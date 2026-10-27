// A site's config and the modules of its own it imports, loaded afresh once saved.
import "./test-hooks.ts"
import test, { describe } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const site = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-siteconfig-"))
fs.mkdirSync(path.join(site, "plugins"))
fs.writeFileSync(
  path.join(site, "basalt.config.ts"),
  `import { wave } from "./plugins/wave"
export default { markdown: { textTransforms: [wave] } }`,
)
const plugin = path.join(site, "plugins/wave.ts")
fs.writeFileSync(plugin, `export const wave = (text: string) => text.replaceAll(":wave:", "👋")`)

const { loadSiteMarkdown, siteModules } = await import("./siteconfig.ts")

describe("a site's own modules", () => {
  test("are tracked, and kept while unchanged", async () => {
    const first = await loadSiteMarkdown(site)
    assert.strictEqual(first.textTransforms[0](":wave:", undefined as never), "👋")
    assert.ok(siteModules().includes(fs.realpathSync(plugin)))
    const again = await loadSiteMarkdown(site)
    assert.strictEqual(again.textTransforms[0], first.textTransforms[0])
  })

  test("a save to one is picked up, though the config is unchanged", async () => {
    fs.writeFileSync(plugin, `export const wave = (text: string) => text.replaceAll(":wave:", "🌊")`)
    const later = new Date(Date.now() + 5000)
    fs.utimesSync(plugin, later, later)
    const next = await loadSiteMarkdown(site)
    assert.strictEqual(next.textTransforms[0](":wave:", undefined as never), "🌊")
  })
})
