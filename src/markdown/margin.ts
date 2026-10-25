import type { Element, ElementContent, Root } from "hast"
import { SKIP, visit } from "unist-util-visit"
import { visitParents } from "unist-util-visit-parents"

/*
 * Basalt's margin notes, after Edward Tufte's: notes that sit in the margin
 * beside the line they belong to, the way a good math textbook keeps its
 * remarks, instead of at the bottom of the page.
 *
 *   sidenotes     footnotes ([^1]), numbered, each placed beside the line
 *                 that cites it
 *   margin notes  `> [!aside]` after a paragraph: unnumbered, beside that
 *                 paragraph; an image in one makes a margin figure
 *
 * Here, at build time, each note is copied next to what it belongs to, as
 * <span class="sidenote"> after its reference or <aside class="marginnote">
 * in place of its callout. The browser (the margin component) lays them out in
 * the margin; with no script, or on a phone, sidenotes open in place and the
 * footnotes stay at the bottom of the page as well.
 */

const el = (
  tagName: string,
  properties: Element["properties"],
  children: ElementContent[],
): Element => ({
  type: "element",
  tagName,
  properties,
  children,
})

const classes = (node: Element): string[] => {
  const c = node.properties?.className
  return Array.isArray(c) ? (c as string[]) : typeof c === "string" ? c.split(" ") : []
}

/** A footnote's content as phrasing, so it can sit inside the sentence citing it. */
function inline(item: Element): ElementContent[] {
  const out: ElementContent[] = []
  const blocks = item.children.filter((c): c is Element => c.type === "element")
  blocks.forEach((block, i) => {
    if (i > 0) out.push(el("br", {}, []))
    const kids = block.tagName === "p" ? block.children : [block]
    for (const kid of kids) {
      if (kid.type === "element" && kid.properties?.dataFootnoteBackref !== undefined) continue
      out.push(structuredClone(kid))
    }
  })
  // the backref's space, left at the end
  const last = out.at(-1)
  if (last?.type === "text") last.value = last.value.replace(/\s+$/, "")
  return out
}

/** Footnotes become sidenotes: each reference is followed by its note. */
export function sidenotes(tree: Root): number {
  const items = new Map<string, Element>()
  visit(tree, "element", (node) => {
    if (
      node.tagName === "li" &&
      typeof node.properties?.id === "string" &&
      node.properties.id.includes("fn-")
    ) {
      items.set(node.properties.id, node)
    }
  })
  let count = 0
  visitParents(tree, "element", (node, ancestors) => {
    if (node.tagName !== "sup") return
    const ref = node.children.find(
      (c): c is Element => c.type === "element" && c.properties?.dataFootnoteRef !== undefined,
    )
    if (!ref) return
    const id = decodeURIComponent(String(ref.properties.href ?? "").replace(/^.*#/, ""))
    const item = items.get(id)
    const parent = ancestors.at(-1) as Element | Root
    if (!item || !parent) return SKIP
    const n =
      ref.children.map((c) => (c.type === "text" ? c.value : "")).join("") || String(count + 1)
    count++
    ref.properties.dataSidenote = id
    const note = el("span", { className: ["sidenote"], role: "note", dataSidenote: id }, [
      el("span", { className: ["sidenote-number"] }, [{ type: "text", value: n }]),
      ...inline(item),
    ])
    parent.children.splice(parent.children.indexOf(node) + 1, 0, note)
    return SKIP
  })
  return count
}

/** `> [!aside]` callouts become margin notes. */
export function marginNotes(tree: Root): number {
  let count = 0
  visitParents(tree, "element", (node, ancestors) => {
    if (node.tagName !== "blockquote" || !classes(node).includes("callout")) return
    const kind = String(node.properties?.dataCallout ?? "")
    if (kind !== "aside" && kind !== "margin") return
    const parent = ancestors.at(-1) as Element | Root
    if (!parent) return SKIP
    const kids = node.children.filter((c): c is Element => c.type === "element")
    const titleBox = kids.find((c) => classes(c).includes("callout-title"))
    const content = kids.find((c) => classes(c).includes("callout-content"))
    const title = titleBox?.children
      .filter((c): c is Element => c.type === "element")
      .find((c) => classes(c).includes("callout-title-inner"))
    const titleText = title ? toText(title).trim() : ""
    // the callout's default title is just its name: an untitled aside has none
    const named = titleText && !/^(aside|margin)$/i.test(titleText)
    const children: ElementContent[] = []
    if (named)
      children.push(
        el(
          "strong",
          { className: ["marginnote-title"] },
          title!.children.flatMap((c) =>
            c.type === "element" && c.tagName === "p" ? c.children : [c],
          ),
        ),
      )
    if (content) children.push(...content.children)
    const figure = JSON.stringify(children).includes('"tagName":"img"')
    const aside = el(
      "aside",
      { className: ["marginnote", ...(figure ? ["marginfigure"] : [])], role: "note" },
      children,
    )
    parent.children[parent.children.indexOf(node)] = aside
    count++
    return SKIP
  })
  return count
}

function toText(node: ElementContent): string {
  if (node.type === "text") return node.value
  if (node.type === "element") return node.children.map(toText).join("")
  return ""
}

export function rehypeMargin() {
  return (tree: Root, file: { data: Record<string, unknown> }) => {
    const notes = sidenotes(tree) + marginNotes(tree)
    if (notes) file.data.marginNotes = notes
  }
}

declare module "vfile" {
  interface DataMap {
    marginNotes: number
  }
}
