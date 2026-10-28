// Publishing the explorer's file ops (commit.ts, github.ts's commitTree): the
// one commit planned over the branch as it is, and the calls that make it.
import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import { plan, type Planning } from "./commit.ts"
import { base64, gitHub, type Head } from "./github.ts"

// a repo whose notes are in garden/notes, with a README beside them that's not a note's
const BLOBS: Record<string, string> = {
  s1: "Home. See [[plants]] and [[shed/tools]].\n",
  s2: "# Plants\n\nBasil.\n",
  s3: "Tools, for [[plants]].\n",
  s4: "Shed.\n",
  s5: "# readme\n",
}
const head: Head = {
  commit: "c0",
  tree: "t0",
  files: [
    { path: "garden/notes/index.md", mode: "100644", sha: "s1" },
    { path: "garden/notes/plants.md", mode: "100644", sha: "s2" },
    { path: "garden/notes/shed/tools.md", mode: "100755", sha: "s3" },
    { path: "garden/notes/shed/index.md", mode: "100644", sha: "s4" },
    { path: "README.md", mode: "100644", sha: "s5" },
  ],
}
const roots = [{ to: "", repo: "garden/notes" }]
const reads: string[] = []
const base = (over: Partial<Planning>): Planning => ({
  head,
  roots,
  ops: [],
  drafts: new Map(),
  read: async (sha) => (reads.push(sha), BLOBS[sha]),
  ...over,
})
const byPath = (c: { path: string }[]) => [...c].sort((a, b) => a.path.localeCompare(b.path))

describe("plan", () => {
  test("a new note: its draft's text, at its path in the repo", async () => {
    const p = await plan(base({ ops: [{ op: "create", path: "shed/rake.md" }], drafts: new Map([["shed/rake.md", "A rake.\n"]]) }))
    assert.deepEqual(p.changes, [{ path: "garden/notes/shed/rake.md", text: "A rake.\n" }])
    assert.equal(p.placed.get("shed/rake.md"), "shed/rake.md")
    // and one never written to: empty
    const empty = await plan(base({ ops: [{ op: "create", path: "new.md" }] }))
    assert.deepEqual(empty.changes, [{ path: "garden/notes/new.md", text: "" }])
    // a new folder: its index note, as it was made
    const folder = await plan(base({ ops: [{ op: "create", path: "barn/index.md", text: "---\ntitle: \"Barn\"\n---\n" }] }))
    assert.deepEqual(folder.changes, [{ path: "garden/notes/barn/index.md", text: "---\ntitle: \"Barn\"\n---\n" }])
  })

  test("a rename with its links: the blob moves as it was, the links go along, nothing else is read", async () => {
    reads.length = 0
    const p = await plan(
      base({
        ops: [{ op: "move", from: "plants.md", to: "herbs.md", relink: true }],
        // the built site's index says who links to plants
        linking: (moved) => (assert.deepEqual(moved, ["plants.md"]), new Set(["index.md", "shed/tools.md"])),
      }),
    )
    assert.deepEqual(byPath(p.changes), [
      { path: "garden/notes/herbs.md", sha: "s2", mode: "100644" },
      { path: "garden/notes/index.md", text: "Home. See [[herbs]] and [[shed/tools]].\n", mode: "100644" },
      { path: "garden/notes/plants.md", gone: true },
      { path: "garden/notes/shed/tools.md", text: "Tools, for [[herbs]].\n", mode: "100755" },
    ])
    assert.deepEqual(p.links, [
      { path: "index.md", links: 1 },
      { path: "shed/tools.md", links: 1 },
    ])
    assert.deepEqual(reads.sort(), ["s1", "s3"])
  })

  test("without its links: only the blob moves", async () => {
    const p = await plan(base({ ops: [{ op: "move", from: "plants.md", to: "herbs.md" }] }))
    assert.deepEqual(byPath(p.changes), [
      { path: "garden/notes/herbs.md", sha: "s2", mode: "100644" },
      { path: "garden/notes/plants.md", gone: true },
    ])
    assert.deepEqual(p.links, [])
  })

  test("a folder moved, a note in it drafted: the draft goes with it, the rest keep their blobs", async () => {
    const p = await plan(
      base({
        ops: [{ op: "move", from: "shed", to: "barn", folder: true, relink: true }],
        drafts: new Map([["shed/tools.md", "Tools, sharpened, for [[plants]].\n"]]),
      }),
    )
    assert.deepEqual(byPath(p.changes), [
      { path: "garden/notes/barn/index.md", sha: "s4", mode: "100644" },
      { path: "garden/notes/barn/tools.md", text: "Tools, sharpened, for [[plants]].\n", mode: "100755" },
      { path: "garden/notes/index.md", text: "Home. See [[plants]] and [[barn/tools]].\n", mode: "100644" },
      { path: "garden/notes/shed/index.md", gone: true },
      { path: "garden/notes/shed/tools.md", gone: true },
    ])
    assert.equal(p.placed.get("shed/tools.md"), "barn/tools.md")
  })

  test("deleted: a note, a folder; a draft of one is placed nowhere", async () => {
    const p = await plan(
      base({
        ops: [{ op: "delete", path: "plants.md" }, { op: "delete", path: "shed", folder: true }],
        drafts: new Map([["plants.md", "x"]]),
      }),
    )
    assert.deepEqual(byPath(p.changes), [
      { path: "garden/notes/plants.md", gone: true },
      { path: "garden/notes/shed/index.md", gone: true },
      { path: "garden/notes/shed/tools.md", gone: true },
    ])
    assert.equal(p.placed.get("plants.md"), null)
  })

  test("what can't be done now (committed to since) is said, and only the rest committed", async () => {
    const p = await plan(base({ ops: [{ op: "create", path: "plants.md" }, { op: "delete", path: "gone.md" }, { op: "create", path: "ok.md" }] }))
    assert.deepEqual(
      p.ops.map((o) => o.why),
      ["exists", "missing", undefined],
    )
    assert.deepEqual(p.changes, [{ path: "garden/notes/ok.md", text: "" }])
  })

  test("files outside the folders of notes are never touched", async () => {
    const p = await plan(base({ ops: [{ op: "delete", path: "shed", folder: true }] }))
    assert.ok(!p.changes.some((c) => c.path === "README.md"))
  })
})

