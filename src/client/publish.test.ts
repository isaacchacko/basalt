// Publishing a built site's draft (publish.ts), against a stand-in for
// GitHub's file and an editor's note: nothing's written till publish(), a
// commit made since the draft began is merged in and shown before anything's
// written, and one made after it was shown is too, not committed over.
import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { Text } from "@codemirror/state"
import { diff } from "./diff.ts"
import { publish, publishFiles, review, reviewFiles, type Drafting } from "./publish.ts"
import type { Filing, Planned } from "./commit.ts"
import type { Head } from "./github.ts"
import type { Version } from "./backend.ts"

/** GitHub's copy of the file: written over only at the version it's at (else a conflict, as a 409), counting writes */
function github(text: string) {
  let n = 0
  const at = { file: { text, sha: "sha0" } as Version, writes: [] as { text: string; base: string; message?: string }[], reads: 0 }
  return {
    at,
    /** a commit made elsewhere */
    commit(text: string) {
      at.file = { text, sha: `sha${++n}` }
    },
    backend: {
      async load() {
        at.reads++
        return at.file
      },
      async save(text: string, base: string, message?: string) {
        if (base !== at.file.sha) return { conflict: at.file }
        at.writes.push({ text, base, message })
        at.file = { text, sha: `sha${++n}` }
        return { sha: at.file.sha }
      },
    },
  }
}

/** an editor's note: what's written, over a version; theirs merged in around it as the editor does (editor.ts rebase) */
function editor(saved: Version, text: string) {
  const s = { saved, text, began: saved.sha, published: [] as Version[] }
  const d: Drafting = {
    now: () => ({ text: s.text, saved: s.saved, began: s.began }),
    merge(now) {
      const ours = diff(s.saved.text, s.text)
      const them = diff(s.saved.text, now.text)
      s.text = them.map(ours).apply(Text.of(s.text.split("\n"))).toString()
      s.saved = now
    },
    published(v) {
      s.saved = v
      s.published.push(v)
    },
  }
  return { s, d }
}

const BASE = "# Plants\n\nBasil wants sun.\n\n- tomatoes\n- ferns\n"
const MINE = BASE.replace("sun.", "sun. Rosemary too.")

describe("publishing a draft", () => {
  test("reviewing it writes nothing: the note before and after, from the file as it is", async () => {
    const gh = github(BASE)
    const { d } = editor(gh.at.file, MINE)
    const r = await review(gh.backend, d)
    assert.deepEqual(r, { before: BASE, after: MINE, moved: false })
    assert.equal(gh.at.reads, 1)
    assert.deepEqual(gh.at.writes, [])
  })

  test("publish commits exactly what's written, over the version it's over, as the message given", async () => {
    const gh = github(BASE)
    const { s, d } = editor(gh.at.file, MINE)
    await review(gh.backend, d)
    const res = await publish(gh.backend, d, "Rosemary")
    assert.ok("sha" in res)
    assert.deepEqual(gh.at.writes, [{ text: MINE, base: "sha0", message: "Rosemary" }])
    assert.deepEqual(s.published, [{ text: MINE, sha: res.sha }])
    assert.equal(gh.at.file.text, MINE)
  })

  test("committed to since the draft began: theirs merged in around it and said so, before anything's written", async () => {
    const gh = github(BASE)
    const { s, d } = editor(gh.at.file, MINE)
    gh.commit(BASE.replace("- tomatoes", "- cherry tomatoes"))
    const r = await review(gh.backend, d)
    const both = MINE.replace("- tomatoes", "- cherry tomatoes")
    assert.deepEqual(r, { before: gh.at.file.text, after: both, moved: true })
    assert.equal(s.text, both, "the note has their change too")
    assert.deepEqual(gh.at.writes, [])
    const res = await publish(gh.backend, d, "Edit notes/plants.md")
    assert.ok("sha" in res)
    assert.equal(gh.at.file.text, both)
  })

  test("committed to after it was shown: a conflict, merged and shown again, not committed till published again", async () => {
    const gh = github(BASE)
    const { d } = editor(gh.at.file, MINE)
    await review(gh.backend, d)
    gh.commit(BASE + "\nA line of theirs.\n")
    const first = await publish(gh.backend, d, "m")
    assert.ok("review" in first)
    assert.equal(first.review.moved, true)
    assert.equal(first.review.after, MINE + "\nA line of theirs.\n")
    assert.deepEqual(gh.at.writes, [], "nothing written over theirs")
    const second = await publish(gh.backend, d, "m")
    assert.ok("sha" in second)
    assert.equal(gh.at.file.text, MINE + "\nA line of theirs.\n")
    assert.equal(gh.at.writes.length, 1)
  })
})

