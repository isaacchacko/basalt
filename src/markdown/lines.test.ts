// Where each block of a page is in its note's file (lines.ts), on whole notes
// rendered the way Astro renders them: the test site, and test/fixtures/edit,
// a block of every kind Basalt draws. Each note lists the lines of its
// top-level blocks in order ("7" for one line, "18-20" for several), as
// they're written in the file, frontmatter and comments and all.
import "./test-hooks.ts"
import test, { describe } from "node:test"
import assert from "node:assert"
import path from "node:path"
import type { Element, Root } from "hast"

const { renderFile } = await import("./render.ts")
const { refreshRegistry } = await import("../lib/registry.ts")
const { fromHtml } = await import("hast-util-from-html")
const { visit } = await import("unist-util-visit")
const { tagLines } = await import("./lines.ts")

const serving = process.env.BASALT_COMMAND
const sites = { site: path.resolve("test/fixtures/site"), edit: path.resolve("test/fixtures/edit") }

async function page(site: string, rel: string, command = "dev"): Promise<Root> {
  process.env.BASALT_SITE = site
  process.env.BASALT_COMMAND = command
  try {
    refreshRegistry()
    return fromHtml((await renderFile(path.join(site, "notes", rel))).code, { fragment: true })
  } finally {
    if (serving === undefined) delete process.env.BASALT_COMMAND
    else process.env.BASALT_COMMAND = serving
  }
}

/** a paragraph a plugin emptied (an embed lifted out of it) shows nothing, so there's nothing to click */
const empty = (el: Element) => el.tagName === "p" && el.children.every((c) => c.type === "text" && !c.value.trim())
const blocks = (tree: Root) => tree.children.filter((c): c is Element => c.type === "element" && !empty(c))
const short = (src: unknown) => (typeof src === "string" ? src.replace(/^(\d+)-\1$/, "$1") : `no data-src`)
const spans = (tree: Root) => blocks(tree).map((b) => short(b.properties.dataSrc))

// Wrong today, sent to dev; a todo runs, and says when it starts passing.
const known: Record<string, string> = {
  "site/diagrams.md": "figures drawn from a code block take the lines from the paragraph before to the end; two $$ blocks share one span",
  "site/files.md": "a code file's figure takes the lines of the embedded file; a csv table has no data-src; a missing embed takes the heading's line",
  "site/index.md": "an aside starts a line late and runs into the next block",
  "site/islands.md": "a ```html live frame starts at the paragraph before it",
  "site/margin.md": "asides start a line late and run into the next block",
  "site/tabs.md": "tabs start on the blank line before the first tab",
  "edit/index.md": "a paragraph before a multi-line comment takes the comment's lines; tables, note-lists have no data-src; diff and tree take a stray line; the aside",
  "edit/blog/index.md": "the first transclusion is a line late",
}

const expected: Record<string, string[]> = {
  "site/diagrams.md": "5 7 9 11-18 20 22 24-33 35 37 39-44 46 48 50-52 54-56 58 60-65 67 69 71-73".split(" "),
  "site/files.md": "5 7 9 11 13 15 17 19 21 23 25 27".split(" "),
  "site/index.md": "6 8 10 12 14-15 17 19 21 23 25 27-34 36 38 40-48 50 52 54".split(" "),
  "site/islands.md": "5 7 9 11 13 15 17 19 21 23 25 27-35".split(" "),
  "site/margin.md": "5 7 9 11 13 15-17 19 21-22 24 26-28 30 32 34-46".split(" "),
  "site/media.md": "5 7 9 11 13 15 17 19 21 23 25 27 29 31 33 35 37".split(" "),
  "site/secondary.md": "5 7 9 11 13 15 17".split(" "),
  "site/sources/garden-ideas.md": "6 8 10 12 14 16-18 20 22 24 26".split(" "),
  "site/tabs.md": "5-18 20 22-23".split(" "),
  "site/transclusion.md": "5 7 9 11 13 15 17 19 21 23 25 27 29 31 33 35 37 39 41".split(" "),
  "site/web.md": "5 7 9 11 13 15 17 19 21 23 25 27 29 31 33 35 37 39 41 43".split(" "),
  "edit/index.md": "7 14 16 18-20 22-23 25-26 28-29 31-32 34-35 37 39 41-43 45-47 49-52 54-58 60 62-64 66 68 70-72 74 76 78-79 81 83-86".split(" "),
  "edit/blog/first.md": ["6"],
  "edit/blog/second.md": ["1", "3"],
  "edit/blog/index.md": ["5", "7"],
  "edit/blog/crlf.md": ["5", "9-10", "12"],
}

