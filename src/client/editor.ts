// Editing a page in place, the way Obsidian edits a note in Live Preview: the
// page stays the page, and the block you're in shows its markdown, to edit
// right there; everything else stays rendered. ⌘E (or the pencil) turns it on
// and off (edit.ts loads this). In it:
//
//   a click       on a block opens it at that word; on a link, follows it
//   ↑ ↓ ← →       past a block's edge go on into the next one, as the cursor
//                 goes from line to line in Obsidian
//   the pencil    in a block's corner opens one that's all controls (an island, a video)
//   the title     opens the note's frontmatter
//   below it all  starts a new block at the end
//   escape        closes the block; ⌘E leaves editing
//   [[            completes a link to a note
//   enter         goes on with the list or quote you're in
//   ⌘S            saves now (publishes, on a built site)
//
// Each block of the page says which lines of the note it came from
// (data-src, markdown/lines.ts), so a block's markdown is exactly those
// lines, and every other block is drawn the way Basalt draws it.
//
// Where it saves (article[data-edit], Page.astro):
//
//   dev     while serving, through the dev server (integrations/edit.ts), a
//           moment after you stop typing; the save swaps in (swap.ts) with the
//           block you're in kept open across it
//   github  a built site with "edit": committed to the repo with your token
//           when you leave a block (or ⌘S); the deploy that the push sets
//           off comes back into the page once it's live. Till then the blocks
//           you changed show their markdown.
//
// The blocks name their lines in the version of the note the page was made
// from; as you type, they're read through a line diff onto the note as it is
// now (lib/linemap.ts), and so is the open block onto a page swapped in.

import { EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, keymap, placeholder, type DecorationSet, type ViewUpdate } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown"
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language"
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, completionStatus, type CompletionContext } from "@codemirror/autocomplete"
import { tags } from "@lezer/highlight"
import { lineMap, merge, type LineMap } from "../lib/linemap"
import { fetchPage, swapIn } from "./swap"
import { GitHubError, deployed, gitHub, type Version } from "./github"

interface Backend {
  load(): Promise<Version>
  /** writes `text` over the version `base`: its sha, or the file as it is when it's no longer `base` */
  save(text: string, base: string): Promise<{ sha: string } | { conflict: Version }>
}

interface Region {
  /** its first line in `live`, from 1, and its last; to = from - 1 when it has none (a new block) */
  from: number
  to: number
  header: boolean
  view: EditorView
  host: HTMLElement
  /** a new block at the end: it gets a blank line before it once it has something in it */
  append: boolean
  /** its text when it opened */
  opened: string
}

const root = document.documentElement
const PERSIST = "basalt-editor"
const SRC = "[data-src]"

let backend: Backend | undefined
let mode: "dev" | "github" = "dev"
let slug = ""
let words: Record<string, string> = {}
/** the note's file as it's saved, and as it is with the edits in it */
let saved: Version | undefined
let live = ""
let liveVersion = 0
/** the texts the page's blocks may name their lines in: versions of the note, by sha */
const texts = new Map<string, string>()
let region: Region | null = null
let saving: Promise<void> | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
/** github: the commit whose deploy hasn't come back yet */
let deploying: { sha: string; since: number } | null = null
let starting: Promise<boolean> | null = null

const article = (scope: ParentNode = document) => scope.querySelector<HTMLElement>("article[data-edit-slug]")
const say = (key: string, vars: Record<string, string> = {}) => (words[key] ?? key).replace(/\{(\w+)\}/g, (all, k) => vars[k] ?? all)
const lines = (s: string) => s.split("\n")
// a file with Windows line endings: its blocks are edited without them, and get them back in it
const crlf = (text: string) => text.includes("\r\n")
const slice = (text: string, from: number, to: number) => (to < from ? "" : lines(text).slice(from - 1, to).map((l) => l.replace(/\r$/, "")).join("\n"))
const fileLines = (block: string, text: string) => (crlf(text) ? lines(block).map((l) => l + "\r") : lines(block))
const setLive = (text: string) => {
  if (text === live) return
  live = text
  liveVersion++
}

// ---------- on and off ----------

export async function setEditing(on: boolean) {
  if (on) {
    if (!(await start())) return
    root.setAttribute("data-editing", "")
    showAppend()
  } else {
    await close()
    await save()
    root.removeAttribute("data-editing")
    document.querySelectorAll(".edit-append, .edit-pick").forEach((el) => el.remove())
  }
  status()
}

