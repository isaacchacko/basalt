// basalt check: build the site and read every page for what's broken.
//
//   notes that failed   a note Basalt couldn't render (its frontmatter doesn't
//                       parse, say): it isn't in the build, or is a stale copy
//   broken links        an internal link, image, video, audio, pdf or frame
//                       whose target isn't in the build
//   missing embeds      an ![[embed]] Basalt couldn't find
//   unknown islands     an <island name="x"> with no islands/x.tsx (or .ts, .jsx, .js)
//   compare anchors     a ^name in a compare block with no partner, or one
//                       that crosses another: it never lines up (a warning)
//   orphans             notes nothing links to (a warning)
//
// Each problem names the note's file (the one you edit) and, where it can be
// told, the line: `notes/field-log.md:10  broken link: [[nudibranch]]: no such note`.
// --json prints them as JSON for an agent. Exits 1 when anything is broken.

import fs from "node:fs"
import path from "node:path"
import { fromHtml } from "hast-util-from-html"
import { visit } from "unist-util-visit"
import { toString } from "hast-util-to-string"

const ISLAND = /^([a-z0-9][\w-]*)\.(tsx|ts|jsx|js)$/i

/** the islands a site has: islands/<name>.{tsx,ts,jsx,js} */
export function islandNames(siteDir) {
  const dir = path.join(siteDir, "islands")
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => !f.includes(".test."))
    .map((f) => ISLAND.exec(f)?.[1])
    .filter(Boolean)
    .sort()
}

/**
 * The note a link points at, as `check`'s notes are keyed: "blog" for /blog,
 * /blog/, /blog/index and /blog/index.html alike, "index" for /.
 */
