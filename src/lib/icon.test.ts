import test, { describe } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { iconData, iconHref, MARK } from "./icon.ts"
import type { SiteFile } from "./site.ts"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-icon-"))
const svg = `<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>`
fs.writeFileSync(path.join(dir, "icon.svg"), svg)
fs.writeFileSync(path.join(dir, "notes.txt"), "not an image")
const files = [
  { abs: path.join(dir, "icon.svg"), rel: "assets/icon.svg", slug: "assets/icon.svg", isNote: false },
  { abs: path.join(dir, "notes.txt"), rel: "assets/notes.txt", slug: "assets/notes.txt", isNote: false },
] as SiteFile[]

describe("the tab's icon", () => {
  test("a page links to the site's own, where it's served, or carries Basalt's mark", () => {
    assert.strictEqual(iconHref("assets/icon.svg"), "/assets/icon.svg")
    assert.strictEqual(iconHref("/assets/My Icon.svg"), "/assets/My-Icon.svg")
    assert.strictEqual(iconHref(undefined), MARK)
    assert.match(MARK, /^data:image\/svg\+xml,/)
  })

  test("inline, it's the file itself as a data url", () => {
    assert.strictEqual(iconData("assets/icon.svg", files), `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)
    assert.strictEqual(iconData("/assets/icon.svg", files), iconData("assets/icon.svg", files))
  })

  test("inline, nothing without one, without its file, or for a file that isn't an image", () => {
    assert.strictEqual(iconData(undefined, files), undefined)
    assert.strictEqual(iconData("assets/gone.svg", files), undefined)
    assert.strictEqual(iconData("assets/notes.txt", files), undefined)
  })
})
