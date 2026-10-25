import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { check, linkedSlug, locate } from "../../bin/check.mjs"

const page = (body: string) => `<!doctype html><html><body><article>${body}</article></body></html>`

function site(pages: Record<string, string>) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-check-"))
  for (const [file, html] of Object.entries(pages)) {
    fs.mkdirSync(path.dirname(path.join(dist, file)), { recursive: true })
    fs.writeFileSync(path.join(dist, file), page(html))
  }
  return dist
}

test("a link to a folder's index links that note, however it's written", () => {
  for (const href of ["/blog", "/blog/", "/blog/index", "/blog/index.html"]) assert.equal(linkedSlug(href), "blog")
  assert.equal(linkedSlug("/"), "index")
  assert.equal(linkedSlug("/blog/a-post#top"), "blog/a-post")
  for (const href of ["/blog", "/blog/", "/blog/index"]) {
    const dist = site({
      "index.html": `<a class="internal" href="${href}" data-slug="blog/index">the writing desk</a>`,
      "blog/index.html": `<p>the blog</p>`,
    })
    const notes = new Map([
      ["index", { file: "notes/index.md", abs: "/nowhere/index.md" }],
      ["blog", { file: "notes/blog/index.md", abs: "/nowhere/blog/index.md" }],
    ])
    const problems = check(dist, notes)
    assert.deepEqual(problems, [], `${href}: ${JSON.stringify(problems)}`)
  }
})

test("a broken link is found at its line, as written", () => {
  const text = "---\ntitle: x\n---\n\nsee [[Nudibranch|the nudibranch]]\n\n![[pool at dawn.png]]\n"
  assert.deepEqual(locate(text, "/nudibranch"), { line: 5, source: "[[Nudibranch|the nudibranch]]" })
  assert.deepEqual(locate(text, "/pool-at-dawn.png"), { line: 7, source: "![[pool at dawn.png]]" })
})

test("an unknown island is reported at its line", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-check-note-"))
  const abs = path.join(dir, "z.md")
  fs.writeFileSync(abs, "# z\n\n<island name=\"anemometer\"></island>\n")
  const dist = site({ "z.html": `<div class="island" data-island="anemometer"></div>`, "index.html": `<a href="/z">z</a>` })
  const notes = new Map([
    ["index", { file: "notes/index.md", abs: path.join(dir, "index.md") }],
    ["z", { file: "notes/z.md", abs }],
  ])
  const problems = check(dist, notes, { islands: ["tally"] })
  assert.deepEqual(problems, [{ kind: "unknown island", note: "notes/z.md", line: 3, detail: '"anemometer" (have: tally)' }])
})

test("a compare anchor that crosses another, or has no partner, is a warning at its line", () => {
  const text = [
    "> [!compare] A",
    "> ```ts ^tiles=/map/ ^move=/onPointerMove/",
    "> ```",
    "> Alone. ^solo",
    "",
    "> [!compare] B",
    "> ```ts ^move=1 ^tiles=2",
    "> ```",
  ].join("\n")
  const abs = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "basalt-note-")), "porting.md")
  fs.writeFileSync(abs, text)
  const lines = (...ls: string[]) => ls.map((l) => `<span data-line="">${l}</span>`).join("\n")
  const dist = site({
    "porting.html":
      `<figure class="compare"><div class="compare-columns">` +
      `<div class="compare-column"><div class="compare-lines" data-compare-lines='[["tiles","/map/"],["move","/onPointerMove/"]]'><pre><code>${lines("albums.map(a =>", "onPointerMove={lean}")}</code></pre></div><p data-compare-anchor="solo">Alone.</p></div>` +
      `<div class="compare-column"><div class="compare-lines" data-compare-lines='[["move","1"],["tiles","2"]]'><pre><code>${lines("addEventListener(\"pointermove\")", "tiles.map(t =>")}</code></pre></div></div>` +
      `</div></figure>`,
  })
  const problems = check(dist, new Map([["porting", { file: "notes/porting.md", abs }]])).filter((p) => p.kind === "compare anchor")
  assert.deepEqual(problems, [
    { kind: "compare anchor", note: "notes/porting.md", line: 2, detail: "^move crosses ^tiles, ignored", warning: true },
    { kind: "compare anchor", note: "notes/porting.md", line: 4, detail: "^solo has no partner in another column, ignored", warning: true },
  ])

  // the page goes by the lines a fence's anchors land on, not the order they're written in
  const landed = site({
    "porting.html":
      `<figure class="compare"><div class="compare-columns">` +
      `<div class="compare-column"><div class="compare-lines" data-compare-lines='[["tiles","/map/"],["move","/onPointerMove/"]]'><pre><code>${lines("onPointerMove={lean}", "albums.map(a =>")}</code></pre></div></div>` +
      `<div class="compare-column"><div class="compare-lines" data-compare-lines='[["tiles","1"],["move","2"]]'><pre><code>${lines("tiles.map(t =>", "addEventListener(\"pointermove\")")}</code></pre></div></div>` +
      `</div></figure>`,
  })
  assert.deepEqual(
    check(landed, new Map([["porting", { file: "notes/porting.md", abs }]])).filter((p) => p.kind === "compare anchor").map((p) => p.detail),
    ["^tiles crosses ^move, ignored"],
  )
})
