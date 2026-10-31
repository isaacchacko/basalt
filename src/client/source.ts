// The source toggle. With html[data-source], a page shows its own file,
// highlighted (Page.astro's .page-source), where its header, note and margin
// were; the navbar stays as it is. It stays on from page to page, like the
// theme, until it's toggled off or the page is reloaded. A page with no file
// of its own (a tag's, a folder's without an index.md) has nothing to show.

import { needSheets } from "./sheets"

const root = document.documentElement
// the file's code blocks are drawn as the note's are
const sheets = (doc?: Document) => needSheets(["code"], doc)

function sync() {
  const button = document.querySelector<HTMLButtonElement>(".source-toggle")
  if (!button) return
  button.disabled = !document.querySelector(".page-source")
  button.setAttribute("aria-pressed", String(root.hasAttribute("data-source")))
}

document.addEventListener("click", async (e) => {
  if (!(e.target as Element).closest?.(".source-toggle")) return
  if (!root.hasAttribute("data-source")) await sheets()
  root.toggleAttribute("data-source")
  sync()
})

document.addEventListener("astro:before-swap", (e) => {
  if (root.hasAttribute("data-source")) void sheets(e.newDocument)
  e.newDocument.documentElement.toggleAttribute("data-source", root.hasAttribute("data-source"))
})

document.addEventListener("astro:page-load", sync)
sync()

export {}
