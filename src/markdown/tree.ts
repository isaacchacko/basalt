import type { Code, Html, Root } from "mdast"
import { visit } from "unist-util-visit"

// A ```tree block is a directory, drawn: folders that fold, an icon for each
// file's kind, a quiet note beside an entry, and marks for what was added,
// removed, changed or is worth looking at, so two trees can be compared.
//
//   ```tree title="A Basalt site"
//   my-site/
//     basalt.json        # the site's settings
//     notes/
//       + drafts/        # added
//       - old.md         # removed
//       ~ index.md       # changed
//       ! start.md       # looked at
//       [[examples]]/    # links to a note
//     node_modules/…     # starts folded
//     …                  # more, not shown
//   ```
//
// The shape comes from indentation, a markdown list, or `tree`'s own output
// (├── └── │), pasted as it is. A folder is a name ending in / or anything
// with entries under it. `open=1` after the language folds every folder
// deeper than the first level, and `title="..."` is the block's header bar.
//
// It's built of <details>, so folding works without a script, and each entry
// carries its path (`data-path`, folders ending in /) from the tree's top
// folder, so a compare block lines up two trees' matching folders even when
// their tops are named differently (quartz/ and my-site/).
//
// In Obsidian or on GitHub it stays a code block that reads as a tree.

export type Mark = "added" | "removed" | "changed" | "marked"

export interface Entry {
  name: string
  /** where the entry links, if its name is a link */
  href?: string
  dir: boolean
  /** a folder written `name/…`: starts folded */
  folded: boolean
  /** a line of `…`: more, not shown */
  more: boolean
  mark?: Mark
  note?: string
  children: Entry[]
}

const MARKS: Record<string, Mark> = { "+": "added", "-": "removed", "~": "changed", "!": "marked" }

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// `tree`'s branches, in box drawing or ascii: each level is four columns
const BRANCH = /^((?:[│|]   |    )*)(?:[├└|`]── |[├└|`]-- )/
const STEM = /^((?:[│|]\s{2,3}|\s{4})*)/

/** A line's depth and what's after its indentation or branch, or null for a line to skip. */
function lines(source: string): { depth: number; text: string }[] {
  const raw = source.replace(/\r/g, "").split("\n")
  // `tree`'s count at the end ("3 directories, 5 files")
  while (raw.length && (!raw.at(-1)!.trim() || /^\d+ director(y|ies)(, \d+ files?)?$/.test(raw.at(-1)!.trim())))
    raw.pop()
  const drawn = raw.some((l) => BRANCH.test(l))
  const out: { depth: number; text: string }[] = []

  if (drawn) {
    for (const line of raw) {
      if (!line.trim()) continue
      const m = BRANCH.exec(line)
      if (m) out.push({ depth: m[1].length / 4 + 1, text: line.slice(m[0].length).trim() })
      else if (!STEM.exec(line)![0] || line.trim() === "." ) out.push({ depth: 0, text: line.trim() })
    }
    // a first line of "." is the folder `tree` was run in: its entries are the top
    if (out[0]?.text === ".") return out.slice(1).map((l) => ({ ...l, depth: l.depth - 1 }))
    return out
  }

  // indentation: any consistent step, tabs or spaces; a markdown list's
  // bullets go if every line has one
  const nonblank = raw.filter((l) => l.trim())
  const listed = nonblank.length > 0 && nonblank.every((l) => /^\s*[-*+]\s+\S/.test(l))
  const stack: number[] = []
  for (const line of nonblank) {
    const indent = /^\s*/.exec(line)![0].replace(/\t/g, "    ").length
    while (stack.length && stack.at(-1)! >= indent) stack.pop()
    out.push({ depth: stack.length, text: listed ? line.trim().replace(/^[-*+]\s+/, "") : line.trim() })
    stack.push(indent)
  }
  return out
}

