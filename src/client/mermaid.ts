// ```mermaid blocks, drawn in the browser in the page's colours (and drawn
// again when the page turns light or dark). The code block becomes a
// figure.diagram-mermaid, which the viewer opens like any other diagram.
// Without JavaScript, or if mermaid can't parse it, the source shows.
//
// Mermaid comes from a CDN, pinned, and only to a page with a mermaid block,
// as Quartz does: bundled, it was 126 MB of every install and some sixty
// chunks of every build, for a diagram most sites never draw. (Offline, its
// source shows.)
import { onTheme, isDark } from "./embeds"

const MERMAID = "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.esm.min.mjs"

type Mermaid = typeof import("mermaid").default
let mermaid: Promise<Mermaid> | null = null
const load = () =>
  (mermaid ??= (import(/* @vite-ignore */ MERMAID) as Promise<{ default: Mermaid }>).then(
    (m) => m.default,
    (err) => {
      mermaid = null
      throw err
    },
  ))

const SOURCES = "pre:has(> code.mermaid), pre:has(> code.language-mermaid), pre[data-language='mermaid']"

// a page without Basalt's colours still gets a drawing (mermaid throws on an empty colour)
const FALLBACK: Record<string, [light: string, dark: string]> = {
  "--light": ["#ffffff", "#0a1440"],
  "--lightgray": ["#e3e5ec", "#1f2f78"],
  "--gray": ["#6b6e78", "#8a9cf0"],
  "--darkgray": ["#1c1c1e", "#d4dcf8"],
  "--dark": ["#000000", "#eef1fd"],
  "--secondary": ["#1b3fd0", "#a9b9ff"],
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
  let m: Mermaid
  try {
    m = await load()
  } catch {
    // offline, or the CDN is down: the source stays, as it would without JavaScript
    for (const figure of figures) {
      figure.dataset.failed = "true"
      delete figure.dataset.drawing
    }
    return
  }
  const dark = isDark()
  const font = css("--bodyFont") || "system-ui, sans-serif"
  m.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    darkMode: dark,
    fontFamily: font,
    // drawn about as wide as the column holds, so it isn't shrunk to fit and
    // its words stay the size of a Graphviz diagram's
    flowchart: { nodeSpacing: 34, rankSpacing: 42, padding: 12, curve: "basis", useMaxWidth: true },
    sequence: {
      // a message's words wrap to the room between its actors, so the
      // drawing fits the measure at its own size
      wrap: true,
      width: 100,
      height: 44,
      actorMargin: 34,
      boxMargin: 8,
      messageMargin: 30,
      mirrorActors: false,
      actorFontFamily: font,
      messageFontFamily: font,
      noteFontFamily: font,
      actorFontSize: 15,
      messageFontSize: 14,
      noteFontSize: 14,
      useMaxWidth: true,
    },
    themeVariables: {
      darkMode: dark,
      fontFamily: font,
      fontSize: "15px",
      actorBkg: css("--light"),
      actorBorder: css("--secondary"),
      actorTextColor: css("--dark"),
      actorLineColor: css("--lightgray"),
      signalColor: css("--gray"),
      signalTextColor: css("--darkgray"),
      noteBkgColor: css("--light"),
      noteBorderColor: css("--tertiary"),
      noteTextColor: css("--darkgray"),
      activationBorderColor: css("--secondary"),
      activationBkgColor: css("--lightgray"),
      sequenceNumberColor: css("--light"),
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

export function startMermaid(signal: AbortSignal, root: ParentNode = document) {
  const figures: HTMLElement[] = []
  for (const pre of root.querySelectorAll<HTMLElement>(SOURCES)) {
    if (pre.closest(".popover, .preview, [data-preview]")) continue
    // rehype-pretty-code wraps a block in a figure of its own: replace that
    const block = pre.closest<HTMLElement>("figure[data-rehype-pretty-code-figure]") ?? pre
    const figure = document.createElement("figure")
    figure.className = "diagram diagram-mermaid"
    figure.dataset.source = sourceOf(pre)
    figure.dataset.drawing = ""
    // the lines it's written on, for editing in place (client/editor.ts)
    for (const key of ["src", "srcSha"]) {
      if (block.dataset[key] === undefined) continue
      figure.dataset[key] = block.dataset[key]
      delete block.dataset[key]
    }
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
