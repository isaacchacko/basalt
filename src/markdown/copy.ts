// <copy>text</copy>: text you copy by clicking it (or tabbing to it and
// pressing enter): an address, a command, a key. In the page it's the text
// itself, underlined in dots; `<copy value="…">` copies something other than
// what it shows. Anywhere else (another markdown viewer, a feed) it's just
// the text. An address or a url in it isn't made a link: it's for copying.
// The click is src/client/copy.ts.

import type { ElementContent, Root } from "hast"
import { toString } from "hast-util-to-string"
import { visit } from "unist-util-visit"

/** what's inside, with any link the markdown made of it back to its text */
function unlink(nodes: ElementContent[]): ElementContent[] {
  return nodes.flatMap((n): ElementContent[] => {
    if (n.type !== "element") return [n]
    if (n.tagName === "a") return unlink(n.children)
    return [{ ...n, children: unlink(n.children) }]
  })
}

export function rehypeCopy() {
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      if (node.tagName !== "copy") return
      node.children = unlink(node.children)
      const given = node.properties?.value
      const value = (given === undefined ? toString(node) : String(given)).trim()
      node.tagName = "span"
      node.properties = {
        className: ["copyable"],
        role: "button",
        tabIndex: 0,
        dataCopy: value,
        dataTip: "click to copy",
      }
    })
  }
}
