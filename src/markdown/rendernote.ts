// A note's text rendered as its page renders it, whatever the text is: as
// saved, or as it was at a commit (a note's history). The
// same plugins Astro renders the site with (astro.config.ts takes `rehype`
// from here), the note's lines named as the file's (lines.ts, `unsaved`).

import fs from "node:fs"
import { createMarkdownProcessor, parseFrontmatter } from "@astrojs/markdown-remark"
import { processorOptions, rehypePlugins, remarkPlugins, syntaxHighlight, transformNote } from "./index"
import { unsaved } from "./lines"
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

let processor: ReturnType<typeof createMarkdownProcessor> | undefined

/** The html of the note at `abs` with `text` for its file. */
export async function renderNote(abs: string, text: string): Promise<string> {
  const file = registry().byAbs.get(abs)
  if (!file) throw new Error(`${abs} isn't one of the site's notes`)
  processor ??= createMarkdownProcessor({
    remarkPlugins: remarkPlugins as never,
    rehypePlugins: rehype as never,
    remarkRehype: processorOptions.remarkRehype,
    smartypants: processorOptions.smartypants,
    syntaxHighlight,
  } as never)
  const { frontmatter, content } = parseFrontmatter(transformNote(text, file))
  unsaved.set(abs, text)
  try {
    return (await (await processor).render(content, { frontmatter, fileURL: new URL("file://" + abs) })).code
  } finally {
    unsaved.delete(abs)
  }
}
