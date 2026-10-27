// Tabs (markdown/tabs.ts): one shows at a time, and ‹ › in the bar above
// steps to the one before or after, going round. Without a script they all
// show, one after another, each under its label.
import { PATHS, icon } from "./embeds"
import { markMore } from "./codereach"

const NOT_THIS_PAGES = ".margin-preview, .margin-hover, .popover, .basalt-viewer"

function stepper(cls: string, label: string, glyph: string) {
  const button = document.createElement("button")
  button.type = "button"
  // a label, not a title: previews.ts would show a title in the side content
  button.className = `tabs-step ${cls}`
  button.setAttribute("aria-label", label)
  button.innerHTML = icon(glyph, 16, 2)
  return button
}

export function startTabs(signal: AbortSignal, root: ParentNode = document) {
  for (const group of root.querySelectorAll<HTMLElement>("article .tabs")) {
    if (group.closest(NOT_THIS_PAGES) || group.hasAttribute("data-tabbing")) continue
    const tabs = [...group.querySelectorAll<HTMLElement>(":scope > .tab")]
    const bar = document.createElement("div")
    bar.className = "tabs-bar"
    const before = stepper("tabs-before", "the one before", PATHS.prev)
    const after = stepper("tabs-after", "the one after", PATHS.next)
    const label = document.createElement("span")
    label.className = "tabs-label"
    const count = document.createElement("span")
    count.className = "tabs-count"
    bar.append(before, label, after, count)

    let shown = 0
    const show = (i: number) => {
      shown = (i + tabs.length) % tabs.length
      tabs.forEach((tab, k) => tab.toggleAttribute("data-shown", k === shown))
      label.textContent = tabs[shown].dataset.label ?? ""
      count.textContent = `${shown + 1} of ${tabs.length}`
      // code's width could only be measured once it shows: whether there's more to reach for
      for (const block of tabs[shown].querySelectorAll<HTMLElement>("figure[data-rehype-pretty-code-figure]")) markMore(block)
    }
    before.addEventListener("click", () => show(shown - 1), { signal })
    after.addEventListener("click", () => show(shown + 1), { signal })
    bar.addEventListener(
      "keydown",
      (e) => {
        const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
        if (!step) return
        e.preventDefault()
        show(shown + step)
        ;(step < 0 ? before : after).focus()
      },
      { signal },
    )

    group.prepend(bar)
    group.toggleAttribute("data-tabbing", true)
    show(0)
    signal.addEventListener("abort", () => {
      bar.remove()
      tabs.forEach((tab) => tab.removeAttribute("data-shown"))
      group.removeAttribute("data-tabbing")
    })
  }
}
