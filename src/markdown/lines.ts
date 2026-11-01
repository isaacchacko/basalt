// Where each block of a note is in its text, for pairing a version's blocks
// with the one's before it (lib/history.ts): data-src="<first line>-<last line>",
// counted from 1 in the text as written, on every top-level block, every
// footnote and every sidenote. Only for a text rendered that isn't the file's
// (`unsaved`: a past version); a page as it's served has none.
//
// A note is parsed after its textTransforms, which add and take away lines (a
// callout's title gets one after it, a %%comment%% goes), so the lines it was
// parsed as are mapped back to the file's by a line diff (lib/linemap.ts).
//
// A block that came straight from the markdown has its lines. One a plugin
// made anew (a diagram's figure, a margin note in place of its callout, tabs
// from callouts in a row, math) has lost them, and its children's are no
// help (they're another file's, an embed's, or a string's parsed again): it
// takes the blocks the markdown was parsed into (remarkSourceBlocks, first of
// the note's remark plugins) that lie between the blocks either side of it.
// So does a block whose lines aren't past the block before it's (a plugin
// that gave it the wrong node's place).
//
// Last of the note's own plugins: a note embedded in this one comes in after
// (transclude.ts), with its own file's lines, inside .transclude.

import type { Element, Root } from "hast"
import type { Root as Mdast } from "mdast"
import type { VFile } from "vfile"
import { visit } from "unist-util-visit"
import { lineMap } from "../lib/linemap.ts"

type Lines = [number, number]
type Positioned = { position?: { start: { line: number; column: number }; end: { line: number; column: number } } }

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/

declare module "vfile" {
  interface DataMap {
    /** the lines (as parsed) of each block the markdown was parsed into */
    sourceBlocks: Lines[]
  }
}

// what renders nothing: a footnote's definition (the footnotes at the foot
// have their own lines) and a link's
const UNSEEN = new Set(["footnoteDefinition", "definition", "yaml", "toml"])

/** The blocks the markdown was parsed into, before any plugin moved them: first of the remark plugins. */
export function remarkSourceBlocks() {
  return (tree: Mdast, file: VFile) => {
    file.data.sourceBlocks = tree.children.flatMap((n) => {
      const p = n.position
      return p && !UNSEEN.has(n.type) ? [[p.start.line, p.end.line] as Lines] : []
    })
  }
}

/** a note's text being rendered that isn't its file's (a past version, lib/history.ts) */
export const unsaved = new Map<string, string>()

export function rehypeSourceLines() {
  return (tree: Root, file: VFile) => {
    if (!file.path) return
    const raw = unsaved.get(file.path)
    if (raw === undefined) return
    tagLines(tree, String(file.value), raw, file.data.sourceBlocks)
  }
}

/**
 * Puts data-src on the tree's blocks: `parsed` is the text the tree was parsed
 * from, `raw` the file, `sources` the lines (in `parsed`) of the blocks it was
 * parsed into.
 */
export function tagLines(tree: Root, parsed: string, raw: string, sources: Lines[] = []) {
  const written = raw.split("\n")
  const map = lineMap(parsed.split("\n"), written)
  const toWritten = (start: number, endLine: number, endColumn = 2): Lines => {
    // a node that ends at the start of a line ends on the line before
    const end = endColumn === 1 && endLine > start ? endLine - 1 : endLine
    return [map.first(start - 1) + 1, map.last(end - 1) + 1]
  }
  const own = (node: Positioned): Lines | undefined => {
    const p = node.position
    if (!p?.start?.line || !p.end?.line) return undefined
    return toWritten(p.start.line, p.end.line, p.end.column)
  }
  const parts = sources.map(([a, b]) => toWritten(a, b))

  const blocks = tree.children.filter((c): c is Element => c.type === "element")
  const spans: (Lines | undefined)[] = blocks.map(own)
  // a block whose lines aren't past the one before it's has the wrong node's place
  let last: Lines | undefined
  spans.forEach((span, i) => {
    if (!span) return
    if (last && span[0] <= last[1]) spans[i] = undefined
    else last = span
  })

  // the body starts after the frontmatter
  const bodyStart = FRONTMATTER.exec(raw)?.[0].split("\n").length ?? 1
  const blank = (line: number) => !written[line - 1]?.trim()
  for (let i = 0; i < blocks.length; i++) {
    if (spans[i]) continue
    let j = i
    while (j < blocks.length && !spans[j]) j++
    const before = spans[i - 1]
    const after = spans[j]
    const from = (before?.[1] ?? bodyStart - 1) + 1
    const to = (after?.[0] ?? written.length + 1) - 1
    const between = parts.filter(([a, b]) => a >= from && b <= to)
    const k = j - i
    for (let n = 0; n < k; n++) {
      let span: Lines
      if (between.length) {
        // the markdown's blocks between them, shared out in turn
        const lo = Math.min(between.length - 1, Math.floor((n * between.length) / k))
        const hi = Math.max(lo, Math.min(between.length, Math.floor(((n + 1) * between.length) / k)) - 1)
        span = [between[lo][0], between[hi][1]]
      } else {
        let a = from
        let b = to
        while (a < b && blank(a)) a++
        while (b > a && blank(b)) b--
        // nothing of its own between them: lifted out of the block before it (an embed out of its paragraph)
        span = blank(a) && (before ?? after) ? (before ?? after)! : [a, Math.max(a, b)]
      }
      spans[i + n] = span
    }
    i = j
  }
  blocks.forEach((b, i) => set(b, spans[i]!))

  // footnotes, at the foot of the page and as sidenotes beside their lines
  const footnotes = new Map<string, Lines>()
  visit(tree, "element", (node) => {
    const id = node.properties?.id
    if (node.tagName === "li" && typeof id === "string" && id.includes("fn-")) {
      const lines = own(node)
      if (lines) {
        footnotes.set(id, lines)
        set(node, lines)
      }
    }
  })
  visit(tree, "element", (node) => {
    const id = node.properties?.dataSidenote
    const lines = typeof id === "string" && classesOf(node).includes("sidenote") ? footnotes.get(id) : undefined
    if (lines) set(node, lines)
  })
  // the footnotes' section is its footnotes
  const all = [...footnotes.values()]
  for (const b of blocks)
    if (b.tagName === "section" && b.properties?.dataFootnotes !== undefined && all.length)
      set(b, [Math.min(...all.map((l) => l[0])), Math.max(...all.map((l) => l[1]))])
}

const set = (node: Element, [from, to]: Lines) => {
  node.properties = { ...node.properties, dataSrc: `${from}-${to}` }
}

const classesOf = (node: Element): string[] => [node.properties?.className ?? []].flat().map(String)
