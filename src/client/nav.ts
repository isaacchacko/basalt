// The navbar's explorer. The navbar persists across page transitions, so
// this marks the note you're on and opens the folders it's in on each page,
// keeps each folder the way the reader left it (localStorage, in Quartz's
// "fileTree" format), and runs the phone's drawer. Opening and folding the
// navbar by pointer and keyboard is css (nav.scss); a touch screen wide
// enough for the desktop drawer opens it with a tap, here.

type FolderState = { path: string; collapsed: boolean }
const KEY = "fileTree"
const root = document.documentElement

function load(): Map<string, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]") as FolderState[]
    return new Map(saved.map((s) => [s.path, s.collapsed]))
  } catch {
    return new Map()
  }
}

function save(state: Map<string, boolean>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...state].map(([path, collapsed]) => ({ path, collapsed }))))
  } catch {}
}

const currentSlug = () => document.body.dataset.slug ?? "index"

/** Mark the current note, open what it's in, and apply each folder's saved state. */
function sync() {
  const explorer = document.querySelector<HTMLElement>(".explorer")
  if (!explorer) return
  const slug = currentSlug()
  const folder = slug.replace(/(^|\/)index$/, "")
  const state = load()
  const fallbackCollapsed = explorer.dataset.collapsed !== "open"
  for (const a of explorer.querySelectorAll<HTMLAnchorElement>(".explorer-ul li > a")) {
    a.classList.toggle("active", a.dataset.for === slug)
  }
  for (const box of explorer.querySelectorAll<HTMLElement>(".folder-container")) {
    const path = box.dataset.folderpath!
    const dir = path.replace(/\/index$/, "")
    box.classList.toggle("active", path === slug)
    const holdsCurrent = folder === dir || folder.startsWith(dir + "/")
    const collapsed = state.get(path) ?? fallbackCollapsed
    box.nextElementSibling?.classList.toggle("open", holdsCurrent || !collapsed)
  }
}

function toggleFolder(icon: Element) {
  const box = icon.closest<HTMLElement>(".folder-container")
  const outer = box?.nextElementSibling
  if (!box || !outer) return
  const open = outer.classList.toggle("open")
  drawBarSoon()
  const state = load()
  state.set(box.dataset.folderpath!, !open)
  save(state)
}

function toggleExplorer(button: Element) {
  const explorer = button.closest<HTMLElement>(".explorer")
  if (!explorer) return
  const collapsed = explorer.classList.toggle("collapsed")
  explorer.setAttribute("aria-expanded", String(!collapsed))
  button.setAttribute("aria-expanded", String(!collapsed))
  // the phone's drawer: the page under it doesn't scroll
  if (button.classList.contains("mobile-explorer")) root.classList.toggle("mobile-no-scroll", !collapsed)
}

document.addEventListener("click", (e) => {
  const target = e.target as Element
  const icon = target.closest?.(".explorer .folder-icon")
  if (icon) {
    e.preventDefault()
    toggleFolder(icon)
    return
  }
  const toggle = target.closest?.(".explorer .explorer-toggle")
  if (toggle) toggleExplorer(toggle)
})

/** On a phone the drawer starts shut. */
function shutDrawer() {
  const explorer = document.querySelector<HTMLElement>(".explorer")
  const menu = explorer?.querySelector<HTMLElement>(".mobile-explorer")
  if (explorer && menu?.checkVisibility()) {
    explorer.classList.add("collapsed")
    explorer.setAttribute("aria-expanded", "false")
    root.classList.remove("mobile-no-scroll")
  }
}

// ---------- the folded bar: a map of the navbar's entries ----------

// Folded (layout.nav "bar"), the navbar is a thin bar down its strip: dotted
// where no entry is, dark where an entry's text is, ember where the page
// you're on is. Each segment is that entry's line, measured where it sits in
// the open layout: folded, the entries are only moved sideways and faded, so
// their heights are the open ones.
const ENTRIES = ".page-title a, .explorer-content a"