/** One line's entry: its mark, name (or link), and note. */
export function entry(text: string): Entry {
  const e: Entry = { name: "", dir: false, folded: false, more: false, children: [] }
  const sigil = /^([+\-~!])\s+/.exec(text)
  if (sigil) {
    e.mark = MARKS[sigil[1]]
    text = text.slice(sigil[0].length)
  }
  // a note is set off by whitespace and a #, so c#.md and [[a#b]] stay names
  const hash = /\s#(\s|$)/.exec(text)
  if (hash) {
    e.note = text.slice(hash.index + hash[0].length).trim() || undefined
    text = text.slice(0, hash.index).trim()
  }

  if (/^(…|\.\.\.)$/.test(text)) {
    e.more = true
    e.name = "…"
    return e
  }
  const fold = /\/(…|\.\.\.)$/.exec(text)
  if (fold) {
    e.folded = true
    text = text.slice(0, fold.index + 1)
  }
  if (text.endsWith("/")) {
    e.dir = true
    text = text.slice(0, -1)
  }

  const wiki = /^\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]$/.exec(text)
  const md = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(text)
  if (wiki) {
    e.href = wiki[1].trim()
    e.name = (wiki[2] ?? wiki[1]).trim()
  } else if (md) {
    e.name = md[1].trim()
    e.href = md[2]
  } else {
    e.name = text
  }
  // a link written with its slash inside: [[examples/]]
  if (e.name.endsWith("/")) {
    e.dir = true
    e.name = e.name.slice(0, -1)
  }
  return e
}

/** The tree's top-level entries. */
export function parseTree(source: string): Entry[] {
  const top: Entry[] = []
  const open: Entry[] = []
  for (const { depth, text } of lines(source)) {
    const e = entry(text)
    // a line indented further than one step under its parent hangs from it all the same
    const d = Math.min(Math.max(depth, 0), open.length)
    open.length = d
    const parent = open.at(-1)
    if (parent) {
      parent.children.push(e)
      parent.dir = true
    } else top.push(e)
    open.push(e)
  }
  return top
}

// ---------- icons, in the line style of the page's controls (client/embeds.ts) ----------

const PAGE = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'

export const ICONS = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  open: '<path d="M4 19a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5l2 2h7a1 1 0 0 1 1 1v2"/><path d="M4 19l2.6-7.3a1 1 0 0 1 1-.7H21l-2.7 7.3a1 1 0 0 1-.9.7z"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  file: PAGE,
  text: PAGE + '<path d="M9 13h6M9 17h4"/>',
  markdown: PAGE + '<path d="M8 18v-5l2 2 2-2v5M16 13v5M14.5 16.5 16 18l1.5-1.5"/>',
  code: PAGE + '<path d="M10 12.5 8 15l2 2.5M14 12.5l2 2.5-2 2.5"/>',
  config: PAGE + '<path d="M10.5 12c-1 0-1.5.5-1.5 1.25v.75c0 .6-.4 1-1 1 .6 0 1 .4 1 1v.75c0 .75.5 1.25 1.5 1.25M13.5 12c1 0 1.5.5 1.5 1.25v.75c0 .6.4 1 1 1-.6 0-1 .4-1 1v.75c0 .75-.5 1.25-1.5 1.25"/>',
  style: PAGE + '<path d="M10.5 12 9.5 18M14.5 12l-1 6M8.5 14h7M8 16h7"/>',
  data: PAGE + '<path d="M8 12h8v6H8zM8 15h8M12 12v6"/>',
  image: PAGE + '<circle cx="10" cy="12.5" r="1.25"/><path d="M5.5 19.5 10 15.5l2.5 2 2-1.5 4 3"/>',
  audio: PAGE + '<circle cx="9.5" cy="17" r="1.5"/><path d="M11 17v-5l4-1v4.5"/><circle cx="13.5" cy="15.5" r="1.5"/>',
  video: PAGE + '<path d="M10 12v6l5-3z"/>',
  pdf: PAGE + '<path d="M9 13h6M9 16h6M9 19h3"/>',
  archive: PAGE + '<path d="M11 3v2M13 5v2M11 7v2M13 9v2M11 13h2v3h-2z"/>',
  key: PAGE + '<circle cx="10" cy="15" r="2"/><path d="M12 15h4.5M15 15v2"/>',
}

export type Kind = keyof typeof ICONS

