// Does each note's article render the markup the Quartz build did? Fetches
// every page that has a reference (the Quartz build's html) from a running
// dev server, reduces both <article>s to an outline (tags, classes, ids, data
// attributes, links and text; hrefs made root-absolute), and diffs them.
//
//   node --experimental-strip-types src/markdown/parity.ts \
//     [--server http://localhost:4331] [--ref <dir of reference html>] [--out <dir>] [page...]
//
// Prints how many outline lines differ per page; the diffs go to --out.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fromHtml } from "hast-util-from-html"
import type { Element, ElementContent, Root } from "hast"

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const server = arg("--server", "http://localhost:4331")
const refDir = arg("--ref", path.join(os.homedir(), "Artifacts/2026-10-25/basalt-astro/reference"))
const outDir = arg("--out", path.join(os.tmpdir(), "basalt-parity"))
const flags = new Set(["--server", "--ref", "--out"])
const only = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !flags.has(all[i - 1]))

// the reference files are named for their slug with / as -; only sources/ has a folder here
const urlOf = (name: string) => (name === "index" ? "/" : "/" + (name.startsWith("sources-") ? name.replace(/^sources-/, "sources/") : name))

function article(html: string): Root {
  const start = html.search(/<article\b/)
  const end = html.lastIndexOf("</article>")
  if (start < 0 || end < 0) throw new Error("no <article>")
  const inner = html.slice(html.indexOf(">", start) + 1, end)
  return fromHtml(inner, { fragment: true })
}

const KEEP = /^(id|class|href|src|data-.*|role|aria-.*|title|alt|width|height|style|type|tabindex|controls|loop|muted|autoplay|playsinline|preload|poster|loading|decoding|sandbox|allow|allowfullscreen|referrerpolicy|target|rel|srcdoc|viewbox)$/i

function attrs(el: Element, page: string): string {
  const out: string[] = []
  // hast keeps properties camelCased; turn them back into attribute names
  for (const [key, raw] of Object.entries(el.properties)) {
    let name = key === "className" ? "class" : key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())
    if (name.startsWith("data-astro")) continue
    if (!KEEP.test(name)) continue
    if (name === "class") continue
    let value = Array.isArray(raw) ? raw.join(" ") : raw === true ? "" : String(raw)
    if (value === "true") value = ""
    if (["href", "src", "data-pdf", "data-pdfjs", "data-island-src"].includes(name)) {
      if (!/^[a-z]+:/i.test(value) && !value.startsWith("#") && !value.startsWith("/")) {
        const url = new URL(value, "https://x" + (page === "/" ? "/" : page))
        value = url.pathname + url.hash
      }
    }
    if (name === "style") value = value.replace(/\s*;\s*$/, "").replace(/\s*([:;])\s*/g, "$1")
    if (name === "srcdoc" || name === "d" || name === "data-graph") value = `#${value.length}`
    out.push(value === "" ? name : `${name}=${JSON.stringify(value)}`)
  }
  return out.sort().join(" ")
}

function outline(root: Root, page: string): string[] {
  const lines: string[] = []
  const walk = (nodes: (ElementContent | Root["children"][number])[], depth: number) => {
    for (const node of nodes) {
      if (node.type === "text") {
        const text = node.value.replace(/\s+/g, " ").trim()
        if (text) lines.push("  ".repeat(depth) + JSON.stringify(text))
      } else if (node.type === "element") {
        const classes = ((node.properties.className ?? []) as string[]).slice().sort()
        const a = attrs(node, page)
        lines.push("  ".repeat(depth) + node.tagName + classes.map((c) => "." + c).join("") + (a ? " " + a : ""))
        // inside svgs (graphviz, katex's, graph's) only the svg itself is compared
        if (node.tagName !== "svg") walk(node.children, depth + 1)
      }
    }
  }
  walk(root.children, 0)
  return lines
}

/** The note's own article: Page.astro's title heading isn't part of the note. */
function dropTitle(root: Root): Root {
  const first = root.children.findIndex((n) => n.type === "element")
  const node = root.children[first]
  if (node?.type === "element" && node.tagName === "h1") root.children.splice(first, 1)
  return root
}

fs.mkdirSync(outDir, { recursive: true })
const names = fs
  .readdirSync(refDir)
  .filter((f) => f.endsWith(".html"))
  .map((f) => f.replace(/\.html$/, ""))
  .filter((n) => !only.length || only.includes(n))

let total = 0
for (const name of names) {
  const page = urlOf(name)
  const ref = outline(article(fs.readFileSync(path.join(refDir, name + ".html"), "utf8")), page)
  const res = await fetch(server + page)
  let ours: string[]
  try {
    ours = outline(dropTitle(article(await res.text())), page)
  } catch (err) {
    console.log(`${name.padEnd(22)} ${res.status} ${(err as Error).message}`)
    total += ref.length
    continue
  }
  const a = path.join(outDir, name + ".quartz.txt")
  const b = path.join(outDir, name + ".astro.txt")
  fs.writeFileSync(a, ref.join("\n") + "\n")
  fs.writeFileSync(b, ours.join("\n") + "\n")
  let diff = ""
  try {
    execFileSync("diff", ["-u", a, b], { encoding: "utf8" })
  } catch (err) {
    diff = (err as { stdout: string }).stdout
  }
  fs.writeFileSync(path.join(outDir, name + ".diff"), diff)
  const changed = diff.split("\n").filter((l) => /^[-+][^-+]/.test(l) || /^[-+]$/.test(l)).length
  total += changed
  console.log(`${name.padEnd(22)} ${res.status} ${String(changed).padStart(4)} lines differ (of ${ref.length})`)
}
console.log(`total ${total}; diffs in ${outDir}`)
