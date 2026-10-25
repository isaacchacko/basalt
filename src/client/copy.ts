// <copy>text</copy> (src/markdown/copy.ts): a click on the text, or enter or
// space on it, puts it on the clipboard, and "copied" shows for a moment (and
// is read out): in the side content, where its "click to copy" is, or with no
// side content (a phone), just above the text. One listener for every page.

let said: HTMLElement | null = null
/** the words a screen reader hears, from a live region of its own */
function say(words: string) {
  if (!said?.isConnected) {
    said = document.createElement("span")
    said.className = "copyable-said"
    said.setAttribute("aria-live", "polite")
    document.body.append(said)
  }
  said.textContent = ""
  requestAnimationFrame(() => (said!.textContent = words))
}

async function copy(el: HTMLElement) {
  try {
    await navigator.clipboard.writeText(el.dataset.copy ?? el.textContent ?? "")
  } catch {
    return
  }
  window.clearTimeout(Number(el.dataset.copiedTimer))
  // its tip in the side content (previews.ts), if that's what's showing
  const tip =
    document.documentElement.dataset.margin === "beside"
      ? document.querySelector<HTMLElement>(".margin-hover .margin-tip:not([data-leaving] *)")
      : null
  const was = tip?.textContent
  if (tip) tip.textContent = "copied"
  el.dataset.copied = tip ? "beside" : "above"
  say("copied")
  el.dataset.copiedTimer = String(
    window.setTimeout(() => {
      delete el.dataset.copied
      if (tip?.isConnected && tip.textContent === "copied") tip.textContent = was ?? ""
    }, 1600),
  )
}

const copyable = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>(".copyable")

document.addEventListener("click", (e) => {
  const el = copyable(e)
  // a selection being made isn't a click to copy
  if (!el || String(getSelection() ?? "").length) return
  e.preventDefault()
  copy(el)
})
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return
  const el = copyable(e)
  if (!el) return
  e.preventDefault()
  copy(el)
})
