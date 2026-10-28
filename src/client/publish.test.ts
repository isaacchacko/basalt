// Publishing a built site's draft (publish.ts), against a stand-in for
// GitHub's file and an editor's note: nothing's written till publish(), a
// commit made since the draft began is merged in and shown before anything's
// written, and one made after it was shown is too, not committed over.
import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { Text } from "@codemirror/state"
import { diff } from "./diff.ts"
import { publish, review, type Drafting } from "./publish.ts"
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