describe("every top-level block has the lines it's written on", () => {
  for (const [key, want] of Object.entries(expected)) {
    const [site, ...rest] = key.split("/")
    test(key, { todo: known[key] }, async () => {
      assert.deepStrictEqual(spans(await page(sites[site as keyof typeof sites], rest.join("/"))), want)
    })
  }
})

describe("footnotes", () => {
  const notes = (tree: Root) => {
    const lis: Record<string, string> = {}
    const sides: Record<string, string> = {}
    visit(tree, "element", (el: Element) => {
      const id = el.properties.id
      if (el.tagName === "li" && typeof id === "string" && id.includes("fn-")) lis[id.replace(/.*fn-/, "")] = short(el.properties.dataSrc)
      const side = el.properties.dataSidenote
      if (typeof side === "string" && [el.properties.className ?? []].flat().includes("sidenote")) sides[side.replace(/.*fn-/, "")] = short(el.properties.dataSrc)
    })
    return { lis, sides }
  }

  test("each footnote, and its sidenote, is the lines of its definition", async () => {
    const want = { how: "34", "why-plus-one": "36", factor: "38", primorial: "40", one: "42", two: "44", three: "46" }
    const { lis, sides } = notes(await page(sites.site, "margin.md"))
    assert.deepStrictEqual(lis, want)
    assert.deepStrictEqual(sides, want)
  })

  test("a footnote over two lines", async () => {
    const { lis, sides } = notes(await page(sites.edit, "index.md"))
    assert.deepStrictEqual(lis, { one: "83", two: "85-86" })
    assert.deepStrictEqual(sides, { one: "83", two: "85-86" })
  })
})

test("a built site without \"edit\" has no data-src", async () => {
  let tagged = 0
  visit(await page(sites.edit, "index.md", "build"), "element", (el: Element) => {
    if (el.properties.dataSrc !== undefined) tagged++
  })
  assert.strictEqual(tagged, 0)
})

describe("tagLines", () => {
  const el = (line: number, end = line): Element => ({
    type: "element",
    tagName: "p",
    properties: {},
    children: [],
    position: { start: { line, column: 1 }, end: { line: end, column: 4 } },
  })
  const tag = (children: Element[], parsed: string, raw: string) => {
    const tree: Root = { type: "root", children }
    tagLines(tree, parsed, raw)
    return children.map((c) => short(c.properties.dataSrc))
  }

  test("lines the text pass added or took away map back to the file's", { todo: "a line whose comment went maps to the blank line after it" }, () => {
    // parsed: the comment went, the callout's title got a line after it
    const raw = "---\nt: 1\n---\n\na %% x %% b\n\n> [!note] T\n> body\n\nend"
    const parsed = "\n\n\n\na  b\n\n> [!note] T\n> \n> body\n\nend"
    assert.deepStrictEqual(tag([el(5), el(7, 9), el(11)], parsed, raw), ["5", "7-8", "10"])
  })

  test("a node that ends at the start of a line ends on the line before", () => {
    const p: Element = { ...el(1), position: { start: { line: 1, column: 1 }, end: { line: 3, column: 1 } } }
    assert.deepStrictEqual(tag([p], "a\nb\n", "a\nb\n"), ["1-2"])
  })

  test("a block that lost its place takes the lines between its neighbours, past blank ones", () => {
    const made: Element = { type: "element", tagName: "div", properties: {}, children: [] }
    assert.deepStrictEqual(tag([el(1), made, el(7)], "a\n\n\nmade\nhere\n\nz", "a\n\n\nmade\nhere\n\nz"), ["1", "4-5", "7"])
  })

  test("a block that lost its place at the top starts after the frontmatter", () => {
    const made: Element = { type: "element", tagName: "div", properties: {}, children: [] }
    const raw = "---\nt: 1\n---\n\nmade\n\nz"
    assert.deepStrictEqual(tag([made, el(7)], raw, raw), ["5", "7"])
  })
})