describe("commitTree", () => {
  type Seen = { url: string; method: string; body?: Record<string, unknown> }
  const real = globalThis.fetch
  let seen: Seen[] = []
  afterEach(() => {
    globalThis.fetch = real
  })
  function stub(ref = 200) {
    seen = []
    let blobs = 0
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      const req: Seen = { url: String(url).replace("https://api.github.com/repos/me/garden", ""), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined }
      seen.push(req)
      const body =
        req.url === "/git/ref/heads/main" ? { object: { sha: "c0" } }
        : req.url === "/git/commits/c0" ? { tree: { sha: "t0" } }
        : req.url.startsWith("/git/trees/t0") ? { tree: [{ path: "a.md", mode: "100644", type: "blob", sha: "s1" }, { path: "d", mode: "040000", type: "tree", sha: "t1" }] }
        : req.url === "/git/blobs" ? { sha: `b${++blobs}` }
        : req.url === "/git/trees" ? { sha: "t2" }
        : req.url === "/git/commits" ? { sha: "c1" }
        : req.url === "/git/refs/heads/main" && ref === 200 ? { object: { sha: "c1" } }
        : { message: "Update is not a fast forward" }
      return new Response(JSON.stringify(body), { status: req.url === "/git/refs/heads/main" ? ref : 200 })
    }) as typeof fetch
  }

  test("the branch read: its commit, its tree, its files (not its folders)", async () => {
    stub()
    const h = await gitHub("me/garden", "test-token").head("main")
    assert.deepEqual(h, { commit: "c0", tree: "t0", files: [{ path: "a.md", mode: "100644", sha: "s1" }] })
    assert.deepEqual(seen.map((s) => s.url), ["/git/ref/heads/main", "/git/commits/c0", "/git/trees/t0?recursive=1"])
  })

  test("one commit: a blob for each new text, a tree over the branch's, the commit, the branch moved, not forced", async () => {
    stub()
    const h = { commit: "c0", tree: "t0", files: [] }
    const res = await gitHub("me/garden", "test-token").commitTree(
      "main",
      h,
      [{ path: "n/new.md", text: "Né.\n" }, { path: "n/b.md", sha: "s1", mode: "100755" }, { path: "n/a.md", gone: true }],
      "Files",
    )
    assert.deepEqual(res, { sha: "c1" })
    assert.deepEqual(
      seen.map((s) => `${s.method} ${s.url}`),
      ["POST /git/blobs", "POST /git/trees", "POST /git/commits", "PATCH /git/refs/heads/main"],
    )
    assert.deepEqual(seen[0].body, { content: base64.encode("Né.\n"), encoding: "base64" })
    assert.deepEqual(seen[1].body, {
      base_tree: "t0",
      tree: [
        { path: "n/new.md", mode: "100644", type: "blob", sha: "b1" },
        { path: "n/b.md", mode: "100755", type: "blob", sha: "s1" },
        { path: "n/a.md", mode: "100644", type: "blob", sha: null },
      ],
    })
    assert.deepEqual(seen[2].body, { message: "Files", tree: "t2", parents: ["c0"] })
    assert.deepEqual(seen[3].body, { sha: "c1", force: false })
  })

  test("a branch committed to since: a conflict, and the branch left as it is", async () => {
    stub(422)
    const res = await gitHub("me/garden", "test-token").commitTree("main", { commit: "c0", tree: "t0", files: [] }, [{ path: "x.md", text: "" }], "m")
    assert.deepEqual(res, { conflict: true })
  })
})
