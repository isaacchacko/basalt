// Mounts Basalt's islands: the site's islands/<name>.{tsx,ts,jsx,js}, each
// bundled by Vite (so React-or-Preact is fetched once however many a page has),
// mounted into its <div class="island" data-island="name">. A module's default
// export is a component (Preact, or React through preact/compat), rendered, or
// hydrated over the markup rendered at build time; or it exports
// mount(el, props) and does what it likes with el, returning how to unmount.
//
// Editing an island in dev hot-swaps it: a component keeps its state (Preact's
// fast refresh), anything else is unmounted and mounted again in place. A note
// or component swapped in while writing (hotswap.ts) keeps the page's mounted
// islands, and their state, where the new page has the same island with the
// same props: the live element is carried into the new page.
//
// Also: live html blocks (iframe.island-html) take the page's colours and
// grow to fit what's in them.

import { onTheme } from "./embeds"

type Unmount = (() => void) | void
type IslandModule = {
  default?: unknown
  mount?: (el: HTMLElement, props: object, opts: { hydrate?: boolean }) => Unmount | Promise<Unmount>
}

const found = import.meta.glob<IslandModule>(["@site/islands/*.{tsx,ts,jsx,js}", "!@site/islands/*.test.*"])
const islands = new Map(Object.entries(found).map(([file, load]) => [file.split("/").pop()!.replace(/\.\w+$/, ""), load]))

// ---- hot swaps (dev) ----
// A changed island's module comes back with a new ?t= in its import. One that
// takes the update itself (a Preact component, through fast refresh) keeps its
// state, and its island is left alone; anything else reaches this module,
// whose new copy mounts again just the islands whose code changed.
type Hot = {
  /** every island on the page, and how to stop it */
  mounted: Map<HTMLElement, AbortController>
  /** island name -> the hot-swap time of the code its islands are running */
  live: Map<string, number>
}
const hot: Hot = (import.meta.hot?.data as Partial<Hot> | undefined)?.mounted
  ? (import.meta.hot!.data as Hot)
  : { mounted: new Map(), live: new Map() }
if (import.meta.hot) {
  Object.assign(import.meta.hot.data, hot)
  import.meta.hot.on("vite:afterUpdate", (payload: { updates: { path: string; acceptedPath: string; timestamp: number }[] }) => {
    for (const u of payload.updates) {
      // swapped in place, by the island's module itself
      if (u.path === u.acceptedPath && islands.has(nameOf(u.path))) hot.live.set(nameOf(u.path), u.timestamp)
    }
  })
}
// ---- islands carried through a hot swap (dev) ----
const PERSIST = "data-astro-transition-persist"
/** islands moving to the next page with their state: the old page's end leaves them running */
const carried = new WeakSet<HTMLElement>()
/** islands carried into this page: they run the newest code already (hot-updated in place) */
const arrived = new WeakSet<HTMLElement>()
const islandKeys = (root: ParentNode) => {
  const keys = new Map<string, HTMLElement>()
  const count = new Map<string, number>()
  for (const el of root.querySelectorAll<HTMLElement>(".island[data-island]")) {
    const base = `${el.dataset.island}\u0000${el.dataset.islandProps ?? ""}`
    const n = count.get(base) ?? 0
    count.set(base, n + 1)
    keys.set(`${base}\u0000${n}`, el)
  }
  return keys
}
if (import.meta.hot) {
  document.addEventListener("astro:before-swap", (e) => {
    if (!window.basaltHotSwap) return
    const next = islandKeys(e.newDocument)
    let i = 0
    for (const [key, el] of islandKeys(document)) {
      const running = hot.mounted.get(el)
      const twin = next.get(key)
      if (!twin || !running || running.signal.aborted || el.dataset.islandMounted !== "true") continue
      // Astro's swap moves the old element into the new page in its twin's place
      const id = `basalt-island-${i++}`
      el.setAttribute(PERSIST, id)
      twin.setAttribute(PERSIST, id)
      carried.add(el)
      arrived.add(el)
    }
  })
  document.addEventListener("astro:after-swap", () => {
    for (const el of document.querySelectorAll<HTMLElement>(`.island[${PERSIST}^="basalt-island-"]`)) el.removeAttribute(PERSIST)
  })
}
/** stop the island when the page goes, unless it's carried to the next one */
const tied = new WeakMap<AbortSignal, WeakSet<HTMLElement>>()
function tie(signal: AbortSignal, el: HTMLElement, mine: AbortController) {
  const set = tied.get(signal) ?? new WeakSet()
  tied.set(signal, set)
  if (set.has(el)) return
  set.add(el)
  signal.addEventListener("abort", () => {
    if (carried.has(el)) return void carried.delete(el)
    mine.abort()
    hot.mounted.delete(el)
  })
}

function nameOf(file: string) {
  return file.split("?")[0].split("/").pop()!.replace(/\.\w+$/, "")
}
/** when this copy of the module's import of the island was last swapped (0: never) */
const versionOf = (name: string) => Number(/[?&]t=(\d+)/.exec(String(islands.get(name)))?.[1] ?? 0)

