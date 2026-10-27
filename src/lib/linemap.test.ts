import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { commonLines, lineMap, merge } from "./linemap.ts"

const lines = (s: string) => s.split("\n")

test("the lines two texts share, in order", () => {
  assert.deepEqual(commonLines(lines("a\nb\nc\nd"), lines("a\nx\nc\nd\ne")), [
    [0, 0],
    [2, 2],
    [3, 3],
  ])
  assert.deepEqual(commonLines([], lines("a")), [])
  assert.deepEqual(commonLines(lines("a\nb"), lines("a\nb")), [
    [0, 0],
    [1, 1],
  ])
})

test("a line both have is itself; a changed one is what it changed into", () => {
  // a callout's title gets a line after it (ofmText); a comment goes away
  const written = lines("---\ntitle: x\n---\n\n> [!note] Hi\n> body\n\n%% gone %%\n\nend")
  const parsed = lines("\n> [!note] Hi\n> \n> body\n\n\n\nend")
  const map = lineMap(parsed, written)
  assert.equal(map.first(1), 4) // the callout's title line
  assert.equal(map.first(3), 5) // its body
  // the line ofmText added is in the stretch around the title
  assert.ok(map.first(2) >= 4 && map.last(2) <= 5)
  assert.equal(map.first(7), 9) // "end"
})

test("lines only the first text has map to the line before them", () => {
  const map = lineMap(lines("a\nb\nc"), lines("a\nc"))
  assert.equal(map.first(1), 0)
  assert.equal(map.first(2), 1)
})

test("every line maps somewhere in a text that's entirely different", () => {
  const map = lineMap(lines("a\nb\nc"), lines("x\ny"))
  for (let i = 0; i < 3; i++) {
    assert.equal(map.first(i), 0)
    assert.equal(map.last(i), 1)
  }
})

describe("merge: an edit made on one version, onto one committed meanwhile", () => {
  const base = "# Plants\n\nBasil.\n\n- tomatoes\n- peppers\n\nFerns."
  const m = (mine: string, theirs: string) => merge(lines(base), lines(mine), lines(theirs)).join("\n")

  test("edits to different lines are both kept", () => {
    assert.equal(m(base.replace("Basil.", "Basil, lots."), base.replace("Ferns.", "Ferns, shaded.")), "# Plants\n\nBasil, lots.\n\n- tomatoes\n- peppers\n\nFerns, shaded.")
  })

  test("the same line changed by both: mine", () => {
    assert.equal(m(base.replace("Basil.", "Mint."), base.replace("Basil.", "Sage.")), base.replace("Basil.", "Mint."))
  })

  test("they add lines above the one I edit", () => {
    const theirs = base.replace("# Plants\n", "# Plants\n\nIntro.\n")
    assert.equal(m(base.replace("Ferns.", "Moss."), theirs), theirs.replace("Ferns.", "Moss."))
  })

  test("I add a block at the end, they edit the top", () => {
    assert.equal(m(base + "\n\nNew.", base.replace("# Plants", "# Garden")), base.replace("# Plants", "# Garden") + "\n\nNew.")
  })

  test("they delete a block I didn't touch, I edit another", () => {
    const theirs = base.replace("- tomatoes\n- peppers\n\n", "")
    assert.equal(m(base.replace("Basil.", "Thyme."), theirs), theirs.replace("Basil.", "Thyme."))
  })

  test("nothing changed: the base; only they changed it: theirs; only I did: mine", () => {
    assert.equal(m(base, base), base)
    const theirs = base.replace("peppers", "chillies")
    assert.equal(m(base, theirs), theirs)
    assert.equal(m(theirs, base), theirs)
  })

  test("empty texts", () => {
    assert.deepEqual(merge([""], [""], [""]), [""])
    assert.equal(merge([""], ["a"], [""]).join("\n"), "a")
  })
})
