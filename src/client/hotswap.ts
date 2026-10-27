// While writing: a saved note or component is swapped into the open page in
// place (swap.ts), with the scroll kept, the page's islands kept running
// (islands.ts) and no arrival. The dev server sends "basalt:swap" instead of
// a reload once the build is done (see integrations/agent.ts). Client code
// still reloads the page.
//
// A page that won't render (a broken component, say) isn't swapped in: the
// last good page stays, under Vite's error overlay, and the next good build
// swaps in over it. A page that is showing Astro's error page (it was loaded
// while broken) has no hot swap, so the server's "recover" reload is for it
// alone: this page ignores it.

import { fetchPage, swapIn } from "./swap"

if (import.meta.hot) {
  import.meta.hot.on("vite:beforeFullReload", (payload: { path?: string; basaltRecover?: boolean }) => {
    // Vite's client reloads for a path only on that path's page: this is none
    if (payload.basaltRecover) payload.path = "/__basalt/recovered.html"
  })

  let latest = 0
  import.meta.hot.on("basalt:swap", async () => {
    const mine = ++latest
    // Astro's error page doesn't come: the overlay says what's wrong, and this page stays
    const doc = await fetchPage()
    if (!doc || mine !== latest) return
    await swapIn(doc)
    // it renders again: whatever the overlay said is fixed
    document.querySelectorAll("vite-error-overlay").forEach((el) => el.remove())
  })
}

export {}
