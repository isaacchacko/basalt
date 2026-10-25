// Code wider than the main content: pointing at it, it reaches into the side
// content for as much more of its width as it needs (and the side column has
// room for), over whatever is there, and draws back when the pointer leaves.
// Only with a side column beside the text, and a mouse.

const SIDE_PAD = 16

/** how far the block can reach right: what its code hides, up to the side column's edge */
function reachOf(block: HTMLElement, pre: HTMLElement): number {
  if (document.documentElement.dataset.margin !== "beside") return 0
  const side = document.querySelector<HTMLElement>("aside.margin")
  const parent = block.parentElement
  if (!side || !parent) return 0
  const code = pre.querySelector<HTMLElement>(":scope > code") ?? pre
  // measured from where the block sits at rest, even mid-way back from a reach
  const box = parent.getBoundingClientRect()
  const style = getComputedStyle(parent)
  const rest = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth)
  const extra = Math.max(0, block.getBoundingClientRect().right - rest)
  const hidden = code.scrollWidth - code.clientWidth - extra
  const room = side.getBoundingClientRect().right - SIDE_PAD - rest
  return Math.max(0, Math.min(hidden + 2, room))
}

export function startCodeReach(signal: AbortSignal) {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return
  for (const pre of document.querySelectorAll<HTMLElement>("article pre")) {
    if (pre.querySelector(":scope > code.mermaid")) continue
    const block = pre.closest<HTMLElement>("figure[data-rehype-pretty-code-figure]") ?? pre
    // code that runs past the edge says so (a fade there), if it can reach for it
    const code = pre.querySelector<HTMLElement>(":scope > code") ?? pre
    block.classList.toggle("has-more", code.scrollWidth > code.clientWidth + 1 && reachOf(block, pre) >= 8)
    let back: number | undefined
    block.addEventListener(
      "mouseenter",
      () => {
        window.clearTimeout(back)
        if (block.classList.contains("is-reaching")) return
        const reach = reachOf(block, pre)
        if (reach < 8) return
        block.style.setProperty("--code-reach", `${Math.round(reach)}px`)
        block.classList.add("is-reaching")
      },
      { signal },
    )
    block.addEventListener(
      "mouseleave",
      () => {
        back = window.setTimeout(() => block.classList.remove("is-reaching"), 150)
      },
      { signal },
    )
  }
}
