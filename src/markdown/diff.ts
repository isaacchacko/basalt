// ```diff fences and embedded .diff / .patch files, drawn as a code review
// draws a change. This runs before rehype-pretty-code and emits its markup
// (figure > figcaption + pre > code > [data-line]), so code blocks' bars,
// themes, reach and compare anchors work on a diff unchanged. Each side of a
// hunk is highlighted on its own, so a removed line is coloured as the code
// it was in.

import type { Element, ElementContent, Properties, Root } from "hast"
import { visit } from "unist-util-visit"
import { bundledLanguages, createHighlighter, type BundledLanguage, type Highlighter, type ThemedToken } from "shiki"

type Kind = "add" | "del" | "ctx" | "hunk" | "file" | "note"

export interface DiffLine {
  kind: Kind
  text: string
  old?: number
  new?: number
}

export interface DiffFile {
  from?: string
  to?: string
  status?: "new file" | "deleted" | "renamed" | "binary"
  lines: DiffLine[]
}

const HUNK = /^@@+ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@+(.*)$/
const GIT = /^diff --git (?:"?a\/)?(.+?)"? (?:"?b\/)?(.+?)"?$/
const GIT_HEADER =
  /^(index |old mode |new mode |similarity index |dissimilarity index |copy from |copy to |new file mode|deleted file mode|rename |Binary files |GIT binary patch)/

/** `--- a/x.ts` -> x.ts; `/dev/null` -> undefined */
function pathOf(line: string): string | undefined {
  const p = line.slice(4).replace(/\t.*$/, "").replace(/^"|"$/g, "")
  return p === "/dev/null" ? undefined : p.replace(/^[ab]\//, "")
}

/** A unified diff's files: git's output, `diff -u`'s, or bare +/- lines. */
export function parseDiff(src: string): DiffFile[] {
  const rows = src.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n")
  const hasHeaders = rows.some((r, i) => GIT.test(r) || HUNK.test(r) || (r.startsWith("--- ") && rows[i + 1]?.startsWith("+++ ")))
  const files: DiffFile[] = []
  let file: DiffFile | undefined
  // what's left of the open hunk, by its header's counts
  let oldLeft = 0
  let newLeft = 0
  let oldNo: number | undefined
  let newNo: number | undefined
  const open = () => {
    file = { lines: [] }
    files.push(file)
    return file
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    // inside a hunk every line starts with its sign (or is a context line
    // emptied by an editor); anything else is a header, whatever the counts said
    const inHunk = (oldLeft > 0 || newLeft > 0) && (row === "" || "+- \\".includes(row[0]))
    if (!inHunk) {
      const git = GIT.exec(row)
      if (git) {
        open().from = git[1]
        file!.to = git[2]
        continue
      }
      if (row.startsWith("--- ") && rows[i + 1]?.startsWith("+++ ")) {
        // a --- after `diff --git` belongs to it; otherwise it starts a file
        const f = file && !file.lines.length && file.from !== undefined ? file : open()
        f.from = pathOf(row)
        f.to = pathOf(rows[++i])
        if (!f.from) f.status = "new file"
        else if (!f.to) f.status = "deleted"
        continue
      }
      if (file && !file.lines.length) {
        if (row.startsWith("new file mode")) file.status = "new file"
        else if (row.startsWith("deleted file mode")) file.status = "deleted"
        else if (row.startsWith("rename from ")) (file.from = row.slice(12)), (file.status = "renamed")
        else if (row.startsWith("rename to ")) file.to = row.slice(10)
        else if (row.startsWith("Binary files ")) file.status = "binary"
        if (GIT_HEADER.test(row)) continue
      }
      const hunk = HUNK.exec(row)
      if (hunk || row.startsWith("@@")) {
        const f = file ?? open()
        oldNo = hunk ? Number(hunk[1]) : undefined
        newNo = hunk ? Number(hunk[3]) : undefined
        oldLeft = hunk ? Number(hunk[2] ?? 1) : Infinity
        newLeft = hunk ? Number(hunk[4] ?? 1) : Infinity
        f.lines.push({ kind: "hunk", text: row })
        continue
      }
      // a commit's message, a patch's stat: what comes before the first file
      if (hasHeaders && !file) continue
    }

    const f = file ?? open()
    const sign = row[0]
    if (sign === "\\") {
      f.lines.push({ kind: "note", text: row })
      continue
    }
    const kind: Kind = sign === "+" ? "add" : sign === "-" ? "del" : "ctx"
    // an editor that trims trailing spaces leaves a context line empty
    const text = sign === "+" || sign === "-" || sign === " " ? row.slice(1) : row
    const line: DiffLine = { kind, text }
    if (kind !== "add") {
      if (oldNo !== undefined) line.old = oldNo++
      oldLeft--
    }
    if (kind !== "del") {
      if (newNo !== undefined) line.new = newNo++
      newLeft--
    }
    f.lines.push(line)
  }
  return files
}

// ---------- word by word: what changed inside a changed line ----------

const WORDS = /\w+|\s+|[^\w\s]/g

/**
 * The parts of `a` and of `b` that aren't in both, as [start, end) ranges,
 * from the longest run of words the two share; none when the lines have too
 * little in common for the marks to mean anything.
 */
export function wordDiff(a: string, b: string): [Array<[number, number]>, Array<[number, number]>] | null {
  const x = a.match(WORDS) ?? []
  const y = b.match(WORDS) ?? []
  if (!x.length || !y.length || x.length * y.length > 160_000) return null
  // lcs[i][j]: how much x[i..] and y[j..] share, counted in characters
  const lcs = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1))
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + x[i].length : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const shared = lcs[0][0]
  if (shared === 0 || shared < 0.4 * Math.max(a.trim().length, b.trim().length)) return null

  const kept = [new Set<number>(), new Set<number>()]
  for (let i = 0, j = 0; i < x.length && j < y.length; ) {
    if (x[i] === y[j]) kept[0].add(i++), kept[1].add(j++)
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++
    else j++
  }
  const ranges = (line: string, words: string[], keep: Set<number>) => {
    const out: Array<[number, number]> = []
    let at = 0
    words.forEach((w, k) => {
      const end = at + w.length
      const last = out.at(-1)
      if (!keep.has(k)) {
        // two changes with only a space between read as one
        if (last && (last[1] === at || /^\s$/.test(line.slice(last[1], at)))) last[1] = end
        else out.push([at, end])
      }
      at = end
    })
    // a change that's only spaces isn't worth a mark
    return out.filter(([s, e]) => line.slice(s, e).trim() !== "")
  }
  return [ranges(a, x, kept[0]), ranges(b, y, kept[1])]
}

// ---------- highlighting ----------

const THEMES = { light: "github-light", dark: "github-dark" } as const
let highlighter: Promise<Highlighter> | undefined

/** shiki's name for a file's language, from its extension or name */
export function languageOf(path: string | undefined): string | undefined {
  if (!path) return undefined
  const name = path.split("/").pop()!.toLowerCase()
  const ext = name.includes(".") ? name.split(".").pop()! : name
  return [ext, name].find((l) => l in bundledLanguages)
}

async function tokenize(lines: string[], language: string | undefined): Promise<ThemedToken[][]> {
  if (!language || !(language in bundledLanguages) || !lines.length) return lines.map((l) => [{ content: l, offset: 0 }])
  const lang = language as BundledLanguage
  highlighter ??= createHighlighter({ themes: Object.values(THEMES), langs: [] })
  const h = await highlighter
  if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(lang)
  return h.codeToTokens(lines.join("\n"), { lang, themes: THEMES, defaultColor: false }).tokens
}

// ---------- the block ----------

const el = (tagName: string, properties: Properties = {}, children: ElementContent[] = []): Element => ({
  type: "element",
  tagName,
  properties,
  children,
})
const text = (value: string): ElementContent => ({ type: "text", value })
const styleOf = (t: ThemedToken) =>
  t.htmlStyle ? Object.entries(t.htmlStyle).map(([k, v]) => `${k}:${v}`).join(";") : undefined

/** A line's tokens, cut and wrapped where its changed words start and end. */
function tokens(line: ThemedToken[], marks: Array<[number, number]> = []): ElementContent[] {
  const out: ElementContent[] = []
  let mark: { range: number; el: Element } | undefined
  let at = 0
  for (const t of line) {
    const cuts = new Set([0, t.content.length])
    for (const [s, e] of marks) for (const c of [s - at, e - at]) if (c > 0 && c < t.content.length) cuts.add(c)
    const points = [...cuts].sort((p, q) => p - q)
    for (let k = 0; k + 1 < points.length; k++) {
      const start = at + points[k]
      const style = styleOf(t)
      const span = el("span", style ? { style } : {}, [text(t.content.slice(points[k], points[k + 1]))])
      const range = marks.findIndex(([s, e]) => start >= s && start < e)
      if (range < 0) {
        mark = undefined
        out.push(span)
        continue
      }
      if (mark?.range !== range) out.push((mark = { range, el: el("span", { className: ["diff-word"] }) }).el)
      mark.el.children.push(span)
    }
    at += t.content.length
  }
  return out
}

/**
 * In a run of removed lines then added ones, the i-th of each are taken to be
 * one line, changed: the words that differ, for each.
 */
function changedWords(hunk: DiffLine[]): Map<DiffLine, Array<[number, number]>> {
  const marks = new Map<DiffLine, Array<[number, number]>>()
  for (let i = 0; i < hunk.length; ) {
    if (hunk[i].kind !== "del") {
      i++
      continue
    }
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (hunk[i]?.kind === "del") dels.push(hunk[i++])
    while (hunk[i]?.kind === "add") adds.push(hunk[i++])
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const d = wordDiff(dels[k].text, adds[k].text)
      if (d) marks.set(dels[k], d[0]).set(adds[k], d[1])
    }
  }
  return marks
}

