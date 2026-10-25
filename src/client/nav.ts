// The navbar's explorer. The navbar persists across page transitions, so
// this marks the note you're on and opens the folders it's in on each page,
// keeps each folder the way the reader left it (localStorage, in Quartz's
// "fileTree" format), and runs the phone's drawer. Opening and folding the
// navbar itself is css (nav.scss).

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

document.addEventListener("astro:page-load", () => {
  sync()
  shutDrawer()
})
// before the swapped-in page paints, so the explorer never shows the last page's state
document.addEventListener("astro:after-swap", sync)

// a navbar kept across transitions is the old page's: if the site's tree
// changed meanwhile (a note added, a title edited), take the new page's
document.addEventListener("astro:before-swap", (e) => {
  const old = document.querySelector<HTMLElement>(".sidebar.left[data-tree]")
  const next = e.newDocument.querySelector<HTMLElement>(".sidebar.left[data-tree]")
  if (old && next && old.dataset.tree !== next.dataset.tree) old.removeAttribute("data-astro-transition-persist")
})

export {}
