// The browser's node:path (lib/vite.ts) answers as node's posix path does.
import test from "node:test"
import assert from "node:assert"
import path from "node:path"
import * as ours from "./path.ts"

const paths = ["/site/notes/a.md", "/site/notes/", "a/b/../c.ts", "./x", "/", "", ".", "..", "a.tar.gz", ".hidden", "/a/.b", "dir/"]

test("basename, extname, dirname, normalize: node's", () => {
  for (const p of paths) {
    assert.strictEqual(ours.basename(p), path.posix.basename(p), `basename(${p})`)
    assert.strictEqual(ours.extname(p), path.posix.extname(p), `extname(${p})`)
    if (p) assert.strictEqual(ours.dirname(p), path.posix.dirname(p), `dirname(${p})`)
    if (p) assert.strictEqual(ours.normalize(p), path.posix.normalize(p).replace(/(.)\/$/, "$1"), `normalize(${p})`)
  }
  assert.strictEqual(ours.basename("/a/b.md", ".md"), "b")
})

test("join, resolve, relative: node's, from the site's root", () => {
  assert.strictEqual(ours.join("/site/.basalt/astro", "cache", "spotify.json"), "/site/.basalt/astro/cache/spotify.json")
  assert.strictEqual(ours.join("a", "../b", "c"), path.posix.join("a", "../b", "c"))
  for (const [a, b] of [["/site", "notes/a.md"], ["/site/x", "/abs"], ["/", "a/../b"]]) assert.strictEqual(ours.resolve(a, b), path.posix.resolve(a, b))
  for (const [a, b] of [["/site/notes", "/site/assets/x.png"], ["/a/b/c", "/a"], ["/a", "/a"], ["/a", "/a/b/c"]]) assert.strictEqual(ours.relative(a, b), path.posix.relative(a, b))
})
