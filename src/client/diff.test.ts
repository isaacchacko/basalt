import test, { describe } from "node:test"
import assert from "node:assert"
import { ChangeSet, Text } from "@codemirror/state"
const { diff } = await import("./diff.ts")

const apply = (a: string, c: ChangeSet) => c.apply(Text.of(a.split("\n"))).toString()

describe("diff", () => {
  const cases: [string, string][] = [
    ["a\nb\nc", "a\nB\nc"],
    ["a\nb\nc", "a\nc"],
    ["a\nb", "a\nb\nc"],
    ["a\nb\n", "a\nb\nc\n"],
    ["a\nb", "x\na\nb"],
    ["", "a\nb"],
    ["a\nb", ""],
    ["a\nb\nc\nd", "a\nB\nc\nD\ne"],
    ["a", "a\n"],
  ]
  for (const [a, b] of cases) test(`${JSON.stringify(a)} → ${JSON.stringify(b)}`, () => assert.strictEqual(apply(a, diff(a, b)), b))

  test("theirs, over mine: both kept, my cursor's text where it was", () => {
    const base = "one\ntwo\nthree\nfour"
    // mine: typed at the end of "two"; theirs: changed "four" and added a line at the top
    const mine = ChangeSet.of([{ from: 7, insert: " and more" }], base.length)
    const them = diff(base, "zero\none\ntwo\nthree\nFOUR")
    const now = mine.apply(Text.of(base.split("\n")))
    assert.strictEqual(them.map(mine).apply(now).toString(), "zero\none\ntwo and more\nthree\nFOUR")
  })
})
