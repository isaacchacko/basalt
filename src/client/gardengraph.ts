// ⌘G (ctrl+G): the whole garden as a graph, on the whole screen. Every note
// and its links, and the files they use (pictures, sounds, pdfs…), this page
// marked; a click on a note goes there, one on a file plays or opens it, and
// pointing at a file shows it in the corner. "Files" in the bar hides them.
// ⌘G again, escape or a click outside the graph closes it. The renderer loads
// the first time it's asked for.

import type { FileKind } from "./graphdraw"
import { needSheets } from "./sheets"

type Index = Record<string, { title?: string; links?: string[]; files?: string[] }>
type Note = { id: string; title: string; links: string[]; files: string[] }

let notes: Promise<Note[]> | null = null
const load = () =>
  (notes ??= fetch("/static/contentIndex.json")
    .then((r) => r.json() as Promise<Index>)
    .then((index) =>
      Object.entries(index)
        .filter(([slug]) => !slug.startsWith("tags/"))
        .map(([slug, d]) => ({ id: slug, title: d.title ?? slug, links: d.links ?? [], files: d.files ?? [] })),
    ))

const KIND_WORDS: Record<FileKind, string> = {
  image: "pictures",
  sound: "sounds",
  video: "videos",
  pdf: "pdfs",
  code: "code",
  data: "data",
  file: "other files",
}
const SHOW_FILES = "basalt:graph-files"
const wantFiles = () => {
  try {
    return sessionStorage.getItem(SHOW_FILES) !== "off"
  } catch {
    return true
  }
}
const keepWant = (on: boolean) => {
  try {
    sessionStorage.setItem(SHOW_FILES, on ? "on" : "off")
  } catch {}
}

let open: (() => void) | null = null

async function show() {
  const [{ draw, neighbourhood, kindOf, kindColour, isFile, FILE }, all] = await Promise.all([import("./graphdraw"), load(), needSheets(["gardengraph"])])
  const dialog = document.createElement("dialog")
  dialog.className = "garden-graph"
  dialog.setAttribute("aria-label", "the garden, as a graph")
  const bar = document.createElement("div")
  bar.className = "garden-graph-bar"
  const title = document.querySelector(".page-title")?.textContent?.trim() || "The garden"
  bar.innerHTML = `<span class="garden-graph-title"></span><span class="garden-graph-count"></span><span class="garden-graph-key"></span><button type="button" class="garden-graph-files" aria-pressed="true">files</button><span class="garden-graph-hint">⌘G or esc to close</span>`
  bar.querySelector(".garden-graph-title")!.textContent = title
  const files = [...new Set(all.flatMap((n) => n.files))]
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  bar.querySelector(".garden-graph-count")!.textContent =
    plural(all.length, "note", "notes") + (files.length ? ` · ${plural(files.length, "file", "files")}` : "")
  // the colours of the kinds of file there are
  const key = bar.querySelector<HTMLElement>(".garden-graph-key")!
  for (const kind of new Set(files.map(kindOf))) {
    const item = document.createElement("span")
    item.className = "garden-graph-kind"
    item.style.setProperty("--kind", kindColour(kind))
    item.textContent = KIND_WORDS[kind]
    key.append(item)
  }
  const toggle = bar.querySelector<HTMLButtonElement>(".garden-graph-files")!
  toggle.hidden = !files.length
  let showFiles = wantFiles()
  const canvas = document.createElement("div")
  canvas.className = "garden-graph-canvas"
  // pointing at a file: it, in the corner
  const peek = document.createElement("div")
  peek.className = "garden-graph-peek"
  peek.hidden = true
  dialog.append(bar, canvas, peek)
  document.body.append(dialog)
  dialog.showModal()

  const ctrl = new AbortController()
  const here = document.body.dataset.slug ?? "index"
  const data = () => neighbourhood(all, here, -1, showFiles)
  const showPeek = (id: string | null) => {
    if (!id || !isFile(id)) return void (peek.hidden = true)
    const slug = id.slice(FILE.length)
    const kind = kindOf(slug)
    const src = "/" + encodeURI(slug)
    const name = decodeURIComponent(slug.split("/").pop() ?? slug)
    peek.replaceChildren()
    if (kind === "image") {
      const img = document.createElement("img")
      img.src = src
      img.alt = ""
      peek.append(img)
    }
    const line = document.createElement("p")
    const what = kind === "sound" ? "click to play" : kind === "image" || kind === "pdf" ? "click to view" : "click to open"
    line.innerHTML = `<span class="garden-graph-peek-name"></span> <span class="garden-graph-peek-what"></span>`
    line.querySelector(".garden-graph-peek-name")!.textContent = name
    line.querySelector(".garden-graph-peek-what")!.textContent = what
    peek.append(line)
    peek.style.setProperty("--kind", kindColour(kind))
    peek.hidden = false
  }
  draw(canvas, data, ctrl.signal, false, () => dialog.close(), showPeek)
  const setFiles = (on: boolean) => {
    showFiles = on
    keepWant(on)
    toggle.setAttribute("aria-pressed", String(on))
    key.hidden = !on
    peek.hidden = true
    ;(canvas as HTMLElement & { graph?: { setData(d: unknown): void } }).graph?.setData(data())
  }
  setFiles(showFiles)
  toggle.addEventListener("click", () => setFiles(!showFiles))
  const shut = () => dialog.close()
  open = shut
  dialog.addEventListener("click", (e) => e.target === dialog && shut())
  dialog.addEventListener("close", () => {
    ctrl.abort()
    dialog.remove()
    open = null
  })
  document.addEventListener("astro:before-swap", shut, { once: true })
}

document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "g") return
  const t = e.target as HTMLElement | null
  if (t?.closest?.("input, textarea, [contenteditable]") && !open) return
  e.preventDefault()
  if (open) open()
  else void show()
})

export {}
