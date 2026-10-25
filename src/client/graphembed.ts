// ```graph blocks: the svg drawn at build time becomes the live graph, started
// from the same layout, so nothing jumps. Drawn by isaacchacko/graph's
// renderer, in the page's theme, and kept in it. Full screen (the viewer's
// expand control) and back, it reframes itself to its new room.
import type { GraphData, Theme } from "graph/packages/graph-view/src/types"
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
  const { GraphRenderer } = await import("graph/packages/graph-view/src/renderer")
  if (signal.aborted) return
  const svg = el.querySelector(":scope > svg")
  const renderer = new GraphRenderer(el, {
    mode: "select",
    arrows: el.dataset.arrows === "true",
    // fitted into a page, a graph is drawn small: bigger labels and dots read at that size
    textSize: 1.8,
    nodeSize: 1.4,
    // a graph in a page is small: keep its labels at the zoom it starts at
    textFadeThreshold: -2,
    theme: pageTheme(),
  })
  renderer.setData(data)
  svg?.remove()
  onTheme(() => renderer.setOptions({ theme: pageTheme() }), signal)

  // Full screen and back: the renderer resizes its canvas itself (it watches
  // its container), but keeps its camera, so the graph would stay the size it
  // was. Reframe once the new size has landed, which on a Mac is after the
  // window's own animation, so on every size change until it settles.
  const figure = el.closest("figure") ?? el
  let refitting = 0
  const refit = () => {
    refitting = performance.now() + 900
    renderer.zoomToFit()
  }
  document.addEventListener(
    "fullscreenchange",
    () => {
      if (document.fullscreenElement === figure || !document.fullscreenElement) refit()
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

export function startGraphs(signal: AbortSignal) {
  for (const el of document.querySelectorAll<HTMLElement>(".graph-embed[data-graph]")) {
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
