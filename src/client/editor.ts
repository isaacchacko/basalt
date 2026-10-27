// Editing a page in place, the way Obsidian's Live Preview edits a note: the
// whole note is one CodeMirror document, and every block of it the cursor
// isn't in is drawn the way Basalt draws it. ⌘E (or the pencil) turns it on
// and off (edit.ts loads this). Everything else is CodeMirror's own: arrows
// and selection across blocks, undo, the clipboard, IME.
//
// A block is drawn from its rendered html, found by its text: the page's own
// elements to begin with (each has the lines it came from, data-src,
// markdown/lines.ts), and, for text that's new, the dev server's rendering of
// the note as it's typed (POST /__basalt/render). The same text is always the
// same nodes, moved, not made again, so an island keeps running and a diagram
// stays drawn. While editing, the page isn't swapped for a save: the editor
// is the page. Turning editing off swaps the page in once.

import { Annotation, ChangeSet, EditorSelection, EditorState, StateEffect, StateField, Text, type Extension } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown"
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language"
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext } from "@codemirror/autocomplete"
import { tags } from "@lezer/highlight"
import { lineMap } from "../lib/linemap"
import { diff } from "./diff"
import { devBackend, type Backend, type EditorHooks, type Version } from "./backend"

declare global {
  interface Window {
    /** the note being edited, for scripts that drive it (the edit proof) */
    basaltEdit?: {
      view: EditorView
      /** its blocks: their lines now (from 1), and whether each is drawn (its box) or open */
      blocks(): { from: number; to: number; lines: [number, number]; drawn: boolean; dom: HTMLElement | null }[]
      /** once nothing's waiting to be saved or rendered, and the last rendering is drawn */
      idle(): Promise<void>
      /** the sha of the file as it's saved */
      saved(): string
    }
  }
}

const root = document.documentElement
let words: Record<string, string> = {}
const say = (key: string, vars: Record<string, string> = {}) => (words[key] ?? key).replace(/\{(\w+)\}/g, (all, k) => vars[k] ?? all)
const article = () => document.querySelector<HTMLElement>("article[data-edit-slug]")

interface Note {
  backend: Backend
  view: EditorView
  host: HTMLElement
  /** the file as it's saved */
  saved: Version
  /** the edits made since it was saved */
  mine: ChangeSet
}
let note: Note | null = null

const hooks: EditorHooks = {
  learn(text, html) {
    if (!note) return
    const elements = typeof html === "string" ? parse(html) : html
    note.view.dispatch({ effects: setBlocks.of(learn(text, elements)) })
  },
  status: (message) => status(message),
}

// ---------- on and off ----------

export async function setEditing(on: boolean) {
  if (on && !note) {
    const art = article()
    if (!art) return
    words = JSON.parse(document.querySelector<HTMLElement>("[data-edit-words]")?.dataset.editWords ?? "{}")
    const backend =
      art.dataset.edit === "github" ? await import("./github").then((m) => m.githubBackend(art, hooks)) : devBackend(art.dataset.editSlug!)
    if (!backend) return
    let saved: Version
    try {
      saved = await backend.load()
    } catch (err) {
      return status(say("editFailed", { error: (err as Error).message }))
    }
    const host = document.createElement("div")
    host.className = "edit-doc"
    host.setAttribute("data-edit-doc", "")
    art.append(host)
    const view = new EditorView({ parent: host, state: EditorState.create({ doc: saved.text, extensions: extensions() }) })
    note = { backend, view, host, saved, mine: ChangeSet.empty(saved.text.length) }
    window.basaltEdit = {
      view,
      blocks: () =>
        view.state.field(blocks).map((b) => {
          const dom = [...view.contentDOM.querySelectorAll<HTMLElement>(":scope > .edit-drawn")].find((box) => view.posAtDOM(box) === b.from) ?? null
          const drawn = view.state.field(drawing).iter(b.from).from === b.from
          return { ...b, lines: [view.state.doc.lineAt(b.from).number, view.state.doc.lineAt(b.to).number] as [number, number], drawn, dom }
        }),
      idle: async () => {
        while (timer !== undefined || saving || renders > 0) await new Promise((r) => setTimeout(r, 25))
      },
      saved: () => (note ?? { saved }).saved.sha,
    }
    root.setAttribute("data-editing", "")
    // the page as it is, block by block, when it's of this text; else rendered afresh
    if (art.dataset.editSha === saved.sha) view.dispatch({ effects: setBlocks.of(learn(saved.text, [...art.children], true)) })
    else void render()
    // the cursor at the end, so the note opens drawn, all of it
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) })
    view.focus()
  } else if (!on && note) {
    const { backend } = note
    await leave()
    await backend.close?.()
  }
  status()
}

