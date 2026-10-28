// Basalt's own markdown plugins, in order, and what the rest of a note's
// rendering is made of: everything index.ts puts together with a site's own
// plugins, and nothing that needs node, so a page being edited renders a note
// with the very same plugins in the browser (browser/render.ts).

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
import { parseFrontmatter } from "@astrojs/markdown-remark"
import type { Root } from "hast"
import { VFile } from "vfile"
import type { SiteFile } from "../lib/site"
import type { FullSlug } from "../lib/path"
import { prettyCode } from "./source.ts"
import { rehypeDiff } from "./diff.ts"
import { rehypeThemedMedia } from "./themed.ts"
import { rehypeCopy } from "./copy.ts"
import { rehypeSound } from "./sound.ts"
import { rehypeSpotify } from "./spotify.ts"
import { remarkNote, rehypeLinks, rehypeNoteData } from "./frontmatter.ts"
import { ofmText, rehypeMermaid, rehypeOfm, remarkOfm } from "./ofm.ts"
import { remarkDiagrams } from "./diagrams.ts"
import { remarkTree } from "./tree.ts"
import { rehypeEmbeds, remarkFileEmbeds } from "./embeds.ts"
import { rehypeCodeTitles } from "./code.ts"
import { rehypeIslands, remarkIslands } from "./islands.ts"
import { rehypeMargin } from "./margin.ts"
import { rehypeTabs } from "./tabs.ts"
import { rehypeSealTranscludes, rehypeTables, rehypeTransclude, type Target } from "./transclude.ts"
import { rehypeNoteLists } from "./notelist.ts"
import type { TextTransform } from "./siteconfig.ts"

export const basaltRemark: PluggableList = [
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

export const basaltRehype: PluggableList = [
  // Quartz highlighted first, before raw html is parsed; diffs before the rest
  rehypeDiff,
  rehypeMermaid,
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
      properties: { "data-anchor": true, ariaHidden: "true", tabIndex: -1, "data-no-popover": true },
      content: AUTOLINK_ICON,
    },
  ],
  rehypeLinks,
  () => rehypeEmbeds({ web: true, files: true, lightbox: true }),
  // [[spotify:…]], a song's card: after the links, so its own isn't marked external
  rehypeSpotify,
  // after a code file's bar is made
  rehypeCodeTitles,
  // `> [!tab]` callouts in a row take turns
  rehypeTabs,
  // a picture with a dark version beside it follows the theme
  rehypeThemedMedia,
  rehypeIslands,
  rehypeMargin,
  rehypeNoteData,
  [rehypeKatex, { output: "html", macros: {} }],
]

/** what happens once the note's own tree is done: other notes, filled in */
export const renderTime: PluggableList = [rehypeTransclude, rehypeNoteLists, rehypeTables, rehypeSealTranscludes]

/** the rest of unified()'s options (gfm, smartypants, remarkRehype) */
export const processorOptions = {
  // ours runs after ofm (see basaltRemark)
  smartypants: false,
  remarkRehype: { allowDangerousHtml: true },
}
/** Astro's own highlighting ("shiki", "prism"), or false when a plugin does it */
export const syntaxHighlight: "shiki" | "prism" | false = false


/** Basalt's own textTransforms (a site's come after) */
export const basaltText: TextTransform[] = [(text) => ofmText(text)]

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/

/** A note's text as the loader hands it to Astro: `transforms` run on everything after its frontmatter. */
export function transformText(raw: string, file: SiteFile, transforms: TextTransform[]): string {
  const head = FRONTMATTER.exec(raw)?.[0] ?? ""
  let body = raw.slice(head.length)
  for (const t of transforms) body = t(body, file)
  return head + body
}

/** What renders a note on its own, for transclusion: a note's plugins, but not what fills in other notes */
export function treeProcessor(remark: PluggableList, rehype: PluggableList) {
  return unified().use(remarkParse).use(remarkGfm).use(remark).use(remarkRehype, { allowDangerousHtml: true }).use(rehype)
}

/** A note rendered on its own (its embeds left as they are) from its text (transformed), or undefined when it's unpublished. */
export async function targetOf(processor: ReturnType<typeof treeProcessor>, slug: FullSlug, abs: string, text: string): Promise<Target | undefined> {
  const { frontmatter, content } = parseFrontmatter(text)
  const vfile = new VFile({ value: content, path: abs, data: { astro: { frontmatter } } })
  const tree = (await processor.run(processor.parse(vfile), vfile)) as Root
  // an unpublished note isn't there to embed, as it isn't there to visit
  const fm = vfile.data.frontmatter
  if (fm?.draft || fm?.private) return undefined
  return {
    slug,
    title: vfile.data.frontmatter?.title,
    tree,
    blocks: vfile.data.blocks ?? {},
  }
}
