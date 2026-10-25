import "./test-hooks.ts"
import test, { describe } from "node:test"
import assert from "node:assert"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import rehypeRaw from "rehype-raw"
import { toHtml } from "hast-util-to-html"
import type { Root } from "hast"
const {
  fileEmbedOptions,
  lineRange,
  parseCsv,
  parseEmbedAlias,
  rehypeEmbeds,
  resolveFile,
  webEmbed,
} = await import("./embeds.ts")
import type { FilePath } from "../lib/path"

async function render(markdown: string): Promise<string> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(() => rehypeEmbeds({ web: true, files: true, lightbox: true }))
  const tree = (await processor.run(processor.parse(markdown))) as Root
  return toHtml(tree)
}

describe("parseEmbedAlias", () => {
  test("splits a caption, flags and a size", () => {
    const o = parseEmbedAlias("my rice|loop muted|640x360")
    assert.strictEqual(o.caption, "my rice")
    assert.deepStrictEqual([...o.flags].sort(), ["loop", "muted"])
    assert.strictEqual(o.width, 640)
    assert.strictEqual(o.height, 360)
  })

  test("a lone number is a width, and words that aren't flags are a caption", () => {
    assert.strictEqual(parseEmbedAlias("300").width, 300)
    assert.strictEqual(parseEmbedAlias("loop the loop").caption, "loop the loop")
    assert.strictEqual(parseEmbedAlias("poster=a.png").poster, "a.png")
    assert.strictEqual(parseEmbedAlias(undefined).caption, "")
  })
})

describe("webEmbed", () => {
  test("youtube, in every url shape, with its start time and playlist", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://youtube.com/shorts/dQw4w9WgXcQ",
      "https://m.youtube.com/embed/dQw4w9WgXcQ",
    ]) {
      const e = webEmbed(url)
      assert.strictEqual(e?.kind, "youtube", url)
      assert.strictEqual(e.kind === "youtube" && e.id, "dQw4w9WgXcQ")
    }
    const timed = webEmbed("https://youtu.be/dQw4w9WgXcQ?t=1m30s&list=PL123")
    assert.ok(timed?.kind === "youtube")
    assert.strictEqual(timed.start, 90)
    assert.strictEqual(timed.list, "PL123")
  })

  test("tweets on twitter.com and x.com", () => {
    const e = webEmbed("https://x.com/jack/status/20")
    assert.deepStrictEqual(e, {
      kind: "tweet",
      url: "https://twitter.com/jack/status/20",
      user: "jack",
      id: "20",
    })
  })

  test("players with a fixed height", () => {
    const track = webEmbed("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT")
    assert.ok(track?.kind === "frame")
    assert.strictEqual(track.src, "https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT")
    assert.strictEqual(track.height, 152)
    const pen = webEmbed("https://codepen.io/team/codepen/pen/PNaGbb")
    assert.ok(pen?.kind === "frame")
    assert.strictEqual(pen.src, "https://codepen.io/team/codepen/embed/PNaGbb?default-tab=result")
  })

  test("anything else is not an embed", () => {
    assert.strictEqual(webEmbed("https://example.com/cat.png"), null)
    assert.strictEqual(webEmbed("https://www.youtube.com/@someone"), null)
    assert.strictEqual(webEmbed("not a url"), null)
  })
})

describe("files", () => {
  test("line ranges", () => {
    assert.deepStrictEqual(lineRange("#L3-L10"), [3, 10])
    assert.deepStrictEqual(lineRange("#l3-10"), [3, 10])
    assert.deepStrictEqual(lineRange("#L7"), [7, 7])
    assert.strictEqual(lineRange("#a-heading"), null)
  })

  test("csv with quotes, escapes and crlf", () => {
    assert.deepStrictEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n'), [
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ])
  })

  test("resolves a file the way shortest links do", () => {
    const files = ["notes/code/hello.py", "data/runs.csv"] as FilePath[]
    assert.strictEqual(resolveFile(files, "hello.py"), "notes/code/hello.py")
    assert.strictEqual(resolveFile(files, "data/runs.csv"), "data/runs.csv")
    assert.strictEqual(resolveFile(files, "nope.py"), undefined)
  })
})