async function leave() {
  if (!note) return
  const { view, host } = note
  await save()
  note = null
  window.basaltEdit = undefined
  root.removeAttribute("data-editing")
  view.destroy()
  host.remove()
}

/** after a page comes in: editing goes on, on the next page */
export async function pageLoaded() {
  if (!root.hasAttribute("data-editing") || note) return
  root.removeAttribute("data-editing")
  if (article()) await setEditing(true)
}

// going to another page: what's typed is saved first
document.addEventListener("astro:before-preparation", (e) => {
  if (!note || window.basaltHotSwap) return
  const ev = e as Event & { loader: () => Promise<void> }
  const load = ev.loader
  ev.loader = async () => {
    await leave()
    root.setAttribute("data-editing", "")
    await load()
  }
})

// ---------- the note's blocks, drawn ----------

/** a block's text → its drawn nodes: the same text, the same nodes */
const drawn = new Map<string, Node[]>()
/** which rendering a text's nodes came from (0: the page's own), for the edit proof */
const renderedBy = new Map<string, number>()
/** nodes rendered anew that haven't been started as a page's content is (tabs, diagrams, islands, code's controls) */
const unstarted = new WeakSet<Node>()
let starting = 0
/** Starts the page's content again once what's just been drawn is in it (Basalt's parts start over the whole page). */
function startDrawn(nodes: Node[]) {
  if (!nodes.some((n) => unstarted.has(n))) return
  nodes.forEach((n) => unstarted.delete(n))
  cancelAnimationFrame(starting)
  starting = requestAnimationFrame(() => document.dispatchEvent(new Event("astro:page-load")))
}

interface Block {
  from: number
  to: number
}

const parse = (html: string) => {
  const t = document.createElement("template")
  t.innerHTML = html
  return [...t.content.children]
}

/**
 * Takes in a rendering of `text` (its top-level elements, each with the
 * lines it came from): the nodes for each block's text. Its blocks, in the
 * note as it is now: where `text` isn't the note as it is now, the blocks
 * whose lines are still there, word for word.
 */
function learn(text: string, elements: Element[], live = false): Block[] {
  const lines = text.split("\n")
  const found = new Map<string, { lines: [number, number]; nodes: Node[] }>()
  const add = (el: HTMLElement) => {
    const [a, b] = el.dataset.src!.split("-").map(Number)
    if (!(a >= 1 && b >= a && b <= lines.length)) return
    const key = lines.slice(a - 1, b).join("\n")
    found.set(key, { lines: [a, b], nodes: [...(found.get(key)?.nodes ?? []), el] })
  }
  for (const el of elements as HTMLElement[]) {
    if (!el.dataset?.src) continue
    // the footnotes, each a block of its own
    if (el.matches("section[data-footnotes]")) {
      for (const li of el.querySelectorAll<HTMLElement>("li[data-src]")) {
        const ol = document.createElement("ol")
        ol.className = "edit-footnote"
        ol.start = [...li.parentElement!.children].indexOf(li) + 1
        ol.dataset.src = li.dataset.src
        ol.append(live ? li : li.cloneNode(true))
        add(ol)
      }
      continue
    }
    add(el)
  }
  // the frontmatter, as Obsidian's properties: a quiet line
  const fm = /^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/.exec(text)
  if (fm) {
    const props = document.createElement("div")
    props.className = "edit-properties"
    props.textContent = `${fm[0].split("\n").length - 2} properties`
    found.set(fm[0], { lines: [1, fm[0].split("\n").length], nodes: [props] })
  }
  // what's drawn for a text already stays drawn (an island running, a diagram drawn)
  for (const [key, { nodes }] of found) {
    if (!live && drawn.has(key)) continue
    drawn.set(key, nodes)
    renderedBy.set(key, live ? 0 : rendering)
    if (!live) nodes.forEach((n) => unstarted.add(n))
  }
  // where those lines are in the note as it is now
  const doc = note?.view.state.doc ?? Text.of(lines)
  const now = doc.toString()
  const map = now === text ? null : lineMap(lines, now.split("\n"))
  const blocks: Block[] = []
  for (const [key, { lines: [a, b] }] of found) {
    const [x, y] = map ? [map.first(a - 1) + 1, map.last(b - 1) + 1] : [a, b]
    if (x < 1 || y > doc.lines) continue
    const block = { from: doc.line(x).from, to: doc.line(y).to }
    if (!map || doc.sliceString(block.from, block.to) === key) blocks.push(block)
  }
  // one block a span, in order, none overlapping another
  blocks.sort((p, q) => p.from - q.from)
  return blocks.filter((b, i) => i === 0 || b.from > blocks[i - 1].to)
}

