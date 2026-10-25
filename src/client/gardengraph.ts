// ⌘G (ctrl+G): the whole garden as a graph, on the whole screen. Every note
// and its links, this page marked; a click on a note goes there, and ⌘G
// again, escape or a click outside the graph closes it. The renderer loads
// the first time it's asked for.

type Index = Record<string, { title?: string; links?: string[] }>

let notes: Promise<{ id: string; title: string; links: string[] }[]> | null = null
const load = () =>
  (notes ??= fetch("/static/contentIndex.json")
    .then((r) => r.json() as Promise<Index>)
    .then((index) =>
      Object.entries(index)
        .filter(([slug]) => !slug.startsWith("tags/"))
        .map(([slug, d]) => ({ id: slug, title: d.title ?? slug, links: d.links ?? [] })),
    ))

let open: (() => void) | null = null

async function show() {
  const [{ draw, neighbourhood }, all] = await Promise.all([import("./graphdraw"), load()])
  const dialog = document.createElement("dialog")
  dialog.className = "garden-graph"
  dialog.setAttribute("aria-label", "the garden, as a graph")
  const bar = document.createElement("div")
  bar.className = "garden-graph-bar"
  const title = document.querySelector(".page-title")?.textContent?.trim() || "The garden"
  bar.innerHTML = `<span class="garden-graph-title"></span><span class="garden-graph-count"></span><span class="garden-graph-hint">⌘G or esc to close</span>`
  bar.querySelector(".garden-graph-title")!.textContent = title
  bar.querySelector(".garden-graph-count")!.textContent = `${all.length} ${all.length === 1 ? "note" : "notes"}`
  const canvas = document.createElement("div")
  canvas.className = "garden-graph-canvas"
  dialog.append(bar, canvas)
  document.body.append(dialog)
  dialog.showModal()

  const ctrl = new AbortController()
  const here = document.body.dataset.slug ?? "index"
  draw(canvas, () => neighbourhood(all, here, -1), ctrl.signal, false, () => dialog.close())
  const shut = () => dialog.close()
  open = shut
  dialog.addEventListener("click", (e) => e.target === dialog && shut())
  dialog.addEventListener("close", () => {
    ctrl.abort()
    dialog.remove()
    open = null
  })
  document.addEventListener("astro:before-swap", shut, { once: true })
}

document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "g") return
  const t = e.target as HTMLElement | null
  if (t?.closest?.("input, textarea, [contenteditable]") && !open) return
  e.preventDefault()
  if (open) open()
  else void show()
})

export {}
