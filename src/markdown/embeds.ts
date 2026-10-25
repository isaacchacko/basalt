import fs from "node:fs"
import path from "node:path"
import type { Element, ElementContent, Properties, Root as HtmlRoot } from "hast"
import type { Code, Html, Paragraph, Root as MdRoot, RootContent, Table, TableRow } from "mdast"
import { fromHtml } from "hast-util-from-html"
import { SKIP, visit } from "unist-util-visit"
import { visitParents } from "unist-util-visit-parents"
import type { VFile } from "vfile"
import { slugifyFilePath, type FilePath } from "../lib/path"
import { hrefOf } from "../lib/links.ts"
import { reg } from "./context.ts"

// Basalt's embeds: what `![[...]]` and `![](...)` turn into when the thing
// embedded is not a note. ofm.ts parses the syntax; this makes each embed a
// proper figure with a static fallback, so a page still makes sense with no
// JS, in a preview, and in a feed. rehypeEmbeds runs after crawlLinks, whose
// resolved srcs it reads.

export interface Options {
  /** youtube, vimeo, spotify, tweets, ... from a bare `![](url)` */
  web: boolean
  /** `![[script.py]]`, `![[script.py#L3-L10]]` and `![[data.csv]]` */
  files: boolean
  /** a click on an image in a note opens it full size */
  lightbox: boolean
}

type El = Element

function el(tagName: string, properties: Properties = {}, children: ElementContent[] = []): El {
  return { type: "element", tagName, properties, children }
}

const text = (value: string): ElementContent => ({ type: "text", value })

function classes(node: El): string[] {
  const c = node.properties?.className
  return Array.isArray(c) ? (c as string[]) : typeof c === "string" ? (c as string).split(" ") : []
}

// ---------- the little language inside an embed's alias ----------

const sizeRegex = /^(\d+)(?:x(\d+))?$/
const MEDIA_FLAGS = new Set(["autoplay", "loop", "muted", "nocontrols", "gif", "inline"])

export interface EmbedOptions {
  caption: string
  width?: number
  height?: number
  flags: Set<string>
  poster?: string
}

/**
 * `my rice|loop muted|640x360` -> caption "my rice", flags, size. Each
 * `|`-separated part is a size, a run of known flags, a `poster=...`, or else
 * part of the caption.
 */
export function parseEmbedAlias(alias: string | undefined): EmbedOptions {
  const out: EmbedOptions = { caption: "", flags: new Set() }
  const caption: string[] = []
  for (const raw of (alias ?? "").split("|")) {
    const part = raw.trim()
    if (!part) continue
    const size = sizeRegex.exec(part)
    const words = part.split(/[\s,]+/)
    if (size) {
      out.width = Number(size[1])
      if (size[2]) out.height = Number(size[2])
    } else if (part.startsWith("poster=")) {
      out.poster = part.slice("poster=".length)
    } else if (words.every((w) => MEDIA_FLAGS.has(w.toLowerCase()))) {
      words.forEach((w) => out.flags.add(w.toLowerCase()))
    } else {
      caption.push(part)
    }
  }
  out.caption = caption.join(" | ")
  return out
}

// ---------- web embeds ----------

export type WebEmbed =
  | { kind: "youtube"; url: string; id: string; start?: number; list?: string }
  | { kind: "tweet"; url: string; user: string; id: string }
  | {
      kind: "frame"
      provider: string
      url: string
      src: string
      /** a fixed height in px (players), or else the frame keeps `aspect` */
      height?: number
      aspect?: string
    }

function seconds(t: string | null): number | undefined {
  if (!t) return undefined
  if (/^\d+$/.test(t)) return Number(t)
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t)
  if (!m) return undefined
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

