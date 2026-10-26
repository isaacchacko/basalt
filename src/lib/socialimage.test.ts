import test, { describe } from "node:test"
import assert from "node:assert"
import { cardSvg, wrap, cardPng, canDrawCards, WIDTH, HEIGHT } from "./socialimage.ts"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const card = { title: "CI cannot be that hard for monorepos", description: "All my homies hate GHA", site: "isaacchacko.com", where: "isaacchacko.com/blog/ci" }

describe("social images", () => {
  test("words are outlines in the site's colours, never NaN, never markup", () => {
    const svg = cardSvg({ ...card, title: '<script>"x" & y</script>', colors: { light: "#f5eedd", dark: "#16294e", secondary: "url(evil)" } })
    assert.match(svg, new RegExp(`^<svg[^>]*width="${WIDTH}" height="${HEIGHT}"`))
    assert.doesNotMatch(svg, /NaN|<script|<text/)
    assert.match(svg, /<rect width="100%" height="100%" fill="#f5eedd"\/>/)
    assert.match(svg, /fill="#16294e"/)
    // a colour that isn't one is Basalt's
    assert.match(svg, /fill="#1b3fd0"/)
  })

  test("a long title wraps to three lines at most, the last cut short", () => {
    const font = { getAdvanceWidth: (t: string, size: number) => t.length * size * 0.5 }
    const lines = wrap(font as never, "one two three four five six seven eight nine ten eleven twelve", 10, 60, 3)
    assert.strictEqual(lines.length, 3)
    assert.ok(lines[2].endsWith("…"))
    assert.deepStrictEqual(wrap(font as never, "short", 10, 60, 3), ["short"])
  })

  test("a card is a 1200×630 png, kept by what's on it", async (t) => {
    if (!canDrawCards()) return t.skip("no sharp here")
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-og-"))
    const png = await cardPng(card, dir)
    assert.ok(png)
    assert.strictEqual(png.readUInt32BE(16), 1200)
    assert.strictEqual(png.readUInt32BE(20), 630)
    assert.strictEqual(fs.readdirSync(dir).length, 1)
    await cardPng(card, dir)
    assert.strictEqual(fs.readdirSync(dir).length, 1)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