function drawBar() {
  const nav = navbar()
  const bar = nav?.querySelector<HTMLElement>(".nav-bar")
  if (!nav || !bar || !bar.checkVisibility()) return
  const top = nav.getBoundingClientRect().top
  const segments: HTMLElement[] = []
  for (const a of nav.querySelectorAll<HTMLAnchorElement>(ENTRIES)) {
    const current = a.classList.contains("active") || !!a.closest(".folder-container.active")
    // an entry counts only where it shows: inside the explorer's scroll, and
    // inside every folder it's in (a shut folder shows none of it; one
    // opening, what's opened so far)
    let shownFrom = -Infinity
    let shownTo = Infinity
    for (let box = a.parentElement?.closest<HTMLElement>(".folder-outer, .explorer-content"); box; box = box.parentElement?.closest<HTMLElement>(".folder-outer, .explorer-content")) {
      if (box.matches(".folder-outer:not(.open)")) shownTo = -Infinity
      const r = box.getBoundingClientRect()
      shownFrom = Math.max(shownFrom, r.top)
      shownTo = Math.min(shownTo, r.bottom)
    }
    for (const line of a.getClientRects()) {
      const from = Math.max(line.top, shownFrom)
      const to = Math.min(line.bottom, shownTo)
      if (to - from < 2) continue
      const seg = document.createElement("span")
      seg.className = current ? "nav-bar-seg is-current" : "nav-bar-seg"
      // the line's glyphs, not its leading
      const inset = Math.min(3, (to - from) / 6)
      seg.style.top = `${from - top + inset}px`
      seg.style.height = `${to - from - inset * 2}px`
      segments.push(seg)
    }
  }
  bar.replaceChildren(...segments)
}

let barFrame = 0
const drawBarSoon = () => {
  cancelAnimationFrame(barFrame)
  barFrame = requestAnimationFrame(drawBar)
}
// what moves the entries: the page (its current entry), the window, a folder
// opening or closing (its list grows over 0.3s: redrawn as it goes), fonts
addEventListener("resize", drawBarSoon)
document.fonts?.ready.then(drawBarSoon)
const barWatch = new ResizeObserver(drawBarSoon)
let watched: Element | null = null
function watchBar() {
  const list = navbar()?.querySelector(".explorer-content > ul")
  if (list && list !== watched) {
    if (watched) barWatch.unobserve(watched)
    barWatch.observe(list)
    watched = list
  }
  drawBarSoon()
}
document.addEventListener("transitionend", (e) => {
  if ((e.target as Element).closest?.(".sidebar.left .folder-outer")) drawBarSoon()
})

// a tap on the folded navbar's strip opens it; a tap anywhere else, or a page
// it took you to, folds it again
const navbar = () => document.querySelector<HTMLElement>(".sidebar.left")
document.addEventListener("pointerdown", (e) => {
  const nav = navbar()
  if (!nav || e.pointerType === "mouse" || !matchMedia("(min-width: 1000px)").matches) return
  nav.classList.toggle("is-open", nav.contains(e.target as Node))
})

document.addEventListener("astro:page-load", () => {
  sync()
  shutDrawer()
  navbar()?.classList.remove("is-open")
  watchBar()
})

// the browser forgets what's hovered while a page is swapped in, for about
// 300ms: a navbar open under the pointer stays open through it, until the
// pointer next moves (and :hover, or its absence, takes over)
document.addEventListener("astro:before-swap", () => {
  const nav = navbar()
  if (!nav?.matches(":hover")) return
  nav.classList.add("is-held")
  document.addEventListener("pointermove", () => nav.classList.remove("is-held"), { once: true })
})
// before the swapped-in page paints, so the explorer never shows the last page's state
document.addEventListener("astro:after-swap", () => {
  sync()
  drawBarSoon()
})

// a navbar kept across transitions is the old page's: if the site's tree
// changed meanwhile (a note added, a title edited), take the new page's
document.addEventListener("astro:before-swap", (e) => {
  const old = document.querySelector<HTMLElement>(".sidebar.left[data-tree]")
  const next = e.newDocument.querySelector<HTMLElement>(".sidebar.left[data-tree]")
  if (old && next && old.dataset.tree !== next.dataset.tree) old.removeAttribute("data-astro-transition-persist")
})

export {}
