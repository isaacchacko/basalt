import "./test-hooks.ts"
import test, { describe } from "node:test"
import assert from "node:assert"
import type { Element, Root } from "hast"
import { toHtml } from "hast-util-to-html"
import type { FullSlug } from "../lib/path"
const { renderTranscludes, useTargets } = await import("./transclude.ts")

const p = (text: string, id?: string): Element => ({
  type: "element",
  tagName: "p",
  properties: id ? { id } : {},
  children: [{ type: "text", value: text }],
})

/** What ofm.ts and crawlLinks leave for `![[target#block|alias]]`. */
function embed(target: string, block = "", alias = "undefined"): Element {
  return {
    type: "element",
    tagName: "blockquote",
    properties: { className: ["transclude"], dataUrl: target, dataBlock: block, dataEmbedAlias: alias },
    children: [
      {
        type: "element",
        tagName: "a",
        properties: { href: `/${target}`, "data-slug": target },
        children: [{ type: "text", value: `Transclude of ${target}` }],
      },
    ],
  }
}

function page(slug: string, children: Element[], blocks: Record<string, Element> = {}) {
  return { slug: slug as FullSlug, title: slug, tree: { type: "root", children } as Root, blocks }
}

async function render(root: Root, pages: ReturnType<typeof page>[]): Promise<string> {
  useTargets(async (slug) => pages.find((p) => p.slug === slug))
  await renderTranscludes(root, "index" as FullSlug, new Set(["index" as FullSlug]))
  return toHtml(root)
}

describe("transclusion", () => {
  test("the same note embedded twice renders twice (Quartz called the second circular)", async () => {
    const html = await render({ type: "root", children: [embed("a"), embed("a")] }, [page("a", [p("hello")])])
    assert.strictEqual(html.match(/<p>hello<\/p>/g)?.length, 2)
    assert.doesNotMatch(html, /Circular/)
  })

  test("a note that embeds itself, through another, is still caught", async () => {
    const html = await render({ type: "root", children: [embed("a")] }, [
      page("a", [embed("b")]),
      page("b", [embed("a")]),
    ])
    assert.match(html, /Circular transclusion detected: a/)
  })

  test("an alias titles a whole-note embed, else the note's title", async () => {
    const html = await render({ type: "root", children: [embed("a", "", "my title"), embed("a")] }, [
      page("a", [p("hello")]),
    ])
    assert.match(html, /<h1>my title<\/h1>/)
    assert.match(html, /<h1>a<\/h1>/)
  })

  test("a missing note, heading or block says so", async () => {
    const html = await render(
      { type: "root", children: [embed("nope"), embed("a", "#no-heading"), embed("a", "#^noblock")] },
      [page("a", [p("hello")])],
    )
    assert.match(html, /nothing to embed: no note called nope/)
    assert.match(html, /nothing to embed: no heading #no-heading in a/)
    assert.match(html, /nothing to embed: no block \^noblock in a/)
  })

  test("a block embed still works, and a list item comes in its list", async () => {
    const block = p("the block", "blk")
    const item: Element = { type: "element", tagName: "li", properties: { id: "it" }, children: [] }
    const html = await render({ type: "root", children: [embed("a", "#^blk"), embed("a", "#^it")] }, [
      page("a", [block], { blk: block, it: item }),
    ])
    assert.match(html, /<p id="blk">the block<\/p><a href="\/a" class="internal transclude-src">Link to original<\/a>/)
    assert.match(html, /<ul><li id="it"><\/li><\/ul>/)
  })

  test("a heading brings what's under it, up to the next as high", async () => {
    const h = (n: number, id: string): Element => ({
      type: "element",
      tagName: `h${n}`,
      properties: { id },
      children: [{ type: "text", value: id }],
    })
    const html = await render({ type: "root", children: [embed("a", "#two")] }, [
      page("a", [h(2, "one"), p("1"), h(2, "two"), p("2"), h(3, "deeper"), p("3"), h(2, "three"), p("4")]),
    ])
    assert.match(html, /<h2 id="two">two<\/h2><p>2<\/p><h3 id="deeper">deeper<\/h3><p>3<\/p><a/)
    assert.doesNotMatch(html, /three|<p>1<\/p>/)
  })

  test("it reports what it embedded", async () => {
    useTargets(async (slug) => (slug === ("a" as FullSlug) ? page("a", [embed("b")]) : page("b", [p("x")])))
    const found = await renderTranscludes(
      { type: "root", children: [embed("a")] },
      "index" as FullSlug,
      new Set(["index" as FullSlug]),
    )
    assert.deepStrictEqual([...found].sort(), ["a", "b"])
  })
})
