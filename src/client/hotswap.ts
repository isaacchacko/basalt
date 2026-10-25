// While writing: a saved note or component is swapped into the open page in
// place, the way a navigation swaps pages, with the scroll kept, the page's
// islands kept running (islands.ts) and no arrival. The dev server sends
// "basalt:swap" instead of a reload once the build is done (see
// integrations/agent.ts). Client code still reloads the page.
//
// A page that won't render (a broken component, say) isn't swapped in: the
// last good page stays, under Vite's error overlay, and the next good build
// swaps in over it. A page that is showing Astro's error page (it was loaded
// while broken) has no hot swap, so the server's "recover" reload is for it
// alone: this page ignores it.

declare global {
  interface Window {
    basaltHotSwap?: boolean
  }
}

if (import.meta.hot) {
  import.meta.hot.on("vite:beforeFullReload", (payload: { path?: string; basaltRecover?: boolean }) => {
    // Vite's client reloads for a path only on that path's page: this is none
    if (payload.basaltRecover) payload.path = "/__basalt/recovered.html"
  })

  let latest = 0
  import.meta.hot.on("basalt:swap", async () => {
    const mine = ++latest
    const url = location.pathname + location.search
    let html: string
    try {
      const res = await fetch(url, { headers: { accept: "text/html" } })
      // Astro's error page: the overlay says what's wrong, and this page stays
      if (!res.ok) return
      html = await res.text()
    } catch {
      return
    }
    if (mine !== latest) return
    const doc = new DOMParser().parseFromString(html, "text/html")
    doc.querySelectorAll("noscript").forEach((el) => el.remove())
    if (!doc.querySelector('[name="astro-view-transitions-enabled"]')) return void location.reload()

    const { navigate } = await import("astro:transitions/client")
    const x = scrollX
    const y = scrollY
    window.basaltHotSwap = true
    // the page just fetched is the one swapped in (no second request)
    const target = new URL(url, location.href).href
    const prepare = (e: Event) => {
      const ev = e as Event & { to: URL; loader: () => Promise<void>; newDocument: Document }
      if (ev.to.href.split("#")[0] !== target.split("#")[0]) return
      ev.loader = async () => {
        ev.newDocument = doc
      }
    }
    document.addEventListener("astro:before-preparation", prepare)
    // instant: the page's smooth scrolling would glide there from the top
    const restore = () => scrollTo({ left: x, top: y, behavior: "instant" })
    document.addEventListener("astro:after-swap", restore, { once: true })
    document.addEventListener(
      "astro:page-load",
      () => {
        restore()
        // and once more after anything laid out on load (the margin) settles
        requestAnimationFrame(() => requestAnimationFrame(restore))
        window.basaltHotSwap = false
      },
      { once: true },
    )
    try {
      await navigate(url + location.hash, { history: "replace" })
    } finally {
      document.removeEventListener("astro:before-preparation", prepare)
    }
    // it renders again: whatever the overlay said is fixed
    document.querySelectorAll("vite-error-overlay").forEach((el) => el.remove())
  })
}

export {}
