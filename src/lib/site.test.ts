import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadSite, pageOf } from "./site.ts"

function site(json: object, files: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-pages-"))
  fs.mkdirSync(path.join(root, "garden"))
  fs.writeFileSync(path.join(root, "garden", "basalt.json"), JSON.stringify(json))
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), "# a note\n")
  }
  return { root, site: loadSite(path.join(root, "garden")) }
}

test("a note is found at its page, wherever basalt.json brings it in from", () => {
  const { root, site: s } = site(
    { content: [{ from: "notes", to: "" }, { from: "../content/pages", to: "" }, { from: "../content/dumps", to: "blog" }] },
    ["garden/notes/index.md", "content/pages/about.md", "content/dumps/index.md", "content/dumps/a post.md"],
  )
  assert.equal(pageOf(s, path.join(root, "garden/notes/index.md")), "/")
  assert.equal(pageOf(s, path.join(root, "content/pages/about.md")), "/about")
  assert.equal(pageOf(s, path.join(root, "content/dumps/index.md")), "/blog")
  assert.equal(pageOf(s, path.join(root, "content/dumps/a post.md")), "/blog/a-post")
})

test("a file that isn't one of the site's notes has no page", () => {
  const { root, site: s } = site({}, ["garden/notes/index.md", "garden/notes/shot.png", "elsewhere/stray.md"])
  assert.equal(pageOf(s, path.join(root, "garden/notes/shot.png")), null)
  assert.equal(pageOf(s, path.join(root, "elsewhere/stray.md")), null)
})
