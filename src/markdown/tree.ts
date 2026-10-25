import type { Code, Html, Root } from "mdast"
import { visit } from "unist-util-visit"

// A ```tree block, drawn as a directory at build time. Folders are <details>,
// so they fold without a script.

type Mark = "added" | "removed" | "changed" | "highlighted"

export interface Entry {
  name: string
  href?: string
  dir: boolean
  /** written `name/…`: shut, or with nothing under it, its contents left out */
  folded: boolean
  mark?: Mark
  note?: string
  children: Entry[]
}

const MARKS: Record<string, Mark> = { "+": "added", "-": "removed", "~": "changed", "!": "highlighted" }

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// `tree`'s output: four columns a level
const BRANCH = /^((?:│   | {4})*)[├└]── /

function linesWithDepth(source: string): { depth: number; text: string }[] {
  const lines = source.split(/\r?\n/).filter((l) => l.trim() && !/^\d+ director(y|ies)/.test(l))
  if (lines.some((l) => BRANCH.test(l))) {
    const out = lines.flatMap((l) => {
      const m = BRANCH.exec(l)
      if (m) return [{ depth: m[1].length / 4 + 1, text: l.slice(m[0].length).trim() }]
      return /^[│\s]*$/.test(l) ? [] : [{ depth: 0, text: l.trim() }]
    })
    // `.` is the folder tree ran in, not an entry
    return out[0]?.text === "." ? out.slice(1).map((l) => ({ ...l, depth: l.depth - 1 })) : out
  }
  // every line a "- " is a markdown list, not a tree of removed entries
  const bullets = lines.every((l) => /^\s*- /.test(l))
  const indents: number[] = []
  return lines.map((l) => {
    const indent = /^\s*/.exec(l)![0].replace(/\t/g, "    ").length
    while (indents.length && indents.at(-1)! >= indent) indents.pop()
    indents.push(indent)
    const text = l.trim()
    return { depth: indents.length - 1, text: bullets ? text.slice(2) : text }
  })
}

export function entry(text: string): Entry {
  const e: Entry = { name: "", dir: false, folded: false, children: [] }
  const sigil = /^([+\-~!])\s+/.exec(text)
  if (sigil) {
    e.mark = MARKS[sigil[1]]
    text = text.slice(sigil[0].length)
  }
  // whitespace before the #, so c#.md and [[a#b]] stay names
  const hash = /\s#(\s|$)/.exec(text)
  if (hash) {
    e.note = text.slice(hash.index + hash[0].length).trim() || undefined
    text = text.slice(0, hash.index).trim()
  }
  if (/\/(…|\.\.\.)$/.test(text)) {
    e.folded = true
    text = text.replace(/(…|\.\.\.)$/, "")
  }
  const wiki = /^\[\[([^\]|]+?)(?:\|([^\]]+))?\]\](\/?)$/.exec(text)
  const md = /^\[([^\]]+)\]\(([^)\s]+)\)(\/?)$/.exec(text)
  if (wiki) [e.href, e.name, text] = [wiki[1].trim(), (wiki[2] ?? wiki[1]).trim(), wiki[3]]
  else if (md) [e.name, e.href, text] = [md[1].trim(), md[2], md[3]]
  else e.name = text
  if (text.endsWith("/") || e.name.endsWith("/")) {
    e.dir = true
    e.name = e.name.replace(/\/$/, "")
  }
  return e
}

export function parseTree(source: string): Entry[] {
  const top: Entry[] = []
  const ancestors: Entry[] = []
  for (const { depth, text } of linesWithDepth(source)) {
    const e = entry(text)
    ancestors.length = Math.min(depth, ancestors.length)
    const parent = ancestors.at(-1)
    if (parent) {
      parent.children.push(e)
      parent.dir = true
    } else top.push(e)
    ancestors.push(e)
  }
  return top
}

// ---------- icons, in the line style of client/embeds.ts ----------

const PAGE = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'

const ICONS = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderOpen:
    '<path d="M4 19a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5l2 2h7a1 1 0 0 1 1 1v2"/><path d="M4 19l2.6-7.3a1 1 0 0 1 1-.7H21l-2.7 7.3a1 1 0 0 1-.9.7z"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  file: PAGE,
  text: PAGE + '<path d="M9 13h6M9 17h4"/>',
  markdown: PAGE + '<path d="M8 18v-5l2 2 2-2v5M16 13v5M14.5 16.5 16 18l1.5-1.5"/>',
  code: PAGE + '<path d="M10 12.5 8 15l2 2.5M14 12.5l2 2.5-2 2.5"/>',
  config:
    PAGE +
    '<path d="M10.5 12c-1 0-1.5.5-1.5 1.25v.75c0 .6-.4 1-1 1 .6 0 1 .4 1 1v.75c0 .75.5 1.25 1.5 1.25M13.5 12c1 0 1.5.5 1.5 1.25v.75c0 .6.4 1 1 1-.6 0-1 .4-1 1v.75c0 .75-.5 1.25-1.5 1.25"/>',
  style: PAGE + '<path d="M10.5 12 9.5 18M14.5 12l-1 6M8.5 14h7M8 16h7"/>',
  data: PAGE + '<path d="M8 12h8v6H8zM8 15h8M12 12v6"/>',
  image: PAGE + '<circle cx="10" cy="12.5" r="1.25"/><path d="M5.5 19.5 10 15.5l2.5 2 2-1.5 4 3"/>',
  audio: PAGE + '<circle cx="9.5" cy="17" r="1.5"/><path d="M11 17v-5l4-1v4.5"/><circle cx="13.5" cy="15.5" r="1.5"/>',
  video: PAGE + '<path d="M10 12v6l5-3z"/>',
  pdf: PAGE + '<path d="M9 13h6M9 16h6M9 19h3"/>',
  archive: PAGE + '<path d="M11 3v2M13 5v2M11 7v2M13 9v2M11 13h2v3h-2z"/>',
  key: PAGE + '<circle cx="10" cy="15" r="2"/><path d="M12 15h4.5M15 15v2"/>',
}