/** What a url embeds as, or null when it's not one Basalt knows how to embed. */
export function webEmbed(raw: string): WebEmbed | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (!/^https?:$/.test(url.protocol)) return null
  const host = url.hostname.replace(/^(www|m|mobile)\./, "")
  const parts = url.pathname.split("/").filter(Boolean)

  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    let id: string | undefined
    if (host === "youtu.be") id = parts[0]
    else if (parts[0] === "watch") id = url.searchParams.get("v") ?? undefined
    else if (["embed", "shorts", "live", "v"].includes(parts[0])) id = parts[1]
    const list = url.searchParams.get("list") ?? undefined
    if (id && /^[\w-]{11}$/.test(id)) {
      return {
        kind: "youtube",
        url: raw,
        id,
        list,
        start: seconds(url.searchParams.get("t") ?? url.searchParams.get("start")),
      }
    }
    if (list) {
      return {
        kind: "frame",
        provider: "youtube",
        url: raw,
        src: `https://www.youtube-nocookie.com/embed/videoseries?list=${list}`,
        aspect: "16 / 9",
      }
    }
    return null
  }

  if (
    (host === "twitter.com" || host === "x.com") &&
    parts[1] === "status" &&
    /^\d+$/.test(parts[2] ?? "")
  ) {
    return {
      kind: "tweet",
      url: `https://twitter.com/${parts[0]}/status/${parts[2]}`,
      user: parts[0],
      id: parts[2],
    }
  }

  if (host === "vimeo.com" && /^\d+$/.test(parts[0] ?? "")) {
    return {
      kind: "frame",
      provider: "vimeo",
      url: raw,
      src: `https://player.vimeo.com/video/${parts[0]}?dnt=1`,
      aspect: "16 / 9",
    }
  }

  if (host === "loom.com" && parts[0] === "share" && parts[1]) {
    return {
      kind: "frame",
      provider: "loom",
      url: raw,
      src: `https://www.loom.com/embed/${parts[1]}`,
      aspect: "16 / 9",
    }
  }

  if (host === "open.spotify.com") {
    const at = parts[0]?.startsWith("intl-") ? 1 : 0
    const [type, id] = parts.slice(at)
    if (id && ["track", "album", "playlist", "episode", "show", "artist"].includes(type)) {
      return {
        kind: "frame",
        provider: "spotify",
        url: raw,
        src: `https://open.spotify.com/embed/${type}/${id}`,
        height: type === "track" || type === "episode" ? 152 : 352,
      }
    }
    return null
  }

  if (host === "soundcloud.com" && parts.length >= 2) {
    return {
      kind: "frame",
      provider: "soundcloud",
      url: raw,
      src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(raw)}&visual=false`,
      height: 166,
    }
  }

  // codepen.io/<user>/pen/<id>, or a team's: codepen.io/team/<team>/pen/<id>
  const pen = parts.indexOf("pen")
  if (host === "codepen.io" && pen > 0 && parts[pen + 1]) {
    return {
      kind: "frame",
      provider: "codepen",
      url: raw,
      src: `https://codepen.io/${parts.slice(0, pen).join("/")}/embed/${parts[pen + 1]}?default-tab=result`,
      height: 420,
    }
  }

  if (host === "figma.com" && ["file", "design", "proto", "board"].includes(parts[0])) {
    return {
      kind: "frame",
      provider: "figma",
      url: raw,
      src: `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(raw)}`,
      aspect: "16 / 10",
    }
  }

  return null
}

/** `![iframe](https://...)` or `![embed|800x600](https://...)`: any page, in a frame. */
const explicitFrameRegex = /^(?:iframe|embed)\b\s*/i

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "")
  } catch {
    return raw
  }
}

function sourceLink(href: string, label: string): El {
  return el(
    "a",
    { href, className: ["external", "embed-source"], target: "_blank", rel: ["noopener", "noreferrer"] },
    [text(label)],
  )
}

function figcaption(caption: string, href?: string, label?: string): El | null {
  const kids: ElementContent[] = []
  if (caption) kids.push(el("span", { className: ["embed-caption"] }, [text(caption)]))
  if (href) kids.push(sourceLink(href, label ?? hostOf(href)))
  return kids.length ? el("figcaption", {}, kids) : null
}

function figure(kind: string, live: ElementContent[], caption: El | null, style?: string): El {
  const props: Properties = { className: ["embed", `embed-${kind}`], dataEmbed: kind }
  if (style) props.style = style
  return el("figure", props, caption ? [...live, caption] : live)
}