/** after a page comes in (edit.ts): editing goes on in it, or stops on a page with no note */
export async function pageLoaded() {
  if (!root.hasAttribute("data-editing")) return
  if (!article()) return void setEditing(false)
  if (!(await start())) return void setEditing(false)
  showAppend()
  status()
}

/** the note the page is of, loaded (once per note) */
function start(): Promise<boolean> {
  const a = article()
  if (!a) return Promise.resolve(false)
  if (starting && a.dataset.editSlug === slug) return starting
  starting = (async () => {
    words = JSON.parse(document.querySelector<HTMLElement>("[data-edit-words]")?.dataset.editWords ?? "{}")
    slug = a.dataset.editSlug!
    mode = a.dataset.edit === "github" ? "github" : "dev"
    texts.clear()
    if (mode === "dev") backend = devBackend(slug)
    else {
      const repo = a.dataset.editRepo!
      const token = await tokenFor(repo)
      if (!token) return false
      gh = gitHub(repo, token)
      backend = githubBackend(repo, a.dataset.editBranch!, a.dataset.editPath!)
    }
    try {
      saved = await backend.load()
    } catch (err) {
      status(say("editFailed", { error: (err as Error).message }))
      return false
    }
    setLive(saved.text)
    texts.set(saved.sha, saved.text)
    const pageSha = a.dataset.editSha!
    if (mode === "github" && pageSha !== saved.sha) {
      // the page is older than the note (a deploy is on its way): its blocks' lines are the old text's
      const old = await gh!.blob(pageSha).catch(() => undefined)
      if (old !== undefined) texts.set(pageSha, old)
    }
    return true
  })()
  const mine = starting
  // a note that didn't load is tried again next time
  void mine.then((ok) => {
    if (!ok && starting === mine) starting = null
  })
  return mine
}

// ---------- which lines a block is ----------

let cached: { key: string; map: LineMap } | undefined
/** a block's lines, [first, last], in `live` */
function linesOf(el: Element): [number, number] {
  const [a, b] = (el as HTMLElement).dataset.src!.split("-").map(Number)
  const version = el.closest<HTMLElement>("[data-src-sha]")?.dataset.srcSha ?? article()?.dataset.editSha ?? ""
  const from = texts.get(version)
  if (from === undefined || from === live) return [a, b]
  const key = `${version}:${liveVersion}`
  if (cached?.key !== key) cached = { key, map: lineMap(lines(from), lines(live)) }
  return [cached.map.first(a - 1) + 1, cached.map.last(b - 1) + 1]
}

/** the blocks of a page that each stand for some lines of the note, in order: its top-level blocks and its footnotes */
function blocks(scope: ParentNode = document): HTMLElement[] {
  const art = article(scope)
  if (!art) return []
  const top = [...art.children].filter((c): c is HTMLElement => c.matches(SRC) && !c.matches("section[data-footnotes]"))
  return [...top, ...art.querySelectorAll<HTMLElement>("section[data-footnotes] li[data-src]")]
}

/** and the sidenotes, and the margin's copies of them and of margin notes */
const hideable = (scope: ParentNode) => [...blocks(scope), ...scope.querySelectorAll<HTMLElement>(".sidenote[data-src], .sidebar [data-src]")]

const meets = ([a, b]: [number, number], from: number, to: number) => to >= from && a <= to && b >= from

/** The block a click (or tap) was on: what it opens; nothing on a link, a control or an island. */
function blockAt(target: Element): HTMLElement | null {
  const art = article()
  if (!art) return null
  if (target.closest(".edit-append")) return target.closest<HTMLElement>(".edit-append")
  if (target.closest("a[href], button, input, select, textarea, summary, label, audio, video, iframe, island, [role=button], [role=tab], [tabindex], .edit-host, dialog"))
    return null
  const header = target.closest<HTMLElement>(".page-header .popover-hint")
  if (header) return header
  const inMargin = target.closest<HTMLElement>(".sidebar [data-src]")
  if (inMargin) return inMargin
  if (!art.contains(target)) return null
  const el = target.closest<HTMLElement>(SRC)
  // a note embedded in this one is this one's ![[embed]]
  const embed = el?.closest<HTMLElement>(".transclude")
  return embed && art.contains(embed) ? topOf(embed, art) : el
}