export function linkedSlug(url) {
  const p = decodeURIComponent(url.split(/[?#]/)[0])
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.html$/, "")
    .replace(/(^|\/)index$/, "")
  return p || "index"
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const loose = (s) => s.toLowerCase().replace(/\.md$/, "").replace(/[\s_]+/g, "-")

/** Where in a note's source a broken target is written: { line, source } (the [[link]] or path as written). */
export function locate(text, target) {
  const lines = text.split("\n")
  const want = loose(decodeURIComponent(target).replace(/^\//, ""))
  const last = want.split("/").pop()
  // [[x]], [[x|alias]], [[x#heading]], ![[x]]
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/!?\[\[([^\]|#^]+)[^\]]*\]\]/g)) {
      const t = loose(m[1].trim())
      if (t === want || t === last || want.endsWith("/" + t) || t.endsWith("/" + last)) return { line: i + 1, source: m[0] }
    }
  }
  // [text](x), ![alt](x), src="x"
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/!?\[[^\]]*\]\(([^)\s]+)[^)]*\)|(?:src|href|data)=["']([^"']+)["']/g)) {
      const t = loose((m[1] ?? m[2]).split(/[?#]/)[0])
      if (t.endsWith(last)) return { line: i + 1, source: m[0] }
    }
  }
  const at = lines.findIndex((l) => loose(l).includes(last))
  return { line: at < 0 ? null : at + 1, source: null }
}

/**
 * The problems in a build (dist), for the site's notes: `notes` maps each
 * note's slug to { file, abs } (file as shown, abs to read its source), and
 * `islands` names the site's islands (null: don't check them).
 *
 * @param {string} dist
 * @param {Map<string, { file: string, abs: string }>} notes
 * @param {{ islands?: string[] | null }} [opts]
 */
export function check(dist, notes, { islands = null } = {}) {
  const pages = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.name.endsWith(".html")) pages.push(abs)
    }
  }
  if (fs.existsSync(dist)) walk(dist)
  const exists = (url) => {
    const p = decodeURIComponent(url.split(/[?#]/)[0])
    if (p === "/" || p === "") return fs.existsSync(path.join(dist, "index.html"))
    const base = path.join(dist, p)
    return [base, `${base}.html`, path.join(base, "index.html")].some((f) => fs.existsSync(f))
  }
  const source = new Map()
  const textOf = (note) => {
    if (!source.has(note.abs)) source.set(note.abs, fs.existsSync(note.abs) ? fs.readFileSync(note.abs, "utf8") : "")
    return source.get(note.abs)
  }
  const problems = []
  const linkedTo = new Set()
  for (const page of pages) {
    const route = "/" + path.relative(dist, page).replace(/(^|\/)index\.html$/, "").replace(/\.html$/, "")
    const note = notes.get(route.replace(/^\//, "") || "index")
    // only notes' own pages are checked (folder, tag and 404 pages are Basalt's)
    if (!note) continue
    const tree = fromHtml(fs.readFileSync(page, "utf8"))
    let article = null
    visit(tree, "element", (node) => {
      if (!article && node.tagName === "article") article = node
    })
    if (!article) continue
    const seenIslands = new Set()
    visit(article, "element", (node) => {
      const cls = [node.properties?.className ?? []].flat()
      if (cls.includes("embed-missing") || cls.includes("transclude-missing")) {
        const detail = toString(node).trim().slice(0, 160)
        const what = /no (?:note|file) called (\S+)/.exec(detail)?.[1]
        const at = what ? locate(textOf(note), what) : { line: null }
        problems.push({ kind: "missing embed", note: note.file, line: at.line, detail })
      }
      if (node.tagName === "figure" && cls.includes("compare")) {
        for (const [name, why] of strayAnchors(node)) {
          const at = textOf(note).split("\n").findIndex((l) => new RegExp(`\\^${escape(name)}(?=[=\\s]|$)`).test(l))
          problems.push({ kind: "compare anchor", note: note.file, line: at < 0 ? null : at + 1, detail: `^${name} ${why}, ignored`, warning: true })
        }
      }
      const island = node.properties?.dataIsland
      if (islands && typeof island === "string" && !islands.includes(island) && !seenIslands.has(island)) {
        seenIslands.add(island)
        const line = (() => {
          const re = new RegExp(`<island\\b[^>]*\\bname=["']${escape(island)}["']`)
          const at = textOf(note).split("\n").findIndex((l) => re.test(l))
          return at < 0 ? null : at + 1
        })()
        // an island in a note this one embeds is that note's to report
        if (line !== null) {
          problems.push({
            kind: "unknown island",
            note: note.file,
            line,
            detail: `"${island}" (${islands.length ? `have: ${islands.join(", ")}` : "the site's islands/ folder is empty"})`,
          })
        }
      }
      for (const attr of ["href", "src", "data"]) {
        const url = node.properties?.[attr]
        if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) continue
        if (attr === "href" && node.tagName !== "a") continue
        if (url.startsWith("/basalt/") || url.startsWith("/_astro/") || url.startsWith("/static/")) continue
        linkedTo.add(linkedSlug(url))
        // and the note it names (a.internal[data-slug], "blog/index" for /blog)
        if (typeof node.properties?.dataSlug === "string") linkedTo.add(linkedSlug("/" + node.properties.dataSlug))
        if (exists(url)) continue
        const target = url.split(/[?#]/)[0]
        const at = locate(textOf(note), target)
        const isNote = node.tagName === "a" && !/\.\w+$/.test(target)
        const said = at.source ?? `${node.tagName} ${attr}=${url}`
        problems.push({
          kind: "broken link",
          note: note.file,
          line: at.line,
          detail: `${said}: ${isNote ? "no such note" : "no such file"} (${decodeURIComponent(target)})`,
        })
      }
    })
  }
  for (const [slug, note] of notes) {
    if (slug !== "index" && !linkedTo.has(slug)) problems.push({ kind: "orphan", note: note.file, line: null, detail: "nothing links here", warning: true })
  }
  return problems
}

/**
 * A compare block's written anchors that don't line up, the way the page
 * pairs them (src/client/compare.ts): a name in every column, kept in the
 * order of the first column unless it crosses one already kept.
 */
export function strayAnchors(figure) {
  const order = new Map()
  visit(figure, "element", (node) => void order.set(node, order.size))
  const columns = []
  visit(figure, "element", (node) => {
    if ([node.properties?.className ?? []].flat().includes("compare-column")) columns.push(node)
  })
  const anchorsOf = (column) => {
    // each name where it first lands in the column, as the page finds it
    const found = new Map()
    const put = (name, at) => (found.get(name) ?? Infinity) > at && found.set(name, at)
    visit(column, "element", (node) => {
      const name = node.properties?.dataCompareAnchor
      if (typeof name === "string") put(name, order.get(node))
      if (typeof node.properties?.dataCompareLines !== "string") return
      const lines = []
      visit(node, "element", (line) => void (line.properties?.dataLine !== undefined && lines.push(line)))
      for (const [name, at] of JSON.parse(node.properties.dataCompareLines)) {
        const text = at.startsWith("/") ? at.slice(1, -1).replace(/\\(.)/g, "$1") : null
        const line = text === null ? lines[Number(at) - 1] : lines.find((l) => toString(l).includes(text))
        if (line) put(name, order.get(line))
      }
    })
    return found
  }
  const found = columns.map(anchorsOf)
  const stray = []
  const kept = []
  const down = (f) => [...f].sort((a, b) => a[1] - b[1]).map(([name]) => name)
  for (const name of new Set(found.flatMap(down))) {
    const row = found.map((f) => f.get(name))
    if (row.some((at) => at === undefined)) {
      stray.push([name, "has no partner in another column"])
      continue
    }
    const crosses = kept.find((k) => !row.every((at, i) => (k.row[0] < row[0]) === (k.row[i] < at)))
    if (crosses) stray.push([name, `crosses ^${crosses.name}`])
    else kept.push({ name, row })
  }
  return stray
}

export function report(all, json) {
  // the same problem twice on one line (a link, and the same link in an embed of it) is one
  const seen = new Set()
  const problems = all.filter((p) => {
    const key = `${p.note}:${p.line}:${p.kind}:${p.detail}`
    return !seen.has(key) && seen.add(key)
  })
  if (json) return console.log(JSON.stringify(problems, null, 2))
  const errors = problems.filter((p) => !p.warning)
  for (const p of problems) {
    const where = `${p.note}${p.line ? `:${p.line}${p.col ? `:${p.col}` : ""}` : ""}`
    console.log(`${p.warning ? "warn " : "error"}  ${where}  ${p.kind}: ${p.detail}`)
  }
  console.log(`${errors.length} broken, ${problems.length - errors.length} warnings`)
}
