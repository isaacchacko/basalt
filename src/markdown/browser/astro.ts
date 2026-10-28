// @astrojs/markdown-remark in the browser (lib/vite.ts): what of it a note's
// rendering uses. Its own entry reads node's process as it loads.

import Slugger from "github-slugger"
import type { Root } from "hast"
import { visit } from "unist-util-visit"
import type { VFile } from "vfile"

export { parseFrontmatter } from "@astrojs/internal-helpers/frontmatter"

/**
 * Astro's rehypeHeadingIds, after the note's own plugins: an id for a heading
 * that hasn't one (rehype-slug has given every heading in markdown its own),
 * from its text as Astro reads it.
 */
export function rehypeHeadingIds() {
  return (tree: Root, file: VFile) => {
    const slugger = new Slugger()
    const headings: { depth: number; slug: string; text: string }[] = []
    visit(tree, (node) => {
      if (node.type !== "element" || node.tagName[0] !== "h") return
      const level = /h([0-6])/.exec(node.tagName)?.[1]
      if (!level) return
      let text = ""
      visit(node, (child, _i, parent) => {
        if (child.type === "element" || !parent) return
        if (child.type === "raw" && /^\n?<.*>\n?$/.test(child.value)) return
        if ((child.type === "text" || child.type === "raw") && "value" in child) {
          const code = "tagName" in parent && (parent.tagName === "code" || parent.tagName === "pre")
          text += code ? child.value : child.value.replace(/\{/g, "${")
        }
      })
      node.properties ??= {}
      if (typeof node.properties.id !== "string") node.properties.id = slugger.slug(text)
      headings.push({ depth: Number(level), slug: String(node.properties.id), text })
    })
    const astro = ((file.data as { astro?: Record<string, unknown> }).astro ??= {})
    astro.headings = headings
  }
}
