// A page's content, started: the viewer, pdfs, islands, code's controls,
// tabs, diagrams. Each part starts on a page (astro:page-load) and stops when
// it goes (its AbortSignal aborts on astro:before-swap); and on whatever's
// drawn anew inside one (a block of a note being edited, editor.ts), which
// starts it in that block alone.

import { startEmbeds } from "./embeds"
import { startViewer } from "./viewer"
import { startCodeControls } from "./codefile"
import { startCodeReach } from "./codereach"
import { startTabs } from "./tabs"
import "./copy"
import "./sound"
import { startPdfs } from "./pdf"
import { startIslands as islandsAtLoad } from "./islands"
import { startGraphs } from "./graphembed"
import { startMermaid } from "./mermaid"

type Part = (signal: AbortSignal, root?: ParentNode) => void

let startIslands: Part = islandsAtLoad
const parts: Part[] = [startEmbeds, startCodeControls, startTabs, startCodeReach, startPdfs, startIslands, startGraphs, startMermaid, startViewer]
let page: AbortController | null = null

/** Starts every part in `root` (the page, or a block drawn in it) till `signal` aborts. */
export function startContent(signal: AbortSignal, root: ParentNode = document) {
  for (const part of parts) {
    try {
      part(signal, root)
    } catch (err) {
      console.error("basalt:", part.name, err)
    }
  }
}

function start() {
  page?.abort()
  page = new AbortController()
  startContent(page.signal)
}

document.addEventListener("astro:before-swap", () => page?.abort())

// an island edited in dev: the islands module is swapped (it unmounts its
// islands as it goes), and the new one mounts them again, on this same page
if (import.meta.hot) {
  import.meta.hot.accept("./islands", (next) => {
    if (!next || !page) return
    const at = parts.indexOf(startIslands)
    parts[at] = startIslands = next.startIslands
    startIslands(page.signal)
    document.dispatchEvent(new CustomEvent("basalt:islands-swapped"))
  })
}
document.addEventListener("astro:page-load", start)
// without the client router there's no astro:page-load: this page is the only one
if (!document.querySelector('[name="astro-view-transitions-enabled"]')) start()
