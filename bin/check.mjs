// basalt check: build the site and read every page for what's broken.
//
//   broken links     an internal link, image, video, audio, pdf or frame
//                    whose target isn't in the build
//   missing embeds   an ![[embed]] or island Basalt couldn't find
//   orphans          notes nothing links to (a warning)
//
// Each problem names the note it's in (the file you edit). --json prints
// them as JSON for an agent. Exits 1 when anything is broken.

import fs from "node:fs"
import path from "node:path"
import { fromHtml } from "hast-util-from-html"
import { visit } from "unist-util-visit"
import { toString } from "hast-util-to-string"

export function check(dist, notes) {
  const pages = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.name.endsWith(".html")) pages.push(abs)
    }
  }
  walk(dist)
  const exists = (url) => {
    const p = decodeURIComponent(url.split(/[?#]/)[0])
    if (p === "/" || p === "") return fs.existsSync(path.join(dist, "index.html"))
    const base = path.join(dist, p)
    return [base, `${base}.html`, path.join(base, "index.html")].some((f) => fs.existsSync(f))
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
    visit(article, "element", (node) => {
      const cls = [node.properties?.className ?? []].flat()
      if (cls.includes("embed-missing") || cls.includes("transclude-missing")) {
        problems.push({ kind: "missing embed", note, detail: toString(node).trim().slice(0, 160) })
      }
      for (const attr of ["href", "src", "data"]) {
        const url = node.properties?.[attr]
        if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) continue
        if (attr === "href" && node.tagName !== "a") continue
        if (url.startsWith("/basalt/") || url.startsWith("/_astro/") || url.startsWith("/static/")) continue
        linkedTo.add(decodeURIComponent(url.split(/[?#]/)[0]).replace(/^\//, "") || "index")
        if (!exists(url)) problems.push({ kind: "broken link", note, detail: `${node.tagName} ${attr}=${url}` })
      }
    })
  }
  for (const [slug, note] of notes) {
    if (slug !== "index" && !linkedTo.has(slug)) problems.push({ kind: "orphan", note, detail: "nothing links here", warning: true })
  }
  return problems
}

export function report(problems, json) {
  if (json) return console.log(JSON.stringify(problems, null, 2))
  const errors = problems.filter((p) => !p.warning)
  for (const p of problems) console.log(`${p.warning ? "warn " : "error"}  ${p.note}  ${p.kind}: ${p.detail}`)
  console.log(`${errors.length} broken, ${problems.length - errors.length} warnings`)
}
