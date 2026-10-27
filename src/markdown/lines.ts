// Where each block of a note's page is in its file, for editing the page in
// place (client/editor.ts): data-src="<first line>-<last line>", counted from
// 1 in the file as written, on every top-level block, every footnote and every
// sidenote. Only while serving, or for a site with "edit" (lib/edit.ts).
//
// A note is parsed after its textTransforms, which add and take away lines (a
// callout's title gets one after it, a %%comment%% goes), so the lines it was
// parsed as are mapped back to the file's by a line diff (lib/linemap.ts). A
// block whose node lost its place on the way (one a plugin made anew, a margin
// note in place of its callout) takes its children's lines, else the lines
// between the blocks either side of it.
//
// Last of the note's own plugins: a note embedded in this one comes in after
// (transclude.ts), with its own file's lines, inside .transclude, which the
// editor knows to look past.

import fs from "node:fs"
import type { Element, Root } from "hast"
import type { VFile } from "vfile"
import { visit } from "unist-util-visit"
import { lineMap } from "../lib/linemap.ts"
import { editable } from "../lib/edit.ts"
import { reg } from "./context.ts"

type Lines = [number, number]
type Positioned = { position?: { start: { line: number; column: number }; end: { line: number; column: number } } }

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/

export function rehypeSourceLines() {
  return (tree: Root, file: VFile) => {
    if (!file.path || !editable(reg().site)) return
    let raw: string
    try {
      raw = fs.readFileSync(file.path, "utf8")
    } catch {
      return
    }
    tagLines(tree, String(file.value), raw)
  }
}

/** Puts data-src on the tree's blocks: `parsed` is the text the tree was parsed from, `raw` the file. */
export function tagLines(tree: Root, parsed: string, raw: string) {
  const written = raw.split("\n")
  const map = lineMap(parsed.split("\n"), written)
  const own = (node: Positioned): Lines | undefined => {
    const p = node.position
    if (!p?.start?.line || !p.end?.line) return undefined
    // a node that ends at the start of a line ends on the line before
    const end = p.end.column === 1 && p.end.line > p.start.line ? p.end.line - 1 : p.end.line
    return [map.first(p.start.line - 1) + 1, map.last(end - 1) + 1]
  }
  const within = (node: Element): Lines | undefined => {
    let span: Lines | undefined
    visit(node, (n) => {
      const lines = own(n as Positioned)
      if (lines) span = span ? [Math.min(span[0], lines[0]), Math.max(span[1], lines[1])] : lines
    })
    return span
  }

  const blocks = tree.children.filter((c): c is Element => c.type === "element")
  const spans = blocks.map((b) => own(b) ?? within(b))
  // the body starts after the frontmatter
  const bodyStart = FRONTMATTER.exec(raw)?.[0].split("\n").length ?? 1
  const blank = (line: number) => !written[line - 1]?.trim()
  for (let i = 0; i < blocks.length; i++) {
    if (spans[i]) continue
    let j = i
    while (j < blocks.length && !spans[j]) j++
    let from = (spans[i - 1]?.[1] ?? bodyStart - 1) + 1
    let to = (spans[j]?.[0] ?? written.length + 1) - 1
    while (from < to && blank(from)) from++
    while (to > from && blank(to)) to--
    for (let k = i; k < j; k++) spans[k] = [from, Math.max(from, to)]
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
}

const set = (node: Element, [from, to]: Lines) => {
  node.properties = { ...node.properties, dataSrc: `${from}-${to}` }
}

const classesOf = (node: Element): string[] => [node.properties?.className ?? []].flat().map(String)
