// The source toggle. With html[data-source], a page shows its own file,
// highlighted (Page.astro's .page-source), where its header, note and margin
// were; the navbar stays as it is. It stays on from page to page, like the
// theme, until it's toggled off or the page is reloaded. A page with no file
// of its own (a tag's, a folder's without an index.md) has nothing to show.

const root = document.documentElement

function sync() {
  const button = document.querySelector<HTMLButtonElement>(".source-toggle")
  if (!button) return
  button.disabled = !document.querySelector(".page-source")
  button.setAttribute("aria-pressed", String(root.hasAttribute("data-source")))
}

document.addEventListener("click", (e) => {
  if (!(e.target as Element).closest?.(".source-toggle")) return
  root.toggleAttribute("data-source")
  sync()
})

document.addEventListener("astro:before-swap", (e) => {
  e.newDocument.documentElement.toggleAttribute("data-source", root.hasAttribute("data-source"))
})

document.addEventListener("astro:page-load", sync)
sync()

export {}
