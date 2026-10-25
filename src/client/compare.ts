// Compare blocks (src/markdown/compare.ts): columns side by side, stacked
// when there isn't room. Partners (the same ^name in two columns) start
// level: the column that's ahead waits with a gap, above the block (and the
// sentence leading into it) or above the line. No gap ever opens before a
// column's first content: the columns start at the top together, and a pair
// that would need a gap there is left out (basalt check says so).
//
// Beside the side content a block reaches across it. Its full-screen control
// flips the page: the navbar, the side content and the rest of the note fold
// away and the block spans the page, scrolled by the page's own scrollbar.
// The control again, or Escape, flips back, keeping your place.
//
// Pointing at one of a pair lights both.

import { PATHS, icon, button, still } from "./embeds"

/** room kept clear of the side content's right edge, as code reach keeps (codereach.ts) */
const SIDE_PAD = 16
/** how far down the window the place kept across a flip is */
const READING_LINE = 0.3
// link previews show a copy of another note: its compare blocks stay as they are
const ELSEWHERE = ".margin-preview, .margin-hover, .popover"

type Row = HTMLElement[]

const columnsOf = (figure: HTMLElement) =>
  [...figure.querySelectorAll<HTMLElement>(":scope > .compare-columns > .compare-column")]

/** `^name=N` / `^name=/text/` on a fence: onto its N-th line, or the first one with the text. */
function resolveLines(figure: HTMLElement) {
  for (const block of figure.querySelectorAll<HTMLElement>("[data-compare-lines]")) {
    const anchors: [string, string][] = JSON.parse(block.dataset.compareLines!)
    const lines = [...block.querySelectorAll<HTMLElement>("[data-line]")]
    for (const [name, at] of anchors) {
      const text = at.startsWith("/") ? at.slice(1, -1).replace(/\\(.)/g, "$1") : undefined
      const line = text === undefined ? lines[Number(at) - 1] : lines.find((l) => l.textContent?.includes(text))
      // a tree's line is its entry's name: the entry is what lines up
      const entry = line?.closest<HTMLElement>("li")
      const el = entry && block.contains(entry) ? entry : line
      if (!el || el.dataset.compareAnchor) continue
      el.dataset.compareAnchor = name
    }
  }
  // a line waits on its own, with code above it; a block's first line waits with its block
  for (const line of figure.querySelectorAll<HTMLElement>("[data-line][data-compare-anchor]"))
    if (line.closest("pre")?.querySelector("[data-line]") !== line) line.dataset.compareLine = ""
}

/** A block with the sentence that leads into it ("…on the page:") before it: they move as one. */
function leadOf(el: HTMLElement): HTMLElement {
  let lead = el
  while (lead.previousElementSibling?.matches("p:not(.compare-label)") && lead.previousElementSibling.textContent!.trimEnd().endsWith(":"))
    lead = lead.previousElementSibling as HTMLElement
  return lead
}

/** Where an anchor's gap goes: before a line itself; before a block's lead-in, a block's first line's being its block's. */
function gapPoint(el: HTMLElement): HTMLElement {
  if (el.dataset.compareLine !== undefined) return el
  return leadOf(el.matches("[data-line]") ? el.closest<HTMLElement>(".compare-column > *")! : el)
}

/** Nothing of the column's (but its label) comes before `point`. */
function atStart(point: HTMLElement, column: HTMLElement): boolean {
  const range = document.createRange()
  const label = column.querySelector(":scope > .compare-label")
  if (label) range.setStartAfter(label)
  else range.setStart(column, 0)
  range.setEndBefore(point)
  return !range.toString().trim()
}

/** Each column's anchors, by name, first one wins: what's written, then trees' entries by path. */
function anchorsOf(column: HTMLElement) {
  const written = new Map<string, HTMLElement>()
  for (const el of column.querySelectorAll<HTMLElement>("[data-compare-anchor]"))
    if (!written.has(el.dataset.compareAnchor!)) written.set(el.dataset.compareAnchor!, el)
  const paths = new Map<string, HTMLElement>()
  for (const el of column.querySelectorAll<HTMLElement>("[data-path]"))
    if (el.dataset.path && !paths.has(el.dataset.path)) paths.set(el.dataset.path, el)
  return { written, paths }
}

const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

/**
 * Partners across every column, top to bottom: a name in every column, in
 * the same order in each. What the author wrote is kept first; a tree's entry
 * matched by path joins only where it fits between those. A pair at the start
 * of one column and not another would need a gap there, and is left out.
 */