describe("rehypeEmbeds", () => {
  test("a code file embed's title bar says what it is", async () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "figure",
          properties: { dataRehypePrettyCodeFigure: "" },
          children: [
            {
              type: "element",
              tagName: "figcaption",
              properties: { dataRehypePrettyCodeTitle: "" },
              children: [{ type: "text", value: "hello.py" }],
            },
            { type: "element", tagName: "pre", properties: {}, children: [] },
          ],
        },
      ],
    }
    const file = {
      data: {
        embeddedFiles: [
          {
            title: "hello.py",
            href: "./files/hello.py",
            lang: "python",
            range: [4, 5],
            total: 14,
            fullscreen: true,
          },
        ],
      },
    }
    rehypeEmbeds({ web: true, files: true, lightbox: true })(tree, file as never)
    const html = toHtml(tree)
    assert.match(html, /<figure[^>]*class="code-file"/)
    assert.match(html, /<span class="code-file-name">hello.py<\/span>/)
    // what it is goes in the raw glyph's tooltip, which the secondary column shows
    assert.match(html, /title="python · lines 4–5 of 14 · the raw file" href=".\/files\/hello.py"/)
    assert.match(html, /class="code-file-action code-file-copy"/)
    assert.match(html, /class="code-file-action code-file-full"/)
    assert.match(html, /<svg/)
  })

  test("fullscreen is a flag on a code file embed, off unless asked for", () => {
    assert.deepStrictEqual(fileEmbedOptions("just greet()|fullscreen"), {
      title: "just greet()",
      fullscreen: true,
    })
    assert.deepStrictEqual(fileEmbedOptions("undefined"), { title: undefined, fullscreen: false })
    assert.deepStrictEqual(fileEmbedOptions("fullscreen"), { title: undefined, fullscreen: true })
  })

  test("a youtube link becomes a facade that is still a link", async () => {
    const html = await render("![a talk](https://youtu.be/dQw4w9WgXcQ?t=42)")
    assert.match(html, /^<figure class="embed embed-youtube"/)
    assert.match(html, /<a class="embed-facade" href="https:\/\/youtu.be\/dQw4w9WgXcQ\?t=42"/)
    assert.match(
      html,
      /data-embed-src="https:\/\/www.youtube-nocookie.com\/embed\/dQw4w9WgXcQ\?autoplay=1&#x26;start=42"/,
    )
    assert.match(html, /i.ytimg.com\/vi\/dQw4w9WgXcQ\/hqdefault.jpg/)
    assert.doesNotMatch(html, /<p>/, "the figure replaces its paragraph")
  })

  test("a tweet is a quote with a link until widgets.js gets to it", async () => {
    const html = await render("![](https://twitter.com/jack/status/20)")
    assert.match(html, /<blockquote class="twitter-tweet"/)
    assert.match(html, /href="https:\/\/twitter.com\/jack\/status\/20"/)
  })

  test("any page, opted in with alt text iframe", async () => {
    const html = await render("![iframe|800x420](https://example.com)")
    assert.match(html, /<iframe src="https:\/\/example.com"/)
    assert.match(html, /--embed-height: 420px; --embed-width: 800px/)
  })

  test("an image with a title gets a caption; every image is lazy", async () => {
    const html = await render('![cat|300](cat.png "a cat")')
    assert.match(html, /<figure class="embed embed-image"/)
    assert.match(
      html,
      /<img src="cat.png" alt="cat" width="300" loading="lazy" decoding="async" class="zoomable">/,
    )
    assert.match(html, /<figcaption>a cat<\/figcaption>/)
  })

  test("video flags from the alias, with a download link inside", async () => {
    const html = await render(
      '<video src="clip.mp4" controls data-embed-alias="a clip|gif|480"></video>',
    )
    assert.match(
      html,
      /<video src="clip.mp4" preload="metadata" loop muted autoplay playsinline width="480">/,
    )
    assert.doesNotMatch(html, /controls/)
    assert.match(html, /<a href="clip.mp4">download clip.mp4<\/a>/)
    assert.match(html, /<figcaption>a clip<\/figcaption>/)
  })

  test("a pdf is an <object> with a link to fall back on", async () => {
    const html = await render(
      '<iframe src="doc.pdf#page=2" class="pdf" data-embed-alias="500"></iframe>',
    )
    assert.match(html, /<object data="doc.pdf#page=2" type="application\/pdf"/)
    // and Basalt's viewer knows the file, the page to open at, and where pdf.js is
    assert.match(
      html,
      /class="pdf-viewer" data-pdf="doc.pdf" data-pdf-name="doc.pdf" data-page="2" data-pdfjs="\/static\/pdfjs\/"/,
    )
    assert.match(html, /open doc.pdf/)
    assert.match(html, /--embed-height: 500px/)
  })

  test("a hand-written iframe gets lazy loading and a way out", async () => {
    const html = await render('<iframe src="https://example.org"></iframe>')
    assert.match(html, /<figure class="embed embed-frame"/)
    assert.match(html, /loading="lazy"/)
    assert.match(html, /class="external embed-source"/)
  })
})
