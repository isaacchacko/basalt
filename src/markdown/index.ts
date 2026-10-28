// Basalt's markdown: what a note goes through between its file and its page.
//
//   textTransforms  run on the note's text (after its frontmatter) before
//                   parsing, for syntax remark can't see (Obsidian's)
//   remarkPlugins   on the markdown tree
//   rehypePlugins   on the html tree
//
// The order is Quartz's, the way Basalt's Quartz build ran its transformers,
// so a note renders to the markup it did there. A site's own plugins
// (<site>/basalt.config.ts, see siteconfig.ts) come after Basalt's, and
// before transclusion, so a note embedded in another has been through them.
//
// A plugin finds out which note it's on with noteOf(file) / slugOf(file) and
// about the whole site with reg() (context.ts). What it learns about the note
// for the page it puts on file.data.frontmatter (the same object as
// file.data.astro.frontmatter), which becomes the entry's data; frontmatter.ts
// lists the fields every note has.
//
// Notes with `draft: true` or `private: true` render as usual, with
// data.draft / data.private set: the page route leaves them out.

import fs from "node:fs"
import type { PluggableList } from "unified"
import { registry } from "../lib/registry"
import { siteDir, type SiteFile } from "../lib/site"
import type { FullSlug } from "../lib/path"
import { useRegistry } from "./context.ts"
import { useTargets, type Target } from "./transclude.ts"
import { loadSiteMarkdown, type TextTransform } from "./siteconfig.ts"
import { rehypeSourceLines, remarkSourceBlocks } from "./lines.ts"
import { basaltRehype, basaltRemark, basaltText, renderTime, targetOf, transformText, treeProcessor } from "./plugins.ts"

export { processorOptions, syntaxHighlight } from "./plugins.ts"
export type { TextTransform }

useRegistry(registry)

const site = await loadSiteMarkdown(siteDir())

export const textTransforms: TextTransform[] = [...basaltText, ...site.textTransforms]
/** whether the site has markdown plugins of its own (its basalt.config.ts): the browser hasn't them */
export const sitePlugins = !!(site.textTransforms.length + site.remarkPlugins.length + site.rehypePlugins.length)

// the blocks the markdown was parsed into, first, before any plugin moves them (lines.ts)
export const remarkPlugins: PluggableList = [remarkSourceBlocks, ...basaltRemark, ...site.remarkPlugins]
// the lines each block came from, last of the note's own (lines.ts): not on
// a note embedded in another (treeProcessor)
export const rehypePlugins: PluggableList = [...basaltRehype, ...site.rehypePlugins, rehypeSourceLines, ...renderTime]

// ---------- another note's tree, for transclusion ----------

/** A note's text as the loader hands it to Astro: textTransforms run on everything after its frontmatter. */
export function transformNote(raw: string, file: SiteFile): string {
  return transformText(raw, file, textTransforms)
}

let ownTree: ReturnType<typeof treeProcessor> | undefined

const targets = new Map<string, { stamp: number; target: Promise<Target | undefined> }>()

/** A note rendered on its own (its embeds left as they are), cached until its file changes. */
export async function renderTarget(slug: FullSlug): Promise<Target | undefined> {
  const file = registry().bySlug.get(slug)
  if (!file?.isNote) return undefined
  const stamp = fs.statSync(file.abs).mtimeMs
  const cached = targets.get(file.abs)
  if (cached && cached.stamp === stamp) return cached.target
  ownTree ??= treeProcessor(remarkPlugins, [...basaltRehype, ...site.rehypePlugins])
  const target = targetOf(ownTree, slug, file.abs, transformNote(fs.readFileSync(file.abs, "utf8"), file))
  targets.set(file.abs, { stamp, target })
  return target
}

useTargets(renderTarget)
