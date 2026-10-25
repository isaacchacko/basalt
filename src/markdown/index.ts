// Basalt's markdown: what a note goes through between its file and its page.
//
//   textTransforms  run on the note's text (after its frontmatter) before
//                   parsing, for syntax remark can't see (Obsidian's)
//   remarkPlugins   on the markdown tree
//   rehypePlugins   on the html tree
//
// A plugin finds out which note it's on with fileOf(file) and about the whole
// site with registry() (src/lib/registry.ts). What it learns about the note
// for the page (its links, its toc, ...) it puts on
// file.data.astro.frontmatter, which becomes the entry's data.

import type { PluggableList } from "unified"
import type { SiteFile } from "../lib/site"

export type TextTransform = (text: string, file: SiteFile) => string

export const textTransforms: TextTransform[] = []
export const remarkPlugins: PluggableList = []
export const rehypePlugins: PluggableList = []