export function renderWebEmbed(embed: WebEmbed, opts: EmbedOptions): El {
  const title = opts.caption || hostOf(embed.url)
  if (embed.kind === "youtube") {
    const params = new URLSearchParams({ autoplay: "1" })
    if (embed.start) params.set("start", String(embed.start))
    if (embed.list) params.set("list", embed.list)
    // a facade: the thumbnail is a plain link to youtube, and only becomes the
    // player when clicked, so a page with five videos doesn't load five players
    return figure(
      "youtube",
      [
        el(
          "a",
          {
            className: ["embed-facade"],
            href: embed.url,
            target: "_blank",
            rel: ["noopener", "noreferrer"],
            dataEmbedSrc: `https://www.youtube-nocookie.com/embed/${embed.id}?${params}`,
            dataEmbedTitle: title,
            ariaLabel: `play: ${title}`,
          },
          [
            el("img", {
              src: `https://i.ytimg.com/vi/${embed.id}/hqdefault.jpg`,
              alt: opts.caption,
              loading: "lazy",
              decoding: "async",
            }),
            el("span", { className: ["embed-play"], ariaHidden: "true" }),
          ],
        ),
      ],
      figcaption(opts.caption, embed.url, "youtube"),
    )
  }

  if (embed.kind === "tweet") {
    // twitter's own markup for a tweet: it reads fine as it is, and the
    // embeds script swaps it for the real card when widgets.js loads
    return figure(
      "tweet",
      [
        el("blockquote", { className: ["twitter-tweet"], dataDnt: "true" }, [
          el("p", {}, [text(opts.caption || `a post by @${embed.user}`)]),
          text(`— @${embed.user} `),
          sourceLink(embed.url, "view on x"),
        ]),
      ],
      null,
    )
  }

  const size = opts.height
    ? `--embed-height: ${opts.height}px`
    : embed.height
      ? `--embed-height: ${embed.height}px`
      : `--embed-aspect: ${embed.aspect ?? "16 / 9"}`
  return figure(
    embed.provider,
    [
      el("iframe", {
        src: embed.src,
        title,
        loading: "lazy",
        allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
        allowFullScreen: true,
        referrerPolicy: "strict-origin-when-cross-origin",
      }),
    ],
    figcaption(opts.caption, embed.url, embed.provider === "frame" ? undefined : embed.provider),
    size + (opts.width ? `; --embed-width: ${opts.width}px` : ""),
  )
}

// ---------- files: code and tables ----------

const CODE_LANGS: Record<string, string> = {
  py: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "tsx",
  jsx: "jsx",
  json: "json",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "fish",
  rs: "rust",
  go: "go",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  java: "java",
  kt: "kotlin",
  rb: "ruby",
  lua: "lua",
  css: "css",
  scss: "scss",
  html: "html",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  sql: "sql",
  txt: "text",
  conf: "ini",
  ini: "ini",
  nix: "nix",
  tex: "latex",
}

export const isCodeFile = (fp: string) => path.extname(fp).slice(1).toLowerCase() in CODE_LANGS

/** `#L3-L10`, `#l3-10`, `#L7` -> [3, 10], [7, 7] (1-based, inclusive) */
export function lineRange(anchor: string): [number, number] | null {
  const m = /^#?l(\d+)(?:-l?(\d+))?$/i.exec(anchor.trim())
  if (!m) return null
  const start = Number(m[1])
  return [start, m[2] ? Math.max(start, Number(m[2])) : start]
}

/** A small, forgiving csv reader: quoted fields, "" escapes, \r\n. */
export function parseCsv(src: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ",") {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else field += c
  }
  if (field !== "" || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""))
}

function csvTable(rows: string[][]): Table {
  const width = Math.max(...rows.map((r) => r.length))
  const toRow = (r: string[]): TableRow => ({
    type: "tableRow",
    children: Array.from({ length: width }, (_, i) => ({
      type: "tableCell",
      children: [{ type: "text", value: r[i] ?? "" }],
    })),
  })
  // mdast-util-to-hast counts a row's cells from `align`, so it needs one per column
  return { type: "table", align: Array(width).fill(null), children: rows.map(toRow) }
}

/** The file `![[name]]` means, the way Quartz's "shortest" links resolve. */
export function resolveFile(allFiles: FilePath[], target: string): FilePath | undefined {
  const want = slugifyFilePath(target as FilePath)
  const slugs = allFiles.map((f) => [f, slugifyFilePath(f)] as const)
  return (
    slugs.find(([, s]) => s === want)?.[0] ?? slugs.find(([, s]) => s.endsWith("/" + want))?.[0]
  )
}

const transcludeHtml =
  /^<blockquote class="transclude" data-url="([^"]*)" data-block="([^"]*)" data-embed-alias="([^"]*)"/

