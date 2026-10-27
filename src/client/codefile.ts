// Every code block's controls, inside its border: in its title bar if it has
// one, else in its top right corner. Each control's label shows beside it in
// the bar, never as a title, which previews.ts would show in the side content.
import { PATHS, icon } from "./embeds"
import { openCode } from "./viewer"
import { markMore } from "./codereach"

const CODE_BLOCKS = "article figure[data-rehype-pretty-code-figure]"
const NOT_THIS_PAGES_CODE = "figure.diagram, .mermaid-source, .margin-preview, .margin-hover, .popover, .basalt-viewer"

const GLYPHS = {
  wrap: '<path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M4 18h5"/><path d="M15 16l-2 2 2 2"/>',
  raw: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16"/>',
}

function control(cls: string, label: string, glyph: string) {
  const button = document.createElement("button")
  button.type = "button"
  button.className = `code-action ${cls}`
  button.setAttribute("aria-label", label)
  button.innerHTML = icon(glyph, 16, 2)
  return button
}

function titleBarOrCorner(block: HTMLElement): HTMLElement {
  const titleBar = block.querySelector<HTMLElement>(":scope > figcaption[data-rehype-pretty-code-title]")
  if (titleBar) return titleBar
  const corner = document.createElement("div")
  corner.className = "code-corner"
  block.prepend(corner)
  return corner
}

/** what copy and raw give: a diff's patch (its data-copy), else the code as shown */
const textOf = (block: HTMLElement, code: HTMLElement) => block.dataset.copy ?? code.innerText.replace(/\n$/, "")

export function startCodeControls(signal: AbortSignal, root: ParentNode = document) {
  for (const block of root.querySelectorAll<HTMLElement>(CODE_BLOCKS)) {
    if (block.closest(NOT_THIS_PAGES_CODE) || block.querySelector(".code-actions")) continue
    const code = block.querySelector<HTMLElement>("pre > code")
    if (!code || code.matches(".mermaid")) continue
    // one tab stop, on what scrolls: the code (a browser makes it one of its own when it overflows)
    code.parentElement!.removeAttribute("tabindex")
    code.tabIndex = 0

    const bar = titleBarOrCorner(block)
    // a code file's bar comes with a raw link and copy (embeds.ts)
    const fileActions = bar.querySelector<HTMLElement>(".code-file-actions")
    const actions = fileActions ?? document.createElement("span")
    actions.classList.add("code-actions")
    // its text is an attribute's, drawn by CSS: the viewer captions a block with its title bar's text
    const label = document.createElement("span")
    label.className = "code-action-label"
    label.setAttribute("aria-hidden", "true")
    const showLabel = (text: string) => (text ? (label.dataset.text = text) : delete label.dataset.text)
    // what a click did, said for a moment: a touch screen has no pointer leaving to clear it
    let clearing: number | undefined
    const sayForAMoment = (text: string) => {
      showLabel(text)
      clearTimeout(clearing)
      clearing = window.setTimeout(() => label.dataset.text === text && showLabel(""), 1400)
    }
    const wrap = control("code-wrap", "wrap lines", GLYPHS.wrap)
    wrap.setAttribute("aria-pressed", "false")
    actions.prepend(label, wrap)
    if (!fileActions) {
      actions.append(control("code-raw", "show raw", GLYPHS.raw), control("code-file-copy", "copy", PATHS.copy))
      bar.append(actions)
    }
    if (!actions.querySelector(".code-file-full")) actions.append(control("code-file-full", "full screen", PATHS.expand))

    // the viewer collects it as code, and adds no full-screen button of its own
    block.dataset.viewerCode = ""

    for (const button of actions.querySelectorAll<HTMLElement>(".code-file-action, .code-action")) {
      button.classList.add("code-action")
      if (button.title) {
        button.dataset.label = button.title
        button.removeAttribute("title")
      }
      const show = () =>
        showLabel(button.dataset.done ? "copied" : (button.dataset.label ?? button.getAttribute("aria-label") ?? ""))
      // a frame later, so moving between controls doesn't flicker the label
      const hide = () =>
        requestAnimationFrame(() => {
          if (!actions.matches(":hover, :has(:focus-visible)")) showLabel("")
        })
      button.addEventListener("pointerenter", show, { signal })
      button.addEventListener("focus", show, { signal })
      button.addEventListener("pointerleave", hide, { signal })
      button.addEventListener("blur", hide, { signal })
    }

    // measured against the block at rest: reaching into the side content, it may fit
    const widerThanBlock = () => code.scrollWidth + 2 > block.parentElement!.clientWidth + 1
    const offerWrap = () => (wrap.hidden = !block.hasAttribute("data-wrap") && !widerThanBlock())
    offerWrap()
    const resizes = new ResizeObserver(offerWrap)
    resizes.observe(code)
    signal.addEventListener("abort", () => resizes.disconnect())
    wrap.addEventListener(
      "click",
      () => {
        const wrapped = block.toggleAttribute("data-wrap")
        wrap.setAttribute("aria-pressed", String(wrapped))
        wrap.setAttribute("aria-label", wrapped ? "don't wrap lines" : "wrap lines")
        sayForAMoment(wrap.getAttribute("aria-label")!)
        markMore(block)
      },
      { signal },
    )

    actions.querySelector(".code-raw")?.addEventListener(
      "click",
      () => {
        const url = URL.createObjectURL(new Blob([textOf(block, code)], { type: "text/plain;charset=utf-8" }))
        window.open(url, "_blank", "noopener")
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      },
      { signal },
    )
    const rawFile = actions.querySelector<HTMLAnchorElement>("a.code-file-raw")
    if (rawFile) rawFile.dataset.astroReload = ""

    const copy = actions.querySelector<HTMLButtonElement>(".code-file-copy")!
    copy.addEventListener(
      "click",
      async () => {
        try {
          await navigator.clipboard.writeText(textOf(block, code))
        } catch {
          return
        }
        const glyph = copy.innerHTML
        copy.innerHTML = icon(PATHS.check, 16, 2)
        copy.dataset.done = "true"
        sayForAMoment("copied")
        setTimeout(() => {
          copy.innerHTML = glyph
          delete copy.dataset.done
        }, 1400)
      },
      { signal },
    )
    actions.querySelector(".code-file-full")!.addEventListener("click", () => openCode(block), { signal })
  }
}
