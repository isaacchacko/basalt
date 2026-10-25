import test, { describe } from "node:test"
import assert from "node:assert"
import "./test-hooks.ts"
const { outsideCode } = await import("./code.ts")

const mark = (t: string) => t.replace(/\[\[(.*?)\]\]/g, "<$1>")

describe("outsideCode", () => {
  test("rewrites prose, and leaves inline code and fenced blocks as written", () => {
    const src = "a [[x]] `[[y#L4-L5]]` b\n```py\n[[z]]\n```\n[[w]] ``[[v]]``"
    assert.strictEqual(
      outsideCode(src, mark),
      "a <x> `[[y#L4-L5]]` b\n```py\n[[z]]\n```\n<w> ``[[v]]``",
    )
  })

  test("a fence closes only on its own kind", () => {
    const src = "~~~\n```\n[[a]]\n~~~\n[[b]]"
    assert.strictEqual(outsideCode(src, mark), "~~~\n```\n[[a]]\n~~~\n<b>")
  })
})

test("a code block's title gets a span of its own; what else is in its bar stays beside it", async () => {
  const { rehypeCodeTitles } = await import("./code.ts")
  const { fromHtml } = await import("hast-util-from-html")
  const { toHtml } = await import("hast-util-to-html")
  const tree = fromHtml(
    '<figure><figcaption data-rehype-pretty-code-title="">a/long/path.diff<span class="diff-stat"></span></figcaption></figure>' +
      '<figure><figcaption data-rehype-pretty-code-title=""><span class="code-file-name">sieve.py</span><span class="code-file-actions"></span></figcaption></figure>',
    { fragment: true },
  )
  rehypeCodeTitles()(tree)
  const html = toHtml(tree)
  assert.match(html, /<span class="code-title"><span>a\/long\/path\.diff<\/span><\/span><span class="diff-stat">/)
  assert.match(html, /<span class="code-title"><span><span class="code-file-name">sieve\.py<\/span><\/span><\/span><span class="code-file-actions">/)
})