const setBlocks = StateEffect.define<Block[]>()

/** the note's blocks as last rendered, moved along as it's typed in */
const blocks = StateField.define<Block[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setBlocks)) return e.value
    if (!tr.docChanged) return value
    return value.map((b) => ({ from: tr.changes.mapPos(b.from, -1), to: tr.changes.mapPos(b.to, 1) }))
  },
})

class Drawn extends WidgetType {
  constructor(readonly key: string) {
    super()
  }
  eq(other: Drawn) {
    return other.key === this.key
  }
  toDOM(view: EditorView) {
    const box = document.createElement("div")
    box.className = "edit-drawn"
    box.dataset.rendered = String(renderedBy.get(this.key) ?? 0)
    const nodes = drawn.get(this.key) ?? []
    box.append(...nodes)
    startDrawn(nodes)
    box.addEventListener("mousedown", (e) => reveal(view, box, this.key, e))
    return box
  }
  ignoreEvent() {
    return true
  }
}

/** Every block the selection isn't in (or at the edge of), drawn. */
const drawing = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_value, tr) {
    const { doc, selection } = tr.state
    const out = []
    for (const b of tr.state.field(blocks)) {
      if (selection.ranges.some((r) => r.from <= b.to && r.to >= b.from)) continue
      const key = doc.sliceString(b.from, b.to)
      if (drawn.has(key)) out.push(Decoration.replace({ widget: new Drawn(key), block: true }).range(b.from, b.to))
    }
    return Decoration.set(out)
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** each drawn block says which lines of the note it is now (data-lines), for whatever drives the page (the edit proof) */
const lines = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.mark(view)
    }
    update(u: ViewUpdate) {
      this.mark(u.view)
    }
    mark(view: EditorView) {
      const { doc } = view.state
      for (const box of view.contentDOM.querySelectorAll<HTMLElement>(":scope > .edit-drawn")) {
        const from = view.posAtDOM(box)
        const block = view.state.field(blocks).find((b) => b.from === from)
        if (block) box.dataset.lines = `${doc.lineAt(block.from).number}-${doc.lineAt(block.to).number}`
      }
    }
  },
)

/** ↑ ↓ into a drawn block, not over it: the cursor goes to its edge, and it opens */
const into = (forward: boolean) => (view: EditorView) => {
  const sel = view.state.selection.main
  if (!sel.empty) return false
  const target = view.moveVertically(sel, forward).head
  let hit: { from: number; to: number } | null = null
  view.state.field(drawing).between(Math.min(sel.head, target), Math.max(sel.head, target), (from, to) => {
    if (forward ? from < sel.head : to > sel.head) return
    if (!hit || (forward ? from < hit.from : to > hit.to)) hit = { from, to }
  })
  if (!hit) return false
  const { from, to } = hit
  view.dispatch({ selection: EditorSelection.cursor(forward ? from : to), scrollIntoView: true })
  return true
}

/** A click on a drawn block (not on a link or a control in it): the cursor goes where it was, in its markdown. */
function reveal(view: EditorView, box: HTMLElement, key: string, e: MouseEvent) {
  const target = e.target as Element
  if (e.button !== 0 || target.closest("a[href], button, input, select, textarea, summary, label, audio, video, iframe, [role=button], [role=tab], .island")) return
  e.preventDefault()
  const from = view.posAtDOM(box)
  view.dispatch({ selection: EditorSelection.cursor(from + offsetIn(box, e, key)) })
  view.focus()
}

/** Where in a block's markdown a click on its drawn text was: the drawn text before it, found in order in the markdown. */
function offsetIn(box: HTMLElement, at: { clientX: number; clientY: number }, source: string): number {
  const r = document.caretRangeFromPoint?.(at.clientX, at.clientY)
  if (!r || !box.contains(r.startContainer)) return source.length
  const range = document.createRange()
  range.selectNodeContents(box)
  range.setEnd(r.startContainer, r.startOffset)
  let i = 0
  for (const ch of range.toString().replace(/\s+/g, "")) {
    const j = source.indexOf(ch, i)
    if (j < 0) break
    i = j + 1
  }
  return i
}

// ---------- saving, and drawing what's new ----------

/** a change of theirs (a save from elsewhere): not one of the edits being saved */
const theirs = Annotation.define<boolean>()

