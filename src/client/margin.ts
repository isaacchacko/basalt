// Basalt's margin, after Tufte: the note's sidenotes, margin notes and margin
// figures, copied out of the article into the margin column (Margin.astro),
// each level with the line it belongs to.
//
//   sidenote      `sup > a[data-footnote-ref][data-sidenote]` then `.sidenote`:
//                 beside the line its number is on
//   margin note   `.marginnote` (an `aside`, or inline): beside the first line
//                 of the block before it, or the line it's in
//   margin figure `aside.marginnote.marginfigure`: the same, image top level
//                 with the line's top
//
// Each item's first baseline sits on its line's baseline. Items never
// overlap: each goes under the one before, and never beside a block wide
// enough to reach into the margin. The graph, contents and backlinks, when a
// page has them, rest at the top of the column in whatever room the notes
// leave. Everything is measured again on resize, when fonts and images
// load, and when the page's arrival animation settles.
//
// With no room for a margin (a phone), the notes stay in the text: a
// sidenote opens under its line when its number is tapped, a margin note is
// a small aside where it was.

const GAP = 12
/** room kept above and below a block that reaches into the margin */
const BLOCKED_ABOVE = 8
const BLOCKED_BELOW = 12
/** room kept between the notes and the resting parts, and between parts */
const PART_GAP = 24

/**
 * Runs `start` for each page: on the first load, and after every navigation
 * by Astro's router. The signal aborts when the page goes, so nothing a page
 * set up outlives it.
 */
export function onPage(start: (signal: AbortSignal) => void) {
  let ctrl: AbortController | null = null
  let body: HTMLElement | null = null
  const run = () => {
    if (body === document.body) return
    ctrl?.abort()
    ctrl = new AbortController()
    body = document.body
    start(ctrl.signal)
  }
  document.addEventListener("astro:page-load", run)
  document.addEventListener("astro:before-swap", (e) => {
    // the page coming in keeps the margin as it is until its own is placed,
    // so its notes never show inline for a moment. A swap of the same page
    // (an edit while writing) keeps the notes themselves too, until then.
    const swap = e as unknown as { newDocument: Document; to: URL }
    const mode = document.documentElement.dataset.margin
    if (mode) swap.newDocument.documentElement.dataset.margin = mode
    const old = document.querySelector<HTMLElement>(".margin > .margin-layer")
    const target = swap.newDocument.querySelector(".margin")
    if (mode === "beside" && old && target && swap.to.pathname === location.pathname) {
      const keep = old.cloneNode(true) as HTMLElement
      keep.dataset.stale = ""
      target.prepend(keep)
    }
    ctrl?.abort()
    ctrl = null
    body = null
  })
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true })
  else run()
}

// ---------- measuring lines ----------

const ratios = new Map<string, number>()

