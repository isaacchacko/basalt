import type { Code, Html, Root } from "mdast"
import { visit } from "unist-util-visit"
import { graphSvg, parseGraph, settle } from "./graph.ts"
import { nativeImport } from "./siteconfig.ts"

// Basalt's graphics as code. A fenced block in one of these languages is a
// picture, not a listing:
//
//   ```graph               isaacchacko/graph's language (a -> b, Sun {gold 3}),
//                          laid out here and drawn live by its renderer
//   ```dot / ```graphviz   drawn to svg here, at build time (wasm graphviz),
//                          in currentColor so it follows the theme
//   ```svg                 inlined as it is
//   ```math                display math, the way GitHub reads it (KaTeX)
//
// Mermaid stays with ofm.ts, which leaves it for the browser. `title="..."`
// after the language is the figure's caption. A diagram that doesn't parse
// fails the figure, not the build: its error and source show.

export interface Options {
  /** ```graph, in isaacchacko/graph's language, drawn by its renderer */
  graph: boolean
  graphviz: boolean
  svg: boolean
  math: boolean
}

type Viz = {
  renderString(src: string, options: { format: string; engine?: string }): string
}
let viz: Promise<Viz> | null = null
const graphviz = () =>
  (viz ??= nativeImport("@viz-js/viz").then((m) => (m as { instance(): Promise<Viz> }).instance()))

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

function captionOf(meta: string | null | undefined): string | undefined {
  return /title=(?:"([^"]*)"|'([^']*)'|(\S+))/
    .exec(meta ?? "")
    ?.slice(1)
    .find(Boolean)
}

function figure(kind: string, inner: string, caption?: string): string {
  const cap = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""
  return `<figure class="diagram diagram-${kind}">${inner}${cap}</figure>`
}

function failure(kind: string, message: string, source: string): string {
  return `<div class="diagram-error"><strong>${kind} didn’t draw:</strong> ${escapeHtml(message)}<pre>${escapeHtml(source)}</pre></div>`
}

/**
 * Graphviz draws in black on white. In a page with a dark mode that's a white
 * box, so ink becomes currentColor and paper becomes nothing.
 */
export function themeSvg(svg: string): string {
  return svg
    .replace(/^[\s\S]*?(<svg)/, "$1")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(fill|stroke)="(black|#000000)"/g, '$1="currentColor"')
    .replace(/fill="(white|#ffffff)"/g, 'fill="none"')
    .replace(/font-family="Times,serif"/g, 'font-family="inherit"')
}

export async function renderGraphviz(source: string, engine?: string): Promise<string> {
  return themeSvg((await graphviz()).renderString(source, { format: "svg", engine }))
}

/**
 * A ```graph block: settled here and drawn as an svg, which the embeds script
 * swaps for the live renderer, started from the same layout. `height=360`
 * and `arrows` / `noarrows` go after the language.
 */
export function graphFigure(node: Code, caption?: string): string {
  const { data, errors } = parseGraph(node.value)
  if (errors.length) {
    const message = errors.map((e) => `line ${e.line + 1}: ${e.message}`).join("; ")
    return failure("graph", message, node.value)
  }
  const meta = node.meta ?? ""
  const arrows = /\bnoarrows\b/.test(meta)
    ? false
    : /\barrows\b/.test(meta) || /->|<-/.test(node.value)
  const height = /height=(\d+)/.exec(meta)?.[1] ?? "360"
  const settled = settle(data)
  const attr = escapeHtml(JSON.stringify(settled))
  const live = `<div class="graph-embed" data-graph="${attr}" data-arrows="${arrows}" style="height:${height}px">${graphSvg(settled, { arrows })}</div>`
  return figure("graph", live, caption)
}

export function remarkDiagrams(opts: Options) {
  return async (tree: Root) => {
    const jobs: { node: Code; index: number; parent: { children: unknown[] } }[] = []
    visit(tree, "code", (node: Code, index, parent) => {
      if (!parent || index === undefined) return
      const lang = node.lang?.toLowerCase()
      if (
        (opts.graph && lang === "graph") ||
        (opts.graphviz && (lang === "dot" || lang === "graphviz")) ||
        (opts.svg && lang === "svg") ||
        (opts.math && lang === "math")
      ) {
        jobs.push({ node, index, parent })
      }
    })

    for (const { node, index, parent } of jobs) {
      const lang = node.lang!.toLowerCase()
      const caption = captionOf(node.meta)
      if (lang === "math") {
        // the shape mdast-util-math gives $$ blocks, so rehype-katex finds it
        parent.children[index] = {
          type: "math",
          value: node.value,
          data: {
            hName: "pre",
            hChildren: [
              {
                type: "element",
                tagName: "code",
                properties: { className: ["language-math", "math-display"] },
                children: [{ type: "text", value: node.value }],
              },
            ],
          },
        }
        continue
      }

      let html: string
      if (lang === "graph") {
        html = graphFigure(node, caption)
      } else if (lang === "svg") {
        html = figure("svg", node.value, caption)
      } else {
        try {
          const engine = /engine=(\w+)/.exec(node.meta ?? "")?.[1]
          html = figure("graphviz", await renderGraphviz(node.value, engine), caption)
        } catch (err) {
          html = failure("graphviz", err instanceof Error ? err.message : String(err), node.value)
        }
      }
      parent.children[index] = { type: "html", value: html } satisfies Html
    }
  }
}
