// The rehype plugins Astro renders the site with (astro.config.ts), its note
// lists drawn from the notes that parse.

import fs from "node:fs"
import { parseFrontmatter } from "@astrojs/markdown-remark"
import { rehypePlugins } from "./index"
import { listed, rehypeNoteLists, renderNoteLists } from "./notelist"
import { useRegistry } from "./context"
import { registry } from "../lib/registry"

// A note whose frontmatter doesn't parse is an error of its own (the loader
// reports it, with its line). A note that embeds or lists it still renders:
// the embed says there's nothing to embed, and the list leaves it out.
const parses = (abs: string) => {
  try {
    parseFrontmatter(fs.readFileSync(abs, "utf8"))
    return true
  } catch {
    return false
  }
}
const listedSafely = () => {
  try {
    return listed()
  } catch {
    const reg = registry()
    const files = reg.files.filter((f) => !f.isNote || parses(f.abs))
    useRegistry(() => ({ ...reg, files }))
    try {
      return listed()
    } finally {
      useRegistry(registry)
    }
  }
}

/** The site's rehype plugins, its note lists drawn from what's listed safely. */
export const rehype = rehypePlugins.map((p) =>
  p === rehypeNoteLists ? () => (tree: never) => renderNoteLists(tree, registry().site.config.locale, listedSafely) : p,
)
