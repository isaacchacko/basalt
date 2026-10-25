import type { Element, Root, RootContent } from "hast"

/** Drop every element `test` matches, in place. */
export function remove(tree: Root | Element, test: (el: Element) => boolean) {
  const kept = (tree.children as RootContent[]).filter((c) => !(c.type === "element" && test(c)))
  tree.children = kept as typeof tree.children
  for (const c of kept) if (c.type === "element") remove(c, test)
}
