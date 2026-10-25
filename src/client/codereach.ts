// Code wider than the main content: pointing at it, it reaches into the side
// content for as much more of its width as it needs (and the side column has
// room for), over whatever is there, and draws back when the pointer leaves.
// Only with a side column beside the text, and a mouse.

const SIDE_PAD = 16

/**
 * Where the block's right edge is at rest (even mid-way back from a reach),
 * and how much room the side content has past it; none in a compare column,
 * whose neighbour is beside it instead.
 */
function restOf(block: HTMLElement): { rest: number; room: number } | undefined {
  if (document.documentElement.dataset.margin !== "beside" || block.closest(".compare-column")) return
  const side = document.querySelector<HTMLElement>("aside.margin")
  const parent = block.parentElement
  if (!side || !parent) return
  const box = parent.getBoundingClientRect()
  const style = getComputedStyle(parent)
  const rest = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth)
  return { rest, room: side.getBoundingClientRect().right - SIDE_PAD - rest }
}

/** how far the block can reach right: what its code hides, up to the side content's edge */
function reachOf(block: HTMLElement, pre: HTMLElement): number {
  const at = restOf(block)
  if (!at) return 0
  const code = pre.querySelector<HTMLElement>(":scope > code") ?? pre
  const extra = Math.max(0, block.getBoundingClientRect().right - at.rest)
  const hidden = code.scrollWidth - code.clientWidth - extra
  return Math.max(0, Math.min(hidden + 2, at.room))
}

/** code that runs past the edge says so (a fade there), if it can reach for it */
export function markMore(block: HTMLElement) {
  const pre = block.matches("pre") ? block : block.querySelector<HTMLElement>("pre")
  if (!pre) return
  const code = pre.querySelector<HTMLElement>(":scope > code") ?? pre
  const at = restOf(block)
  // wrapped, it never runs past; and a reaching block's code fills it, so its width can't tell
  const wider =
    at !== undefined && !block.hasAttribute("data-wrap") && block.getBoundingClientRect().left + code.scrollWidth + 2 > at.rest + 1
  block.classList.toggle("has-more", wider && at.room >= 8)
}

export function startCodeReach(signal: AbortSignal) {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return
  for (const pre of document.querySelectorAll<HTMLElement>("article pre")) {
    if (pre.querySelector(":scope > code.mermaid")) continue
    const block = pre.closest<HTMLElement>("figure[data-rehype-pretty-code-figure]") ?? pre
    markMore(block)
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
