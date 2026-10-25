// Drawing a garden's graph with isaacchacko/graph's renderer, for the graph
// in the side content (graph.ts) and the whole garden on ⌘G (gardengraph.ts):
// the notes and their links, in the page's theme, a node going to its note.

import { navigate } from "astro:transitions/client"
import { GraphRenderer } from "graph/packages/graph-view/src/renderer"
import type { GraphData, Theme } from "graph/packages/graph-view/src/types"

export type Note = { id: string; title: string; links: string[] }

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function pageTheme(): Theme {
  return {
    background: null,
    node: cssVar("--graph-node", cssVar("--gray", "#888")),
    link: cssVar("--graph-link", cssVar("--lightgray", "#ddd")),
    text: cssVar("--graph-text", cssVar("--darkgray", "#333")),
    accent: cssVar("--graph-accent", cssVar("--tertiary", "#c84")),
    fontFamily: cssVar("--bodyFont", "system-ui, sans-serif"),
  }
}

/** A note's folder is a note too: blog/post hangs off blog. */
const folderOf = (slug: string) => slug.replace(/\/?[^/]+$/, "").replace(/^$/, "")

/** The notes within `depth` links of `here`, either way; every note when depth < 0. */
export function neighbourhood(notes: Note[], here: string, depth: number): GraphData {
  const ids = new Set(notes.map((n) => n.id))
  const resolve = (slug: string) =>
    ids.has(slug) ? slug : ids.has(`${slug}/index`) ? `${slug}/index` : null
  const links: { source: string; target: string }[] = []
  const seen = new Set<string>()
  const add = (source: string, target: string) => {
    const key = [source, target].sort().join("\u0000")
    if (source === target || seen.has(key)) return
    seen.add(key)
    links.push({ source, target })
  }
  for (const n of notes) {
    for (const to of n.links) {
      const target = resolve(to.replace(/#.*$/, ""))
      if (target) add(n.id, target)
    }
    const folder = folderOf(n.id.replace(/\/index$/, ""))
    const parent = folder ? resolve(folder) : null
    if (parent && n.id !== parent) add(parent, n.id)
  }
  let keep = ids
  if (depth >= 0) {
    keep = new Set([here])
    let frontier = new Set([here])
    for (let i = 0; i < depth; i++) {
      const next = new Set<string>()
      for (const l of links) {
        if (frontier.has(l.source) && !keep.has(l.target)) next.add(l.target)
        if (frontier.has(l.target) && !keep.has(l.source)) next.add(l.source)
      }
      next.forEach((s) => keep.add(s))
      frontier = next
    }
  }
  const accent = cssVar("--secondary", "#2f4a5a")
  return {
    nodes: notes
      .filter((n) => keep.has(n.id))
      .map((n) => ({
        id: n.id,
        label: n.title,
        ...(n.id === here ? { color: accent, size: 1.6 } : {}),
      })),
    links: links.filter((l) => keep.has(l.source) && keep.has(l.target)),
  }
}

export const hrefOf = (slug: string) => "/" + slug.replace(/(^|\/)index$/, "")

/** A renderer in `el` that keeps to the page's theme and goes to a clicked note. */
export function draw(el: HTMLElement, data: () => GraphData, signal: AbortSignal, small: boolean, onGo?: () => void) {
  const renderer = new GraphRenderer(el, {
    mode: "select",
    arrows: false,
    // in the margin, nodes sit closer and their labels are set larger, so
    // the graph reads at a column's width
    textSize: small ? 1.5 : 1,
    ...(small ? { forces: { centerForce: 0.4, repelForce: 10, linkForce: 1, linkDistance: 90 } } : {}),
    nodeSize: 1,
    // a graph in the margin is small: keep its labels at the zoom it starts at
    textFadeThreshold: -2,
    theme: pageTheme(),
  })
  renderer.setData(data())
  // for a site's own scripts (and tests): the element knows its renderer
  ;(el as HTMLElement & { graph?: GraphRenderer }).graph = renderer
  renderer.on("nodeClick", ({ id }) => {
    onGo?.()
    navigate(hrefOf(id))
  })
  // this note's colour is the theme's too: the nodes keep their places
  const retheme = () => {
    renderer.setOptions({ theme: pageTheme() })
    renderer.setData(data())
  }
  const themes = new MutationObserver(retheme)
  themes.observe(document.documentElement, { attributes: true, attributeFilter: ["saved-theme", "data-theme", "class", "style"] })
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", retheme, { signal })
  document.addEventListener("themechange", retheme, { signal })
  const destroy = () => {
    themes.disconnect()
    renderer.destroy()
  }
  signal.addEventListener("abort", destroy, { once: true })
  return destroy
}

