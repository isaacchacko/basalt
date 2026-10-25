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

// ---------- the bar: the navbar's edge, with the page you're on marked ----------

// layout.nav "bar": a thin line at the navbar's edge, folded or open, with the
// entry of the page you're on marked on it, level with that entry's text. The
// mark is one element that slides when the page changes (the navbar persists
// across pages). Entries are measured where they sit in the open layout:
// folded, they're only moved sideways and faded, so their heights are the open ones.
const ENTRIES = ".page-title a, .explorer-content a"

function drawBar() {
  const nav = navbar()
  const bar = nav?.querySelector<HTMLElement>(".nav-bar")
  if (!nav || !bar || !bar.checkVisibility()) return
  const top = nav.getBoundingClientRect().top
  let from = Infinity
  let to = -Infinity
  for (const a of nav.querySelectorAll<HTMLAnchorElement>(ENTRIES)) {
    if (!a.classList.contains("active") && !a.closest(".folder-container.active")) continue
    // it counts only where it shows: inside the explorer's scroll, and inside
    // every folder it's in (a shut folder shows none of it; one opening, what's
    // opened so far)
    let shownFrom = -Infinity
    let shownTo = Infinity
    for (let box = a.parentElement?.closest<HTMLElement>(".folder-outer, .explorer-content"); box; box = box.parentElement?.closest<HTMLElement>(".folder-outer, .explorer-content")) {
      if (box.matches(".folder-outer:not(.open)")) shownTo = -Infinity
      const r = box.getBoundingClientRect()
      shownFrom = Math.max(shownFrom, r.top)
      shownTo = Math.min(shownTo, r.bottom)
    }
    for (const line of a.getClientRects()) {
      const lineFrom = Math.max(line.top, shownFrom)
      const lineTo = Math.min(line.bottom, shownTo)
      if (lineTo - lineFrom < 2) continue
      from = Math.min(from, lineFrom)
      to = Math.max(to, lineTo)
    }
  }
  let mark = bar.querySelector<HTMLElement>(".nav-bar-seg")
  const placing = !mark
  if (!mark) {
    mark = document.createElement("span")
    mark.className = "nav-bar-seg is-placing"
    bar.replaceChildren(mark)
  }
  if (to <= from) {
    mark.classList.add("is-gone")
    return
  }
  // the text's glyphs, not its leading
  const inset = Math.min(3, (to - from) / 6)
  mark.classList.remove("is-gone")
  mark.style.top = `${from - top + inset}px`
  mark.style.height = `${to - from - inset * 2}px`
  // first placed where it is; after that it slides
  if (placing) requestAnimationFrame(() => mark.classList.remove("is-placing"))
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
  if (!nav || e.pointerType === "mouse" || !matchMedia("(min-width: 1056px)").matches) return
  nav.classList.toggle("is-open", nav.contains(e.target as Node))
})

// an explorer entry cut short by its ellipsis gives its whole name on hover
document.addEventListener("pointerover", (e) => {
  const a = (e.target as Element | null)?.closest?.<HTMLAnchorElement>(".explorer-content a")
  if (!a) return
  if (a.scrollWidth > a.clientWidth + 1) a.title = a.textContent?.trim() ?? ""
  else a.removeAttribute("title")
})

document.addEventListener("astro:page-load", () => {
  sync()
  shutDrawer()
  navbar()?.classList.remove("is-open")
  watchBar()
})

// the browser forgets what's hovered while a page is swapped in, and only
// works it out again some time after the pointer next moves: a navbar open
// under the pointer (you just clicked one of its entries) stays open through
// the navigation for as long as the pointer is over it, and folds only once
// the pointer has left it
let releaseHold: ((e: PointerEvent) => void) | null = null
const hold = () => {
  const nav = navbar()
  if (!nav) return
  nav.classList.add("is-held")
  if (releaseHold) document.removeEventListener("pointermove", releaseHold)
  releaseHold = (e: PointerEvent) => {
    const r = nav.getBoundingClientRect()
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    if (inside) return
    nav.classList.remove("is-held")
    document.removeEventListener("pointermove", releaseHold!)
    releaseHold = null
  }
  document.addEventListener("pointermove", releaseHold)
}
// held from the press on one of its entries: by the time the page is swapped
// (astro:before-swap) the view transition's overlay is already over the page,
// and whether the navbar still counts as hovered then is a race
document.addEventListener(
  "pointerdown",
  (e) => {
    const nav = navbar()
    if (e.pointerType === "mouse" && nav?.contains(e.target as Node)) hold()
  },
  { capture: true },
)
// and any navigation (a key, a link elsewhere) that starts while it's open
document.addEventListener("astro:before-preparation", () => {
  if (navbar()?.matches(":hover")) hold()
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
