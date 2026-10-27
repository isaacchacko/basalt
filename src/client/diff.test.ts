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

  describe("theirs over mine, both from one version (a save from elsewhere while I type, editor.ts)", () => {
    const base = "# Plants\n\nBasil.\n\n- tomatoes\n- peppers\n\nFerns."
    const over = (mine: string, theirs: string) => {
      const ours = diff(base, mine)
      return diff(base, theirs).map(ours).apply(Text.of(mine.split("\n"))).toString()
    }
    test("edits to different lines are both kept", () => {
      assert.strictEqual(over(base.replace("Basil.", "Basil, lots."), base.replace("Ferns.", "Ferns, shaded.")), "# Plants\n\nBasil, lots.\n\n- tomatoes\n- peppers\n\nFerns, shaded.")
    })
    test("they add lines above the one I edit", () => {
      const theirs = base.replace("# Plants\n", "# Plants\n\nIntro.\n")
      assert.strictEqual(over(base.replace("Ferns.", "Moss."), theirs), theirs.replace("Ferns.", "Moss."))
    })
    test("I add a block at the end, they edit the top", () => {
      assert.strictEqual(over(base + "\n\nNew.", base.replace("# Plants", "# Garden")), base.replace("# Plants", "# Garden") + "\n\nNew.")
    })
    test("they delete a block I didn't touch, I edit another", () => {
      const theirs = base.replace("- tomatoes\n- peppers\n\n", "")
      assert.strictEqual(over(base.replace("Basil.", "Thyme."), theirs), theirs.replace("Basil.", "Thyme."))
    })
    test("the same line changed by both: both kept, nothing lost", () => {
      const both = over(base.replace("Basil.", "Mint."), base.replace("Basil.", "Sage."))
      assert.ok(both.includes("Mint.") && both.includes("Sage.") && !both.includes("Basil."), both)
    })
    test("only they changed it: theirs; only I did: mine", () => {
      const theirs = base.replace("peppers", "chillies")
      assert.strictEqual(over(base, theirs), theirs)
      assert.strictEqual(over(theirs, base), theirs)
    })
  })
})