function embedError(message: string): Html {
  return { type: "html", value: `<p class="embed-missing">${message.replace(/</g, "&lt;")}</p>` }
}

/** What a code file embed is, for the bar over it: see rehypeEmbeds. */
export interface EmbeddedFile {
  title: string
  href: string
  lang: string
  /** the lines shown, 1-based, and how many the file has */
  range: [number, number] | null
  total: number
  /** `![[file.py|fullscreen]]`: a button that shows it on the whole screen */
  fullscreen: boolean
}

/** A code file embed's alias: its title, then flags like `fullscreen`, `|`-separated in any order. */
export function fileEmbedOptions(alias: string | undefined): {
  title?: string
  fullscreen: boolean
} {
  const parts = (alias && alias !== "undefined" ? alias : "").split("|").map((p) => p.trim())
  const fullscreen = parts.includes("fullscreen")
  const title = parts.filter((p) => p && p !== "fullscreen").join(" | ")
  return { title: title || undefined, fullscreen }
}

function fileEmbed(
  url: string,
  block: string,
  alias: string,
  embedded: EmbeddedFile[],
): RootContent | null {
  const ext = path.extname(url).slice(1).toLowerCase()
  if (!(ext in CODE_LANGS) && ext !== "csv") return null

  const { files } = reg()
  const file = resolveFile(
    files.map((f) => f.rel),
    url,
  )
  if (!file) return embedError(`couldn't find ${url} to embed`)
  const name = path.basename(file)
  let src: string
  try {
    src = fs.readFileSync(files.find((f) => f.rel === file)!.abs, "utf8")
  } catch {
    return embedError(`couldn't read ${file}`)
  }

  if (ext === "csv") return csvTable(parseCsv(src))

  let lines = src.replace(/\n$/, "").split("\n")
  const total = lines.length
  const range = lineRange(block)
  const options = fileEmbedOptions(alias)
  const title = (options.title ?? name).replace(/"/g, "'")
  let meta = `title="${title}" showLineNumbers`
  if (range) {
    lines = lines.slice(range[0] - 1, range[1])
    meta = `title="${title}" showLineNumbers{${range[0]}}`
  }
  embedded.push({
    title,
    href: hrefOf(slugifyFilePath(file)),
    lang: CODE_LANGS[ext],
    range: range ? [range[0], Math.min(range[1], total)] : null,
    total,
    fullscreen: options.fullscreen,
  })
  const code: Code = { type: "code", lang: CODE_LANGS[ext], meta, value: lines.join("\n") }
  return code
}

/** Splits `p` around its child at `i`, so a block can take that child's place. */
function liftOut(p: Paragraph, i: number, block: RootContent): RootContent[] {
  const before = p.children.slice(0, i)
  const after = p.children.slice(i + 1)
  const blank = (nodes: Paragraph["children"]) =>
    nodes.every((n) => n.type === "text" && n.value.trim() === "")
  const out: RootContent[] = []
  if (!blank(before)) out.push({ type: "paragraph", children: before })
  out.push(block)
  if (!blank(after)) out.push({ type: "paragraph", children: after })
  return out
}

// ---------- the html pass ----------

/** A block embed alone in its paragraph replaces the paragraph: <p><figure> isn't valid html. */
function replaceNode(parent: El | HtmlRoot, index: number, node: El, grandparent?: El | HtmlRoot) {
  parent.children[index] = node
  if (
    grandparent &&
    parent.type === "element" &&
    parent.tagName === "p" &&
    node.tagName === "figure" &&
    parent.children.every((c) => c === node || (c.type === "text" && c.value.trim() === ""))
  ) {
    const at = grandparent.children.indexOf(parent)
    if (at >= 0) grandparent.children[at] = node
  }
}

function mediaFigure(node: El, kind: "video" | "audio"): El {
  const src = String(node.properties.src ?? "")
  const opts = parseEmbedAlias(String(node.properties.dataEmbedAlias ?? ""))
  const flags = opts.flags
  if (flags.has("gif")) ["autoplay", "loop", "muted", "nocontrols"].forEach((f) => flags.add(f))
  const props: Properties = { src, preload: "metadata" }
  if (!flags.has("nocontrols")) props.controls = true
  if (flags.has("loop")) props.loop = true
  if (flags.has("muted") || flags.has("autoplay")) props.muted = true
  if (flags.has("autoplay")) props.autoPlay = true
  if (kind === "video") {
    props.playsInline = true
    if (opts.poster) props.poster = opts.poster
    if (opts.width) props.width = opts.width
    if (opts.height) props.height = opts.height
  }
  const name = decodeURIComponent(src.split("/").pop()?.split("#")[0] ?? src)
  const fallback = el("a", { href: src }, [text(`download ${name}`)])
  const media = el(kind, props, [fallback])
  const caption = kind === "audio" ? opts.caption || name : opts.caption
  return figure(kind, [media], caption ? el("figcaption", {}, [text(caption)]) : null)
}

/** where pdf.js is served from (the media scripts load it) */
export const PDFJS = "/static/pdfjs/"

/**
 * A pdf: Basalt's viewer (the embeds script draws its pages with pdf.js, from
 * PDFJS). Until then, and with no
 * script, an <object>, which a browser that can't show pdfs inline (most
 * phones) replaces with a link.
 */
function pdfFigure(node: El): El {
  const src = String(node.properties.src ?? "")
  const opts = parseEmbedAlias(String(node.properties.dataEmbedAlias ?? ""))
  const [file, hash = ""] = src.split("#")
  const name = decodeURIComponent(file.split("/").pop() ?? file)
  const page = Number(/(?:^|&)page=(\d+)/.exec(hash)?.[1] ?? 1)
  const object = el("object", { data: src, type: "application/pdf", ariaLabel: name }, [
    el("p", { className: ["embed-fallback"] }, [
      text("this browser can't show the pdf here. "),
      el("a", { href: src }, [text(`open ${name}`)]),
    ]),
  ])
  const viewer = el(
    "div",
    {
      className: ["pdf-viewer"],
      dataPdf: file,
      dataPdfName: name,
      dataPage: page,
      dataPdfjs: PDFJS,
    },
    [object],
  )
  return figure(
    "pdf",
    [viewer],
    el("figcaption", {}, [
      ...(opts.caption ? [el("span", { className: ["embed-caption"] }, [text(opts.caption)])] : []),
      el("a", { href: src, className: ["embed-source"] }, [text(name)]),
    ]),
    `--embed-height: ${opts.height ?? opts.width ?? 720}px`,
  )
}

function imageAltSize(node: El) {
  const alt = String(node.properties.alt ?? "")
  const m = /^(.*?)\|\s*(\d+)(?:x(\d+))?\s*$/.exec(alt)
  if (!m) return
  node.properties.alt = m[1].trim()
  node.properties.width = m[2]
  if (m[3]) node.properties.height = m[3]
}

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const GLYPHS = {
  source: svg('<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
  full: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
}

/**
 * A code file embed's title bar says what it is: the file's name, then its
 * language, which lines (of how many), and a link to the file itself.
 */
function labelFileEmbeds(tree: HtmlRoot, embedded: EmbeddedFile[]) {
  const queue = [...embedded]
  visit(tree, "element", (node) => {
    if (
      !queue.length ||
      node.tagName !== "figure" ||
      node.properties.dataRehypePrettyCodeFigure === undefined
    )
      return
    const caption = node.children.find(
      (c): c is El => c.type === "element" && c.properties.dataRehypePrettyCodeTitle !== undefined,
    )
    const title = caption?.children.map((c) => (c.type === "text" ? c.value : "")).join("")
    if (!caption || title !== queue[0].title) return
    const info = queue.shift()!
    const lines = info.range
      ? `lines ${info.range[0]}–${info.range[1]} of ${info.total}`
      : `${info.total} ${info.total === 1 ? "line" : "lines"}`
    node.properties.className = [...classes(node), "code-file"]
    const action = (
      tag: "a" | "button",
      cls: string,
      label: string,
      tip: string,
      glyph: string,
      props = {},
    ) =>
      el(tag, { className: ["code-file-action", cls], ariaLabel: label, title: tip, ...props }, [
        ...(fromHtml(glyph, { fragment: true }).children as ElementContent[]),
      ])
    caption.children = [
      el("span", { className: ["code-file-name"] }, [text(title)]),
      el("span", { className: ["code-file-actions"] }, [
        action(
          "a",
          "code-file-raw",
          "view the raw file",
          `${info.lang} · ${lines} · the raw file`,
          GLYPHS.source,
          {
            href: info.href,
            dataNoPopover: true,
          },
        ),
        action("button", "code-file-copy", "copy", "copy the code", GLYPHS.copy, {
          type: "button",
        }),
        ...(info.fullscreen
          ? [
              action(
                "button",
                "code-file-full",
                "full screen",
                "show it on the whole screen",
                GLYPHS.full,
                { type: "button" },
              ),
            ]
          : []),
      ]),
    ]
    return SKIP
  })
}

export function rehypeEmbeds(opts: Options) {
  return (tree: HtmlRoot, file?: VFile) => {
    if (file?.data.embeddedFiles?.length) labelFileEmbeds(tree, file.data.embeddedFiles)
    visitParents(tree, "element", (node, ancestors) => {
      const p = ancestors.at(-1) as El | HtmlRoot | undefined
      if (!p) return
      const gp = ancestors.at(-2) as El | HtmlRoot | undefined
      const index = p.children.indexOf(node)
      const props = node.properties ?? {}
      if (props.dataBasalt) return SKIP

      if (node.tagName === "img") {
        const src = String(props.src ?? "")
        const alt = String(props.alt ?? "")
        if (opts.web && /^https?:\/\//.test(src)) {
          const embed = webEmbed(src)
          const explicit = explicitFrameRegex.exec(alt)
          if (embed || explicit) {
            const aliasOpts = parseEmbedAlias(alt.replace(explicitFrameRegex, ""))
            const out = renderWebEmbed(
              embed ?? { kind: "frame", provider: "frame", url: src, src, aspect: "16 / 10" },
              aliasOpts,
            )
            out.properties.dataBasalt = true
            replaceNode(p, index, out, gp)
            return SKIP
          }
        }
        imageAltSize(node)
        props.loading ??= "lazy"
        props.decoding ??= "async"
        if (opts.lightbox) node.properties.className = [...classes(node), "zoomable"]
        // `![alt](src "a caption")` is a figure with a caption
        if (typeof props.title === "string" && props.title) {
          const caption = props.title
          delete node.properties.title
          const out = figure("image", [node], el("figcaption", {}, [text(caption)]))
          out.properties.dataBasalt = true
          replaceNode(p, index, out, gp)
          return SKIP
        }
        return
      }

      if (node.tagName === "video" || node.tagName === "audio") {
        const out = mediaFigure(node, node.tagName)
        out.properties.dataBasalt = true
        replaceNode(p, index, out, gp)
        return SKIP
      }

      if (node.tagName === "iframe") {
        if (classes(node).includes("pdf")) {
          const out = pdfFigure(node)
          out.properties.dataBasalt = true
          replaceNode(p, index, out, gp)
          return SKIP
        }
        const src = String(props.src ?? "")
        // ObsidianFlavoredMarkdown's own youtube iframe, if it was left on
        const yt = classes(node).includes("youtube") ? webEmbed(src) : null
        if (yt) {
          const out = renderWebEmbed(yt, parseEmbedAlias(""))
          out.properties.dataBasalt = true
          replaceNode(p, index, out, gp)
          return SKIP
        }
        // a live html block is the Islands plugin's
        if (classes(node).includes("island-html")) return SKIP
        // an iframe written by hand: lazy, and with a way out if it won't load
        props.loading ??= "lazy"
        if (!(p.type === "element" && classes(p).includes("embed"))) {
          const out = figure("frame", [node], /^https?:/.test(src) ? figcaption("", src) : null)
          out.properties.dataBasalt = true
          replaceNode(p, index, out, gp)
        }
        return SKIP
      }
    })
  }
}

export function remarkFileEmbeds() {
  return (tree: MdRoot, file: VFile) => {
    const embedded: EmbeddedFile[] = (file.data.embeddedFiles = [])
    visit(tree, "paragraph", (p: Paragraph, index, parent) => {
      if (!parent || index === undefined) return
      const at = p.children.findIndex((c) => c.type === "html" && transcludeHtml.test(c.value))
      if (at < 0) return
      const [, url, block, alias] = transcludeHtml.exec((p.children[at] as Html).value)!
      const embed = fileEmbed(url, block, alias, embedded)
      if (!embed) return
      parent.children.splice(index, 1, ...(liftOut(p, at, embed) as typeof parent.children))
      return [SKIP, index + 1]
    })
  }
}

declare module "vfile" {
  interface DataMap {
    embeddedFiles: EmbeddedFile[]
  }
}
