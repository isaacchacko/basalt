// A site's own plugins (basalt.config.ts), after Basalt's.
import "./test-hooks.ts"
import test, { describe } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const site = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-site-"))
fs.mkdirSync(path.join(site, "notes"))
fs.mkdirSync(path.join(site, "plugins"))
fs.writeFileSync(path.join(site, "basalt.json"), '{ "title": "a site" }')
// a plugin in its own file, imported without its extension, using a package the site doesn't have
fs.writeFileSync(
  path.join(site, "plugins/title.ts"),
  `import { toString } from "mdast-util-to-string"
export function leadingTitle() {
  return (tree: any, file: any) => {
    const node = tree.children[0]
    if (node?.type !== "heading" || node.depth !== 1) return
    if (file.data.frontmatter.title === file.stem) file.data.frontmatter.title = toString(node)
    tree.children.shift()
  }
}`,
)
fs.writeFileSync(
  path.join(site, "basalt.config.ts"),
  `import { leadingTitle } from "./plugins/title"
export default {
  markdown: {
    textTransforms: [(text: string) => text.replaceAll(":wave:", "👋")],
    remarkPlugins: [leadingTitle],
    rehypePlugins: [() => (tree: any) => { tree.children.push({ type: "element", tagName: "hr", properties: { className: ["site"] }, children: [] }) }],
  },
}`,
)
fs.writeFileSync(path.join(site, "notes/dump.md"), "# A dump\n\nHello :wave:, [[other]].\n")
fs.writeFileSync(path.join(site, "notes/other.md"), "---\nprivate: true\n---\n\nsecret\n")
fs.writeFileSync(path.join(site, "notes/embeds.md"), "![[other]]\n")
fs.writeFileSync(path.join(site, "notes/draft.md"), "---\ndraft: true\n---\n\nnot yet\n")
process.env.BASALT_SITE = site

const { renderFile } = await import("./render.ts")

describe("a site's plugins", () => {
  test("text transforms, remark and rehype plugins all run, after Basalt's", async () => {
    const out = await renderFile(path.join(site, "notes/dump.md"))
    assert.strictEqual(out.metadata.frontmatter.title, "A dump")
    assert.match(out.code, /^<p>Hello 👋, <a href="\/other" class="internal" data-slug="other">other<\/a>.<\/p>/)
    assert.match(out.code, /<hr class="site">$/)
  })

  test("drafts and private notes are marked, for the page route to leave out", async () => {
    const other = await renderFile(path.join(site, "notes/other.md"))
    assert.strictEqual(other.metadata.frontmatter.private, true)
    assert.strictEqual(other.metadata.frontmatter.draft, false)
    const draft = await renderFile(path.join(site, "notes/draft.md"))
    assert.strictEqual(draft.metadata.frontmatter.draft, true)
  })

  test("an unpublished note can't be embedded either", async () => {
    const out = await renderFile(path.join(site, "notes/embeds.md"))
    assert.match(out.code, /nothing to embed: no note called other/)
    assert.doesNotMatch(out.code, /secret/)
  })
})