const topOf = (el: HTMLElement, art: HTMLElement) => {
  let at = el
  while (at.parentElement && at.parentElement !== art) at = at.parentElement
  return at.matches(SRC) ? at : null
}

function frontmatterLines(text: string): [number, number] {
  const m = /^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/.exec(text)
  return m ? [1, m[0].split("\n").length] : [1, 0]
}

// ---------- a block, open ----------

async function open(target: HTMLElement, caret: { x: number; y: number } | "start" | "end" = "end") {
  if (!(await start())) return
  const header = target.matches(".page-header .popover-hint")
  const append = target.matches(".edit-append")
  await close()
  const all = lines(live)
  let [from, to] = header ? frontmatterLines(live) : append ? [0, 0] : linesOf(target)
  if (append) {
    // before the empty line a file ending in a newline ends with
    from = all.at(-1) === "" ? all.length : all.length + 1
    to = from - 1
  }
  const text = slice(live, from, to)
  // the pencil was for opening it
  picked?.removeAttribute("data-edit-picked")
  picked = null
  document.querySelector(".edit-pick")?.remove()
  const host = document.createElement(target.matches("li") ? "li" : "div")
  host.className = header ? "edit-host edit-host-header" : "edit-host"
  host.setAttribute("data-astro-transition-persist", PERSIST)
  const view = new EditorView({ parent: host, state: EditorState.create({ doc: text, extensions: extensions(header) }) })
  region = { from, to, header, view, host, append, opened: text }
  place(document, region)
  view.focus()
  const pos = caret === "start" ? 0 : caret === "end" ? text.length : caretFor(target, caret, text)
  view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true })
  status()
}

/**
 * Puts the region's editor where its blocks are, in a page (this one, or one
 * about to be swapped in, `version` its note's sha): its blocks hidden, and
 * the editor (in a page to come, a stand-in that Astro swaps it in for)
 * before the first of them.
 */
function place(doc: Document, r: Region, version?: string) {
  const here = doc === document
  const host = here ? r.host : doc.createElement(r.host.tagName.toLowerCase())
  if (!here) {
    host.setAttribute("data-astro-transition-persist", PERSIST)
    host.className = r.host.className
  }
  if (r.header) {
    const head = doc.querySelector<HTMLElement>(".page-header .popover-hint")
    head?.setAttribute("data-edit-hidden", "")
    head?.after(host)
    return
  }
  const art = article(doc)
  if (!art) return
  // the region's lines in the version the page's blocks name theirs in
  let [from, to] = [r.from, r.to]
  const pageText = version ? texts.get(version) : undefined
  if (!here && pageText !== undefined && pageText !== live) {
    const map = lineMap(lines(live), lines(pageText))
    from = map.first(r.from - 1) + 1
    to = r.to < r.from ? from - 1 : map.last(r.to - 1) + 1
  }
  const linesHere = (el: HTMLElement): [number, number] => (here ? linesOf(el) : (el.dataset.src!.split("-").map(Number) as [number, number]))
  const hit = hideable(doc).filter((el) => !el.hasAttribute("data-edit-stale") && meets(linesHere(el), from, to))
  for (const el of hit) el.setAttribute("data-edit-hidden", "")
  const first = hit.find((el) => el.parentElement === art) ?? hit.find((el) => el.matches("li"))
  if (first) return void first.before(host)
  // a footnote's own lines, shown as its sidenote: after the paragraph that cites it
  const note = hit.find((el) => el.matches(".sidenote"))
  const cited = note && art.querySelector(`[data-footnote-ref][data-sidenote="${CSS.escape(note.dataset.sidenote ?? "")}"]`)
  const para = cited && [...art.children].find((c) => c.contains(cited))
  if (para) return void para.after(host)
  // nothing there yet (a new block): after the block before it
  const before = blocks(doc)
    .filter((el) => el.parentElement === art && linesHere(el)[1] < from)
    .pop()
  if (before) before.after(host)
  else art.append(host)
}

