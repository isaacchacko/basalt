import "./test-hooks.ts"
import test, { describe } from "node:test"
import assert from "node:assert"
import { unified } from "unified"
import remarkParse from "remark-parse"
import type { Root } from "mdast"
const { graphFigure, remarkDiagrams, renderGraphviz, themeSvg } = await import("./diagrams.ts")

async function run(markdown: string): Promise<Root> {
  const processor = unified()
    .use(remarkParse)
    .use(() => remarkDiagrams({ graph: true, graphviz: true, svg: true, math: true }))
  return (await processor.run(processor.parse(markdown))) as Root
}

describe("diagrams", () => {
  test("graphviz draws at build time, in currentColor", async () => {
    const svg = await renderGraphviz("digraph { a -> b }")
    assert.match(svg, /^<svg/)
    assert.match(svg, /currentColor/)
    assert.doesNotMatch(svg, /fill="white"/)
  })

  test("a dot block becomes a figure, titled by its meta", async () => {
    const tree = await run('```dot title="two nodes"\ndigraph { a -> b }\n```')
    const node = tree.children[0]
    assert.strictEqual(node.type, "html")
    assert.match(
      node.type === "html" ? node.value : "",
      /^<figure class="diagram diagram-graphviz"><svg[\s\S]*<figcaption>two nodes<\/figcaption><\/figure>$/,
    )
  })

  test("a dot block that doesn't parse fails the figure, not the build", async () => {
    const tree = await run("```dot\ndigraph { a -> }\n```")
    const node = tree.children[0]
    assert.ok(node.type === "html" && node.value.startsWith('<div class="diagram-error">'))
  })

  test("a graph block is laid out at build time, svg and all", async () => {
    const tree = await run("```graph\na -> b, c\n```")
    const node = tree.children[0]
    const html = node.type === "html" ? node.value : ""
    assert.match(
      html,
      /^<figure class="diagram diagram-graph"><div class="graph-embed" data-graph="/,
    )
    assert.match(html, /data-arrows="true"/)
    assert.strictEqual(html.match(/<circle /g)?.length, 3)
    const data = JSON.parse(
      /data-graph="([^"]*)"/
        .exec(html)![1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&"),
    )
    assert.strictEqual(data.nodes.length, 3)
    assert.ok(
      data.nodes.every((n: { x: number }) => Number.isFinite(n.x)),
      "every node has its settled place",
    )
  })

  test("a graph block that doesn't parse says where", async () => {
    const tree = await run('```graph\n"unterminated -> b\n```')
    const node = tree.children[0]
    assert.ok(
      node.type === "html" && node.value.startsWith('<div class="diagram-error">'),
      node.type === "html" ? node.value : "",
    )
  })

  test("a math block is display math, like GitHub's", async () => {
    const tree = await run("```math\nx^2\n```")
    assert.strictEqual(tree.children[0].type, "math")
  })

  test("other code is left alone", async () => {
    const tree = await run("```js\n1\n```")
    assert.strictEqual(tree.children[0].type, "code")
  })

  test("themeSvg drops the prolog and paper", () => {
    assert.strictEqual(
      themeSvg('<?xml version="1.0"?><!-- x --><svg><polygon fill="white" stroke="black"/></svg>'),
      '<svg><polygon fill="none" stroke="currentColor"/></svg>',
    )
  })
})

describe("a graph's zoom", () => {
  const block = (meta: string | null) =>
    graphFigure({ type: "code", lang: "graph", meta, value: "a -> b" } as never)
  test("off unless it asks", () => {
    assert.match(block(null), /data-zoom="false"/)
    assert.match(block('title="zoom out"'), /data-zoom="false"/)
    assert.match(block("zoom=false"), /data-zoom="false"/)
  })
  test("zoom, canZoom or zoom=true turns it on", () => {
    for (const meta of ["zoom", "canZoom", "zoom=true", 'title="x" zoom height=300'])
      assert.match(block(meta), /data-zoom="true"/, meta)
  })
})
