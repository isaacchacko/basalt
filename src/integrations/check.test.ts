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

test("an orphan is a note nothing reaches: not a folder's own note, nor one the navigation links", () => {
  const dist = site({
    "index.html": `<p>home</p>`,
    "about/index.html": `<p>about</p>`,
    "blog/index.html": `<p>the blog</p>`,
    "blog/a-post/index.html": `<p>a post</p>`,
    "stray/index.html": `<p>nobody comes here</p>`,
  })
  const notes = new Map(
    ["index", "about", "blog", "blog/a-post", "stray"].map((s) => [s, { file: `notes/${s}.md`, abs: `/nowhere/${s}.md` }]),
  )
  const orphans = (reached?: string[]) =>
    check(dist, notes, { reached }).filter((p) => p.kind === "orphan").map((p) => p.note)
  // blog is a folder's own note: its folder's page
  assert.deepEqual(orphans(), ["notes/about.md", "notes/blog/a-post.md", "notes/stray.md"])
  assert.deepEqual(orphans(["about", "blog/a-post/"]), ["notes/stray.md"])
})
