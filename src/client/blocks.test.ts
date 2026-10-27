import test, { describe } from "node:test"
import assert from "node:assert"
const { keysOf, textOf } = await import("./blocks.ts")

describe("a drawn block's key", () => {
  test("a text that comes once is its own key", () => {
    assert.deepStrictEqual(keysOf(["a", "b"]), ["a", "b"])
  })
  test("two blocks with the same text are two keys, in the note's order", () => {
    const keys = keysOf(["![[x#^y]]", "between", "![[x#^y]]", "![[x#^y]]"])
    assert.strictEqual(new Set(keys).size, 4)
    assert.deepStrictEqual(keys.map(textOf), ["![[x#^y]]", "between", "![[x#^y]]", "![[x#^y]]"])
  })
  test("the first keeps its key when another with its text comes after it (an edit doesn't move what's drawn above)", () => {
    const before = keysOf(["p", "q"])
    const after = keysOf(["p", "q", "p"])
    assert.strictEqual(after[0], before[0])
    assert.strictEqual(after[1], before[1])
  })
})
