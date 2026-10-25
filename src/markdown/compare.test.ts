import "./test-hooks.ts"
import test, { describe } from "node:test"
import assert from "node:assert"
import path from "node:path"

process.env.BASALT_SITE = path.resolve("test/fixtures/site")
const { renderFile } = await import("./render.ts")
const { lineAnchors } = await import("./compare.ts")
const { code } = await renderFile(path.resolve("test/fixtures/site/notes/compare.md"))

describe("compare blocks", () => {
  test("callouts in a row are one figure, a column each, labelled by their titles", () => {
    assert.match(code, /<figure class="compare" data-columns="2"><div class="compare-columns"><div class="compare-column" data-label="Basalt"><p class="compare-label">Basalt<\/p>/)
    assert.match(code, /<div class="compare-column" data-label="Quartz v5"><p class="compare-label">Quartz <em>v5<\/em><\/p>/)
  })

  test("a lone one stays a callout; untitled ones have no label", () => {
    assert.match(code, /<blockquote class="callout compare" data-callout="compare"/)
    assert.match(code, /<figure class="compare" data-columns="3">/)
    assert.match(code, /<div class="compare-column">\s*<p>Untitled.<\/p>/)
  })

  test("a block id anchors its paragraph, or on its own line the block before it", () => {
    assert.match(code, /<p data-compare-anchor="page">and a note puts it on the page.<\/p>/)
    assert.match(code, /<div class="compare-lines" data-compare-anchor="page">\s*<figure data-rehype-pretty-code-figure="">/)
    assert.doesNotMatch(code, /\^page/)
  })

  test("a fence's line anchors come off its info string and onto its block", () => {
    assert.match(code, /data-compare-lines="\[\[&#x22;markup&#x22;,&#x22;2&#x22;\],\[&#x22;handlers&#x22;,&#x22;\/onPointerMove\/&#x22;\]\]"/)
    assert.match(code, /data-rehype-pretty-code-title="[^"]*"[^>]*>music.tsx<\/figcaption>/)
  })

  test("line anchors: a number or /text/, several, the rest of the info string kept", () => {
    assert.deepStrictEqual(lineAnchors('title="a b.ts" ^one=3 showLineNumbers ^two=/x = y/'), {
      meta: 'title="a b.ts" showLineNumbers',
      anchors: [
        ["one", "3"],
        ["two", "/x = y/"],
      ],
    })
    assert.deepStrictEqual(lineAnchors("{1-3} ^notanchor"), { meta: "{1-3} ^notanchor", anchors: [] })
  })
})
