import test, { describe } from "node:test"
import assert from "node:assert/strict"
import { applyOps, badName, badPath, movesOf, relink, repoPathOf, treePathOf, type FileOp } from "./fileops.ts"

const files = ["index.md", "plants.md", "blog/index.md", "blog/a post.md", "blog/card.png", "a/dup.md", "b/dup.md"]

describe("names and paths", () => {
  test("a name has none of a path's or a link's own characters", () => {
    for (const ok of ["a post", "Ünïcode", "2026-10-28", "a.b"]) assert.equal(badName(ok), undefined, ok)
    for (const bad of ["", " ", ".", "..", ".hidden", "a/b", "a\\b", "a#b", "a|b", "a[b]", "a^b", "a:b", "a?b"]) assert.ok(badName(bad), bad)
  })
  test("a path doesn't climb out, start at the top of the disk, or go somewhere private", () => {
    for (const ok of ["a.md", "blog/a post.md", "x/y/z"]) assert.equal(badPath(ok), undefined, ok)
    for (const bad of ["", "/a.md", "a/", "../a.md", "a/../../b.md", "a//b.md", "./a.md", "private/a.md", "x/node_modules/a.md", ".git/config"]) assert.ok(badPath(bad), bad)
  })
})

describe("applyOps", () => {
  test("a note made, renamed, moved, deleted", () => {
    const ops: FileOp[] = [
      { op: "create", path: "new.md" },
      { op: "move", from: "new.md", to: "blog/new.md" },
      { op: "move", from: "plants.md", to: "garden.md" },
      { op: "delete", path: "a/dup.md" },
    ]
    const r = applyOps(files, ops)
    assert.deepEqual(r.errors, [])
    assert.deepEqual([...r.files].sort(), ["b/dup.md", "blog/a post.md", "blog/card.png", "blog/index.md", "blog/new.md", "garden.md", "index.md"])
    assert.equal(r.from.get("garden.md"), "plants.md")
    assert.equal(r.from.has("blog/new.md"), false, "a new note wasn't anywhere before")
  })
  test("a folder moves with everything in it, and goes with everything in it", () => {
    const moved = applyOps(files, [{ op: "move", from: "blog", to: "writing/blog", folder: true }])
    assert.deepEqual([...moved.files].filter((f) => f.startsWith("writing/")).sort(), ["writing/blog/a post.md", "writing/blog/card.png", "writing/blog/index.md"])
    const gone = applyOps(files, [{ op: "delete", path: "blog", folder: true }])
    assert.deepEqual([...gone.files].sort(), ["a/dup.md", "b/dup.md", "index.md", "plants.md"])
  })
  test("never over a file or folder that's there, from nothing, or into itself", () => {
    const r = applyOps(files, [
      { op: "create", path: "plants.md" },
      { op: "move", from: "index.md", to: "plants.md" },
      { op: "move", from: "nope.md", to: "x.md" },
      { op: "move", from: "plants.md", to: "blog" },
      { op: "move", from: "blog", to: "blog/inner", folder: true },
      { op: "create", path: "../out.md" },
      { op: "delete", path: "nope.md" },
    ])
    assert.deepEqual(
      r.errors.map((e) => e.why),
      ["exists", "exists", "missing", "exists", "path", "path", "missing"],
    )
    assert.deepEqual([...r.files].sort(), [...files].sort())
  })
})

describe("relink", () => {
  const moved = (ops: FileOp[]) => {
    const r = applyOps(files, ops)
    return { now: r.files, moved: movesOf(files, ops) }
  }
  const at = (p: string) => ({ was: p, now: p })

  test("a renamed note's links follow it, their headings and aliases kept", () => {
    const m = moved([{ op: "move", from: "plants.md", to: "garden.md" }])
    const text = "See [[plants]], [[plants#Basil|the basil]], ![[plants]] and [[plants.md]].\n"
    const out = relink(text, at("index.md"), files, m.now, m.moved)
    assert.equal(out.text, "See [[garden]], [[garden#Basil|the basil]], ![[garden]] and [[garden.md]].\n")
    assert.equal(out.links, 4)
  })
  test("a link that still gets there stays; one in code stays; other links stay", () => {
    const m = moved([{ op: "move", from: "blog/a post.md", to: "a post.md" }])
    const text = "[[a post]] and [[blog/a post|it]] `[[blog/a post]]`\n```\n[[blog/a post]]\n```\n[[index]] [[https://x.y]]\n"
    const out = relink(text, at("index.md"), files, m.now, m.moved)
    assert.equal(out.text, "[[a post]] and [[a post|it]] `[[blog/a post]]`\n```\n[[blog/a post]]\n```\n[[index]] [[https://x.y]]\n")
    assert.equal(out.links, 1)
  })
  test("a name that's no longer the only one of its kind is written as its path", () => {
    const m = moved([{ op: "move", from: "plants.md", to: "a/plants.md" }, { op: "create", path: "b/plants.md" }])
    const out = relink("[[plants]]", at("index.md"), files, m.now, m.moved)
    assert.equal(out.text, "[[a/plants]]")
  })
  test("a folder moved: the links into it, its own name, and its files", () => {
    const m = moved([{ op: "move", from: "blog", to: "writing", folder: true }])
    const text = "[[blog]] [[blog/a post]] [[a post]] ![[blog/card.png]] [[blog/index|home]]"
    const out = relink(text, at("index.md"), files, m.now, m.moved)
    assert.equal(out.text, "[[writing]] [[writing/a post]] [[a post]] ![[writing/card.png]] [[writing/index|home]]")
  })
  test("the moved note's own links, from where it is now", () => {
    const m = moved([{ op: "move", from: "plants.md", to: "garden.md" }])
    const out = relink("[[plants]] and [[a/dup]]", { was: "plants.md", now: "garden.md" }, files, m.now, m.moved)
    assert.equal(out.text, "[[garden]] and [[a/dup]]")
  })
})

describe("the tree in a repository", () => {
  const roots = [
    { to: "", repo: "garden/notes" },
    { to: "blog", repo: "posts" },
  ]
  test("each path by the folder of notes it's in, the deepest", () => {
    assert.equal(repoPathOf(roots, "index.md"), "garden/notes/index.md")
    assert.equal(repoPathOf(roots, "blog/a.md"), "posts/a.md")
    assert.equal(repoPathOf(roots, "blog"), "posts")
    assert.equal(repoPathOf([{ to: "x", repo: "x" }], "y.md"), undefined)
    assert.equal(treePathOf(roots, "garden/notes/a/b.md"), "a/b.md")
    assert.equal(treePathOf(roots, "posts/a.md"), "blog/a.md")
    assert.equal(treePathOf(roots, "README.md"), undefined)
    // under the top's folder, but where blog's files are: not the top's
    assert.equal(treePathOf(roots, "garden/notes/blog/a.md"), undefined)
    assert.equal(repoPathOf([{ to: "", repo: "" }], "a.md"), "a.md")
  })
})
