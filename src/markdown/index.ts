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

import { rehypeThemedMedia } from "./themed.ts"
import { rehypeCopy } from "./copy.ts"
import { rehypeSound } from "./sound.ts"
import fs from "node:fs"
import type { PluggableList } from "unified"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkRehype from "remark-rehype"
import remarkSmartypants from "remark-smartypants"
import remarkMath from "remark-math"
import rehypeRaw from "rehype-raw"
import rehypeSlug from "rehype-slug"
import rehypeAutolinkHeadings from "rehype-autolink-headings"
import rehypeKatex from "rehype-katex"
import rehypePrettyCode from "rehype-pretty-code"
import { prettyCode } from "./source.ts"
import { rehypeDiff } from "./diff.ts"
import { parseFrontmatter } from "@astrojs/markdown-remark"
import type { Root } from "hast"
import { VFile } from "vfile"
import { registry } from "../lib/registry"
import { siteDir, type SiteFile } from "../lib/site"
import type { FullSlug } from "../lib/path"
import { useRegistry } from "./context.ts"
import { remarkNote, rehypeLinks, rehypeNoteData } from "./frontmatter.ts"
import { ofmText, rehypeOfm, remarkOfm } from "./ofm.ts"
import { remarkDiagrams } from "./diagrams.ts"
import { remarkTree } from "./tree.ts"
import { rehypeEmbeds, remarkFileEmbeds } from "./embeds.ts"
import { rehypeIslands, remarkIslands } from "./islands.ts"
import { rehypeMargin } from "./margin.ts"
import { rehypeSealTranscludes, rehypeTables, rehypeTransclude, useTargets, type Target } from "./transclude.ts"
import { rehypeNoteLists } from "./notelist.ts"
import { loadSiteMarkdown, type TextTransform } from "./siteconfig.ts"

export type { TextTransform }

useRegistry(registry)

const site = await loadSiteMarkdown(siteDir())

export const textTransforms: TextTransform[] = [(text) => ofmText(text), ...site.textTransforms]

const basaltRemark: PluggableList = [
  remarkNote,
  [remarkDiagrams, { graph: true, graphviz: true, svg: true, math: true }],
  // ```tree, a directory drawn
  remarkTree,
  remarkOfm,
  // after ofm, whose arrows (-->) it would otherwise make dashes of
  remarkSmartypants,
  remarkFileEmbeds,
  remarkIslands,
  remarkMath,
]

const AUTOLINK_ICON = {
  type: "element",
  tagName: "svg",
  properties: {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  },
  children: [
    {
      type: "element",
      tagName: "path",
      properties: { d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" },
      children: [],
    },
    {
      type: "element",
      tagName: "path",
      properties: { d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" },
      children: [],
    },
  ],
}

const basaltRehype: PluggableList = [
  // Quartz highlighted first, before raw html is parsed; diffs before the rest
  rehypeDiff,
  [rehypePrettyCode, prettyCode],
  rehypeRaw,
  // <copy>text</copy>, before links are made of what's in it
  rehypeCopy,
  // <sound src spotify>word</sound>, its song looked up
  rehypeSound,
  rehypeOfm,
  rehypeSlug,
  [
    rehypeAutolinkHeadings,
    {
      behavior: "append",
      properties: { role: "anchor", ariaHidden: true, tabIndex: -1, "data-no-popover": true },
      content: AUTOLINK_ICON,
    },
  ],
  rehypeLinks,
  () => rehypeEmbeds({ web: true, files: true, lightbox: true }),
  // a picture with a dark version beside it follows the theme
  rehypeThemedMedia,
  rehypeIslands,
  rehypeMargin,
  rehypeNoteData,
  [rehypeKatex, { output: "html", macros: {} }],
]

/** what happens once the note's own tree is done: other notes, filled in */
const renderTime: PluggableList = [rehypeTransclude, rehypeNoteLists, rehypeTables, rehypeSealTranscludes]

export const remarkPlugins: PluggableList = [...basaltRemark, ...site.remarkPlugins]
export const rehypePlugins: PluggableList = [...basaltRehype, ...site.rehypePlugins, ...renderTime]

/** the rest of unified()'s options (gfm, smartypants, remarkRehype) */
export const processorOptions = {
  // ours runs after ofm (see basaltRemark)
  smartypants: false,
  remarkRehype: { allowDangerousHtml: true },
}
/** Astro's own highlighting ("shiki", "prism"), or false when a plugin does it */
export const syntaxHighlight: "shiki" | "prism" | false = false

// ---------- another note's tree, for transclusion ----------

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/

/** A note's text as the loader hands it to Astro: textTransforms run on everything after its frontmatter. */
export function transformNote(raw: string, file: SiteFile): string {
  const head = FRONTMATTER.exec(raw)?.[0] ?? ""
  let body = raw.slice(head.length)
  for (const t of textTransforms) body = t(body, file)
  return head + body
}

let ownTree: ReturnType<typeof treeProcessor> | undefined
function treeProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkPlugins)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use([...basaltRehype, ...site.rehypePlugins])
}

const targets = new Map<string, { stamp: number; target: Promise<Target | undefined> }>()

/** A note rendered on its own (its embeds left as they are), cached until its file changes. */
export async function renderTarget(slug: FullSlug): Promise<Target | undefined> {
  const file = registry().bySlug.get(slug)
  if (!file?.isNote) return undefined
  const stamp = fs.statSync(file.abs).mtimeMs
  const cached = targets.get(file.abs)
  if (cached && cached.stamp === stamp) return cached.target
  const target = (async () => {
    const { frontmatter, content } = parseFrontmatter(transformNote(fs.readFileSync(file.abs, "utf8"), file))
    const vfile = new VFile({ value: content, path: file.abs, data: { astro: { frontmatter } } })
    ownTree ??= treeProcessor()
    const tree = (await ownTree.run(ownTree.parse(vfile), vfile)) as Root
    // an unpublished note isn't there to embed, as it isn't there to visit
    const fm = vfile.data.frontmatter
    if (fm?.draft || fm?.private) return undefined
    return {
      slug,
      title: vfile.data.frontmatter?.title,
      tree,
      blocks: vfile.data.blocks ?? {},
    }
  })()
  targets.set(file.abs, { stamp, target })
  return target
}

useTargets(renderTarget)