type Kind = keyof typeof ICONS

// first match wins: key before config, which would take package-lock.json and .npmrc
const KINDS: [RegExp, Kind][] = [
  [/\.(md|mdx|markdown)$/i, "markdown"],
  [/\.(txt|rst|adoc|org|log)$|^(readme|license|licence|changelog|authors|notice)$/i, "text"],
  [/\.(lock|pem|key|crt)$|^\.env(\..*)?$|-lock\.(json|ya?ml)$|^\.npmrc$/i, "key"],
  [
    /\.(json|jsonc|json5|ya?ml|toml|ini|cfg|conf|xml|plist|properties)$|^(\..*rc|dockerfile|makefile|procfile|\.editorconfig|\.git(ignore|attributes|modules)|\.(node|python|ruby)-version|\.tool-versions)$/i,
    "config",
  ],
  [/\.(css|scss|sass|less|styl|pcss)$/i, "style"],
  [/\.(csv|tsv|sql|sqlite|db|parquet|ndjson|jsonl)$/i, "data"],
  [/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|heic|tiff?)$/i, "image"],
  [/\.(mp3|wav|m4a|ogg|flac|aac|opus)$/i, "audio"],
  [/\.(mp4|webm|mov|mkv|ogv|avi)$/i, "video"],
  [/\.pdf$/i, "pdf"],
  [/\.(zip|tar|gz|tgz|bz2|xz|7z|rar|zst)$/i, "archive"],
  [
    /\.(ts|tsx|js|jsx|mjs|cjs|astro|vue|svelte|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|lua|sh|bash|zsh|fish|r|jl|hs|ml|ex|exs|clj|scala|dart|zig|nim|html?|wasm)$/i,
    "code",
  ],
]

export const kindOf = (name: string): Kind => KINDS.find(([re]) => re.test(name))?.[1] ?? "file"

const svg = (d: string, cls: string) =>
  `<svg class="${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`

// ---------- the html ----------

/** `code`, [[links]] and [links](url) in a note; the rest as text */
function noteHtml(text: string): string {
  let out = ""
  let last = 0
  for (const m of text.matchAll(/`([^`]+)`|\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    out += escapeHtml(text.slice(last, m.index))
    if (m[1] !== undefined) out += `<code>${escapeHtml(m[1])}</code>`
    else if (m[2] !== undefined) out += `<a href="${escapeHtml(m[2].trim())}">${escapeHtml((m[3] ?? m[2]).trim())}</a>`
    else out += `<a href="${escapeHtml(m[5])}">${escapeHtml(m[4])}</a>`
    last = m.index! + m[0].length
  }
  return out + escapeHtml(text.slice(last))
}

function row(e: Entry, depth: number): string {
  const tag = e.dir ? "summary" : "div"
  const chevron = e.dir ? svg(ICONS.chevron, "tree-chevron") : '<span class="tree-chevron"></span>'
  // both, and the stylesheet shows the one for whether the <details> is open
  const icon = e.dir
    ? svg(ICONS.folderOpen, "tree-icon tree-icon-open") + svg(ICONS.folder, "tree-icon tree-icon-shut")
    : svg(ICONS[kindOf(e.name)], "tree-icon")
  // a narrow column breaks a long name after a dot before it breaks mid-word
  const shown = escapeHtml(e.name).replace(/(?<=[^.])\.(?=.)/g, ".<wbr>")
  const name = e.href
    ? `<a class="tree-name" href="${escapeHtml(e.href)}">${shown}</a>`
    : `<span class="tree-name">${shown}</span>`
  const elided = e.folded && !e.children.length ? '<span class="tree-elided">/…</span>' : ""
  // the tint can't be seen by a screen reader
  const said = e.mark ? `<span class="tree-said">, ${e.mark}</span>` : ""
  const note = e.note ? `<span class="tree-note">${noteHtml(e.note)}</span>` : ""
  return `<${tag} class="tree-row" style="--d:${depth}">${chevron}${icon}<span class="tree-label"><span>${name}${elided}</span>${said}${note}</span></${tag}>`
}

function list(entries: Entry[], depth: number): string {
  const items = entries.map((e) => {
    const attrs = [
      `class="tree-entry ${e.dir ? "tree-dir" : "tree-file"}"`,
      e.mark ? `data-mark="${e.mark}"` : "",
      e.dir && !e.children.length ? "data-empty" : "",
    ]
      .filter(Boolean)
      .join(" ")
    if (!e.dir) return `<li ${attrs}>${row(e, depth)}</li>`
    const children = e.children.length ? list(e.children, depth + 1) : ""
    return `<li ${attrs}><details${e.folded ? "" : " open"}>${row(e, depth)}${children}</details></li>`
  })
  return `<ul class="tree-list" style="--d:${depth}">${items.join("")}</ul>`
}

export function treeHtml(source: string, meta?: string | null): string {
  const top = parseTree(source)
  if (!top.length) return ""
  const title = /title=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(meta ?? "")?.slice(1).find(Boolean)
  const caption = title ? `<figcaption class="tree-title">${escapeHtml(title)}</figcaption>` : ""
  return `<figure class="tree">${caption}${list(top, 0)}</figure>`
}

export function remarkTree() {
  return (tree: Root) => {
    visit(tree, "code", (node: Code, index, parent) => {
      if (!parent || index === undefined || node.lang?.toLowerCase() !== "tree") return
      parent.children[index] = { type: "html", value: treeHtml(node.value, node.meta) } satisfies Html
    })
  }
}