/** the explorer's ops kept for a branch: its head moves with each commit (ours, or one made elsewhere), the note's blob with it */
function filing(note: { text: string; sha: string }) {
  let n = 0
  const at = { head: { commit: "c0", tree: "t0", files: [{ path: "notes/plants.md", mode: "100644", sha: note.sha }] } as Head, texts: new Map([[note.sha, note.text]]), commits: [] as string[], dropped: 0, planned: [] as (string | null)[] }
  const f: Filing = {
    ops: [{ op: "move", from: "plants.md", to: "herbs.md" }],
    note: "plants.md",
    sha: async (text) => `blob:${text.length}`,
    head: async () => structuredClone(at.head),
    noteOn: (head) => {
      const file = head.files.find((f) => f.path === "notes/plants.md")!
      return { sha: file.sha, read: async () => at.texts.get(file.sha)! }
    },
    plan: async (_head, text) => (at.planned.push(text), { ops: f.ops.map((op) => ({ op })), links: [], changes: [], placed: new Map() }) as Planned,
    async commit(head, _p, message) {
      if (head.commit !== at.head.commit) return { conflict: true }
      at.commits.push(message)
      at.head = { ...at.head, commit: `c${++n}` }
      return { sha: at.head.commit }
    },
    published: () => (at.dropped++, "herbs.md"),
    discard() {},
  }
  return {
    at,
    f,
    /** a commit made elsewhere, to the note */
    elsewhere(text: string) {
      const sha = `theirs${++n}`
      at.texts.set(sha, text)
      at.head = { ...at.head, commit: `c${n}`, files: [{ path: "notes/plants.md", mode: "100644", sha }] }
    },
  }
}

describe("publishing the explorer's ops with the note", () => {
  test("reviewing reads the branch, writes nothing, and merges theirs into the note when it's moved", async () => {
    const { s, d } = editor({ text: BASE, sha: "sha0" }, MINE)
    const fl = filing({ text: BASE, sha: "sha0" })
    fl.elsewhere(BASE.replace("- tomatoes", "- cherry tomatoes"))
    const r = await reviewFiles(fl.f, d)
    const both = MINE.replace("- tomatoes", "- cherry tomatoes")
    assert.equal(s.text, both)
    assert.deepEqual(r.note, { before: BASE.replace("- tomatoes", "- cherry tomatoes"), after: both, moved: true })
    assert.deepEqual(fl.at.planned, [both], "the note goes in the plan as it is now")
    assert.deepEqual(fl.at.commits, [])
  })

  test("a note with no changes isn't in the plan, nor the dialog", async () => {
    const { d } = editor({ text: BASE, sha: "sha0" }, BASE)
    const fl = filing({ text: BASE, sha: "sha0" })
    const r = await reviewFiles(fl.f, d)
    assert.equal(r.note, null)
    assert.deepEqual(fl.at.planned, [null])
  })

  test("the branch moved after it was shown: read again and shown again, not committed; then one commit", async () => {
    const { s, d } = editor({ text: BASE, sha: "sha0" }, MINE)
    const fl = filing({ text: BASE, sha: "sha0" })
    const r = await reviewFiles(fl.f, d)
    fl.elsewhere(BASE + "\nA line of theirs.\n")
    const first = await publishFiles(fl.f, d, r, "Files")
    assert.ok("review" in first)
    assert.deepEqual(fl.at.commits, [], "nothing committed over theirs")
    assert.equal(first.review.note?.after, MINE + "\nA line of theirs.\n")
    const second = await publishFiles(fl.f, d, first.review, "Files")
    assert.deepEqual(second, { at: "herbs.md" })
    assert.deepEqual(fl.at.commits, ["Files"])
    assert.equal(fl.at.dropped, 1)
    assert.deepEqual(s.published, [{ text: MINE + "\nA line of theirs.\n", sha: `blob:${(MINE + "\nA line of theirs.\n").length}` }])
  })
})