/** the block the cursor's in (or at the edge of), if it's in one */
const blockAt = (state: EditorState) => {
  const { head } = state.selection.main
  return state.field(blocks).find((b) => b.from <= head && head <= b.to)
}

let timer: ReturnType<typeof setTimeout> | undefined
const changed = EditorView.updateListener.of((u) => {
  const n = note
  if (!n || n.view !== u.view) return
  if (u.docChanged && !u.transactions.some((tr) => tr.annotation(theirs))) n.mine = n.mine.compose(u.changes)
  if (n.backend.saveOn === "idle") {
    if (!u.docChanged) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void save().then(render)
    }, 300)
  } else if (u.selectionSet) {
    // a block changed and left: saved (a commit, on GitHub)
    const was = blockAt(u.startState)
    const is = blockAt(u.state)
    const left = was && (!is || is.from !== u.changes.mapPos(was.from))
    if (left && u.state.doc.toString() !== n.saved.text) void save().then(render)
  }
  status()
})

let saving: Promise<void> | null = null
async function save(): Promise<void> {
  clearTimeout(timer)
  timer = undefined
  const n = note
  if (!n) return
  if (saving) return saving.then(save)
  const text = n.view.state.doc.toString()
  if (text === n.saved.text) return
  const base = n.saved
  // what's typed from here on is saved next time
  const sent = n.mine
  n.mine = ChangeSet.empty(text.length)
  let again = false
  saving = (async () => {
    try {
      const res = await n.backend.save(text, base.sha)
      if ("conflict" in res) {
        rebase(n, base, sent, res.conflict)
        again = true
      } else n.saved = { text, sha: res.sha }
    } catch (err) {
      n.mine = sent.compose(n.mine)
      status(say("editFailed", { error: (err as Error).message }))
    }
  })().finally(() => (saving = null))
  await saving
  status()
  if (again) await save()
}

/**
 * The note changed elsewhere since `base` (another editor, an agent, another
 * commit): their changes go into the editor as changes of its own, over ours,
 * so the cursor and everything typed stay where they are. Where both changed
 * the same lines, ours come after theirs.
 */
function rebase(n: Note, base: Version, sent: ChangeSet, now: Version) {
  const ours = sent.compose(n.mine)
  const them = diff(base.text, now.text)
  n.view.dispatch({ changes: them.map(ours), annotations: theirs.of(true) })
  n.mine = ours.map(them, true)
  n.saved = now
}

let rendering = 0
/** renderings asked for and not yet in */
let renders = 0
async function render() {
  const n = note
  if (!n) return
  const text = n.view.state.doc.toString()
  const mine = ++rendering
  renders++
  const html = await n.backend.render(text).catch(() => null)
  renders--
  // a rendering of what's typed by now may be on its way already
  if (html === null || note !== n || mine !== rendering) return
  hooks.learn(text, html)
}

document.addEventListener("keydown", (e) => {
  if (!note || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return
  e.preventDefault()
  void save().then(render)
})

// ---------- the status, in the corner ----------

function status(message?: string) {
  let el = document.querySelector<HTMLElement>(".edit-status")
  if (!note && !message) return void el?.remove()
  if (!el) {
    el = document.createElement("div")
    el.className = "edit-status"
    el.setAttribute("role", "status")
    document.body.append(el)
  }
  const unsaved = !!note && note.view.state.doc.toString() !== note.saved.text
  el.dataset.state = message ? "message" : saving || unsaved ? "saving" : "idle"
  el.textContent = message ?? (saving || unsaved ? say("editSaving") : say("editing"))
}

// ---------- the editor ----------

const style = HighlightStyle.define([
  { tag: tags.heading1, class: "md-h md-h1" },
  { tag: tags.heading2, class: "md-h md-h2" },
  { tag: tags.heading3, class: "md-h md-h3" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], class: "md-h md-h4" },
  { tag: tags.emphasis, class: "md-em" },
  { tag: tags.strong, class: "md-strong" },
  { tag: tags.strikethrough, class: "md-strike" },
  { tag: [tags.link, tags.url], class: "md-link" },
  { tag: tags.monospace, class: "md-code" },
  { tag: tags.quote, class: "md-quote" },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.meta, tags.comment], class: "md-mark" },
  { tag: tags.list, class: "md-list" },
])

