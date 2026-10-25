// Compare blocks (src/markdown/compare.ts): columns side by side, partners
// level. In the page a block reaches across the side content for room, and
// its columns stand side by side when they fit, stacked when they don't.
// Anchored blocks (the same ^name in two columns) start level: the column
// that's ahead waits, with space, for the other. Lines inside code don't
// open gaps in the page; they line up in the reader.
//
// The reader is Basalt's viewer, which takes the block in itself (a live
// embed). There each column scrolls on its own and the others follow, so
// that what's level with an anchor in one is level with its partner in the
// rest: between anchors they move in proportion. With no room for columns
// (a phone) the reader shows one at a time, and switching keeps the place.
//
// Hovering an anchored block (or line) lights its partners.

import { PATHS, icon, button } from "./embeds"
import { toggleViewer, viewerButton } from "./viewer"

/** room kept clear of the side content's right edge, as code reach keeps (codereach.ts) */
const SIDE_PAD = 16
/** in the reader, how far down a column its reading line is */
const READING_LINE = 0.3
/** how far either side of a pair, in column heights, the columns keep it level */
const HOLD = 0.35
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
      if (el === line) el.dataset.compareLine = ""
    }
  }
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
 * matched by path joins only where it fits between those.
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
      const row = found.map((f) => f[key].get(name))
      if (row.some((el) => !el)) continue
      if (fits(row as Row)) rows.push(row as Row)
    }
  }
  add("written")
  add("paths")
  return rows.sort((a, b) => (before(a[0], b[0]) ? -1 : 1))
}

/** Where `el` starts in `column`'s content, from its top. */
const offsetIn = (el: HTMLElement, column: HTMLElement) =>
  el.getBoundingClientRect().top - column.getBoundingClientRect().top + column.scrollTop

function makeGap(): HTMLElement {
  const gap = document.createElement("div")
  gap.className = "compare-gap"
  gap.setAttribute("aria-hidden", "true")
  return gap
}

/**
 * Inline, side by side: each row of partners starts level, the ones ahead
 * waiting with a gap before them (a block, or an entry in a tree). A line in
 * code doesn't open a gap in its block: those rows wait for the reader.
 */
function level(figure: HTMLElement, columns: HTMLElement[], rows: Row[]) {
  for (const gap of figure.querySelectorAll(".compare-gap")) gap.remove()
  if (columns.length < 2 || columns[0].offsetTop !== columns[1].offsetTop) return
  for (const row of rows) {
    if (row.some((el) => el.dataset.compareLine !== undefined)) continue
    const gaps = row.map((el) => {
      const gap = makeGap()
      el.before(gap)
      return gap
    })
    // an empty gap lets the margins around it collapse as before; one with a
    // height doesn't, which moves its block a little further: measured again
    const top = () => row.map((el) => el.getBoundingClientRect().top)
    const target = Math.max(...top())
    top().forEach((t, i) => (gaps[i].style.height = `${target - t}px`))
    top().forEach((t, i) => {
      const h = parseFloat(gaps[i].style.height)
      if (h > 0) gaps[i].style.height = `${Math.max(0, h - (t - target))}px`
    })
  }
}

/** Beside the side content, a top-level block takes its width too. */
function reach(figure: HTMLElement) {
  figure.style.removeProperty("--compare-width")
  if (document.documentElement.dataset.margin !== "beside" || figure.parentElement?.tagName !== "ARTICLE") return
  const side = document.querySelector<HTMLElement>("aside.margin")
  if (!side) return
  const width = side.getBoundingClientRect().right - SIDE_PAD - figure.getBoundingClientRect().left
  if (width > figure.offsetWidth) figure.style.setProperty("--compare-width", `${Math.floor(width)}px`)
}

// ---------- the reader ----------

/**
 * `y` (a point in column `from`'s content) in column `to`'s, through the
 * partners. Near a pair (within `hold` of it) the columns move together, so
 * the pair stays level while it's read; the difference in length between
 * two pairs is taken up in the stretch between them.
 */
function carry(y: number, from: number, to: number, rows: Row[], columns: HTMLElement[], hold: number): number {
  const a = columns[from]
  const b = columns[to]
  const knots: [number, number][] = [[0, 0]]
  for (const row of rows) {
    const k: [number, number] = [offsetIn(row[from], a), offsetIn(row[to], b)]
    if (k[0] > knots.at(-1)![0] && k[1] >= knots.at(-1)![1]) knots.push(k)
  }
  knots.push([Math.max(a.scrollHeight, knots.at(-1)![0] + 1), Math.max(b.scrollHeight, knots.at(-1)![1])])
  for (let i = 1; i < knots.length; i++) {
    const [x0, y0] = knots[i - 1]
    const [x1, y1] = knots[i]
    if (y > x1) continue
    const band = Math.min(hold, (x1 - x0) / 3, (y1 - y0) / 3)
    if (y - x0 <= band) return y0 + (y - x0)
    if (x1 - y <= band) return y1 - (x1 - y)
    return y0 + band + ((y - x0 - band) / (x1 - x0 - 2 * band)) * (y1 - y0 - 2 * band)
  }
  return knots.at(-1)![1]
}