async function close() {
  const r = region
  if (!r) return
  region = null
  const text = r.view.state.doc.toString()
  const changed = text !== r.opened
  // the page under the block is already the note as it is (a save came back while it was open)
  const behind = changed && !(saved && live === saved.text && article()?.dataset.editSha === saved.sha)
  document.querySelectorAll("[data-edit-hidden]").forEach((el) => {
    el.removeAttribute("data-edit-hidden")
    // what it showed before the edit: hidden till the page comes back with it
    if (behind) el.setAttribute("data-edit-stale", "")
  })
  if (behind && r.to >= r.from && !r.header) {
    // meanwhile the block shows its markdown
    const pending = document.createElement(r.host.tagName.toLowerCase())
    pending.className = "edit-pending"
    pending.dataset.src = `${r.from}-${r.to}`
    const key = `live:${liveVersion}`
    texts.set(key, live)
    pending.dataset.srcSha = key
    pending.textContent = text
    r.host.replaceWith(pending)
  } else {
    if (behind && r.header) document.querySelectorAll("[data-edit-stale]").forEach((el) => el.removeAttribute("data-edit-stale"))
    r.host.remove()
  }
  r.view.destroy()
  if (changed) await save()
  status()
}

// ---------- typing ----------

function typed(view: EditorView) {
  const r = region
  if (!r || r.view !== view) return
  const all = lines(live)
  const text = view.state.doc.toString()
  const doc = text === "" && r.to < r.from ? [] : fileLines(text, live)
  if (r.append && doc.length) {
    // a new block at the end: a blank line keeps it apart from the one before it
    if (all[r.from - 2]?.trim()) {
      all.splice(r.from - 1, 0, crlf(live) ? "\r" : "")
      r.from++
      r.to++
    }
    r.append = false
  }
  all.splice(r.from - 1, r.to - r.from + 1, ...doc)
  setLive(all.join("\n"))
  r.to = r.from + doc.length - 1
  if (mode === "dev") {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void save(), 300)
  }
  status()
}

/** writes `live`, when it isn't what's saved; again, if it changed meanwhile */
function save(): Promise<void> {
  clearTimeout(saveTimer)
  if (!backend || !saved) return Promise.resolve()
  if (saving) return saving.then(save)
  if (live === saved.text) return Promise.resolve()
  const text = live
  const base = saved
  let again = false
  saving = (async () => {
    status()
    let res: Awaited<ReturnType<Backend["save"]>>
    try {
      res = await backend!.save(text, base.sha)
    } catch (err) {
      status(say("editFailed", { error: (err as Error).message }))
      return
    }
    if ("conflict" in res) {
      // changed elsewhere since (another editor, another commit): the open
      // block goes in over theirs, everything else is as they have it
      texts.set(res.conflict.sha, res.conflict.text)
      rebase(base.text, res.conflict)
      saved = res.conflict
      again = true
      return
    }
    saved = { text, sha: res.sha }
    texts.set(res.sha, text)
    if (mode === "github") {
      deploying = { sha: res.sha, since: Date.now() }
      void waitForDeploy()
    }
  })().finally(() => {
    saving = null
    status()
  })
  return saving.then(() => (again || (mode === "dev" && live !== saved?.text) ? save() : undefined))
}

/** `live` moved onto `now`: the open block as you have it, everything else as `now` has it */
function rebase(base: string, now: Version) {
  const r = region
  // the blocks changed since `base`, closed by now (a commit's on leaving one), as changed
  if (!r) return void setLive(merge(lines(base), lines(live), lines(now.text)).join("\n"))
  const mine = r.view.state.doc.toString()
  const toBase = lineMap(lines(live), lines(base))
  const toNow = lineMap(lines(base), lines(now.text))
  const baseFrom = toBase.first(r.from - 1)
  const baseTo = r.to < r.from ? baseFrom - 1 : toBase.last(r.to - 1)
  const from = toNow.first(baseFrom) + 1
  const to = baseTo < baseFrom ? from - 1 : toNow.last(baseTo) + 1
  const all = lines(now.text)
  const doc = mine === "" ? [] : fileLines(mine, now.text)
  all.splice(from - 1, to - from + 1, ...doc)
  setLive(all.join("\n"))
  r.from = from
  r.to = from + doc.length - 1
}

// ---------- from block to block ----------

