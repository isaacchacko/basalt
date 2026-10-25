// Compare blocks: two things side by side. Two (or more) `> [!compare] Label`
// callouts in a row, with only a blank line between them, are one block, and
// each callout is a column, its title the column's label:
//
//   > [!compare] Basalt
//   > ```tsx title="music.tsx" ^markup=5 ^handlers=/onPointerMove/
//   > …
//   > ```
//   > ^page
//
//   > [!compare] Quartz
//   > …
//
// Anchors line the columns up: blocks (or lines) with the same name in
// different columns are partners, kept level beside each other (the browser
// does that, client/compare.ts). An anchor is
//
//   ^name          Obsidian's block id, at the end of a paragraph or on its
//                  own line after a block
//   ^name=N        in a fence's info string: its N-th line
//   ^name=/text/   in a fence's info string: its first line containing text
//
// Obsidian shows the columns as callouts one after another and hides block
// ids; GitHub shows them as quotes. Either way it reads top to bottom.
//
// Here the anchors come off the markdown before anything else reads them
// (rehype-pretty-code would drop a fence's, block references would take a
// block id as a transclusion target), and the callouts become one figure.

import type { BlockContent, Blockquote, Code, Parent, Root as MdRoot, RootContent } from "mdast"
import type { Element, ElementContent, Root } from "hast"
import { visit } from "unist-util-visit"

// ---------- markdown: the anchors, off the text ----------

const LINE_ANCHOR = /(^|\s)\^([-\w]+)=(\d+|\/(?:\\.|[^/\\])+\/)(?=\s|$)/g
const BLOCK_ANCHOR = /(^|\s)\^([-\w]+)\s*$/

/** A fence's line anchors, taken out of its info string: [name, "5" | "/text/"]. */
export function lineAnchors(meta: string): { meta: string; anchors: [string, string][] } {
  const anchors: [string, string][] = []
  const rest = meta.replace(LINE_ANCHOR, (_m, space: string, name: string, at: string) => {
    anchors.push([name, at])
    return space
  })
  return { meta: rest.replace(/\s+/g, " ").trim(), anchors }
}

/** `> [!compare] Label`, before ofm has made a callout of it */
function isCompare(node: RootContent): node is Blockquote {
  if (node.type !== "blockquote") return false
  const first = node.children[0]
  return first?.type === "paragraph" && first.children[0]?.type === "text" && /^\[!compare\]/i.test(first.children[0].value)
}

/** A div around a node that can't carry attributes through to the page (a fence, raw html). */
function wrap(node: RootContent): Blockquote {
  return {
    type: "blockquote",
    data: { hName: "div", hProperties: { className: ["compare-lines"] } },
    children: [node as BlockContent],
  }
}

const props = (node: RootContent) => {
  node.data ??= {}
  return ((node.data as { hProperties?: Record<string, unknown> }).hProperties ??= {})
}

/** Takes a trailing ` ^name` off a paragraph: its name, and whether that was all the paragraph held. */
function takeBlockId(node: RootContent): { name: string; empty: boolean } | undefined {
  if (node.type !== "paragraph") return undefined
  const last = node.children.at(-1)
  if (last?.type !== "text") return undefined
  const m = BLOCK_ANCHOR.exec(last.value)
  if (!m) return undefined
  last.value = last.value.slice(0, m.index + m[1].length).replace(/\s+$/, "")
  if (!last.value) node.children.pop()
  const empty = node.children.every((c) => c.type === "text" && !c.value.trim())
  return { name: m[2], empty }
}

function anchorBlocks(parent: Parent) {
  for (let i = 0; i < parent.children.length; i++) {
    let node = parent.children[i] as RootContent
    if (node.type === "code") {
      const { meta, anchors } = lineAnchors(node.meta ?? "")
      if (anchors.length) {
        ;(node as Code).meta = meta || null
        node = parent.children[i] = wrap(node)
        props(node).dataCompareLines = JSON.stringify(anchors)
      }
    }
    const id = takeBlockId(node)
    if (id?.empty) {
      // a block id on its own line names the block before it
      parent.children.splice(i--, 1)
      let before = parent.children[i] as RootContent | undefined
      if (!before) continue
      if (before.type === "code" || before.type === "html") before = parent.children[i] = wrap(before)
      props(before).dataCompareAnchor = id.name
      continue
    }
    if (id) props(node).dataCompareAnchor = id.name
    if ("children" in node && node.type !== "paragraph") anchorBlocks(node as Parent)
  }
}