/** In the reader: columns that follow the one being read, and on a phone, one at a time. */
function reader(figure: HTMLElement, columns: HTMLElement[], rows: Row[]): () => void {
  const ctrl = new AbortController()
  const { signal } = ctrl
  let driver = columns[0]
  let follow = 0
  const line = (c: HTMLElement) => c.clientHeight * READING_LINE
  const carryTo = (y: number, from: number, to: number) => carry(y, from, to, rows, columns, columns[from].clientHeight * HOLD)
  const followFrom = (lead: HTMLElement) => {
    const from = columns.indexOf(lead)
    const y = lead.scrollTop + line(lead)
    columns.forEach((c, to) => {
      if (c === lead) return
      c.scrollTop = carryTo(y, from, to) - line(c)
    })
  }
  for (const column of columns) {
    const lead = () => (driver = column)
    for (const type of ["pointerenter", "wheel", "touchstart", "focusin", "keydown"])
      column.addEventListener(type, lead, { signal, passive: true })
    column.addEventListener(
      "scroll",
      () => {
        if (column !== driver || !column.isConnected) return
        cancelAnimationFrame(follow)
        follow = requestAnimationFrame(() => followFrom(column))
      },
      { signal, passive: true },
    )
  }

  // one column at a time: a switch over them, which keeps the place
  const tabs = document.createElement("div")
  tabs.className = "compare-tabs"
  const show = (i: number, keep = true) => {
    const from = columns.findIndex((c) => c.dataset.active !== undefined)
    const y = from >= 0 && keep ? carryTo(columns[from].scrollTop + line(columns[from]), from, i) : 0
    columns.forEach((c, j) => {
      c.toggleAttribute("data-active", j === i)
      tabs.children[j]?.setAttribute("aria-pressed", String(j === i))
    })
    driver = columns[i]
    columns[i].scrollTop = y - line(columns[i])
  }
  columns.forEach((c, i) => {
    const tab = document.createElement("button")
    tab.type = "button"
    tab.textContent = c.dataset.label || `Column ${i + 1}`
    tab.addEventListener("click", () => show(i), { signal })
    tabs.append(tab)
  })
  figure.prepend(tabs)
  show(0, false)

  return () => {
    ctrl.abort()
    cancelAnimationFrame(follow)
    tabs.remove()
    for (const c of columns) delete c.dataset.active
  }
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

function startBlock(figure: HTMLElement, signal: AbortSignal) {
  const columns = columnsOf(figure)
  resolveLines(figure)
  const rows = partners(columns)
  hoverPartners(figure, rows, signal)

  const actions = document.createElement("span")
  actions.className = "code-actions compare-actions"
  const full = button("code-action compare-full", "full screen", icon(PATHS.expand, 16))
  full.addEventListener("click", () => toggleViewer(figure), { signal })
  viewerButton(full, figure, signal, 16)
  actions.append(full)
  figure.dataset.quietControls = ""
  figure.append(actions)

  let closeReader: (() => void) | undefined
  let frame = 0
  const sizes = new Map<Element, number>()
  const lay = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (closeReader) return
      reach(figure)
      level(figure, columns, rows)
      for (const c of columns) for (const kid of c.children) sizes.set(kid, kid.getBoundingClientRect().height)
    })
  }
  // what changes heights: the block's width, anything in a column growing
  // (an image arriving, code wrapping); not the gaps, which this makes
  let width = 0
  const ro = new ResizeObserver((entries) => {
    const moved = entries.some((e) =>
      e.target === figure
        ? Math.abs(figure.offsetWidth - width) > 0.5
        : Math.abs((sizes.get(e.target) ?? -1) - e.target.getBoundingClientRect().height) > 0.5,
    )
    width = figure.offsetWidth
    if (moved) lay()
  })
  ro.observe(figure)
  for (const c of columns) for (const kid of c.children) if (!kid.classList.contains("compare-gap")) ro.observe(kid)
  document.addEventListener("margin:placed", lay, { signal })
  addEventListener("resize", lay, { signal })
  document.fonts?.ready.then(() => !signal.aborted && lay())

  figure.addEventListener(
    "basalt:viewer",
    (e) => {
      const open = (e as CustomEvent<{ open: boolean }>).detail.open
      if (open && !closeReader) {
        for (const gap of figure.querySelectorAll(".compare-gap")) gap.remove()
        figure.style.removeProperty("--compare-width")
        figure.dataset.reader = ""
        closeReader = reader(figure, columns, rows)
      } else if (!open && closeReader) {
        closeReader()
        closeReader = undefined
        delete figure.dataset.reader
        lay()
      }
    },
    { signal },
  )
  signal.addEventListener("abort", () => {
    ro.disconnect()
    cancelAnimationFrame(frame)
    closeReader?.()
    actions.remove()
  })
  lay()
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
