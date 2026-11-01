// What `basalt example` prints (bin/examples.mjs) is markdown that works: every
// component, in every place, rendered as a note of the test site.
import "./test-hooks.ts"
import test, { after, describe } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const site = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-examples-"))
fs.cpSync(path.resolve("test/fixtures/site"), site, { recursive: true })
const { components, places, example } = await import("../../bin/examples.mjs")
const note = (c: string, p: string) => path.join(site, "notes", `example-${c}-${p}.md`)
for (const [c, { markdown }] of Object.entries(components))
  for (const [p, { place }] of Object.entries(places))
    fs.writeFileSync(note(c, p), `---\ntitle: ${c}, ${p}\n---\n\nThe paragraph it's about.\n\n${place(markdown)}\n`)

process.env.BASALT_SITE = site
const { renderFile } = await import("./render.ts")
const { refreshRegistry } = await import("../lib/registry.ts")
refreshRegistry()
after(() => fs.rmSync(site, { recursive: true, force: true }))

describe("every component, in every place", () => {
  for (const c of Object.keys(components)) {
    test(c, async () => {
      const main = (await renderFile(note(c, "main"))).code
      const margin = (await renderFile(note(c, "margin"))).code
      assert.doesNotMatch(main, /class="marginnote/, "the main content's is in the text")
      // the whole of it in one aside, its own callouts (a tab, a tip) read as callouts
      const aside = /<aside class="marginnote[^"]*"[\s\S]*<\/aside>/.exec(margin)?.[0]
      assert.ok(aside, "the margin's is an aside")
      assert.doesNotMatch(margin, /\[!\w+\]/)
      assert.ok(aside.replace(/^<aside[^>]*>|<\/aside>$/g, "").trim(), "with the component in it")
    })
  }
})

describe("basalt example", () => {
  test("a component, in either order with its place", () => {
    assert.strictEqual(example(["graph", "margin"]).text, example(["margin", "graph"]).text)
    assert.match(example(["graph", "margin"]).text!, /^> \[!aside\]\n> ```graph/m)
    assert.match(example(["graph"]).text!, /^```graph/m)
  })

  test("a place alone says how it works; nothing lists what there is", () => {
    assert.match(example(["margin"]).text!, /footnote is a numbered sidenote/)
    assert.match(example([]).text!, /note-list/)
  })

  test("a word it doesn't know says what there is", () => {
    assert.match(example(["grph"]).error!, /no example "grph": components are graph, /)
  })
})
