// Basalt's pdf viewer: a pdf's pages, stacked and fit to the column's width
// (or, full screen, each whole page to the screen), under one slim bar: page,
// zoom, full screen, the browser's own viewer at this page, download. Its text
// is a real text layer, so it can be selected and found. pdf.js is fetched only
// when a pdf scrolls near; pages far from view give their canvases back. Without
// this script the <object> it replaces stays, with its link.
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { button as makeButton, icon, toggleFullscreen } from "./embeds"

const ico = (d: string) => icon(d, 16, 2)
const ICONS = {
  prev: ico('<path d="M15 6l-6 6 6 6"/>'),
  next: ico('<path d="M9 6l6 6-6 6"/>'),
  out: ico('<path d="M5 12h14"/>'),
  in: ico('<path d="M12 5v14M5 12h14"/>'),
  fit: ico('<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>'),
  full: ico('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  open: ico('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  download: ico('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
}

type PdfJs = typeof import("pdfjs-dist")
let pdfjs: Promise<PdfJs> | null = null
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = workerUrl
    return lib
  })
  return pdfjs
}

const button = (cls: string, label: string, svg: string) => makeButton(`pdf-button ${cls}`, label, svg)

function link(cls: string, label: string, svg: string, href: string, download?: string) {
  const a = document.createElement("a")
  a.className = `pdf-button ${cls}`
  a.href = href
  a.setAttribute("aria-label", label)
  a.title = label
  a.innerHTML = svg
  a.dataset.noPopover = "true"
  a.dataset.astroReload = ""
  if (download !== undefined) a.setAttribute("download", download)
  else {
    a.target = "_blank"
    a.rel = "noopener"
  }
  return a
}

// a canvas this many pixels or more is drawn smaller and scaled up: a page at
// 400% on a retina screen would otherwise take hundreds of megabytes
const MAX_PIXELS = 16_000_000
const PAD = 16

type Page = {
  n: number
  box: HTMLDivElement
  /** its size at scale 1, once known (until then, the first page's) */
  base?: { width: number; height: number }
  /** the scale its canvas was drawn at, 0 if it has none */
  drawn: number
  task?: RenderTask
  text?: "building" | "built"
}