const KINDS: [RegExp, Kind][] = [
  [/\.(md|mdx|markdown)$/i, "markdown"],
  [/\.(txt|rst|adoc|org|log)$|^(readme|license|licence|changelog|authors|notice)$/i, "text"],
  // lock files and secrets before config, which would take package-lock.json and .npmrc
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

// ---------- notes: a little markdown, inline ----------

/** `code`, [[links]] and [links](url) in a note; the rest as text. */
export function inline(text: string): string {
  let out = ""
  const re = /`([^`]+)`|\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    out += escapeHtml(text.slice(last, m.index))
    if (m[1] !== undefined) out += `<code>${escapeHtml(m[1])}</code>`
    else if (m[2] !== undefined) out += `<a href="${escapeHtml(m[2].trim())}">${escapeHtml((m[3] ?? m[2]).trim())}</a>`
    else out += `<a href="${escapeHtml(m[5])}">${escapeHtml(m[4])}</a>`
    last = m.index! + m[0].length
  }
  return out + escapeHtml(text.slice(last))
}

// ---------- the html ----------

const SAID: Record<Mark, string> = { added: "added", removed: "removed", changed: "changed", marked: "" }

function row(e: Entry, depth: number): string {
  const tag = e.dir ? "summary" : "div"
  const chevron = e.dir ? svg(ICONS.chevron, "tree-chevron") : '<span class="tree-chevron"></span>'
  // a folder carries both its icons, and its <details> shows the one it's in
  const icon = e.more
    ? ""
    : e.dir
      ? svg(ICONS.open, "tree-icon tree-icon-open") + svg(ICONS.folder, "tree-icon tree-icon-shut")
      : svg(ICONS[kindOf(e.name)], "tree-icon")
  // the name is the line a compare block's ^anchor=/text/ is matched against,
  // so a word in the note can't take it
  const name = e.href
    ? `<a class="tree-name" href="${escapeHtml(e.href)}" data-line>${escapeHtml(e.name)}</a>`
    : `<span class="tree-name" data-line>${escapeHtml(e.name)}</span>`
  // a folder written name/… with nothing under it: its contents left out
  const elided = e.folded && !e.children.length ? '<span class="tree-elided">/…</span>' : ""
  // a mark is said, not only coloured, for a reader who can't see the colour
  const said = e.mark && SAID[e.mark] ? `<span class="tree-said">, ${SAID[e.mark]}</span>` : ""
  const note = e.note ? `<span class="tree-note">${inline(e.note)}</span>` : ""
  return `<${tag} class="tree-row" style="--d:${depth}">${chevron}${icon}<span class="tree-label"><span>${name}${elided}</span>${said}${note}</span></${tag}>`
}

function list(entries: Entry[], depth: number, base: string, foldBelow: number, lone = false): string {
  const items = entries.map((e) => {
    // a lone top folder's path is empty, and so its entries' start from it
    const path = lone ? "" : e.more ? undefined : base + e.name + (e.dir ? "/" : "")
    const attrs = [
      `class="tree-entry ${e.more ? "tree-more" : e.dir ? "tree-dir" : "tree-file"}"`,
      path !== undefined ? `data-path="${escapeHtml(path)}"` : "",
      e.mark ? `data-mark="${e.mark}"` : "",
      e.dir && !e.children.length ? "data-empty" : "",
    ]
      .filter(Boolean)
      .join(" ")
    if (!e.dir) return `<li ${attrs}>${row(e, depth)}</li>`
    const folded = e.folded || depth >= foldBelow
    const inner = e.children.length ? list(e.children, depth + 1, path ?? "", foldBelow) : ""
    return `<li ${attrs}><details${folded ? "" : " open"}>${row(e, depth)}${inner}</details></li>`
  })
  return `<ul class="tree-list" style="--d:${depth}">${items.join("")}</ul>`
}

/**
 * A tree's figure. Paths are from inside its top folder when it has only
 * one, so quartz/content/ and my-site/content/ are both content/.
 */
export function treeHtml(source: string, meta?: string | null): string {
  const top = parseTree(source)
  if (!top.length) return ""
  const caption = /title=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(meta ?? "")?.slice(1).find(Boolean)
  const openTo = /\bopen=(\d+)/.exec(meta ?? "")?.[1]
  const foldBelow = openTo === undefined ? Infinity : Number(openTo)
  const lone = top.length === 1 && top[0].dir
  const cap = caption ? `<figcaption class="tree-title">${escapeHtml(caption)}</figcaption>` : ""
  return `<figure class="tree">${cap}${list(top, 0, "", foldBelow, lone)}</figure>`
}

export function remarkTree() {
  return (tree: Root) => {
    visit(tree, "code", (node: Code, index, parent) => {
      if (!parent || index === undefined || node.lang?.toLowerCase() !== "tree") return
      parent.children[index] = { type: "html", value: treeHtml(node.value, node.meta) } satisfies Html
    })
  }
}
