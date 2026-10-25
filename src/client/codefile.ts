// A code file's bar (figure.code-file, from ![[file.py]]): copy its code, see
// the raw file, and show it on the whole screen if it asked for that.
import { PATHS, fullscreenButton, icon, toggleFullscreen } from "./embeds"

export function startCodeFiles(signal: AbortSignal) {
  for (const figure of document.querySelectorAll<HTMLElement>("figure.code-file")) {
    const code = figure.querySelector<HTMLElement>("pre code")
    const copy = figure.querySelector<HTMLButtonElement>(".code-file-copy")
    const full = figure.querySelector<HTMLButtonElement>(".code-file-full")
    const raw = figure.querySelector<HTMLAnchorElement>(".code-file-raw")
    if (raw) raw.dataset.astroReload = ""

    copy?.addEventListener(
      "click",
      async () => {
        if (!code) return
        try {
          await navigator.clipboard.writeText(code.innerText.replace(/\n$/, ""))
        } catch {
          return
        }
        const glyph = copy.innerHTML
        copy.innerHTML = icon(PATHS.check, 16, 2)
        copy.dataset.done = "true"
        setTimeout(() => {
          copy.innerHTML = glyph
          delete copy.dataset.done
        }, 1400)
      },
      { signal },
    )
    if (full) {
      full.addEventListener("click", () => toggleFullscreen(figure), { signal })
      fullscreenButton(full, figure, signal, 16, 2)
    }
  }
}