async function mountIsland(el: HTMLElement, signal: AbortSignal) {
  if (el.dataset.islandMounted === "true" || signal.aborted) return
  const name = el.dataset.island!
  const load = islands.get(name)
  if (!load) return console.error(`basalt: no island called "${name}" (islands/${name}.tsx, say)`)
  el.dataset.islandMounted = "true"
  hot.live.set(name, versionOf(name))
  // a frame page (<island frame>) carries the props in its address
  let props: object = {}
  try {
    const raw = el.dataset.islandProps ?? (el.hasAttribute("data-island-frame") ? decodeURIComponent(location.hash.slice(1)) : "")
    props = raw ? JSON.parse(raw) : {}
  } catch (err) {
    console.error(`basalt: island "${name}" has props that aren't json`, err)
  }
  // build-time markup is hydrated, once: after a hot swap it's rendered afresh
  const hydrate = el.dataset.islandSsr === "true" && !el.dataset.islandRendered
  el.dataset.islandRendered = "true"
  try {
    const mod = await load()
    if (signal.aborted) return
    let unmount: Unmount
    if (typeof mod.mount === "function") {
      unmount = await mod.mount(el, props, { hydrate })
    } else if (typeof mod.default === "function") {
      const preact = await import("preact")
      const vnode = preact.h(mod.default as preact.ComponentType, props)
      if (hydrate) preact.hydrate(vnode, el)
      else {
        el.replaceChildren()
        preact.render(vnode, el)
      }
      unmount = () => preact.render(null, el)
    } else {
      throw new Error("its module exports neither a default component nor mount(el, props)")
    }
    const stop = () => {
      delete el.dataset.islandMounted
      if (typeof unmount === "function") unmount()
    }
    if (signal.aborted) stop()
    else signal.addEventListener("abort", stop)
  } catch (err) {
    // the fallback, or the build-time render, stays where it is
    delete el.dataset.islandMounted
    console.error(`basalt: island "${name}" didn't mount`, err)
  }
}

function schedule(el: HTMLElement, signal: AbortSignal) {
  const load = el.dataset.islandLoad
  if (load === "eager" || el.hasAttribute("data-island-frame")) return void mountIsland(el, signal)
  if (load === "idle") {
    const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 200))
    return void idle(() => mountIsland(el, signal))
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect()
        mountIsland(el, signal)
      }
    },
    { rootMargin: "200px" },
  )
  io.observe(el)
  signal.addEventListener("abort", () => io.disconnect())
}

// ---- live html blocks ----

const THEME_VARS = [
  "--light",
  "--lightgray",
  "--gray",
  "--darkgray",
  "--dark",
  "--secondary",
  "--tertiary",
  "--highlight",
  "--bodyFont",
  "--codeFont",
]

function theme(): Record<string, string> {
  const style = getComputedStyle(document.documentElement)
  return Object.fromEntries(THEME_VARS.map((v) => [v, style.getPropertyValue(v)]))
}

const sendTheme = (frame: HTMLIFrameElement) => frame.contentWindow?.postMessage({ basaltTheme: theme() }, "*")

window.addEventListener("message", (e) => {
  const height = e.data?.basaltHeight
  if (typeof height !== "number") return
  for (const frame of document.querySelectorAll<HTMLIFrameElement>("iframe.island-html")) {
    if (frame.contentWindow === e.source && !frame.style.height) frame.style.minHeight = `${Math.ceil(height)}px`
  }
})

function liveHtml(signal: AbortSignal, root: ParentNode) {
  const frames = root.querySelectorAll<HTMLIFrameElement>("iframe.island-html")
  if (!frames.length) return
  frames.forEach((frame) => frame.addEventListener("load", () => sendTheme(frame), { signal }))
  onTheme(() => frames.forEach(sendTheme), signal)
}

/**
 * A frame page (<island frame>) takes its page's light or dark, so the frame
 * isn't a white box on a dark page (or a dark one on a light page). Its css is
 * otherwise its own.
 */
function followParentTheme(signal: AbortSignal) {
  let parentRoot: HTMLElement
  try {
    if (window.parent === window) return
    parentRoot = window.parent.document.documentElement
  } catch {
    return // another origin's page: it can't be asked
  }
  const root = document.documentElement
  const copy = () => {
    for (const attr of ["saved-theme", "data-theme", "class"]) {
      const v = parentRoot.getAttribute(attr)
      if (v === null) root.removeAttribute(attr)
      else root.setAttribute(attr, v)
    }
    root.style.colorScheme = getComputedStyle(parentRoot).colorScheme || "normal"
  }
  copy()
  const watch = new MutationObserver(copy)
  watch.observe(parentRoot, { attributes: true, attributeFilter: ["saved-theme", "data-theme", "class", "style"] })
  signal.addEventListener("abort", () => watch.disconnect())
}

export function startIslands(signal: AbortSignal, root: ParentNode = document) {
  if (root === document && document.querySelector("[data-island-frame]")) followParentTheme(signal)
  for (const el of root.querySelectorAll<HTMLElement>(".island[data-island], [data-island-frame]")) {
    const name = el.dataset.island!
    const running = hot.mounted.get(el)
    // the same page again, after a hot swap of something else (or an island
    // carried into this page by one): leave it be
    if (running && !running.signal.aborted && (arrived.has(el) || hot.live.get(name) === versionOf(name))) {
      arrived.delete(el)
      tie(signal, el, running)
      continue
    }
    running?.abort()
    const mine = new AbortController()
    hot.mounted.set(el, mine)
    tie(signal, el, mine)
    schedule(el, mine.signal)
  }
  liveHtml(signal, root)
}
