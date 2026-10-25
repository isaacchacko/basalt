// The graph view in the side content: the notes within a link or so of this
// one, and every note when it's opened up (graphdraw.ts draws them).

import { draw, neighbourhood, type Note } from "./graphdraw"
import { onPage } from "./margin"

onPage((signal) => {
  for (const view of document.querySelectorAll<HTMLElement>(".graph-view")) {
    const notes: Note[] = JSON.parse(view.dataset.notes ?? "[]")
    const here = view.dataset.here ?? ""
    const depth = Number(view.dataset.depth ?? 1)
    const local = view.querySelector<HTMLElement>(".graph-view-local")!
    draw(local, () => neighbourhood(notes, here, depth), signal, true)

    const dialog = view.querySelector<HTMLDialogElement>("dialog.graph-view-global")!
    const canvas = dialog.querySelector<HTMLElement>(".graph-view-global-canvas")!
    let closeBig: (() => void) | null = null
    view.querySelector(".graph-view-expand")?.addEventListener(
      "click",
      () => {
        dialog.showModal()
        const ctrl = new AbortController()
        signal.addEventListener("abort", () => ctrl.abort(), { once: true })
        draw(canvas, () => neighbourhood(notes, here, -1), ctrl.signal, false, () => dialog.close())
        closeBig = () => ctrl.abort()
      },
      { signal },
    )
    dialog.addEventListener("close", () => closeBig?.(), { signal })
    dialog.addEventListener("click", (e) => e.target === dialog && dialog.close(), { signal })
    signal.addEventListener("abort", () => dialog.open && dialog.close())
  }
})