function partners(columns: HTMLElement[]): Row[] {
  if (columns.length < 2) return []
  const found = columns.map(anchorsOf)
  const rows: Row[] = []
  const fits = (row: Row) =>
    rows.every((r) => {
      const ahead = before(r[0], row[0])
      return row.every((el, i) => before(r[i], el) === ahead && r[i] !== el)
    })
  const add = (key: "written" | "paths") => {
    for (const name of found[0][key].keys()) {
      const row = found.map((f) => f[key].get(name)) as Row
      if (row.some((el) => !el)) continue
      const starts = row.map((el, i) => atStart(gapPoint(el), columns[i]))
      if (starts.some(Boolean) && !starts.every(Boolean)) continue
      if (fits(row)) rows.push(row)
    }
  }
  add("written")
  add("paths")
  return rows.sort((a, b) => (before(a[0], b[0]) ? -1 : 1))
}

/** A gap before a block: its own element. Before a line: the line's top margin (code lines sit in a grid). */
function openGap(el: HTMLElement): (height: number) => void {
  if (el.dataset.compareLine !== undefined) {
    el.dataset.compareGap = ""
    return (h) => (el.style.marginTop = `${h}px`)
  }
  const gap = document.createElement("div")
  gap.className = "compare-gap"
  gap.setAttribute("aria-hidden", "true")
  gapPoint(el).before(gap)
  return (h) => (gap.style.height = `${h}px`)
}

function closeGaps(figure: HTMLElement) {
  for (const gap of figure.querySelectorAll(".compare-gap")) gap.remove()
  for (const line of figure.querySelectorAll<HTMLElement>("[data-compare-gap]")) {
    line.style.marginTop = ""
    delete line.dataset.compareGap
  }
}

/** Side by side, each row of partners starts level, the ones ahead waiting with a gap. */
function level(figure: HTMLElement, columns: HTMLElement[], rows: Row[]) {
  closeGaps(figure)
  if (columns.length < 2 || columns[0].offsetTop !== columns[1].offsetTop) return
  for (const row of rows) {
    const gaps = row.map(openGap)
    // an empty gap lets the margins around it collapse as before; one with a
    // height doesn't, which moves its block a little further: measured again
    const tops = () => row.map((el) => el.getBoundingClientRect().top)
    const target = Math.max(...tops())
    const heights = tops().map((t) => target - t)
    heights.forEach((h, i) => gaps[i](h))
    tops().forEach((t, i) => heights[i] > 0 && gaps[i](Math.max(0, heights[i] - (t - target))))
  }
}

/** Beside the side content, a top-level block takes its width too. */
function reach(figure: HTMLElement) {
  figure.style.removeProperty("--compare-width")
  if (document.documentElement.dataset.margin !== "beside" || figure.parentElement?.tagName !== "ARTICLE") return
  if (figure.hasAttribute("data-spread")) return
  const side = document.querySelector<HTMLElement>("aside.margin")
  if (!side) return
  const width = side.getBoundingClientRect().right - SIDE_PAD - figure.getBoundingClientRect().left
  if (width > figure.offsetWidth) figure.style.setProperty("--compare-width", `${Math.floor(width)}px`)
}

// ---------- each block ----------

function hoverPartners(figure: HTMLElement, rows: Row[], signal: AbortSignal) {
  const partnersOf = new Map<HTMLElement, Row>()
  for (const row of rows) for (const el of row) partnersOf.set(el, row)
  let lit: Row | undefined
  figure.addEventListener(
    "pointerover",
    (e) => {
      let row: Row | undefined
      for (let el = e.target as HTMLElement | null; el && el !== figure; el = el.parentElement)
        if ((row = partnersOf.get(el))) break
      if (row === lit) return
      lit?.forEach((el) => el.classList.remove("compare-lit"))
      row?.forEach((el) => el.classList.add("compare-lit"))
      lit = row
    },
    { signal },
  )
  figure.addEventListener("pointerleave", () => {
    lit?.forEach((el) => el.classList.remove("compare-lit"))
    lit = undefined
  }, { signal })
}

/** What's at the reading line in the block (a line, an entry, a block), and how far down the window it is. */
function placeIn(figure: HTMLElement): { el: HTMLElement; top: number } {
  const column = columnsOf(figure)[0].getBoundingClientRect()
  const hit = document.elementFromPoint(column.left + column.width / 2, innerHeight * READING_LINE)
  const el = (hit && figure.contains(hit) && hit.closest<HTMLElement>("[data-line], li, .compare-column > *")) || figure
  return { el, top: el.getBoundingClientRect().top }
}

