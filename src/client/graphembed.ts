// ```graph blocks: the svg drawn at build time becomes the live graph, started
// from the same layout, so nothing jumps. Drawn by isaacchacko/graph's
// renderer, in the page's theme, and kept in it. In the viewer (its expand
// control) and back, it reframes itself to its new room.
import type { GraphData, Theme } from "@isaacchacko/graph"
import { onTheme } from "./embeds"

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

export function pageTheme(): Theme {
  return {
    background: null,
    node: cssVar("--graph-node", cssVar("--gray", "#888")),
    link: cssVar("--graph-link", cssVar("--lightgray", "#ddd")),
    text: cssVar("--graph-text", cssVar("--darkgray", "#333")),
    accent: cssVar("--graph-accent", cssVar("--tertiary", "#c84")),
    fontFamily: cssVar("--bodyFont", "system-ui, sans-serif"),
  }
}

async function drawGraph(el: HTMLElement, data: GraphData, signal: AbortSignal) {
  const { GraphRenderer } = await import("@isaacchacko/graph")
  if (signal.aborted) return
  const svg = el.querySelector(":scope > svg")
  const renderer = new GraphRenderer(el, {
    mode: "select",
    arrows: el.dataset.arrows === "true",
    // in the page the wheel scrolls past it unless it asked to zoom (```graph zoom)
    zoom: el.dataset.zoom === "true",
    // fitted into a page, a graph is drawn small: bigger labels and dots read at that size
    textSize: 1.8,
    nodeSize: 1.4,
    // a graph in a page is small: keep its labels at the zoom it starts at
    textFadeThreshold: -2,
    theme: pageTheme(),
  })
  renderer.setData(data)
  // for a site's own scripts (and tests): the element knows its renderer
  ;(el as HTMLElement & { graph?: unknown }).graph = renderer
  svg?.remove()
  onTheme(() => renderer.setOptions({ theme: pageTheme() }), signal)

  // Into the viewer and back (viewer.ts): the renderer resizes its canvas
  // itself (it watches its container), but keeps its camera, so the graph
  // would stay the size it was. Reframe as the new size lands, on every size
  // change until it settles (the viewer grows it in over a moment).
  const figure = el.closest("figure") ?? el
  let refitting = 0
  const refit = () => {
    refitting = performance.now() + 900
    renderer.zoomToFit()
  }
  // full screen in the viewer it always zooms; back in the page, as it asked
  figure.addEventListener(
    "basalt:viewer",
    (e) => {
      renderer.setOptions({ zoom: (e as CustomEvent<{ open: boolean }>).detail.open || el.dataset.zoom === "true" })
      refit()
    },
    { signal },
  )
  const watch = new ResizeObserver(() => {
    if (performance.now() < refitting) renderer.zoomToFit()
  })
  watch.observe(el)
  signal.addEventListener("abort", () => {
    watch.disconnect()
    renderer.destroy()
  })
}

export function startGraphs(signal: AbortSignal, root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>(".graph-embed[data-graph]")) {
    if (el.closest(".popover, .preview, [data-preview]")) continue
    let data: GraphData
    try {
      data = JSON.parse(el.dataset.graph!)
    } catch {
      continue
    }
    drawGraph(el, data, signal).catch((err) => console.error("basalt: a graph didn't draw", err))
  }
}