/** Where the baseline sits in a glyph box of `el`'s font, as a fraction of its height. */
function baselineRatio(el: Element): number {
  const cs = getComputedStyle(el)
  const key = `${cs.fontFamily}|${cs.fontStyle}|${cs.fontWeight}`
  const known = ratios.get(key)
  if (known !== undefined) return known
  const probe = document.createElement("span")
  probe.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;line-height:normal;font-size:100px;font-family:${cs.fontFamily};font-style:${cs.fontStyle};font-weight:${cs.fontWeight}`
  const text = document.createTextNode("x")
  const mark = document.createElement("span")
  mark.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline"
  probe.append(text, mark)
  document.body.append(probe)
  const range = document.createRange()
  range.selectNodeContents(text)
  const box = range.getBoundingClientRect()
  const ratio = box.height ? (mark.getBoundingClientRect().top - box.top) / box.height : 0.8
  probe.remove()
  ratios.set(key, ratio)
  return ratio
}

export type Line = { top: number; baseline: number }

const skipped = (n: Node) =>
  !!n.parentElement?.closest(".sidenote, .marginnote, .katex-mathml, .margin-number, style, script")

/** The line a character of a text node is on. */
function lineAt(text: Text, at: number): Line | null {
  const range = document.createRange()
  range.setStart(text, at)
  range.setEnd(text, at + 1)
  const rect = range.getBoundingClientRect()
  if (!rect.height) return null
  return { top: rect.top, baseline: rect.top + baselineRatio(text.parentElement!) * rect.height }
}

const BLOCK = "p, li, dd, dt, td, th, h1, h2, h3, h4, h5, h6, blockquote, figcaption, figure, div, section, article"

/** The line the text right before `ref` ends on, in viewport px. */
export function lineBefore(ref: Element): Line {
  const block = ref.parentElement?.closest(BLOCK) ?? document.body
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let found: Line | null = null
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!(ref.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING)) break
    if (skipped(n)) continue
    const s = n.data
    let i = s.length - 1
    while (i >= 0 && /\s/.test(s[i])) i--
    if (i < 0) continue
    found = lineAt(n, i) ?? found
  }
  if (found) return found
  const r = ref.getBoundingClientRect()
  return { top: r.top, baseline: r.bottom }
}

/** The first line of text in `el`, or null when it starts with something else (an image). */
export function firstLine(el: Element): Line | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n instanceof Element) {
      if (n.matches("img, svg, video, canvas, iframe, picture")) return null
      continue
    }
    if (skipped(n)) continue
    const s = (n as Text).data
    const i = s.search(/\S/)
    if (i < 0) continue
    const line = lineAt(n as Text, i)
    if (line) return line
  }
  return null
}

/** The line of `el` the pointer is on, else its first. */
export function lineOf(el: Element, y?: number): Line {
  const rects = [...el.getClientRects()].filter((r) => r.height)
  const rect = rects.find((r) => y !== undefined && y >= r.top && y <= r.bottom) ?? rects[0]
  if (!rect) {
    const r = el.getBoundingClientRect()
    return { top: r.top, baseline: r.bottom }
  }
  // an inline box's rect is its font's glyph box
  return { top: rect.top, baseline: rect.top + baselineRatio(el) * rect.height }
}

/**
 * Where `item` (absolutely placed in `column`) should go, in column px, so
 * its first baseline sits on `line`'s; an item starting with an image puts
 * the image's top at the line's top.
 */
export function levelWith(item: HTMLElement, line: Line, column: DOMRect): number {
  const own = item.getBoundingClientRect()
  const first = firstLine(item)
  return first ? line.baseline - column.top - (first.baseline - own.top) : line.top - column.top
}

// ---------- the column ----------

export const isBeside = () => document.documentElement.dataset.margin === "beside"

/** The line a margin item belongs to. */
function anchorOf(note: HTMLElement): Line {
  const prev = note.previousElementSibling
  // a sidenote: the line its number is on, measured from the text before the number
  if (note.classList.contains("sidenote") && prev?.matches("sup")) return lineBefore(prev)
  // a block aside: the first line of the block before it
  if (getComputedStyle(note).display !== "inline" && note.matches("aside, div, figure")) {
    if (prev) return firstLine(prev) ?? lineOf(prev)
    return lineOf(note.parentElement ?? note)
  }
  // inline: the line it's in
  return lineBefore(note)
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string) {
  const node = document.createElement(tag)
  node.className = cls
  return node
}

function copyOf(note: HTMLElement): HTMLElement {
  const copy = note.cloneNode(true) as HTMLElement
  copy.classList.add("in-margin")
  copy.classList.remove("open")
  copy.removeAttribute("id")
  copy.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"))
  copy.setAttribute("aria-hidden", "true")
  return copy
}

/** A sidenote's number and the note itself light up together. */
function pair(id: string | undefined) {
  document.querySelectorAll(".is-paired").forEach((n) => n.classList.remove("is-paired"))
  if (!id) return
  document
    .querySelectorAll(`[data-sidenote="${CSS.escape(id)}"]`)
    .forEach((n) => n.classList.add("is-paired"))
}

onPage((signal) => {
  const root = document.documentElement
  const margin = document.querySelector<HTMLElement>(".margin")
  const article =
    margin?.parentElement?.querySelector<HTMLElement>(":scope > article") ??
    document.querySelector<HTMLElement>("article")
  if (!margin || !article) return

  const notes = [...article.querySelectorAll<HTMLElement>(".sidenote, .marginnote")].filter(
    (n) => !n.parentElement?.closest(".sidenote, .marginnote"),
  )
  const layer = el("div", "margin-layer")
  margin.prepend(layer)
  const copies = notes.map((note) => {
    const copy = copyOf(note)
    layer.append(copy)
    return { note, copy }
  })
  const parts = [...margin.querySelectorAll<HTMLElement>(".margin-resting > .margin-part")]

  const beside = () => {
    if (getComputedStyle(margin).display === "none") return false
    const m = margin.getBoundingClientRect()
    const prose = article.querySelector(":scope > p") ?? article
    return m.width >= 140 && m.left >= prose.getBoundingClientRect().right - 2
  }

  const reset = () => {
    for (const part of parts) part.style.top = ""
    margin.style.minHeight = ""
  }

  const place = () => {
    if (!beside()) {
      root.dataset.margin = "inline"
      reset()
      return
    }
    root.dataset.margin = "beside"
    const column = margin.getBoundingClientRect()

    // blocks wide enough to reach into the margin: nothing sits beside them
    const blocked: [number, number][] = [...article.children]
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.height && r.right > column.left + 4)
      .map((r) => [r.top - column.top - BLOCKED_ABOVE, r.bottom - column.top + BLOCKED_BELOW])
    const clear = (top: number, height: number, against: [number, number][]) => {
      for (let moved = true; moved; ) {
        moved = false
        for (const [from, to] of against) {
          if (top < to && top + height > from) {
            top = to
            moved = true
          }
        }
      }
      return top
    }

    const taken: [number, number][] = []
    let floor = -Infinity
    let lowest = 0
    for (const { note, copy } of copies) {
      const height = copy.offsetHeight
      const want = levelWith(copy, anchorOf(note), column)
      const top = clear(Math.max(want, floor), height, blocked)
      copy.style.top = `${top}px`
      copy.dataset.offset = String(Math.round(top - want))
      taken.push([top - PART_GAP, top + height + PART_GAP])
      floor = top + height + GAP
      lowest = Math.max(lowest, top + height)
    }

    // each resting part takes the first room the notes leave, from the top
    const avoid = [...blocked, ...taken]
    for (const part of parts) {
      const height = part.offsetHeight
      const top = clear(0, height, avoid)
      part.style.top = `${top}px`
      avoid.push([top - PART_GAP, top + height + PART_GAP])
      lowest = Math.max(lowest, top + height)
    }
    margin.style.minHeight = `${Math.ceil(lowest)}px`
    margin.dispatchEvent(new CustomEvent("margin:placed", { bubbles: true }))
  }

  let frame = 0
  const again = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(place)
  }
  place()
  // the notes kept from before a swap give way to these, now they're placed
  for (const stale of margin.querySelectorAll(".margin-layer[data-stale]")) stale.remove()

  // sizes that move lines: the article's, the column's width, each item's
  let width = margin.offsetWidth
  const ro = new ResizeObserver((entries) => {
    if (entries.every((e) => e.target === margin) && margin.offsetWidth === width) return
    width = margin.offsetWidth
    again()
  })
  ro.observe(article)
  ro.observe(margin)
  copies.forEach(({ copy }) => ro.observe(copy))
  parts.forEach((part) => ro.observe(part))
  signal.addEventListener("abort", () => ro.disconnect())

  addEventListener("resize", again, { signal })
  const fontsChanged = () => {
    ratios.clear()
    again()
  }
  document.fonts?.ready.then(() => !signal.aborted && fontsChanged())
  document.fonts?.addEventListener("loadingdone", fontsChanged, { signal })
  // images change heights when they arrive: a figure is measured after its image loads
  for (const img of [...article.querySelectorAll("img"), ...layer.querySelectorAll("img")])
    if (!img.complete) img.addEventListener("load", again, { signal, once: true })
  // lines measured while the page rises into place are low: measure once it settles
  article.addEventListener("animationend", again, { signal })
  article.addEventListener("transitionend", again, { signal })

  // hovering a sidenote's number, or the note, lights both
  let paired: string | undefined
  document.addEventListener(
    "pointerover",
    (e) => {
      const id = (e.target as Element).closest?.<HTMLElement>("[data-sidenote]")?.dataset.sidenote
      if (id === paired) return
      paired = id
      pair(id)
    },
    { signal },
  )

  // a sidenote is read beside the page, not by jumping to the bottom of it
  document.addEventListener(
    "click",
    (e) => {
      const ref = (e.target as Element).closest?.<HTMLAnchorElement>("a[data-footnote-ref]")
      if (!ref || e.metaKey || e.ctrlKey || !article.contains(ref)) return
      e.preventDefault()
      const id = ref.dataset.sidenote
      if (isBeside()) {
        const copy = id && layer.querySelector<HTMLElement>(`[data-sidenote="${CSS.escape(id)}"]`)
        if (copy) {
          copy.classList.remove("is-called")
          void copy.offsetWidth
          copy.classList.add("is-called")
        }
        return
      }
      // no margin: the note opens in place, under its line
      const note = ref.closest("sup")?.nextElementSibling
      if (note?.classList.contains("sidenote")) {
        const open = note.classList.toggle("open")
        ref.setAttribute("aria-expanded", String(open))
      }
    },
    // before Astro's router sees it, or it jumps to the footnote at the bottom
    { signal, capture: true },
  )

  signal.addEventListener("abort", () => {
    cancelAnimationFrame(frame)
    layer.remove()
    reset()
    pair(undefined)
    delete root.dataset.margin
  })
})
