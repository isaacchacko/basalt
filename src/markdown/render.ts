// A note rendered the way Astro renders it, outside Astro: for tests, and for
// checking a note's markup from the command line:
//
//   node --experimental-strip-types src/markdown/render.ts notes/index.md

import "./test-hooks.ts"
import fs from "node:fs"
import path from "node:path"

const { createMarkdownProcessor, parseFrontmatter } = await import("@astrojs/markdown-remark")
const md = await import("./index.ts")
const { refreshRegistry } = await import("../lib/registry.ts")

export async function renderFile(abs: string) {
  const reg = refreshRegistry()
  const file = reg.byAbs.get(abs)
  if (!file) throw new Error(`${abs} isn't one of the site's notes`)
  const processor = await createMarkdownProcessor({
    remarkPlugins: md.remarkPlugins as never,
    rehypePlugins: md.rehypePlugins as never,
    remarkRehype: md.processorOptions.remarkRehype,
    smartypants: md.processorOptions.smartypants,
    syntaxHighlight: md.syntaxHighlight,
  })
  const { frontmatter, content } = parseFrontmatter(md.transformNote(fs.readFileSync(abs, "utf8"), file))
  return processor.render(content, { frontmatter, fileURL: new URL("file://" + abs) })
}

if (import.meta.main) {
  const reg = refreshRegistry()
  const abs = path.resolve(reg.site.dir, process.argv[2])
  const out = await renderFile(abs)
  if (process.argv.includes("--data")) console.log(JSON.stringify(out.metadata.frontmatter, null, 2))
  else console.log(out.code)
}