/** The compare callouts' anchors, read and taken off their text. */
export function remarkCompare() {
  return (tree: MdRoot) => {
    visit(tree, "blockquote", (node) => {
      if (isCompare(node)) anchorBlocks(node)
    })
  }
}

// ---------- html: callouts in a row, one figure ----------

const el = (tagName: string, properties: Element["properties"], children: ElementContent[]): Element => ({
  type: "element",
  tagName,
  properties,
  children,
})

const classes = (node: Element): string[] => {
  const c = node.properties?.className
  return Array.isArray(c) ? c.map(String) : typeof c === "string" ? (c as string).split(" ") : []
}

const isCallout = (node: ElementContent | undefined): node is Element =>
  node?.type === "element" &&
  node.tagName === "blockquote" &&
  classes(node).includes("callout") &&
  node.properties?.dataCallout === "compare"

const blank = (node: ElementContent) => node.type === "text" && !node.value.trim()

function toText(node: ElementContent): string {
  if (node.type === "text") return node.value
  if (node.type === "element") return node.children.map(toText).join("")
  return ""
}

/** A callout's label (its title, unless it's the default "Compare") and its content. */
function column(callout: Element): Element {
  const kids = callout.children.filter((c): c is Element => c.type === "element")
  const titleBox = kids.find((c) => classes(c).includes("callout-title"))
  const title = titleBox?.children
    .filter((c): c is Element => c.type === "element")
    .find((c) => classes(c).includes("callout-title-inner"))
  const label = title ? toText(title).trim() : ""
  const named = label && label.toLowerCase() !== "compare"
  const body: ElementContent[] = []
  for (const kid of callout.children) {
    if (kid === titleBox) continue
    if (kid.type === "element" && classes(kid).includes("callout-content")) body.push(...kid.children)
    else body.push(kid)
  }
  const head: ElementContent[] = []
  if (named) {
    const words = title!.children.flatMap((c) => (c.type === "element" && c.tagName === "p" ? c.children : [c]))
    // ofm leaves a space after a callout's title
    const last = words.at(-1)
    if (last?.type === "text") last.value = last.value.trimEnd()
    head.push(el("p", { className: ["compare-label"] }, words))
  }
  return el("div", { className: ["compare-column"], ...(named ? { dataLabel: label } : {}) }, [...head, ...body])
}

/** Every run of two or more compare callouts in `parent` becomes a compare figure. */
function gather(parent: Root | Element): number {
  let count = 0
  const kids = parent.children as ElementContent[]
  for (let i = 0; i < kids.length; i++) {
    if (!isCallout(kids[i])) continue
    const run = [i]
    for (let j = i + 1; j < kids.length; j++) {
      if (blank(kids[j])) continue
      if (!isCallout(kids[j])) break
      run.push(j)
    }
    if (run.length < 2) continue
    const columns = run.map((k) => column(kids[k] as Element))
    const figure = el("figure", { className: ["compare"], dataColumns: String(columns.length) }, [
      el("div", { className: ["compare-columns"] }, columns),
    ])
    kids.splice(i, run.at(-1)! - i + 1, figure)
    count++
  }
  return count
}

export function rehypeCompare() {
  return (tree: Root, file: { data: Record<string, unknown> }) => {
    let count = 0
    const walk = (node: Root | Element) => {
      count += gather(node)
      for (const kid of node.children) if (kid.type === "element") walk(kid)
    }
    walk(tree)
    if (count) file.data.compareBlocks = count
  }
}

declare module "vfile" {
  interface DataMap {
    compareBlocks: number
  }
}
