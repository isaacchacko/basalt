import "./test-hooks.ts"
import test, { describe } from "node:test"
import assert from "node:assert"
import { unified } from "unified"
import remarkParse from "remark-parse"
import type { Root } from "mdast"
const { entry, kindOf, parseTree, remarkTree, treeHtml } = await import("./tree.ts")

const names = (source: string) => {
  const walk = (es: ReturnType<typeof parseTree>, d: number): string[] =>
    es.flatMap((e) => [`${"  ".repeat(d)}${e.name}${e.dir ? "/" : ""}`, ...walk(e.children, d + 1)])
  return walk(parseTree(source), 0).join("\n")
}

const paths = (html: string) => [...html.matchAll(/data-path="([^"]*)"/g)].map((m) => m[1])

describe("trees", () => {
  test("indentation, in any step, makes the shape", () => {
    assert.strictEqual(names("a/\n   b.md\n   c/\n      d.ts\ne"), "a/\n  b.md\n  c/\n    d.ts\ne")
    assert.strictEqual(names("a\n\tb\n\t\tc"), "a/\n  b/\n    c")
  })

  test("a markdown list's bullets go", () => {
    assert.strictEqual(names("- a/\n  - b.md\n  - + c.md"), "a/\n  b.md\n  c.md")
    assert.strictEqual(parseTree("- a/\n  - + c.md")[0].children[0].mark, "added")
  })

  test("tree's output is read as it is, its count and its . dropped", () => {
    const out = [".", "├── a.md", "├── src", "│   ├── b.ts", "│   └── c", "│       └── d.ts", "└── e", "", "3 directories, 3 files"].join("\n")
    assert.strictEqual(names(out), "a.md\nsrc/\n  b.ts\n  c/\n    d.ts\ne")
    assert.strictEqual(names("site\n|-- a\n`-- b\n    `-- c"), "site/\n  a\n  b/\n    c")
  })

  test("an entry's mark, note, fold and link", () => {
    assert.deepStrictEqual(entry("+ new.md   # the new one"), {
      name: "new.md",
      dir: false,
      folded: false,
      more: false,
      mark: "added",
      note: "the new one",
      children: [],
    })
    assert.strictEqual(entry("c#.md").name, "c#.md")
    assert.strictEqual(entry("[[a#b]]").href, "a#b")
    const fold = entry("node_modules/…  # 132 files")
    assert.ok(fold.dir && fold.folded)
    assert.strictEqual(fold.name, "node_modules")
    assert.strictEqual(fold.note, "132 files")
    assert.ok(entry("...").more)
    assert.deepStrictEqual([entry("[[start|start.md]]").href, entry("[[start|start.md]]").name], ["start", "start.md"])
    assert.deepStrictEqual([entry("[x](files/x.py)").href, entry("[[examples]]/").dir], ["files/x.py", true])
    assert.deepStrictEqual(
      ["-", "~", "!"].map((s) => entry(`${s} a`).mark),
      ["removed", "changed", "marked"],
    )
  })

  test("icons follow the file's kind", () => {
    const kinds = Object.fromEntries(
      [
        "Dockerfile",
        "LICENSE.txt",
        ".npmrc",
        ".prettierrc",
        ".node-version",
        ".gitattributes",
        "package-lock.json",
        "index.d.ts",
        "a.yaml",
        "a.tsx",
        "a.json",
        "a.scss",
        "a.md",
        "a.png",
        "weird",
      ].map((n) => [n, kindOf(n)]),
    )
    assert.deepStrictEqual(kinds, {
      Dockerfile: "config",
      "LICENSE.txt": "text",
      ".npmrc": "key",
      ".prettierrc": "config",
      ".node-version": "config",
      ".gitattributes": "config",
      "package-lock.json": "key",
      "index.d.ts": "code",
      "a.yaml": "config",
      "a.tsx": "code",
      "a.json": "config",
      "a.scss": "style",
      "a.md": "markdown",
      "a.png": "image",
      weird: "file",
    })
  })

  test("paths start inside a lone top folder, so two sites' trees line up", () => {
    const html = treeHtml("quartz/\n  content/\n    index.md\n  …")
    assert.deepStrictEqual(paths(html), ["", "content/", "content/index.md"])
    assert.deepStrictEqual(paths(treeHtml("a.md\nb/\n  c.md")), ["a.md", "b/", "b/c.md"])
  })

  test("folders are details, open unless folded", () => {
    const html = treeHtml("a/\n  b/\n    c\n  d/…\n    e", 'open=9 title="x"')
    assert.match(html, /^<figure class="tree"><figcaption class="tree-title">x<\/figcaption>/)
    assert.strictEqual(html.match(/<details open>/g)?.length, 2)
    assert.strictEqual(html.match(/<details>/g)?.length, 1)
    assert.strictEqual(treeHtml("a/\n  b/\n    c", "open=1").match(/<details open>/g)?.length, 1)
  })

  test("an empty tree draws nothing", () => {
    assert.strictEqual(treeHtml("\n  \n"), "")
  })

  test("a linked folder is a link", () => {
    assert.match(treeHtml("[[about]]/\n  a.md"), /<summary[^>]*>.*<a class="tree-name" href="about"/)
  })

  test("a mark is said as well as coloured, and only on its own entry", () => {
    const html = treeHtml("+ a/\n  + b.md\n  c.md")
    assert.strictEqual(html.match(/data-mark="added"/g)?.length, 2)
    assert.strictEqual(html.match(/tree-said">, added</g)?.length, 2)
  })

  test("a note's code is text, and its links are links", () => {
    const html = treeHtml('a.md  # `<island name="music" ssr>` and [[b|bee]]')
    assert.match(html, /<code>&lt;island name=&quot;music&quot; ssr&gt;<\/code>/)
    assert.match(html, /<a href="b">bee<\/a>/)
    assert.doesNotMatch(html, /<island/)
  })

  test("only the name is the line an anchor's /text/ matches", () => {
    const html = treeHtml("a.md  # notes")
    assert.match(html, /<span class="tree-name" data-line>a\.md<\/span>/)
    assert.strictEqual(html.match(/data-line/g)?.length, 1)
  })

  test("an elided folder says so", () => {
    assert.match(treeHtml("quartz/…  # Quartz itself"), /tree-elided">\/…</)
  })

  test("a ```tree block becomes the figure, inside a quote too", async () => {
    const processor = unified().use(remarkParse).use(remarkTree)
    const tree = (await processor.run(processor.parse("> ```tree\n> a/\n>   b\n> ```"))) as Root
    const quote = tree.children[0]
    assert.ok(quote.type === "blockquote" && quote.children[0].type === "html")
    assert.match(quote.children[0].value, /^<figure class="tree">/)
  })
})
