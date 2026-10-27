import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { commonLines, lineMap } from "./linemap.ts"

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