function neighbour(dir: -1 | 1): HTMLElement | null {
  const r = region
  if (!r) return null
  const shown = blocks().filter((el) => !el.hasAttribute("data-edit-hidden") && el.checkVisibility())
  const header = document.querySelector<HTMLElement>(".page-header .popover-hint")
  if (r.header) return dir === 1 ? (shown[0] ?? null) : null
  const spans = shown.map((el) => [el, linesOf(el)] as const)
  if (dir === 1) return spans.find(([, [a]]) => a > Math.max(r.to, r.from - 1))?.[0] ?? null
  return spans.filter(([, [, b]]) => b < r.from).pop()?.[0] ?? header
}

/** ↑ ↓ ← → at the block's edge go on into the next block */
const edge = (dir: -1 | 1, by: "line" | "char") => (view: EditorView) => {
  const sel = view.state.selection.main
  if (!sel.empty) return false
  if (by === "char") {
    if (sel.head !== (dir === -1 ? 0 : view.state.doc.length)) return false
  } else {
    // on the first (or last) line as it's drawn, wrapped lines and all
    const moved = view.moveVertically(sel, dir === 1)
    const here = view.coordsAtPos(sel.head)
    const there = view.coordsAtPos(moved.head)
    const sameLine = moved.head === sel.head || !here || !there || (dir === -1 ? there.top >= here.top - 1 : there.bottom <= here.bottom + 1)
    if (!sameLine) return false
  }
  const to = neighbour(dir)
  if (!to) return false
  void open(to, dir === -1 ? "end" : "start")
  return true
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

function extensions(header: boolean): Extension[] {
  return [
    history(),
    EditorView.lineWrapping,
    // GitHub's flavour: tables, ~~strikethrough~~, - [ ] tasks
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(style),
    quietMarks,
    codeLines,
    closeBrackets(),
    // ahead of the completions' own escape, which takes one typed a moment
    // after a key (a completion pending) for closing a list
    Prec.highest(keymap.of([{ key: "Escape", run: (view) => completionStatus(view.state) !== "active" && (void close(), true) }])),
    autocompletion({ override: [wikilinks], icons: false }),
    header ? placeholder("---\ntitle: …\n---") : [],
    keymap.of([
      { key: "ArrowUp", run: edge(-1, "line") },
      { key: "ArrowDown", run: edge(1, "line") },
      { key: "ArrowLeft", run: edge(-1, "char") },
      { key: "ArrowRight", run: edge(1, "char") },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...markdownKeymap,
      ...historyKeymap,
      indentWithTab,
      ...defaultKeymap,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) typed(u.view)
    }),
    EditorView.contentAttributes.of({ "aria-label": say("editBlock") }),
  ]
}

/** Where in a block's markdown a click on its drawn text was: the drawn text before it, found in order in the markdown. */
function caretFor(el: HTMLElement, at: { x: number; y: number }, source: string): number {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
  let node: Node | undefined
  let offset = 0
  const p = doc.caretPositionFromPoint?.(at.x, at.y)
  if (p) [node, offset] = [p.offsetNode, p.offset]
  else {
    const r = document.caretRangeFromPoint?.(at.x, at.y)
    if (r) [node, offset] = [r.startContainer, r.startOffset]
  }
  if (!node || !el.contains(node)) return source.length
  const range = document.createRange()
  range.selectNodeContents(el)
  range.setEnd(node, offset)
  let i = 0
  for (const ch of range.toString().replace(/\s+/g, "")) {
    const j = source.indexOf(ch, i)
    if (j < 0) break
    i = j + 1
  }
  return i
}

// ---------- the page, in editing ----------

function showAppend() {
  const art = article()
  if (!art || art.nextElementSibling?.matches(".edit-append")) return
  const add = document.createElement("div")
  add.className = "edit-append"
  add.textContent = say("editAdd")
  art.after(add)
}

