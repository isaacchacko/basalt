// The whole pipeline, on a fixed site (test/fixtures/site: the showcase as it
// was when these were written, kept apart so the showcase can change), the
// way Astro runs it.
import "./test-hooks.ts"
import test, { describe } from "node:test"
import assert from "node:assert"
import path from "node:path"

process.env.BASALT_SITE = path.resolve("test/fixtures/site")
const { renderFile } = await import("./render.ts")
const { refreshRegistry } = await import("../lib/registry.ts")
const { ofmText } = await import("./ofm.ts")
const notes = path.resolve("test/fixtures/site/notes")
const render = (rel: string) => renderFile(path.join(notes, rel))

describe("the showcase, rendered", () => {
  test("every note renders", async () => {
    for (const f of refreshRegistry().files.filter((f) => f.isNote)) {
      const out = await renderFile(f.abs)
      assert.ok(out.code.length > 0, f.rel)
    }
  })

  test("the data each page can count on", async () => {
    const out = await render("transclusion.md")
    const fm = out.metadata.frontmatter as Record<string, unknown>
    assert.strictEqual(fm.title, "transclusion")
    assert.deepStrictEqual(fm.transcludes, ["sources/garden-ideas"])
    assert.ok((fm.links as string[]).includes("sources/garden-ideas"))
    assert.strictEqual(fm.draft, false)
    assert.strictEqual(fm.private, false)
    assert.strictEqual(typeof fm.readingTime, "number")
    assert.match(String(fm.date), /^\d{4}-\d\d-\d\dT/)
    assert.match(String(fm.description), /^!\[\[note\]\] puts one note inside another\./)
    const garden = (await render("sources/garden-ideas.md")).metadata.frontmatter as Record<string, unknown>
    assert.deepStrictEqual(garden.tags, ["example"])
  })

  test("links are internal with their slug, root-absolute, or external", async () => {
    const { code } = await render("secondary.md")
    assert.match(code, /<a href="\/transclusion" class="internal" data-slug="transclusion">transclusion<\/a>/)
    assert.match(code, /<a href="\/diagrams#graphviz" class="internal alias" data-slug="diagrams">graphviz<\/a>/)
    assert.match(code, /<a href="https:\/\/quartz.jzhao.xyz" class="external">Quartz<svg/)
    assert.match(code, /<img src="\/assets\/card.png" width="320" height="auto" alt="a test card" loading="lazy" decoding="async" class="zoomable">/)
  })

  test("footnotes are sidenotes, asides margin notes", async () => {
    const { code } = await render("margin.md")
    assert.match(code, /<sup><a href="#user-content-fn-how"[^>]*data-footnote-ref[^>]*data-sidenote="user-content-fn-how">1<\/a><\/sup><span class="sidenote" role="note"/)
    assert.match(code, /<aside class="marginnote( marginfigure)?" role="note">/)
  })

  test("a transcluded note's headings stay out of the page's", async () => {
    const out = await render("transclusion.md")
    assert.ok(!out.metadata.headings.some((h) => h.slug === "why-a-garden"))
    assert.match(out.code, /<h2 id="why-a-garden">/)
  })

  test("code files, diagrams, islands and embeds keep Quartz's markup", async () => {
    assert.match((await render("files.md")).code, /<figure data-rehype-pretty-code-figure="" class="code-file">/)
    const d = (await render("diagrams.md")).code
    assert.match(d, /<figure class="diagram diagram-graph"><div class="graph-embed" data-graph="/)
    assert.match(d, /<figure class="diagram diagram-graphviz"><svg/)
    assert.match(d, /<span class="katex-display">/)
    assert.match((await render("islands.md")).code, /data-island-ssr="true"><button type="button" class="counter">clicked 3 times<\/button>/)
    assert.match((await render("media.md")).code, /<div class="pdf-viewer" data-pdf="\/assets\/basalt.pdf"/)
    assert.match((await render("web.md")).code, /<figure class="embed embed-youtube"/)
  })
})

describe("ofm's text pass", () => {
  test("comments go, callout titles get a line, code keeps its wikilinks", () => {
    assert.strictEqual(ofmText("a %%hidden%% b"), "a  b")
    assert.strictEqual(ofmText("> [!note] Title\n> body"), "> [!note] Title\n> \n> body")
    assert.strictEqual(ofmText("`[[a#b c]]` [[a#b c]]"), "`[[a#b c]]` [[a#b-c|b c]]")
  })

  test("wikilinks in a table have their pipes escaped", () => {
    assert.strictEqual(ofmText("| a |\n| --- |\n| [[x|y]] |\n"), "| a |\n| --- |\n| [[x\\|y]] |\n")
  })
})
