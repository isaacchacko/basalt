import test from "node:test"
import assert from "node:assert"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkRehype from "remark-rehype"
import rehypeRaw from "rehype-raw"
import rehypeStringify from "rehype-stringify"
import { rehypeCopy } from "./copy.ts"

const render = async (md: string) =>
  String(
    await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeCopy)
      .use(rehypeStringify)
      .process(md),
  )

test("<copy> is its text, copied on a click", async () => {
  const html = await render("run <copy>npm install</copy> first")
  assert.match(html, /<span class="copyable" role="button" tabindex="0" data-copy="npm install" data-tip="click to copy">npm install<\/span>/)
})

test("an address in it stays text, not a link", async () => {
  const html = await render("reach me at <copy>me@example.com</copy>")
  assert.match(html, /data-copy="me@example.com"[^>]*>me@example.com<\/span>/)
  assert.doesNotMatch(html, /<a /)
})

test("value copies something other than what it shows", async () => {
  const html = await render('the <copy value="sk-123">key</copy>')
  assert.match(html, /data-copy="sk-123"[^>]*>key<\/span>/)
})