/** Live Preview's quiet marks: off the lines the cursor is on, a heading's #, emphasis's * and _, ~~ and inline code's ` don't show. */
const quietMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = this.build(u.view)
    }
    build(view: EditorView): DecorationSet {
      const { doc, selection } = view.state
      const active = new Set(selection.ranges.flatMap((r) => [doc.lineAt(r.from).number, doc.lineAt(r.to).number]))
      const hide = Decoration.replace({})
      const out = []
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            const name = node.name
            const quiet = name === "EmphasisMark" || name === "StrikethroughMark" || name === "HeaderMark" || (name === "CodeMark" && node.node.parent?.name === "InlineCode")
            if (!quiet || active.has(doc.lineAt(node.from).number)) return
            // a heading's # takes its space with it
            const end = name === "HeaderMark" && doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to
            if (end > node.from) out.push(hide.range(node.from, end))
          },
        })
      }
      return Decoration.set(out, true)
    }
  },
  { decorations: (v) => v.decorations },
)

/** the lines of a code block, a table or raw html, in the code font, as they line up */
const CODE_LINES = new Set(["FencedCode", "CodeBlock", "Table", "HTMLBlock"])
const codeLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = this.build(u.view)
    }
    build(view: EditorView): DecorationSet {
      const { doc } = view.state
      const line = Decoration.line({ class: "md-code-line" })
      const out = []
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            if (!CODE_LINES.has(node.name)) return
            for (let n = doc.lineAt(node.from).number; n <= doc.lineAt(node.to).number; n++) out.push(line.range(doc.line(n).from))
            return false
          },
        })
      }
      return Decoration.set(out, true)
    }
  },
  { decorations: (v) => v.decorations },
)

/**
 * Beside a mark that's hidden, the browser turns the space before it into a
 * no-break one as you type, and CodeMirror reads that back: a space it turned
 * stays a space (one typed as one, ⌥space, stays).
 */
const keepSpaces = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent("input")) return tr
  const fixes: { from: number; to: number; insert: string }[] = []
  tr.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
    const text = inserted.toString()
    if (!text.includes("\u00a0") || !tr.startState.sliceDoc(fromA, toA).includes(" ")) return
    for (let i = text.indexOf("\u00a0"); i >= 0; i = text.indexOf("\u00a0", i + 1)) fixes.push({ from: fromB + i, to: fromB + i + 1, insert: " " })
  })
  return fixes.length ? [tr, { changes: fixes, sequential: true }] : tr
})

let index: Promise<{ label: string; detail: string; apply: string }[]> | undefined
/** the site's notes, for [[: a name that's the only one of its kind on its own, else its path */
const notes = () =>
  (index ??= fetch("/static/contentIndex.json")
    .then((r) => r.json())
    .then((all: Record<string, { title?: string; filePath?: string }>) => {
      const named = Object.values(all).filter((n) => n.filePath?.endsWith(".md"))
      const base = (p: string) => p.split("/").pop()!
      const count = new Map<string, number>()
      for (const n of named) count.set(base(n.filePath!.slice(0, -3)), (count.get(base(n.filePath!.slice(0, -3))) ?? 0) + 1)
      return named.map((n) => {
        const name = n.filePath!.slice(0, -3)
        return { label: n.title ?? base(name), detail: name, apply: count.get(base(name))! > 1 ? name : base(name) }
      })
    })
    .catch(() => []))

async function wikilinks(ctx: CompletionContext) {
  const before = ctx.matchBefore(/\[\[[^\]\n|#]*$/)
  if (!before) return null
  const all = await notes()
  return {
    from: before.from + 2,
    validFor: /^[^\]\n|#]*$/,
    options: all.map((n) => ({
      label: n.label,
      detail: n.detail,
      apply: (view: EditorView, _c: unknown, from: number, to: number) => {
        // closeBrackets has usually put the ]] there already
        const closed = view.state.sliceDoc(to, to + 2) === "]]"
        view.dispatch({ changes: { from, to, insert: n.apply + (closed ? "" : "]]") }, selection: { anchor: from + n.apply.length + 2 } })
      },
    })),
  }
}

function extensions(): Extension[] {
  return [
    history(),
    EditorView.lineWrapping,
    // GitHub's flavour: tables, ~~strikethrough~~, - [ ] tasks
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(style),
    quietMarks,
    keepSpaces,
    codeLines,
    blocks,
    drawing,
    lines,
    changed,
    closeBrackets(),
    autocompletion({ override: [wikilinks], icons: false }),
    keymap.of([{ key: "ArrowDown", run: into(true) }, { key: "ArrowUp", run: into(false) }, ...closeBracketsKeymap, ...completionKeymap, ...markdownKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
    EditorView.contentAttributes.of({ "aria-label": say("edit") }),
  ]
}