document.addEventListener(
  "click",
  (e) => {
    if (!root.hasAttribute("data-editing") || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
    const target = e.target as Element
    const pen = target.closest(".edit-pick")
    const block = pen ? document.querySelector<HTMLElement>("[data-edit-picked]") : blockAt(target)
    if (!block) {
      // a click away from the open block closes it
      if (region && !target.closest(".edit-host, .cm-tooltip, .edit-status, a[href], button, dialog")) void close()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    void open(block, pen ? "end" : { x: e.clientX, y: e.clientY })
  },
  true,
)

// a block of nothing but controls (an island, a video, a graph) opens from the pencil in its corner
let picked: HTMLElement | null = null
document.addEventListener("pointerover", (e) => {
  if (!root.hasAttribute("data-editing") || (e.target as Element).closest(".edit-pick")) return
  const art = article()
  const el = (e.target as Element).closest<HTMLElement>(SRC)
  // a footnote is a block of its own
  const block = el && art ? (art.contains(el) ? (el.closest<HTMLElement>("section[data-footnotes] li[data-src]") ?? topOf(el, art)) : el) : null
  if (!block || block === picked || block.closest(".edit-host")) return
  picked?.removeAttribute("data-edit-picked")
  picked = block
  block.setAttribute("data-edit-picked", "")
  let pen = document.querySelector<HTMLButtonElement>(".edit-pick")
  if (!pen) {
    pen = document.createElement("button")
    pen.type = "button"
    pen.className = "edit-pick"
    pen.setAttribute("aria-label", say("editBlock"))
    pen.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>'
    document.body.append(pen)
  }
  const box = block.getBoundingClientRect()
  pen.style.top = `${box.top + scrollY}px`
  // beside its top right corner; inside it, where there's no room beside it (a phone)
  pen.style.left = `${Math.min(box.right + 4, document.documentElement.clientWidth - 28) + scrollX}px`
})

document.addEventListener("keydown", (e) => {
  if (!root.hasAttribute("data-editing") || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return
  e.preventDefault()
  void save()
})

// going to another page: what's typed is saved first
document.addEventListener("astro:before-preparation", (e) => {
  if (window.basaltHotSwap || !root.hasAttribute("data-editing")) return
  const ev = e as Event & { loader: () => Promise<void> }
  const load = ev.loader
  ev.loader = async () => {
    await close()
    await save()
    await load()
  }
})

// a newer version of this page swapped in (a save, a deploy): the open block stays open in it
document.addEventListener("basalt:swap-document", (e) => {
  const doc = (e as CustomEvent<Document>).detail
  const sha = article(doc)?.dataset.editSha
  if (sha && !texts.has(sha)) void learn()
  if (region) place(doc, region, sha)
})

// Astro puts the focus back in the editor once it's moved, but at the start
// of it (a contenteditable's caret goes there), and CodeMirror would take
// that for where you are: the caret goes back where it was, in the page
// itself, before the next key lands
let caret: EditorSelection | undefined
document.addEventListener("astro:before-swap", () => {
  caret = region?.view.hasFocus ? region.view.state.selection : undefined
})

document.addEventListener("astro:after-swap", () => {
  picked = null
  const r = region
  if (!r?.host.isConnected || !caret) return
  r.view.focus()
  const { anchor, head } = caret.main
  const a = r.view.domAtPos(anchor)
  const h = r.view.domAtPos(head)
  getSelection()?.setBaseAndExtent(a.node, a.offset, h.node, h.offset)
})

/** someone else's save came in: the note as it is now, taken in when nothing of ours is unsaved */
async function learn() {
  const now = await backend?.load().catch(() => undefined)
  if (!now || !saved) return
  texts.set(now.sha, now.text)
  if (saving || live !== saved.text || now.sha === saved.sha) return
  const r = region
  if (r) {
    const map = lineMap(lines(live), lines(now.text))
    const from = map.first(r.from - 1) + 1
    r.to = r.to < r.from ? from - 1 : map.last(r.to - 1) + 1
    r.from = from
  }
  saved = now
  setLive(now.text)
  if (r) {
    const text = slice(live, r.from, r.to)
    if (text !== r.view.state.doc.toString()) r.view.dispatch({ changes: { from: 0, to: r.view.state.doc.length, insert: text } })
  }
}

window.addEventListener("beforeunload", (e) => {
  if (saved && (live !== saved.text || saving)) e.preventDefault()
})

// ---------- github: the deploy, back ----------

let watching = false
async function waitForDeploy() {
  if (watching) return
  watching = true
  try {
    // till the last commit's deploy is in: one made while swapping one in is waited for too
    while (deploying) {
      const doc = await deployed(fetchPage, (doc) => article(doc)?.dataset.editSha, () => deploying, { tick: () => status() })
      if (!doc) break
      deploying = null
      if (doc === "slow") return void status(say("editSlowDeploy"))
      await swapIn(doc)
      status(say("editLive"))
    }
  } finally {
    watching = false
  }
}

// ---------- the status, in the corner ----------

function status(message?: string) {
  let el = document.querySelector<HTMLElement>(".edit-status")
  if (!root.hasAttribute("data-editing") && !message && !deploying) return void el?.remove()
  if (!el) {
    el = document.createElement("div")
    el.className = "edit-status"
    el.setAttribute("role", "status")
    document.body.append(el)
  }
  const unsaved = !!saved && live !== saved.text
  const state = saving ? "saving" : deploying ? "deploying" : unsaved ? "unsaved" : "idle"
  el.dataset.state = message ? "message" : state
  el.textContent =
    message ??
    {
      saving: say(mode === "github" ? "editPublishing" : "editSaving"),
      deploying: say("editDeploying", { s: String(Math.round((Date.now() - (deploying?.since ?? Date.now())) / 1000)) }),
      unsaved: say(mode === "github" ? "editUnpublished" : "editSaving"),
      idle: say("editing"),
    }[state]
}

// ---------- where a note is saved ----------

function devBackend(slug: string): Backend {
  const url = `/__basalt/source?slug=${encodeURIComponent(slug)}`
  return {
    async load() {
      const res = await fetch(url, { cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    },
    async save(text, base) {
      const res = await fetch("/__basalt/source", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-basalt-edit": "1" },
        body: JSON.stringify({ slug, text, base }),
      })
      if (res.status === 409) return { conflict: await res.json() }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? String(res.status))
      return res.json()
    },
  }
}

let gh: ReturnType<typeof gitHub> | undefined
const tokenKey = (repo: string) => `basalt-github-token:${repo}`

/** the token for the repo: kept in this browser, else asked for */
async function tokenFor(repo: string): Promise<string | undefined> {
  let token: string | null = null
  try {
    token = localStorage.getItem(tokenKey(repo))
  } catch {}
  return (token ?? (await connect(repo))) || undefined
}

function forget(repo: string) {
  try {
    localStorage.removeItem(tokenKey(repo))
  } catch {}
  root.removeAttribute("data-edit-connected")
}

function githubBackend(repo: string, branch: string, path: string): Backend {
  const forgetting = (err: unknown) => {
    if (err instanceof GitHubError && err.status === 401) forget(repo)
    throw err
  }
  return {
    load: () => gh!.read(path, branch).catch(forgetting),
    save: (text, base) => gh!.write(path, branch, text, base, say("editCommit", { path })).catch(forgetting),
  }
}

/** Asks for a token for the repo, once, in a dialog, and checks it can write there. */
function connect(repo: string): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog")
    dialog.className = "edit-connect"
    dialog.innerHTML = `<form method="dialog">
      <h2></h2><p class="edit-connect-help"></p>
      <label><span></span><input name="token" type="password" autocomplete="off" spellcheck="false" required></label>
      <p class="edit-connect-error" hidden></p>
      <menu><a target="_blank" rel="noopener"></a><button type="button"></button><button type="submit"></button></menu>
    </form>`
    dialog.querySelector("h2")!.textContent = say("editConnect")
    dialog.querySelector(".edit-connect-help")!.textContent = say("editTokenHelp", { repo })
    dialog.querySelector("label span")!.textContent = say("editToken")
    const link = dialog.querySelector("a")!
    link.textContent = say("editMakeToken")
    link.href = `https://github.com/settings/personal-access-tokens/new?name=${encodeURIComponent(`Basalt ${repo}`)}`
    const [cancel, ok] = dialog.querySelectorAll("button")
    cancel.textContent = say("editCancel")
    ok.textContent = say("editConnectButton")
    const input = dialog.querySelector("input")!
    const error = dialog.querySelector<HTMLElement>(".edit-connect-error")!
    const done = (token: string | null) => {
      dialog.close()
      dialog.remove()
      resolve(token)
    }
    cancel.addEventListener("click", () => done(null))
    dialog.addEventListener("cancel", () => done(null))
    dialog.querySelector("form")!.addEventListener("submit", async (e) => {
      e.preventDefault()
      const token = input.value.trim()
      if (!(await gitHub(repo, token).canPush())) {
        error.hidden = false
        error.textContent = say("editTokenWrong", { repo })
        return
      }
      try {
        localStorage.setItem(tokenKey(repo), token)
      } catch {}
      root.setAttribute("data-edit-connected", "")
      done(token)
    })
    document.body.append(dialog)
    dialog.showModal()
  })
}
