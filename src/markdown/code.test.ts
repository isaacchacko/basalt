import test, { describe } from "node:test"
import assert from "node:assert"
import "./test-hooks.ts"
const { outsideCode } = await import("./code.ts")

const mark = (t: string) => t.replace(/\[\[(.*?)\]\]/g, "<$1>")

describe("outsideCode", () => {
  test("rewrites prose, and leaves inline code and fenced blocks as written", () => {
    const src = "a [[x]] `[[y#L4-L5]]` b\n```py\n[[z]]\n```\n[[w]] ``[[v]]``"
    assert.strictEqual(
      outsideCode(src, mark),
      "a <x> `[[y#L4-L5]]` b\n```py\n[[z]]\n```\n<w> ``[[v]]``",
    )
  })

  test("a fence closes only on its own kind", () => {
    const src = "~~~\n```\n[[a]]\n~~~\n[[b]]"
    assert.strictEqual(outsideCode(src, mark), "~~~\n```\n[[a]]\n~~~\n<b>")
  })
})