async function mount(viewer: HTMLElement, signal: AbortSignal) {
  if (viewer.dataset.ready) return
  viewer.dataset.ready = "loading"
  const url = new URL(viewer.dataset.pdf!, location.href).href
  const name = viewer.dataset.pdfName ?? "document.pdf"
  let lib: PdfJs
  let doc: PDFDocumentProxy
  try {
    lib = await loadPdfJs()
    doc = await lib.getDocument({ url }).promise
  } catch (err) {
    // the <object> and its link stay
    console.error("basalt: the pdf viewer couldn't open", url, err)
    viewer.dataset.ready = "failed"
    return
  }
  if (signal.aborted) return void doc.destroy()
  signal.addEventListener("abort", () => doc.destroy())

  // ---- the viewer's parts ----
  const stage = document.createElement("div")
  stage.className = "pdf-stage"
  stage.tabIndex = 0
  stage.setAttribute("aria-label", `${name}, ${doc.numPages} pages`)
  const pagesBox = document.createElement("div")
  pagesBox.className = "pdf-pages"
  stage.append(pagesBox)

  const bar = document.createElement("div")
  bar.className = "pdf-bar"
  const prev = button("pdf-prev", "previous page", ICONS.prev)
  const next = button("pdf-next", "next page", ICONS.next)
  const pageInput = document.createElement("input")
  pageInput.className = "pdf-page-input"
  pageInput.inputMode = "numeric"
  pageInput.setAttribute("aria-label", "page")
  const total = document.createElement("span")
  total.className = "pdf-total"
  total.textContent = `/ ${doc.numPages}`
  const zoomOut = button("pdf-zoom-out", "zoom out", ICONS.out)
  const zoomLabel = document.createElement("span")
  zoomLabel.className = "pdf-zoom"
  const zoomIn = button("pdf-zoom-in", "zoom in", ICONS.in)
  const fit = button("pdf-fit", "fit to width", ICONS.fit)
  const full = button("pdf-full", "full screen (f)", ICONS.full)
  const open = link("pdf-open", "open in the browser's viewer", ICONS.open, url)
  const down = link("pdf-download", "download", ICONS.download, url, name)
  const group = (...kids: HTMLElement[]) => {
    const g = document.createElement("div")
    g.className = "pdf-group"
    g.append(...kids)
    return g
  }
  bar.append(group(prev, pageInput, total, next), group(zoomOut, zoomLabel, zoomIn, fit), group(full, open, down))
  const fallback = [...viewer.childNodes]
  viewer.replaceChildren(stage, bar)
  viewer.dataset.ready = "true"
  signal.addEventListener("abort", () => {
    viewer.replaceChildren(...fallback)
    delete viewer.dataset.ready
  })

  // ---- pages: placeholders sized to each page, drawn when near view ----
  const first = await doc.getPage(1)
  const firstBase = first.getViewport({ scale: 1 })
  const cache = new Map<number, Promise<PDFPageProxy>>([[1, Promise.resolve(first)]])
  const getPage = (n: number) => {
    if (!cache.has(n)) cache.set(n, doc.getPage(n))
    return cache.get(n)!
  }
  const figure = viewer.closest("figure") ?? viewer
  const fullscreen = () => document.fullscreenElement === figure
  let zoom = 1 // on top of fitting
  /** full screen fits the whole page to the screen; in the column, the width */
  const fitScale = () => {
    const w = (stage.clientWidth - PAD * 2) / firstBase.width
    if (!fullscreen()) return w
    return Math.min(w, (stage.clientHeight - PAD * 2) / firstBase.height)
  }
  const scale = () => fitScale() * zoom
  const pages: Page[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const box = document.createElement("div")
    box.className = "pdf-page"
    box.dataset.page = String(n)
    pagesBox.append(box)
    pages.push({ n, box, drawn: 0, base: n === 1 ? firstBase : undefined })
  }
  const sizeOne = (p: Page, s = scale()) => {
    const base = p.base ?? firstBase
    p.box.style.width = `${base.width * s}px`
    p.box.style.height = `${base.height * s}px`
    p.box.style.setProperty("--total-scale-factor", String(s))
  }
  const size = () => {
    const s = scale()
    for (const p of pages) sizeOne(p, s)
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`
    fit.title = fullscreen() ? "fit the page" : "fit to width"
    fit.setAttribute("aria-label", fit.title)
  }

  const buildText = async (p: Page, page: PDFPageProxy) => {
    if (p.text) return
    p.text = "building"
    const layer = document.createElement("div")
    layer.className = "textLayer"
    try {
      const text = new lib.TextLayer({
        textContentSource: page.streamTextContent(),
        container: layer,
        viewport: page.getViewport({ scale: 1 }),
      })
      await text.render()
      if (signal.aborted) return
      // pdf.js sizes the layer from --total-scale-factor, so a zoom only
      // changes that variable, not the layer
      p.box.append(layer)
      p.text = "built"
    } catch {
      p.text = undefined
    }
  }

  const draw = async (p: Page) => {
    const s = scale()
    if (p.drawn === s || signal.aborted) return
    p.drawn = s
    p.task?.cancel()
    const page = await getPage(p.n)
    if (!p.base) {
      p.base = page.getViewport({ scale: 1 })
      sizeOne(p)
    }
    const ratio = Math.min(devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / (p.base.width * p.base.height * s * s)))
    const viewport = page.getViewport({ scale: s * ratio })
    const canvas = document.createElement("canvas")
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const task = page.render({ canvas, viewport })
    p.task = task
    try {
      await task.promise
      if (p.drawn !== s) return
      p.box.querySelector("canvas")?.remove()
      p.box.prepend(canvas)
      buildText(p, page)
    } catch {
      // cancelled by a newer draw, or freed
    }
  }

  /** a page far from view gives its canvas's memory back */
  const free = (p: Page) => {
    if (!p.drawn) return
    p.task?.cancel()
    p.drawn = 0
    const canvas = p.box.querySelector("canvas")
    if (canvas) {
      canvas.width = canvas.height = 0
      canvas.remove()
    }
  }

  const near = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) draw(pages[Number((e.target as HTMLElement).dataset.page) - 1])
    },
    { root: stage, rootMargin: "600px 0px" },
  )
  const kept = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (!e.isIntersecting) free(pages[Number((e.target as HTMLElement).dataset.page) - 1])
    },
    { root: stage, rootMargin: "2400px 0px" },
  )
  pages.forEach((p) => {
    near.observe(p.box)
    kept.observe(p.box)
  })
  signal.addEventListener("abort", () => {
    near.disconnect()
    kept.disconnect()
  })

  // the browser's find needs every page's text, not just the drawn ones':
  // build the rest when the page is idle
  if (doc.numPages <= 300) {
    const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 300))
    const rest = async () => {
      for (const p of pages) {
        if (signal.aborted) return
        if (p.text) continue
        await buildText(p, await getPage(p.n))
        await new Promise((r) => idle(r))
      }
    }
    idle(() => rest())
  }

  // ---- where you are ----
  // the page you're on, as of the last scroll you made: a relayout (a zoom,
  // full screen) keeps it the page you're on
  let anchor = Number(viewer.dataset.page) || 1
  let width = 0
  let height = 0
  const current = () => {
    const mid = stage.scrollTop + stage.clientHeight / 3
    let n = 1
    for (const p of pages) if (p.box.offsetTop <= mid) n = p.n
    return n
  }
  // a smooth scroll to a page: until it ends, the page is the one it's going to
  let gliding = false
  const showPage = () => {
    // a scroll the browser made while the stage changed size isn't you moving
    if (!gliding && stage.clientWidth === width && stage.clientHeight === height) anchor = current()
    paint()
  }
  const paint = () => {
    if (document.activeElement !== pageInput) pageInput.value = String(anchor)
    prev.disabled = anchor <= 1
    next.disabled = anchor >= doc.numPages
    open.href = `${url}#page=${anchor}`
  }
  const goTo = (n: number, smooth = true) => {
    n = Math.min(Math.max(n, 1), doc.numPages)
    const target = pages[n - 1]
    // full screen, a page sits in the middle of the screen; in the column, at the top
    const top = fullscreen()
      ? target.box.offsetTop - Math.max(PAD, (stage.clientHeight - target.box.offsetHeight) / 2)
      : target.box.offsetTop - PAD
    anchor = n
    const to = Math.max(0, Math.min(top, stage.scrollHeight - stage.clientHeight))
    gliding = smooth && Math.abs(stage.scrollTop - to) > 1
    stage.scrollTo({ top: to, behavior: gliding ? "smooth" : "instant" })
    paint()
  }
  const rezoom = (z: number) => {
    width = stage.clientWidth
    height = stage.clientHeight
    zoom = Math.min(Math.max(z, 0.5), 4)
    size()
    pages.forEach((p) => {
      // redraw what's in view now; the rest when it comes near
      if (Math.abs(p.n - anchor) <= 1) draw(p)
      else free(p)
    })
    goTo(anchor, false)
  }

  rezoom(1)

  stage.addEventListener("scroll", showPage, { passive: true, signal })
  stage.addEventListener("scrollend", () => (gliding = false), { signal })
  prev.addEventListener("click", () => goTo(anchor - 1), { signal })
  next.addEventListener("click", () => goTo(anchor + 1), { signal })
  pageInput.addEventListener(
    "change",
    () => {
      goTo(Number(pageInput.value) || 1)
      stage.focus({ preventScroll: true })
    },
    { signal },
  )
  zoomIn.addEventListener("click", () => rezoom(zoom * 1.25), { signal })
  zoomOut.addEventListener("click", () => rezoom(zoom / 1.25), { signal })
  fit.addEventListener("click", () => rezoom(1), { signal })
  full.addEventListener("click", () => toggleFullscreen(figure), { signal })
  // into full screen and out: fit again, at the page you were on
  document.addEventListener("fullscreenchange", () => rezoom(1), { signal })
  // the page fits whatever it's in: the column, or the whole screen
  const resize = new ResizeObserver(() => {
    if (stage.clientWidth === width && (stage.clientHeight === height || !fullscreen())) return
    rezoom(zoom)
  })
  resize.observe(stage)
  signal.addEventListener("abort", () => resize.disconnect())

  // keys work anywhere in the viewer, a bar button just clicked included
  viewer.addEventListener(
    "keydown",
    (e) => {
      if (e.target === pageInput || e.metaKey || e.ctrlKey || e.altKey) return
      const keys: Record<string, () => void> = {
        ArrowRight: () => goTo(anchor + 1),
        ArrowLeft: () => goTo(anchor - 1),
        PageDown: () => goTo(anchor + 1),
        PageUp: () => goTo(anchor - 1),
        Home: () => goTo(1),
        End: () => goTo(doc.numPages),
        "+": () => rezoom(zoom * 1.25),
        "=": () => rezoom(zoom * 1.25),
        "-": () => rezoom(zoom / 1.25),
        "0": () => rezoom(1),
        f: () => toggleFullscreen(figure),
      }
      const act = keys[e.key]
      if (!act) return
      e.preventDefault()
      act()
    },
    { signal },
  )
  viewer.addEventListener("pointerdown", () => (viewer.dataset.pointer = ""), { signal })
  viewer.addEventListener("keydown", () => delete viewer.dataset.pointer, { signal, capture: true })
  // a click on the bar leaves the keys with the pages, not the button
  bar.addEventListener(
    "click",
    (e) => {
      if ((e.target as Element).closest("button") && e.detail > 0) stage.focus({ preventScroll: true })
    },
    { signal },
  )
}

export function startPdfs(signal: AbortSignal) {
  const viewers = document.querySelectorAll<HTMLElement>(".pdf-viewer[data-pdf]")
  if (!viewers.length) return
  const soon = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        soon.unobserve(e.target)
        mount(e.target as HTMLElement, signal)
      }
    },
    { rootMargin: "400px 0px" },
  )
  viewers.forEach((v) => soon.observe(v))
  signal.addEventListener("abort", () => soon.disconnect())
}
