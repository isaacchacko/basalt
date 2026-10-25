import "./test-hooks.ts"
import test, { describe } from "node:test"
import assert from "node:assert"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkRehype from "remark-rehype"
import { toHtml } from "hast-util-to-html"
import type { Element, Root } from "hast"
const { marginNotes, sidenotes } = await import("./margin.ts")

async function hast(markdown: string): Promise<Root> {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype)
  return (await processor.run(processor.parse(markdown))) as Root
}

describe("margin notes", () => {
  test("a footnote becomes a sidenote right after its number", async () => {
    const tree = await hast(
      "Some claim.[^a] And another.[^b]\n\n[^a]: Why it holds.\n[^b]: A second *note*.",
    )
    assert.strictEqual(sidenotes(tree), 2)
    const html = toHtml(tree)
    assert.match(
      html,
      /<\/sup><span class="sidenote" role="note" data-sidenote="user-content-fn-a"><span class="sidenote-number">1<\/span>Why it holds.<\/span>/,
    )
    assert.match(html, /<span class="sidenote-number">2<\/span>A second <em>note<\/em>.<\/span>/)
    // the number knows its note, and the backref doesn't come along
    assert.match(html, /data-sidenote="user-content-fn-a"[^>]*>1<\/a>/)
    assert.doesNotMatch(html.split("<section")[0], /data-footnote-backref/)
  })

  test("the footnotes stay at the bottom too, for feeds and no script", async () => {
    const tree = await hast("Claim.[^a]\n\n[^a]: Note.")
    sidenotes(tree)
    assert.match(toHtml(tree), /<section data-footnotes class="footnotes">/)
  })

  test("an aside callout becomes a margin note, titled only if it was named", () => {
    const callout = (title: string): Element => ({
      type: "element",
      tagName: "blockquote",
      properties: { className: ["callout", "aside"], dataCallout: "aside" },
      children: [
        {
          type: "element",
          tagName: "div",
          properties: { className: ["callout-title"] },
          children: [
            {
              type: "element",
              tagName: "div",
              properties: { className: ["callout-title-inner"] },
              children: [
                {
                  type: "element",
                  tagName: "p",
                  properties: {},
                  children: [{ type: "text", value: title }],
                },
              ],
            },
          ],
        },
        {
          type: "element",
          tagName: "div",
          properties: { className: ["callout-content"] },
          children: [
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [{ type: "text", value: "a remark" }],
            },
          ],
        },
      ],
    })
    const tree: Root = { type: "root", children: [callout("Euclid"), callout("Aside")] }
    assert.strictEqual(marginNotes(tree), 2)
    const html = toHtml(tree)
    assert.match(
      html,
      /^<aside class="marginnote" role="note"><strong class="marginnote-title">Euclid<\/strong><p>a remark<\/p><\/aside>/,
    )
    assert.match(html, /<aside class="marginnote" role="note"><p>a remark<\/p><\/aside>$/)
  })
})
