// Stylesheets only some pages need, so a page of prose loads none of them:
// what a note has (KaTeX's, a tree's, a diff's) is linked from the pages whose
// note has it (layouts/Page.astro), and what opens over a page (a note's
// history, ⌘G's graph, the viewer, a preview, search) is linked when
// it opens. Each link is marked data-basalt-sheet with its name. Content taken
// from another page (a preview, a search passage) brings its sheets along.

import katexCss from "katex/dist/katex.min.css?url"
import codeCss from "../styles/code.scss?url"
import diagramsCss from "../styles/diagrams.scss?url"
import diffCss from "../styles/diff.scss?url"
import embedsCss from "../styles/embeds.scss?url"
import islandsCss from "../styles/islands.scss?url"
import pdfCss from "../styles/pdf.scss?url"
import soundCss from "../styles/sound.scss?url"
import spotifyCss from "../styles/spotify.scss?url"
import tabsCss from "../styles/tabs.scss?url"
import treeCss from "../styles/tree.scss?url"
import viewerCss from "../styles/viewer.scss?url"
import historyCss from "../styles/history.scss?url"
import gardenGraphCss from "../styles/gardengraph.scss?url"
import previewsCss from "../styles/previews.scss?url"
import searchboxCss from "../styles/searchbox.scss?url"
import viewerboxCss from "../styles/viewerbox.scss?url"

/** what a note has that needs a sheet, as its html shows it */
export const NOTE_SHEETS = {
  katex: [katexCss, /class="katex/],
  code: [codeCss, /<pre|code-file/],
  diagrams: [diagramsCss, /class="diagram/],
  diff: [diffCss, /class="diff/],
  embeds: [embedsCss, /class="(embed|transclude)|<(audio|video|iframe)/],
  islands: [islandsCss, /class="island/],
  pdf: [pdfCss, /embed-pdf|class="pdf/],
  sound: [soundCss, /class="sound/],
  spotify: [spotifyCss, /class="basalt-song/],
  tabs: [tabsCss, /class="tabs/],
  tree: [treeCss, /class="tree/],
  // what opens into the viewer: a picture, a diagram, a frame, a long code block
  viewer: [viewerCss, /zoomable|class="diagram|embed-frame|<pre|code-file/],
} satisfies Record<string, [href: string, has: RegExp]>

const SHEETS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(NOTE_SHEETS).map(([name, [href]]) => [name, href])),
  history: historyCss,
  gardengraph: gardenGraphCss,
  previews: previewsCss,
  searchbox: searchboxCss,
  viewerbox: viewerboxCss,
}

export type SheetName = keyof typeof NOTE_SHEETS | "history" | "gardengraph" | "previews" | "searchbox" | "viewerbox"

/** The `<link>` of sheet `name` in `doc`, made if it hasn't one; resolves once it applies. */
function linkSheet(name: string, href: string, doc: Document): Promise<void> {
  let link = doc.head.querySelector<HTMLLinkElement>(`link[data-basalt-sheet="${CSS.escape(name)}"]`)
  if (!link) {
    link = doc.createElement("link")
    link.rel = "stylesheet"
    link.href = href
    link.dataset.basaltSheet = name
    // before the page's own styles, as Page.astro links them, so a site's
    // custom.scss, last of those, still wins
    doc.head.insertBefore(link, doc.head.querySelector('link[rel="stylesheet"][href*="/_astro/"]:not([data-basalt-sheet]), style[data-vite-dev-id]'))
  }
  if (doc !== document || link.sheet) return Promise.resolve()
  const loading = link
  return new Promise((done) => {
    loading.addEventListener("load", () => done(), { once: true })
    loading.addEventListener("error", () => done(), { once: true })
  })
}

/**
 * Link sheets `names` in `doc` (this page, or the page coming in, in
 * astro:before-swap, so it arrives with them); resolves once they apply.
 */
export function needSheets(names: SheetName[], doc: Document = document): Promise<void> {
  return Promise.all(names.map((name) => linkSheet(name, SHEETS[name], doc))).then(() => {})
}

/** Link here any of `doc`'s sheets this page doesn't have. */
export function adoptSheets(doc: Document) {
  for (const link of doc.head.querySelectorAll<HTMLLinkElement>("link[data-basalt-sheet]")) {
    void linkSheet(link.dataset.basaltSheet!, link.getAttribute("href")!, document)
  }
}
