// A built site's draft store (draft.ts), against a stand-in for local storage:
// kept per repo, branch and note, read back as it was put, and what's broken
// or blocked read as no draft at all.
import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { draftKey, draftStore, draftsOf, draftsUnder, type Draft } from "./draft.ts"

/** local storage's interface, over a map; `blocked`: every call throws, as a browser with storage off does */
function storage(blocked = false) {
  const m = new Map<string, string>()
  const no = () => {
    if (blocked) throw new DOMException("blocked", "SecurityError")
  }
  return {
    m,
    getItem: (k: string) => (no(), m.get(k) ?? null),
    setItem: (k: string, v: string) => (no(), void m.set(k, v)),
    removeItem: (k: string) => (no(), void m.delete(k)),
    key: (i: number) => (no(), [...m.keys()][i] ?? null),
    get length() {
      no()
      return m.size
    },
    clear: () => m.clear(),
  }
}

const draft = (over: Partial<Draft> = {}): Draft => ({
  text: "# Plants\n\nBasil wants sun. Rosemary too.\n",
  base: { text: "# Plants\n\nBasil wants sun.\n", sha: "a".repeat(40) },
  began: "a".repeat(40),
  url: "/plants/",
  title: "Plants",
  at: 1000,
  ...over,
})

describe("draftStore", () => {
  test("a draft is read back as it was kept, and gone once dropped", () => {
    const s = storage()
    const store = draftStore(draftKey("me/garden", "main", "notes/plants.md"), s)
    assert.equal(store.get(), null)
    assert.equal(store.put(draft()), true)
    assert.deepEqual(store.get(), draft())
    store.drop()
    assert.equal(store.get(), null)
    assert.equal(s.m.size, 0)
  })

  test("each repo, branch and note has its own", () => {
    const s = storage()
    const keys = [draftKey("me/garden", "main", "a.md"), draftKey("me/garden", "main", "b.md"), draftKey("me/garden", "next", "a.md"), draftKey("you/garden", "main", "a.md")]
    assert.equal(new Set(keys).size, 4)
    keys.forEach((k, i) => draftStore(k, s).put(draft({ text: `note ${i}` })))
    keys.forEach((k, i) => assert.equal(draftStore(k, s).get()?.text, `note ${i}`))
    draftStore(keys[0], s).drop()
    assert.equal(draftStore(keys[1], s).get()?.text, "note 1")
  })

  test("what isn't a draft (broken, or of another shape) is none", () => {
    const s = storage()
    const key = draftKey("me/garden", "main", "a.md")
    for (const bad of ["{", "null", "42", JSON.stringify({ text: "x" }), JSON.stringify({ ...draft(), base: { text: "x" } })]) {
      s.m.set(key, bad)
      assert.equal(draftStore(key, s).get(), null, bad)
    }
  })

  test("a browser that won't keep anything: no draft, and no throw", () => {
    const store = draftStore("k", storage(true))
    assert.equal(store.get(), null)
    assert.equal(store.put(draft()), false)
    assert.doesNotThrow(() => store.drop())
    assert.equal(draftStore("k", undefined).put(draft()), false)
  })
})

describe("draftsUnder", () => {
  test("a branch's other notes' drafts, newest first; not this note's, nor another branch's", () => {
    const s = storage()
    const here = draftKey("me/garden", "main", "a.md")
    draftStore(here, s).put(draft({ at: 5 }))
    draftStore(draftKey("me/garden", "main", "b.md"), s).put(draft({ title: "B", at: 1 }))
    draftStore(draftKey("me/garden", "main", "c.md"), s).put(draft({ title: "C", at: 3 }))
    draftStore(draftKey("me/garden", "next", "d.md"), s).put(draft({ title: "D", at: 9 }))
    s.m.set(draftKey("me/garden", "main", "e.md"), "{broken")
    assert.deepEqual(draftsUnder(draftsOf("me/garden", "main"), here, s).map((d) => d.title), ["C", "B"])
    assert.deepEqual(draftsUnder(draftsOf("me/garden", "main"), here, storage(true)), [])
  })
})
