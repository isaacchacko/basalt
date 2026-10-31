import "../markdown/test-hooks.ts"
import test, { describe } from "node:test"
import assert from "node:assert"
import type { FullSlug } from "./path.ts"
import type { Element, Root } from "hast"
const { resolveLink, hrefOf, crawlLinks } = await import("./links.ts")

const slugs = ["index", "margin", "sources/garden-ideas", "blog/index", "blog/a-post", "assets/card.png", "a/dup", "b/dup"] as FullSlug[]
const from = (s: string) => s as FullSlug

describe("links", () => {
  test("a unique name is enough (shortest), and hrefs are root-absolute", () => {
    assert.deepStrictEqual(resolveLink(from("index"), "garden-ideas", slugs), {
      href: "/sources/garden-ideas",
      slug: "sources/garden-ideas",
    })
    assert.deepStrictEqual(resolveLink(from("blog/a-post"), "margin", slugs), { href: "/margin", slug: "margin" })
    assert.strictEqual(resolveLink(from("sources/garden-ideas"), "card.png", slugs).href, "/assets/card.png")
  })

  test("headings become anchors; media fragments pass through", () => {
    assert.strictEqual(resolveLink(from("index"), "garden-ideas#What to plant", slugs).href, "/sources/garden-ideas#what-to-plant")
    assert.strictEqual(resolveLink(from("index"), "clip.mp4#t=2", slugs).href, "/clip.mp4#t=2")
  })

  test("a name that isn't unique is a path from the root", () => {
    assert.deepStrictEqual(resolveLink(from("blog/a-post"), "a/dup", slugs), { href: "/a/dup", slug: "a/dup" })
    assert.deepStrictEqual(resolveLink(from("blog/a-post"), "dup", slugs), { href: "/dup", slug: "dup" })
  })

  test("folders and the index", () => {
    assert.deepStrictEqual(resolveLink(from("margin"), "blog/", slugs), { href: "/blog/", slug: "blog/index" })
    assert.deepStrictEqual(resolveLink(from("blog/a-post"), "/", slugs), { href: "/", slug: "index" })
    assert.strictEqual(resolveLink(from("blog/a-post"), "/tags/x", slugs).slug, "tags/x")
    assert.strictEqual(hrefOf("blog/index"), "/blog/")
    assert.strictEqual(hrefOf("index"), "/")
    assert.strictEqual(hrefOf("sources/garden-ideas"), "/sources/garden-ideas")
  })

  test("a file's name written down reads as one: its glyph before it", () => {
    const link = (href: string, text: string): Element => ({
      type: "element",
      tagName: "a",
      properties: { href },
      children: [{ type: "text", value: text }],
    })
    const links = [link("margin.md", "margin.md"), link("blog/", "blog/"), link("margin", "margin"), link("margin", "Margin notes")]
    crawlLinks({ type: "root", children: links } as Root, from("index"), slugs)
    const glyphs = links.map((a) => (a.children[0] as Element).properties?.className)
    assert.deepStrictEqual(glyphs, [["file-name-icon"], ["file-name-icon"], undefined, undefined])
    assert.deepStrictEqual(links.map((a) => (a.properties.className as string[]).includes("file-name")), [true, true, false, false])
    assert.strictEqual((links[1].children[1] as { value: string }).value, "blog")
  })
})
