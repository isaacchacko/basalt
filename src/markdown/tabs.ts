// Tabs: things that take turns. Two (or more) `> [!tab] Label` callouts in a
// row, with only a blank line between them, are one block, and each callout is
// a tab holding whatever markdown it holds, its title the tab's label:
//
//   > [!tab] Basalt
//   > ```tsx title="music.tsx"
//   > …
//   > ```
//
//   > [!tab] Quartz
//   > …
//
// The browser shows one at a time, with ‹ › to step between them
// (client/tabs.ts). Obsidian shows them as callouts one after another, GitHub
// as quotes, and so does a page without its script: either way it reads top
// to bottom.

import type { Element, ElementContent, Root } from "hast"

const el = (tagName: string, properties: Element["properties"], children: ElementContent[]): Element => ({
  type: "element",
  tagName,
  properties,
  children,
})

const classes = (node: Element): string[] => [node.properties?.className ?? []].flat().map(String)

const isTab = (node: ElementContent | undefined): node is Element =>
  node?.type === "element" &&
  node.tagName === "blockquote" &&
  classes(node).includes("callout") &&
  node.properties?.dataCallout === "tab"

const blank = (node: ElementContent) => node.type === "text" && !node.value.trim()

function toText(node: ElementContent): string {
  if (node.type === "text") return node.value
  if (node.type === "element") return node.children.map(toText).join("")
  return ""
}

/** A callout as a tab: its label (its title, unless it's the default "Tab") over its content. */
function tab(callout: Element): Element {
  const kids = callout.children.filter((c): c is Element => c.type === "element")
  const titleBox = kids.find((c) => classes(c).includes("callout-title"))
  const title = titleBox?.children
    .filter((c): c is Element => c.type === "element")
    .find((c) => classes(c).includes("callout-title-inner"))
  const label = title ? toText(title).trim() : ""
  const named = label && label.toLowerCase() !== "tab"
  const body: ElementContent[] = []
  for (const kid of callout.children) {
    if (kid === titleBox) continue
    if (kid.type === "element" && classes(kid).includes("callout-content")) body.push(...kid.children)
    else body.push(kid)
  }
  if (!named) return el("section", { className: ["tab"] }, body)
  const words = title!.children.flatMap((c) => (c.type === "element" && c.tagName === "p" ? c.children : [c]))
  // ofm leaves a space after a callout's title
  const last = words.at(-1)
  if (last?.type === "text") last.value = last.value.trimEnd()
  return el("section", { className: ["tab"], dataLabel: label }, [el("p", { className: ["tab-label"] }, words), ...body])
}

/** Every run of two or more tab callouts in `parent` becomes one block of tabs. */
function gather(parent: Root | Element) {
  const kids = parent.children as ElementContent[]
  for (let i = 0; i < kids.length; i++) {
    if (!isTab(kids[i])) continue
    const run = [i]
    for (let j = i + 1; j < kids.length; j++) {
      if (blank(kids[j])) continue
      if (!isTab(kids[j])) break
      run.push(j)
    }
    if (run.length < 2) continue
    kids.splice(i, run.at(-1)! - i + 1, el("div", { className: ["tabs"] }, run.map((k) => tab(kids[k] as Element))))
  }
}

export function rehypeTabs() {
  return (tree: Root) => {
    const walk = (node: Root | Element) => {
      gather(node)
      for (const kid of node.children) if (kid.type === "element") walk(kid)
    }
    walk(tree)
  }
}
