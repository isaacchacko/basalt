// While writing: a saved note or component is swapped into the open page in
// place, the way a navigation swaps pages, with the scroll kept and no arrival
// (the dev server sends "basalt:swap" instead of a reload; see
// integrations/agent.ts). Client code still reloads the page.

declare global {
  interface Window {
    basaltHotSwap?: boolean
  }
}

if (import.meta.hot) {
  import.meta.hot.on("basalt:swap", async () => {
    const { navigate } = await import("astro:transitions/client")
    const x = scrollX
    const y = scrollY
    window.basaltHotSwap = true
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
    await navigate(location.pathname + location.search + location.hash, { history: "replace" })
  })
}

export {}
