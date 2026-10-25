// Replays Basalt's arrival on every page a transition brings in. The first
// page's is started in Head.astro, before it paints; an incoming page gets the
// class before it's swapped in, so its blocks never show and then vanish.
// (Its elements are new, so their animations start over by themselves.)
// A reload the dev server makes for an edit isn't an arrival.

const reduce = matchMedia("(prefers-reduced-motion: reduce)")

document.addEventListener("astro:before-swap", (e) => {
  const next = e.newDocument.documentElement
  delete next.dataset.hot
  next.classList.toggle("basalt-arrive", !reduce.matches)
})

if (import.meta.hot) {
  import.meta.hot.on("vite:beforeFullReload", () => {
    try {
      sessionStorage.setItem("basalt:hot", "1")
    } catch {}
  })
}
