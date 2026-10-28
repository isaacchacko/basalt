// A draft's markdown, marked as a commit's changes are (marks.ts textMarked):
// what the publish dialog shows.
import test, { describe } from "node:test"
import assert from "node:assert"
import { textMarked } from "./marks.ts"

const NOTE = "---\ntitle: Plants\n---\n\n# Plants\n\nBasil wants sun and water every morning.\n\nFerns like it dim and damp.\n\n- tomatoes\n- basil\n"

describe("a draft's changes, marked", () => {
  test("words added and taken away in a block, marked in it; the blocks that didn't change left out", () => {
    const out = textMarked(NOTE, NOTE.replace("every morning.", "each morning. Rosemary too."))
    assert.match(out, /<p data-src="7-7">Basil wants sun and water <del>every<\/del><ins>each<\/ins> morning\. <ins>Rosemary too\.<\/ins><\/p>/)
    assert.doesNotMatch(out, /Ferns|tomatoes|title/)
    assert.equal((out.match(/class="marks-skip"/g) ?? []).length, 2, "the blocks left out, before and after it")
  })

  test("a block added, or taken away, whole", () => {
    const out = textMarked(NOTE, NOTE.replace("Ferns like it dim and damp.\n\n", "") + "\nA new line.\n")
    assert.match(out, /<p class="history-removed">Ferns like it dim and damp\.<\/p>/)
    assert.match(out, /<p data-src="\d+-\d+" class="history-added">A new line\.<\/p>/)
  })

  test("markdown is shown as written, not read as html; and a text with \\r\\n as one with \\n", () => {
    const out = textMarked(NOTE, NOTE.replace("damp.", "damp. <b>bold</b> & more"))
    assert.match(out, /<ins>&#x3C;b>bold&#x3C;\/b> &#x26; more<\/ins>/)
    assert.equal(textMarked(NOTE, NOTE.replace(/\n/g, "\r\n")), "")
  })

  test("nothing changed: nothing", () => assert.equal(textMarked(NOTE, NOTE), ""))
})
