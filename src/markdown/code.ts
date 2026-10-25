import type { ElementContent, Root } from "hast"
import { h } from "hastscript"
import { visit } from "unist-util-visit"

// fenced code blocks and `inline code`
const codeRegex = /(^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\2[^\n]*$|`+[^`\n]+`+)/gm

/** Applies `fn` to the parts of `src` that aren't code. */
export function outsideCode(src: string, fn: (text: string) => string): string {
  let out = ""
  let last = 0
  for (const m of src.matchAll(codeRegex)) {
    out += fn(src.slice(last, m.index)) + m[0]
    last = m.index! + m[0].length
  }
  return out + fn(src.slice(last))
}

const isTitle = (n: ElementContent) =>
  n.type === "text" || (n.type === "element" && String(n.properties.className ?? "").includes("code-file-name"))

/**
 * A code block's title in a span of its own, so a long one is cut at its
 * start (code.scss) rather than running past its bar, script or no script.
 * What else is in the bar (a diff's stat, a code file's controls) stays beside it.
 */
export function rehypeCodeTitles() {
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      if (node.tagName !== "figcaption" || node.properties.dataRehypePrettyCodeTitle === undefined) return
      const title = node.children.filter(isTitle)
      if (!title.length) return
      node.children = [h("span.code-title", [h("span", title)]), ...node.children.filter((n) => !isTitle(n))]
    })
  }
}