// drawn from its attributes, so a caption's text (the viewer's) is just its title
function stat(added: number, removed: number): Element {
  return el("span", {
    className: ["diff-stat"],
    role: "img",
    ariaLabel: `${added} added, ${removed} removed`,
    ...(added ? { dataAdded: `+${added}` } : {}),
    ...(removed ? { dataRemoved: `−${removed}` } : {}),
  })
}

/** a file's path, or old → new */
function nameOf(f: DiffFile): string {
  if (f.from && f.to && f.from !== f.to) return `${f.from} → ${f.to}`
  return f.to ?? f.from ?? ""
}

export interface DiffOptions {
  lang?: string
  title?: string
}

/** The fence's info after `diff`: `lang=ts`, `title="…"`. */
export function diffOptions(meta: string | undefined): DiffOptions {
  const m = meta ?? ""
  const lang = /(?:^|\s)lang=["']?([\w+#.-]+)/.exec(m)?.[1]
  const t = /(?:^|\s)title=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(m)
  return { lang, title: t ? (t[1] ?? t[2] ?? t[3]) : undefined }
}

export async function renderDiff(src: string, opts: DiffOptions = {}): Promise<Element> {
  const files = parseDiff(src)
  const theme = `${THEMES.light} ${THEMES.dark}`
  const rows: ElementContent[] = []
  let added = 0
  let removed = 0
  let gutterDigits = 0
  const title = opts.title ?? (files.length === 1 ? nameOf(files[0]) || undefined : files.length > 1 ? `${files.length} files` : undefined)

  for (const f of files) {
    const lang = opts.lang ?? languageOf(f.to ?? f.from)
    const name = nameOf(f)
    const fileAdded = f.lines.filter((l) => l.kind === "add").length
    const fileRemoved = f.lines.filter((l) => l.kind === "del").length
    added += fileAdded
    removed += fileRemoved
    if (name && name !== title) {
      const status = f.status === "new file" || f.status === "deleted" ? f.status : undefined
      rows.push(
        el("span", { dataLine: "", dataDiff: "file" }, [
          el("span", { className: ["diff-file-name"] }, [text(name)]),
          ...(status ? [el("span", { className: ["diff-file-status"] }, [text(status)])] : []),
          ...(fileAdded || fileRemoved ? [stat(fileAdded, fileRemoved)] : []),
        ]),
      )
    }
    if (f.status === "binary" && !f.lines.length) {
      rows.push(el("span", { dataLine: "", dataDiff: "note", className: ["diff-label"] }, [text("a binary file, not shown")]))
      continue
    }

    const hunks: DiffLine[][] = [[]]
    for (const l of f.lines) {
      if (l.kind === "hunk") hunks.push([l])
      else hunks.at(-1)!.push(l)
    }
    for (const hunk of hunks) {
      const body = hunk.filter((l) => l.kind === "add" || l.kind === "del" || l.kind === "ctx")
      const before = body.filter((l) => l.kind !== "add")
      const after = body.filter((l) => l.kind !== "del")
      const [oldTokens, newTokens] = await Promise.all([
        tokenize(before.map((l) => l.text), lang),
        tokenize(after.map((l) => l.text), lang),
      ])
      const tokensOf = new Map<DiffLine, ThemedToken[]>()
      before.forEach((l, i) => l.kind === "del" && tokensOf.set(l, oldTokens[i] ?? []))
      after.forEach((l, i) => tokensOf.set(l, newTokens[i] ?? []))

      const marks = changedWords(hunk)

      for (const l of hunk) {
        if (l.kind === "hunk") {
          const m = HUNK.exec(l.text)
          rows.push(
            el("span", { dataLine: "", dataDiff: "hunk" }, [
              el("span", { className: ["diff-gutter"], ariaHidden: "true" }),
              el("span", { className: ["diff-hunk-range"] }, [text(m ? l.text.slice(0, l.text.length - m[5].length) : l.text)]),
              ...(m?.[5].trim() ? [el("span", { className: ["diff-hunk-context"] }, [text(m[5])])] : []),
            ]),
          )
          continue
        }
        if (l.kind === "note") {
          rows.push(el("span", { dataLine: "", dataDiff: "note" }, [text(l.text)]))
          continue
        }
        gutterDigits = Math.max(gutterDigits, String(l.old ?? "").length, String(l.new ?? "").length)
        rows.push(
          el("span", { dataLine: "", dataDiff: l.kind }, [
            el("span", {
              className: ["diff-gutter"],
              ariaHidden: "true",
              dataOld: l.old ?? "",
              dataNew: l.new ?? "",
            }),
            el("span", { className: ["diff-sign"] }, [text(l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ")]),
            ...tokens(tokensOf.get(l) ?? [], marks.get(l)),
          ]),
        )
      }
    }
  }

  const lines: ElementContent[] = []
  rows.forEach((r, i) => lines.push(...(i ? [text("\n")] : []), r))
  const shared = { dataLanguage: "diff", dataTheme: theme }
  const code = el("code", { ...shared, style: "display: grid;" }, lines)
  const pre = el("pre", { tabIndex: 0, ...shared }, [code])
  const caption = title
    ? el("figcaption", { dataRehypePrettyCodeTitle: "", ...shared }, [
        text(title),
        ...(added || removed ? [stat(added, removed)] : []),
      ])
    : undefined
  return el(
    "figure",
    {
      dataRehypePrettyCodeFigure: "",
      className: ["diff"],
      ...(gutterDigits ? { dataNumbered: "", style: `--diff-digits: ${gutterDigits}` } : {}),
      dataCopy: src.replace(/\n$/, ""),
    },
    caption ? [caption, pre] : [pre],
  )
}

const isDiff = (node: Element) =>
  node.tagName === "code" &&
  Array.isArray(node.properties.className) &&
  node.properties.className.includes("language-diff")

export function rehypeDiff() {
  return async (tree: Root) => {
    const found: Array<{ pre: Element; code: Element; parent: Element | Root }> = []
    visit(tree, "element", (node, _i, parent) => {
      if (node.tagName !== "pre" || !parent) return
      const code = node.children.find((c): c is Element => c.type === "element" && isDiff(c))
      if (code) found.push({ pre: node, code, parent })
    })
    for (const { pre, code, parent } of found) {
      const src = code.children.map((c) => (c.type === "text" ? c.value : "")).join("")
      const meta = (code.data as { meta?: string } | undefined)?.meta
      const figure = await renderDiff(src, diffOptions(meta))
      parent.children[parent.children.indexOf(pre)] = figure
    }
  }
}
