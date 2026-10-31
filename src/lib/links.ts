// Links between notes, resolved the way Quartz's CrawlLinks resolved them
// ("shortest": a name that's unique in the site is enough), but written
// root-absolute (/sources/garden-ideas), since Astro serves each page at a
// clean URL of its own.

import isAbsoluteUrl from "is-absolute-url"
import type { Element, Root } from "hast"
import { visit } from "unist-util-visit"
import path from "node:path"
import {
  simplifySlug,
  splitAnchor,
  stripSlashes,
  transformLink,
  type FullSlug,
} from "./path.ts"

export interface Resolved {
  /** root-absolute, with its anchor: "/sources/garden-ideas#why" */
  href: string
  /** the full slug it points at: "sources/garden-ideas", "index", "blog/index" */
  slug: FullSlug
}

/** Where `target`, written in the note `from`, goes. */
export function resolveLink(from: FullSlug, target: string, allSlugs: FullSlug[]): Resolved {
  const rel = transformLink(from, target, { strategy: "shortest", allSlugs })
  const url = new URL(rel, "https://base.com/" + stripSlashes(simplifySlug(from), true))
  let [canonical] = splitAnchor(url.pathname)
  if (canonical.endsWith("/")) canonical += "index"
  // the URL percent-encodes; slugs are plain
  const slug = decodeURIComponent(stripSlashes(canonical, true)) as FullSlug
  return { href: url.pathname + url.hash, slug }
}

/** A slug as the root-absolute path of its page: "blog/index" -> "/blog/". */
export function hrefOf(slug: FullSlug | string): string {
  const simple = simplifySlug(slug as FullSlug)
  return simple === "/" ? "/" : "/" + simple
}

const EXTERNAL_ICON: Element = {
  type: "element",
  tagName: "svg",
  properties: {
    "aria-hidden": "true",
    class: "external-icon",
    style: "max-width:0.8em;max-height:0.8em",
    viewBox: "0 0 512 512",
  },
  children: [
    {
      type: "element",
      tagName: "path",
      properties: {
        d: "M320 0H288V64h32 82.7L201.4 265.4 178.7 288 224 333.3l22.6-22.6L448 109.3V192v32h64V192 32 0H480 320zM32 32H0V64 480v32H32 456h32V480 352 320H424v32 96H64V96h96 32V32H160 32z",
      },
      children: [],
    },
  ],
}

/** a 24px outline glyph in the text's ink, as Basalt's other icons are drawn */
const glyph = (className: string, paths: string[]): Element => ({
  type: "element",
  tagName: "svg",
  properties: {
    "aria-hidden": "true",
    className: [className],
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  },
  children: paths.map((d) => ({ type: "element", tagName: "path", properties: { d }, children: [] })),
})
const FILE_ICON = glyph("file-name-icon", ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4"])
// FolderMark.astro's
const FOLDER_ICON = glyph("file-name-icon", [
  "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
])

/**
 * Marks every link internal (with the slug it goes to) or external (with an
 * icon), resolves internal hrefs and the srcs of images, video, audio and
 * frames, and returns the slugs the note links to.
 */
export function crawlLinks(tree: Root, from: FullSlug, allSlugs: FullSlug[]): FullSlug[] {
  const outgoing = new Set<FullSlug>()
  visit(tree, "element", (node) => {
    if (node.tagName === "a" && typeof node.properties.href === "string") {
      let dest = node.properties.href
      const classes = (node.properties.className ?? []) as string[]
      const isExternal = isAbsoluteUrl(dest, { httpOnly: false })
      classes.push(isExternal ? "external" : "internal")
      if (isExternal) node.children.push(structuredClone(EXTERNAL_ICON))

      // a link whose text isn't its href is an alias
      if (
        node.children.length === 1 &&
        node.children[0].type === "text" &&
        node.children[0].value !== dest
      ) {
        classes.push("alias")
      }
      node.properties.className = classes

      // not external links, nor anchors within the page
      const isInternal = !(isExternal || dest.startsWith("#"))
      if (isInternal) {
        const { href, slug } = resolveLink(from, dest, allSlugs)
        node.properties.href = href
        node.properties["data-slug"] = slug
        outgoing.add(slug)
      }

      // pretty links: [[folder/note]] reads "note"
      if (
        isInternal &&
        node.children.length === 1 &&
        node.children[0].type === "text" &&
        !node.children[0].value.startsWith("#")
      ) {
        const written = node.children[0].value
        node.children[0].value = path.basename(written)
        // a file's name written down, [[margin.md]] or [[start/]], reads as one, by its glyph
        const glyph = written.endsWith("/") ? FOLDER_ICON : path.extname(written) ? FILE_ICON : undefined
        if (glyph) {
          classes.push("file-name")
          node.children.unshift(structuredClone(glyph))
        }
      }
    }

    if (
      ["img", "video", "audio", "iframe"].includes(node.tagName) &&
      typeof node.properties.src === "string" &&
      !isAbsoluteUrl(node.properties.src, { httpOnly: false })
    ) {
      node.properties.src = resolveLink(from, node.properties.src, allSlugs).href
    }
  })
  return [...outgoing]
}
