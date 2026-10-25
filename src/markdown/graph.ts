import { parseGraph, renderSvg, settle, type GraphData } from "@isaacchacko/graph"

/**
 * Basalt draws graphs with isaacchacko/graph (graph.isaacchacko.com): its
 * renderer in the browser, and its layout and svg here, at build time, so a
 * graph has a picture before any script runs and starts from that picture's
 * layout when the live one takes over.
 */
export { parseGraph, settle }

/** A settled graph as an svg in the page's colours. */
export function graphSvg(settled: GraphData, opts: { arrows?: boolean } = {}): string {
  return renderSvg(
    settled,
    {
      arrows: opts.arrows ?? false,
      theme: {
        background: null,
        node: "var(--graph-node, var(--secondary))",
        link: "var(--graph-link, var(--lightgray))",
        text: "var(--graph-text, var(--darkgray))",
        fontFamily: "inherit",
      },
    },
    { padding: 32, transparent: true },
  )
}
