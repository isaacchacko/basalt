import test from "node:test"
import assert from "node:assert"
import { darkVersion } from "./themed.ts"

const files = new Set(["assets/phone.png", "assets/phone.dark.png", "assets/a b.png", "assets/a b.dark.png", "assets/solo.png"])
const has = (s: string) => files.has(s)

test("a picture's dark version is found beside it", () => {
  assert.equal(darkVersion("/assets/phone.png", has), "/assets/phone.dark.png")
  assert.equal(darkVersion("/assets/a%20b.png", has), "/assets/a%20b.dark.png")
  assert.equal(darkVersion("/assets/phone.png#t=2", has), "/assets/phone.dark.png#t=2")
})

test("no dark version, or not a local picture: nothing", () => {
  assert.equal(darkVersion("/assets/solo.png", has), undefined)
  assert.equal(darkVersion("/assets/phone.dark.png", has), undefined)
  assert.equal(darkVersion("https://example.com/phone.png", has), undefined)
  assert.equal(darkVersion("/notes/page", has), undefined)
})
