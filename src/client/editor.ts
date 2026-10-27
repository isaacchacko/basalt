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

import { ChangeSet, EditorSelection, EditorState, StateEffect, StateField, type Extension, type Text } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown"
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language"
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext } from "@codemirror/autocomplete"
import { tags } from "@lezer/highlight"
import { fetchPage, swapIn } from "./swap"

const root = document.documentElement
let words: Record<string, string> = {}
const say = (key: string, vars: Record<string, string> = {}) => (words[key] ?? key).replace(/\{(\w+)\}/g, (all, k) => vars[k] ?? all)
const article = () => document.querySelector<HTMLElement>("article[data-edit-slug]")

interface Note {
  slug: string
  view: EditorView
  host: HTMLElement
  /** the file as it's saved */
  saved: { text: string; sha: string }
}
let note: Note | null = null

// ---------- on and off ----------

export async function setEditing(on: boolean) {
  if (on && !note) {
    const art = article()
    if (!art) return
    words = JSON.parse(document.querySelector<HTMLElement>("[data-edit-words]")?.dataset.editWords ?? "{}")
    const slug = art.dataset.editSlug!
    const res = await fetch(`/__basalt/source?slug=${encodeURIComponent(slug)}`, { cache: "no-store" })
    if (!res.ok) return status(say("editFailed", { error: String(res.status) }))
    const saved = (await res.json()) as { text: string; sha: string }
    const host = document.createElement("div")
    host.className = "edit-doc"
    art.append(host)
    const view = new EditorView({ parent: host, state: EditorState.create({ doc: saved.text, extensions: extensions() }) })
    note = { slug, view, host, saved }
    root.setAttribute("data-editing", "")
    // the page as it is, block by block, when it's of this text; else rendered afresh
    if (art.dataset.editSha === saved.sha) view.dispatch({ effects: setBlocks.of(learn(view.state.doc, [...art.children] as HTMLElement[], true)) })
    else void render()
    // the cursor at the end, so the note opens drawn, all of it
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) })
    view.focus()
  } else if (!on && note) {
    await leave()
    // the page, once, as it is now
    const doc = await fetchPage()
    if (doc) await swapIn(doc)
  }
  status()
}

async function leave() {
  if (!note) return
  const { view, host } = note
  await save()
  note = null
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

/** Takes in a rendering of `doc`: its top-level elements, each with the lines it came from. Its blocks, in `doc`. */
function learn(doc: Text, elements: Element[], live = false): Block[] {
  const found = new Map<string, { block: Block; nodes: Node[] }>()
  const add = (el: HTMLElement) => {
    const [a, b] = el.dataset.src!.split("-").map(Number)
    if (!(a >= 1 && b >= a && b <= doc.lines)) return
    const block = { from: doc.line(a).from, to: doc.line(b).to }
    const key = doc.sliceString(block.from, block.to)
    found.set(key, { block, nodes: [...(found.get(key)?.nodes ?? []), el] })
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
  const fm = /^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/.exec(doc.toString())
  if (fm) {
    const props = document.createElement("div")
    props.className = "edit-properties"
    props.textContent = fm[0].split("\n").length - 2 + " properties"
    found.set(fm[0], { block: { from: 0, to: fm[0].length }, nodes: [props] })
  }
  // what's drawn for a text already stays drawn (an island running, a diagram drawn)
  for (const [key, { nodes }] of found) {
    if (!live && drawn.has(key)) continue
    drawn.set(key, nodes)
    if (!live) nodes.forEach((n) => unstarted.add(n))
  }
  // one block a span, in order, none overlapping another
  const blocks = [...found.values()].map((f) => f.block).sort((x, y) => x.from - y.from)
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

let timer: ReturnType<typeof setTimeout> | undefined
const changed = EditorView.updateListener.of((u) => {
  if (!u.docChanged) return
  if (pending) pending.since = pending.since.compose(u.changes)
  clearTimeout(timer)
  timer = setTimeout(() => void save().then(render), 300)
  status()
})

let saving: Promise<void> | null = null
async function save(): Promise<void> {
  clearTimeout(timer)
  if (!note) return
  if (saving) return saving.then(save)
  const text = note.view.state.doc.toString()
  if (text === note.saved.text) return
  const n = note
  saving = (async () => {
    const res = await fetch("/__basalt/source", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-basalt-edit": "1" },
      body: JSON.stringify({ slug: n.slug, text, base: n.saved.sha }),
    }).catch(() => undefined)
    if (res?.status === 409) n.saved = await res.json() // changed elsewhere: ours goes over it, next save
    else if (res?.ok) n.saved = { text, sha: (await res.json()).sha }
    else status(say("editFailed", { error: String(res?.status ?? "offline") }))
  })().finally(() => (saving = null))
  await saving
  status()
}

/** a rendering on its way: the edits made since it was asked for */
let pending: { since: ChangeSet } | null = null
async function render() {
  if (!note) return
  const n = note
  const doc = n.view.state.doc
  const mine = (pending = { since: ChangeSet.empty(doc.length) })
  const res = await fetch("/__basalt/render", {
    method: "POST",
    headers: { "content-type": "application/json", "x-basalt-edit": "1" },
    body: JSON.stringify({ slug: n.slug, text: doc.toString() }),
  }).catch(() => undefined)
  if (!res?.ok || note !== n || pending !== mine) return
  pending = null
  const t = document.createElement("template")
  t.innerHTML = (await res.json()).html
  const fresh = learn(doc, [...t.content.children])
  const moved = fresh.map((b) => ({ from: mine.since.mapPos(b.from, -1), to: mine.since.mapPos(b.to, 1) }))
  n.view.dispatch({ effects: setBlocks.of(moved) })
  // what's drawn anew is started the way a page's content is (tabs, diagrams, islands, code's controls)
}

document.addEventListener("keydown", (e) => {
  if (!note || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return
  e.preventDefault()
  void save()
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
    changed,
    closeBrackets(),
    autocompletion({ override: [wikilinks], icons: false }),
    keymap.of([{ key: "ArrowDown", run: into(true) }, { key: "ArrowUp", run: into(false) }, ...closeBracketsKeymap, ...completionKeymap, ...markdownKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
    EditorView.contentAttributes.of({ "aria-label": say("edit") }),
  ]
}
