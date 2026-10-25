// What page transitions need beyond Astro's ClientRouter.
//
// - The note's own arrival (motion.ts) is the transition, so the root
//   doesn't cross-fade as well (motion.scss turns its animation off).
// - Anything open over the page (search, the phone's explorer drawer) is
//   closed before the next page comes in.
// - The page marks itself as moving (html[data-navigating]) from the click to
//   the swap, so styles can quiet hover effects meanwhile.

const root = document.documentElement

document.addEventListener("astro:before-preparation", () => {
  root.dataset.navigating = ""
})

document.addEventListener("astro:before-swap", () => {
  document.querySelector(".search-container.active")?.classList.remove("active")
  root.classList.remove("mobile-no-scroll")
  const explorer = document.querySelector<HTMLElement>(".explorer")
  if (explorer && explorer.querySelector<HTMLElement>(".mobile-explorer")?.checkVisibility()) {
    explorer.classList.add("collapsed")
  }
})

document.addEventListener("astro:after-swap", () => {
  delete root.dataset.navigating
})
