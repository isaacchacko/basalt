// Mounts Basalt's islands: the site's islands/<name>.{tsx,ts,jsx,js}, each
// bundled by Vite (so React-or-Preact is fetched once however many a page has),
// mounted into its <div class="island" data-island="name">. A module's default
// export is a component (Preact, or React through preact/compat), rendered, or
// hydrated over the markup rendered at build time; or it exports
// mount(el, props) and does what it likes with el, returning how to unmount.
//
// Editing an island in dev hot-swaps it: a component keeps its state (Preact's
// fast refresh), anything else is unmounted and mounted again in place.
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

function liveHtml(signal: AbortSignal) {
  const frames = document.querySelectorAll<HTMLIFrameElement>("iframe.island-html")
  if (!frames.length) return
  frames.forEach((frame) => frame.addEventListener("load", () => sendTheme(frame), { signal }))
  onTheme(() => frames.forEach(sendTheme), signal)
}

export function startIslands(signal: AbortSignal) {
  for (const el of document.querySelectorAll<HTMLElement>(".island[data-island], [data-island-frame]")) {
    const name = el.dataset.island!
    const running = hot.mounted.get(el)
    // the same page again, after a hot swap of something else: leave it be
    if (running && !running.signal.aborted && hot.live.get(name) === versionOf(name)) continue
    running?.abort()
    const mine = new AbortController()
    hot.mounted.set(el, mine)
    signal.addEventListener("abort", () => {
      mine.abort()
      hot.mounted.delete(el)
    })
    schedule(el, mine.signal)
  }
  liveHtml(signal)
}
