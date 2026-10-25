import { ForceSimulation } from "graph/packages/graph-view/src/simulation"
import { buildSvg } from "graph/packages/graph-view/src/export"
import { DEFAULT_OPTIONS } from "graph/packages/graph-view/src/defaults"
import type { SceneLink, SceneNode } from "graph/packages/graph-view/src/scene"
import type { GraphData, RendererOptions } from "graph/packages/graph-view/src/types"
import * as graphLanguage from "graph/packages/graph-view/src/parse"

/**
 * Basalt draws graphs with isaacchacko/graph (graph.isaacchacko.com): its
 * renderer in the browser, and its physics here, at build time, so a graph
 * has a picture before any script runs and starts from that picture's layout
 * when the live one takes over.
 */
// graph's web app isn't an es module package, so outside a bundler (the test
// runner) its exports arrive as a commonjs default
type Language = typeof graphLanguage
const language: Language =
  (Reflect.get(graphLanguage, "default") as Language | undefined) ?? graphLanguage
export const parseGraph = language.parseGraph

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const MAX_TICKS = 600

/** Where each node settles, the way the renderer would place and settle them. */
export function settle(data: GraphData, forces = DEFAULT_OPTIONS.forces): GraphData {
  const nodes: SceneNode[] = data.nodes.map((n, i) => {
    const r = 10 * Math.sqrt(i + 0.5)
    return {
      id: n.id,
      label: n.label ?? n.id,
      color: n.color ?? null,
      sizeMul: n.size ?? 1,
      x: n.x ?? Math.cos(i * GOLDEN_ANGLE) * r,
      y: n.y ?? Math.sin(i * GOLDEN_ANGLE) * r,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
      degree: 0,
      fade: 1,
      accent: 0,
      emphasis: 0,
      appear: 1,
    }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const links: SceneLink[] = data.links
    .filter((l) => byId.has(l.source) && byId.has(l.target))
    .map((l) => ({
      source: byId.get(l.source)!,
      target: byId.get(l.target)!,
      label: l.label ?? "",
      length: l.length ?? 1,
      fade: 1,
      accent: 0,
    }))
  const sim = new ForceSimulation<SceneNode>({ ...forces })
  sim.setGraph(nodes, links)
  for (let i = 0; i < MAX_TICKS && sim.active; i++) sim.tick()

  const round = (v: number) => Math.round(v * 10) / 10
  return {
    nodes: data.nodes.map((n, i) => ({ ...n, x: round(nodes[i].x), y: round(nodes[i].y) })),
    links: data.links,
  }
}

// stand-ins buildSvg paints with, swapped for the page's theme variables
const INK = { node: "#000001", link: "#000002", text: "#000003" }
const THEMED: [RegExp, string][] = [
  [/fill="#000001"/g, 'style="fill:var(--graph-node, var(--secondary))"'],
  [/stroke="#000002"/g, 'style="stroke:var(--graph-link, var(--lightgray))"'],
  [/fill="#000002"/g, 'style="fill:var(--graph-link, var(--lightgray))"'],
  [/fill="#000003"/g, 'style="fill:var(--graph-text, var(--darkgray))"'],
]

/** A settled graph as an svg in the page's colours. */
export function graphSvg(settled: GraphData, opts: { arrows?: boolean } = {}): string {
  const options: RendererOptions = {
    ...DEFAULT_OPTIONS,
    arrows: opts.arrows ?? false,
    theme: { ...DEFAULT_OPTIONS.theme, background: null, ...INK, fontFamily: "inherit" },
  }
  const nodes = settled.nodes.map(
    (n) =>
      ({
        ...n,
        label: n.label ?? n.id,
        color: n.color ?? null,
        sizeMul: n.size ?? 1,
        degree: settled.links.filter((l) => l.source === n.id || l.target === n.id).length,
        appear: 1,
      }) as unknown as SceneNode,
  )
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const links = settled.links
    .filter((l) => byId.has(l.source) && byId.has(l.target))
    .map(
      (l) =>
        ({
          source: byId.get(l.source)!,
          target: byId.get(l.target)!,
          label: l.label ?? "",
        }) as SceneLink,
    )
  const xs = nodes.map((n) => n.x)
  const ys = nodes.map((n) => n.y)
  const box = nodes.length
    ? {
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: Math.min(...ys),
        bottom: Math.max(...ys) + 16,
      }
    : { left: 0, right: 0, top: 0, bottom: 0 }
  let svg = buildSvg(nodes, links, options, box, { padding: 32, transparent: true })
  for (const [from, to] of THEMED) svg = svg.replace(from, to)
  return svg
}
