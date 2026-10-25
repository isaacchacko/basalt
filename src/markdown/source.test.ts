import test from "node:test"
import assert from "node:assert"
import { fromHtml } from "hast-util-from-html"
import { toString } from "hast-util-to-string"
import { highlightSource } from "./source.ts"

const note = "---\ntitle: Tides\n---\n\n# Tides\n\nSee [[moon]] and <copy>x</copy>.\n"

test("a note's source is its whole file, as written", async () => {
  const text = toString(fromHtml(await highlightSource(note), { fragment: true }))
  assert.equal(text.replace(/^ $/gm, ""), note.replace(/\n$/, ""))
})

test("it's highlighted as markdown, in the light and the dark theme", async () => {
  const html = await highlightSource(note)
  assert.match(html, /<code data-language="md" data-theme="github-light github-dark"/)
  assert.match(html, /--shiki-dark-font-weight:bold"># Tides<\/span>/)
})
