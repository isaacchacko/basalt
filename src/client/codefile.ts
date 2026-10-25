// A code file's bar (figure.code-file, from ![[file.py]]): copy its code, see
// the raw file, and, if it asked for that, open it in Basalt's viewer, the
// same full screen as every other kind of media (viewer.ts).
import { PATHS, icon } from "./embeds"
import { openCode } from "./viewer"

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
    full?.addEventListener("click", () => openCode(figure), { signal })
  }
}
