// ```mermaid blocks, drawn in the browser in the page's colours (and drawn
// again when the page turns light or dark). The code block becomes a
// figure.diagram-mermaid, which the viewer opens like any other diagram.
// Without JavaScript, or if mermaid can't parse it, the source shows.
import { onTheme, isDark } from "./embeds"

type Mermaid = typeof import("mermaid").default
let mermaid: Promise<Mermaid> | null = null
const load = () => (mermaid ??= import("mermaid").then((m) => m.default))

const SOURCES = "pre:has(> code.mermaid), pre:has(> code.language-mermaid), pre[data-language='mermaid']"

// a page without Basalt's colours still gets a drawing (mermaid throws on an empty colour)
const FALLBACK: Record<string, [light: string, dark: string]> = {
  "--light": ["#f4f1ec", "#141413"],
  "--lightgray": ["#e2ddd4", "#2a2926"],
  "--gray": ["#9a948a", "#6f6b64"],
  "--darkgray": ["#3a3835", "#d6d2ca"],
  "--dark": ["#1d1c1a", "#f0ece4"],
  "--secondary": ["#2f4a5a", "#8fb0c2"],
}

function css(name: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (value) return value
  const fallback = FALLBACK[name]
  return fallback ? fallback[isDark() ? 1 : 0] : ""
}

function sourceOf(pre: HTMLElement): string {
  const code = pre.querySelector("code")
  const clip = code?.dataset.clipboard
  if (clip) {
    try {
      return JSON.parse(clip)
    } catch {}
  }
  return (code ?? pre).textContent ?? ""
}

let ids = 0

async function draw(figures: HTMLElement[]) {
  const m = await load()
  const dark = isDark()
  m.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    darkMode: dark,
    fontFamily: css("--bodyFont") || "system-ui, sans-serif",
    themeVariables: {
      darkMode: dark,
      fontFamily: css("--bodyFont") || "system-ui, sans-serif",
      fontSize: "15px",
      background: css("--light"),
      primaryColor: css("--light"),
      primaryTextColor: css("--darkgray"),
      primaryBorderColor: css("--secondary"),
      secondaryColor: css("--lightgray"),
      tertiaryColor: css("--light"),
      lineColor: css("--gray"),
      textColor: css("--darkgray"),
      mainBkg: css("--light"),
      nodeBorder: css("--secondary"),
      clusterBkg: css("--light"),
      clusterBorder: css("--lightgray"),
      edgeLabelBackground: css("--light"),
      titleColor: css("--dark"),
    },
  })
  for (const figure of figures) {
    const box = figure.querySelector<HTMLElement>(".mermaid-drawing")!
    try {
      const { svg } = await m.render(`basalt-mermaid-${++ids}`, figure.dataset.source!)
      box.innerHTML = svg
      delete figure.dataset.failed
    } catch (err) {
      figure.dataset.failed = "true"
      console.error("basalt: a mermaid diagram didn't draw", err)
    }
    delete figure.dataset.drawing
  }
  document.dispatchEvent(new CustomEvent("basalt:diagram"))
}

export function startMermaid(signal: AbortSignal) {
  const figures: HTMLElement[] = []
  for (const pre of document.querySelectorAll<HTMLElement>(SOURCES)) {
    if (pre.closest(".popover, .preview, [data-preview]")) continue
    // rehype-pretty-code wraps a block in a figure of its own: replace that
    const block = pre.closest<HTMLElement>("figure[data-rehype-pretty-code-figure]") ?? pre
    const figure = document.createElement("figure")
    figure.className = "diagram diagram-mermaid"
    figure.dataset.source = sourceOf(pre)
    figure.dataset.drawing = ""
    const drawing = document.createElement("div")
    drawing.className = "mermaid-drawing"
    figure.append(drawing)
    // until it's drawn (and if it can't be), the source
    block.before(figure)
    figure.append(block)
    block.classList.add("mermaid-source")
    figures.push(figure)
  }
  if (!figures.length) return
  draw(figures)
  onTheme(() => draw(figures), signal)
}
