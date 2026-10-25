import type { Element, Root, RootContent } from "hast"

/** Drop every element `test` matches, in place. */
export function remove(tree: Root | Element, test: (el: Element) => boolean) {
  tree.children = tree.children.filter((c: RootContent) => !(c.type === "element" && test(c))) as never
  for (const c of tree.children) if (c.type === "element") remove(c, test)
}