function startBlock(figure: HTMLElement, signal: AbortSignal) {
  const columns = columnsOf(figure)
  resolveLines(figure)
  const rows = partners(columns)
  hoverPartners(figure, rows, signal)

  const sizes = new Map<Element, number>()
  const lay = () => {
    reach(figure)
    level(figure, columns, rows)
    for (const c of columns) for (const kid of c.children) sizes.set(kid, kid.getBoundingClientRect().height)
  }
  let frame = 0
  const layLater = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(lay)
  }

  const actions = document.createElement("span")
  actions.className = "code-actions compare-actions"
  const full = button("code-action compare-full", "full screen", icon(PATHS.expand, 16))
  full.setAttribute("aria-pressed", "false")
  actions.append(full)
  figure.dataset.quietControls = ""
  // first in the block's tab order, as it's first in its corner
  figure.prepend(actions)

  const spread = (on: boolean) => {
    if (on === figure.hasAttribute("data-spread")) return
    const place = placeIn(figure)
    const flip = () => {
      document.documentElement.toggleAttribute("data-compare-spread", on)
      figure.toggleAttribute("data-spread", on)
      full.innerHTML = icon(on ? PATHS.collapse : PATHS.expand, 16)
      full.setAttribute("aria-label", on ? "back to the page" : "full screen")
      full.title = on ? "back to the page (esc)" : "full screen"
      full.setAttribute("aria-pressed", String(on))
      lay()
      if (place.el === figure) figure.scrollIntoView({ block: "start", behavior: "instant" })
      else scrollBy({ top: place.el.getBoundingClientRect().top - place.top, behavior: "instant" })
    }
    if (document.startViewTransition && !still()) document.startViewTransition(flip)
    else flip()
  }
  full.addEventListener("click", () => spread(!figure.hasAttribute("data-spread")), { signal })
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !figure.hasAttribute("data-spread")) return
      e.preventDefault()
      spread(false)
      full.focus({ preventScroll: true })
    },
    { signal },
  )

  // what changes heights: the block's width, anything in a column growing
  // (an image arriving, code wrapping, a folder folding); not the gaps, which this makes
  let width = 0
  const ro = new ResizeObserver((entries) => {
    const moved = entries.some((e) =>
      e.target === figure
        ? Math.abs(figure.offsetWidth - width) > 0.5
        : Math.abs((sizes.get(e.target) ?? -1) - e.target.getBoundingClientRect().height) > 0.5,
    )
    width = figure.offsetWidth
    if (moved) layLater()
  })
  ro.observe(figure)
  for (const c of columns) for (const kid of c.children) ro.observe(kid)
  document.addEventListener("margin:placed", layLater, { signal })
  addEventListener("resize", layLater, { signal })
  document.fonts?.ready.then(() => !signal.aborted && layLater())

  signal.addEventListener("abort", () => {
    ro.disconnect()
    cancelAnimationFrame(frame)
    document.documentElement.removeAttribute("data-compare-spread")
    figure.removeAttribute("data-spread")
    actions.remove()
  })
  layLater()
}

const SIDE_OCCUPANTS = ".margin-layer > *, .margin-resting > *, .basalt-now-playing"

/** What rests in the side content beside a block that has taken its width fades until the block has passed (a preview, which was asked for, stays). */
function clearSide(signal: AbortSignal) {
  const side = document.querySelector<HTMLElement>("aside.margin")
  if (!side) return
  let frame = 0
  const check = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const wide = [...document.querySelectorAll<HTMLElement>("article > figure.compare[style*='--compare-width']")].map((f) =>
        f.getBoundingClientRect(),
      )
      for (const el of side.querySelectorAll<HTMLElement>(SIDE_OCCUPANTS)) {
        const r = el.getBoundingClientRect()
        const under = wide.some((f) => r.height && r.top < f.bottom + 8 && r.bottom > f.top - 8 && r.left < f.right)
        el.toggleAttribute("data-under-compare", under)
      }
    })
  }
  addEventListener("scroll", check, { signal, passive: true })
  addEventListener("resize", check, { signal })
  document.addEventListener("margin:placed", check, { signal })
  const mo = new MutationObserver(check)
  mo.observe(side, { childList: true, subtree: true })
  for (const figure of document.querySelectorAll("article > figure.compare"))
    mo.observe(figure, { attributes: true, attributeFilter: ["style"] })
  signal.addEventListener("abort", () => {
    mo.disconnect()
    cancelAnimationFrame(frame)
    for (const el of side.querySelectorAll("[data-under-compare]")) el.removeAttribute("data-under-compare")
  })
  check()
}

export function startCompare(signal: AbortSignal) {
  for (const figure of document.querySelectorAll<HTMLElement>("figure.compare")) {
    if (figure.closest(ELSEWHERE) || figure.querySelector(":scope > .compare-actions")) continue
    startBlock(figure, signal)
  }
  if (document.querySelector("article > figure.compare")) clearSide(signal)
}
