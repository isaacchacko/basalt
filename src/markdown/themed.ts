// Theme-aware media: a picture or video with a dark version beside it
// (`phone.dark.png` next to `phone.png`) shows the one that matches the
// page's theme, and swaps the moment the theme is toggled. Nothing to write:
// embed `phone.png` as usual and Basalt finds `phone.dark.png`.
//
// Both are in the html; the one not shown is display: none, which keeps a lazy
// image from loading until its theme is chosen (src/styles/themed.scss). A
// link to such a picture carries the dark one as data-dark-src, for previews.

import type { Element, Root } from "hast"
import { visit } from "unist-util-visit"
import { registry } from "../lib/registry.ts"

const MEDIA = /\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mov)$/i

/** "/assets/phone.png" -> "/assets/phone.dark.png", when that file is in the site */
export function darkVersion(src: string, has: (slug: string) => boolean): string | undefined {
  if (!src.startsWith("/") || src.startsWith("//")) return undefined
  const [path, rest = ""] = src.split(/(?=[?#])/)
  const slug = decodeURIComponent(path.slice(1))
  if (!MEDIA.test(slug) || /\.dark\.[^.]+$/i.test(slug)) return undefined
  const dark = slug.replace(/(\.[^.]+)$/, ".dark$1")
  return has(dark) ? "/" + encodeURI(dark) + rest : undefined
}

const classes = (node: Element): string[] => {
  const c: unknown = node.properties?.className
  return Array.isArray(c) ? c.map(String) : typeof c === "string" ? c.split(" ") : []
}

export function rehypeThemedMedia() {
  return (tree: Root) => {
    const { bySlug } = registry()
    const has = (slug: string) => bySlug.has(slug as never)
    visit(tree, "element", (node, index, parent) => {
      if (classes(node).some((c) => c.startsWith("themed-"))) return
      if ((node.tagName === "img" || node.tagName === "video") && parent && index !== undefined) {
        const dark = darkVersion(String(node.properties?.src ?? ""), has)
        if (!dark) return
        const twin: Element = structuredClone(node)
        twin.properties = { ...twin.properties, src: dark }
        node.properties = { ...node.properties, className: [...classes(node), "themed-light"] }
        twin.properties.className = [...classes(twin).filter((c) => c !== "themed-light"), "themed-dark"]
        parent.children.splice(index + 1, 0, twin)
        return index + 2
      }
      if (node.tagName === "a" && classes(node).includes("internal")) {
        const href = String(node.properties?.href ?? "")
        const dark = darkVersion(href, has)
        if (dark) node.properties = { ...node.properties, dataDarkSrc: dark }
      }
    })
  }
}
