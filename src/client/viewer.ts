// Basalt's viewer: any picture on the page, full screen. Images, diagrams
// (graphviz, svg, mermaid), pages in a frame and code (a code file that
// asked for `fullscreen`, a long code block) open in one viewer that grows
// out of where they sit, with the caption under them, zoom and pan (click, z,
// the wheel, a pinch), ←/→ (or a swipe) through the page's others, and the
// original a click away. A link to a picture opens it here too, growing out
// of its preview in the side content if that's showing (previews.ts), else
// out of the link. Without this script an image is an image, a diagram is a
// diagram, and a link to a picture is a link.
import {
  EASE,
  PATHS,
  button as makeButton,
  fullscreenButton,
  icon,
  isDark,
  isImageLink,
  themedPair,
  link as makeLink,
  still,
  toggleFullscreen,
} from "./embeds"

type Kind = "image" | "svg" | "frame" | "code"
type Item = {
  kind: Kind
  origin: HTMLElement
  caption: string
  src?: string
  /** where it grows from and shrinks back to, when that isn't its origin (a link's preview) */
  from?: HTMLElement
  /** a picture with a light and a dark version: the viewer can show either */
  pair?: { light: string; dark: string }
}

const ICON = (k: keyof typeof PATHS) => icon(PATHS[k])
const button = (cls: string, label: string, svg: string) => makeButton(`viewer-button ${cls}`, label, svg)
const link = (cls: string, label: string, svg: string) => makeLink(`viewer-button ${cls}`, label, svg)

const DIAGRAMS = "figure.diagram-graphviz, figure.diagram-svg, figure.diagram-mermaid"
// code that opens here: a code file with a full-screen button, or a code
// block long enough to have been given one (addExpands)
const CODE = "figure.code-file:has(.code-file-full), [data-viewer-code]"
/** a code block taller than this many lines gets a way into the viewer */
const LONG_CODE = 20
// link previews show a copy of another note: its pictures aren't this page's.
// (A margin figure's copy in .margin-layer is this page's, and opens.)
const ELSEWHERE = ".margin-preview, .margin-hover, .popover, a, .basalt-viewer"
const shown = (el: Element) => el.getClientRects().length > 0
/** a diagram's own svg, not the one in its expand control */
const drawingOf = (el: Element) => el.querySelector<SVGSVGElement>("svg:not(.viewer-button *)")

function captionOf(el: HTMLElement): string {
  const figure = el.closest("figure, aside.marginfigure, .marginfigure")
  const cap = figure?.querySelector(":scope > figcaption")
  const text = cap?.textContent?.trim()
  if (text) return text
  if (el instanceof HTMLImageElement) {
    if (el.alt.trim()) return el.alt.trim()
    // a margin figure's caption is the text beside its image
    const aside = el.closest(".marginfigure")
    if (aside) return aside.textContent?.trim() ?? ""
  }
  return ""
}

/**
 * Everything on the page the viewer can show, in reading order: top to bottom
 * as it's laid out, so a margin figure (whose copy sits in the margin column,
 * after the article in the html) comes beside the line it's on.
 */
function items(): Item[] {
  const found = collect()
  const top = new Map(found.map((i) => [i, i.origin.getBoundingClientRect().top]))
  return found.sort((a, b) => top.get(a)! - top.get(b)!)
}

/** A link to a picture, in the page's own text (not a preview's copy). */
const IMAGE_LINKS = "article a.internal[data-slug]"
const ownLink = (a: Element) => isImageLink(a) && !a.closest(".margin-preview, .margin-hover, .popover, .basalt-viewer")

function collect(): Item[] {
  const found: Item[] = []
  const candidates = document.querySelectorAll<HTMLElement>(
    `img.zoomable, ${DIAGRAMS}, figure.embed-frame, ${CODE}, ${IMAGE_LINKS}`,
  )
  for (const el of candidates) {
    if (el instanceof HTMLAnchorElement) {
      if (ownLink(el) && shown(el)) {
        const pair = themedPair(el)
        found.push({
          kind: "image",
          origin: el,
          caption: el.textContent?.trim() ?? "",
          src: pair && isDark() ? pair.dark : el.href,
          pair,
        })
      }
      continue
    }
    if (!shown(el) || el.closest(ELSEWHERE)) continue
    if (el instanceof HTMLImageElement) {
      // of a light and dark pair only the one showing is collected (the other is display: none)
      found.push({ kind: "image", origin: el, caption: captionOf(el), src: el.currentSrc || el.src, pair: themedPair(el) })
    } else if (el.matches(CODE)) {
      const name = el.querySelector(".code-file-name, [data-rehype-pretty-code-title]")?.textContent?.trim() ?? ""
      const raw = el.querySelector<HTMLAnchorElement>(".code-file-raw")?.href
      found.push({ kind: "code", origin: el, caption: name, src: raw })
    } else if (el.matches("figure.embed-frame")) {
      const frame = el.querySelector("iframe")
      if (frame) found.push({ kind: "frame", origin: el, caption: captionOf(frame), src: frame.src })
    } else if (drawingOf(el)) {
      found.push({ kind: "svg", origin: el, caption: captionOf(el) })
    }
  }
  return found
}

/** What the origin shows, measured: the image or svg itself, not its figure. */
function originBox(item: Item): DOMRect {
  if (item.from?.isConnected && shown(item.from)) return item.from.getBoundingClientRect()
  const el = item.kind === "svg" ? (drawingOf(item.origin) ?? item.origin) : item.origin
  return el.getBoundingClientRect()
}

/**
 * The transform that puts the media (laid out at `to`) where `from` is. The
 * media scales about its centre (so zooming does too), so it moves centre to
 * centre: measured from the corners, it set off towards the bottom right and
 * then turned back.
 */
function flip(from: DOMRect, to: DOMRect): string {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2)
  const dy = from.top + from.height / 2 - (to.top + to.height / 2)
  return `translate(${dx}px, ${dy}px) scale(${from.width / to.width}, ${from.height / to.height})`
}

let current: { close: (now?: boolean) => void } | null = null

export async function openViewer(start: HTMLElement, opener: { key?: boolean; from?: HTMLElement } = {}) {
  current?.close(true)
  const all = items()
  if (!all.length) return
  let index = Math.max(
    0,
    all.findIndex((i) => i.origin === start || i.origin.contains(start)),
  )
  if (opener.from) all[index].from = opener.from
  const returnFocus = document.activeElement as HTMLElement | null

  const dialog = document.createElement("dialog")
  dialog.className = "basalt-viewer"
  dialog.setAttribute("aria-label", "viewer")
  const bar = document.createElement("div")
  bar.className = "viewer-bar"
  const counter = document.createElement("span")
  counter.className = "viewer-count"
  const zoom = button("viewer-zoom", "zoom (z)", ICON("zoom"))
  const openOriginal = link("viewer-open", "open the original in a new tab", ICON("open"))
  openOriginal.target = "_blank"
  openOriginal.rel = "noopener"
  const download = link("viewer-download", "download", ICON("download"))
  const close = button("viewer-close", "close (esc)", ICON("close"))
  const copyCode = button("viewer-copy", "copy the code", ICON("copy"))
  // a picture with a light and a dark version: see the other one, in place
  const themeSwitch = button("viewer-theme", "the other theme's version (t)", ICON("moon"))
  const spacer = document.createElement("span")
  spacer.className = "viewer-spacer"
  bar.append(counter, spacer, themeSwitch, zoom, copyCode, openOriginal, download, close)

  const stage = document.createElement("div")
  stage.className = "viewer-stage"
  const caption = document.createElement("p")
  caption.className = "viewer-caption"
  const prev = button("viewer-prev", "previous (←)", ICON("prev"))
  const next = button("viewer-next", "next (→)", ICON("next"))
  dialog.append(bar, stage, prev, next, caption)
  document.body.append(dialog)
  dialog.showModal()
  close.focus({ preventScroll: true })
  // the ring around close is for keyboard users; a click didn't move focus
  if (!opener.key) dialog.dataset.pointer = ""
  dialog.addEventListener("keydown", () => delete dialog.dataset.pointer, { once: true })
  document.documentElement.dataset.viewer = ""

  // ---- the media, fitted to the stage, with its zoom and pan ----
  let media!: HTMLElement
  let fitW = 0
  let fitH = 0
  let scale = 1
  let tx = 0
  let ty = 0
  let maxScale = 1
  const apply = () => {
    media.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
    dialog.dataset.zoomed = scale > 1.01 ? "true" : "false"
  }
  const clamp = () => {
    const room = stage.getBoundingClientRect()
    const mx = Math.max(0, (fitW * scale - room.width) / 2)
    const my = Math.max(0, (fitH * scale - room.height) / 2)
    tx = Math.min(mx, Math.max(-mx, tx))
    ty = Math.min(my, Math.max(-my, ty))
  }
  /** Zoom to `to`, keeping the point at (x, y) (from the stage's centre) still. */
  const zoomTo = (to: number, x = 0, y = 0, animate = true) => {
    to = Math.min(maxScale, Math.max(1, to))
    tx = x - ((x - tx) * to) / scale
    ty = y - ((y - ty) * to) / scale
    scale = to
    if (scale === 1) tx = ty = 0
    clamp()
    if (animate && !still()) {
      media.style.transition = `transform 260ms ${EASE}`
      setTimeout(() => (media.style.transition = ""), 280)
    }
    apply()
  }
  const toggleZoom = (x = 0, y = 0) => zoomTo(scale > 1.01 ? 1 : Math.min(maxScale, Math.max(2, maxScale)), x, y)

  const build = async (item: Item): Promise<HTMLElement> => {
    const room = stage.getBoundingClientRect()
    let el: HTMLElement
    let w: number
    let h: number
    if (item.kind === "image") {
      const img = document.createElement("img")
      img.src = item.src!
      img.alt = item.origin instanceof HTMLImageElement ? item.origin.alt : item.caption
      img.draggable = false
      await img.decode().catch(() => {})
      const nw = img.naturalWidth || room.width
      const nh = img.naturalHeight || room.height
      // a photo at most its own size; a small one may grow by half again
      const fit = Math.min(room.width / nw, room.height / nh, nw < 800 ? 1.5 : 1)
      w = nw * fit
      h = nh * fit
      // zoom up to the image's own pixels, and at least twice the fit
      maxScale = Math.max(1 / fit, 2.5)
      el = img
    } else if (item.kind === "svg") {
      const source = drawingOf(item.origin)!
      const svg = source.cloneNode(true) as SVGSVGElement
      const box = source.getBoundingClientRect()
      const vb = source.viewBox?.baseVal
      const aspect = vb && vb.width ? vb.width / vb.height : box.width / box.height || 1
      // vector: as big as the screen allows, up to three times its size in
      // the page, with room around it
      const fit = Math.min((room.width * 0.92) / aspect, room.height * 0.92, Math.max(box.height * 3, 240))
      w = fit * aspect
      h = fit
      svg.removeAttribute("style")
      svg.setAttribute("width", String(w))
      svg.setAttribute("height", String(h))
      maxScale = 6
      el = document.createElement("div")
      el.append(svg)
    } else if (item.kind === "code") {
      // a copy of the code, highlighting and line numbers and all, at a
      // reading size, scrolling inside the stage when it's long
      const source = item.origin.matches("pre") ? item.origin : item.origin.querySelector("pre")!
      const pre = source.cloneNode(true) as HTMLElement
      pre.querySelectorAll(".clipboard-button, .viewer-expand").forEach((n) => n.remove())
      pre.removeAttribute("tabindex")
      el = document.createElement("div")
      el.append(pre)
      w = Math.min(room.width, 1040)
      h = 0
      maxScale = 1
    } else {
      const frame = document.createElement("iframe")
      frame.src = item.src!
      frame.title = item.caption || "a page"
      frame.allow = "fullscreen; clipboard-write"
      frame.referrerPolicy = "strict-origin-when-cross-origin"
      w = Math.min(room.width, 1280)
      h = room.height
      maxScale = 1
      el = frame
    }
    el.classList.add("viewer-media")
    el.dataset.kind = item.kind
    el.style.width = `${w}px`
    // code is as tall as it is, up to the stage, and scrolls past that
    if (item.kind === "code") el.style.maxHeight = `${room.height}px`
    else el.style.height = `${h}px`
    fitW = w
    fitH = h
    return el
  }

  let hidden: HTMLElement | null = null
  const hideOrigin = (item: Item) => {
    if (hidden) hidden.style.visibility = ""
    // the picture leaves its place; a link stays where it is
    const at = item.from ?? item.origin
    hidden = item.kind === "image" && at instanceof HTMLImageElement ? at : null
    if (hidden) hidden.style.visibility = "hidden"
  }

  const describe = (item: Item) => {
    counter.textContent = all.length > 1 ? `${index + 1} of ${all.length}` : ""
    caption.textContent = item.caption
    caption.hidden = !item.caption
    prev.hidden = next.hidden = all.length < 2
    zoom.hidden = item.kind === "frame" || item.kind === "code"
    copyCode.hidden = item.kind !== "code"
    themeSwitch.hidden = !item.pair
    if (item.pair) {
      const dark = item.src === item.pair.dark
      themeSwitch.innerHTML = ICON(dark ? "sun" : "moon")
      themeSwitch.setAttribute("aria-label", dark ? "the light version (t)" : "the dark version (t)")
      themeSwitch.title = themeSwitch.getAttribute("aria-label")!
      themeSwitch.setAttribute("aria-pressed", String(dark !== isDark()))
    }
    openOriginal.hidden = !item.src
    download.hidden = item.kind !== "image"
    if (item.src) openOriginal.href = item.src
    if (item.kind === "image") {
      download.href = item.src!
      download.setAttribute("download", decodeURIComponent(item.src!.split("/").pop()?.split("?")[0] ?? ""))
    }
  }

  let showing = 0
  const show = async (item: Item, grow: boolean, direction = 0) => {
    const mine = ++showing
    describe(item)
    const el = await build(item)
    // a quicker step has already moved on
    if (mine !== showing || finished) return
    scale = 1
    tx = ty = 0
    media = el
    apply()
    for (const old of stage.querySelectorAll<HTMLElement>(".viewer-media")) {
      old.classList.remove("viewer-media")
      old.classList.add("viewer-leaving")
      if (!still())
        old.animate([{ opacity: 1 }, { opacity: 0, translate: `${-direction * 40}px 0` }], {
          duration: 180,
          easing: EASE,
          fill: "forwards",
        })
      setTimeout(() => old.remove(), still() ? 0 : 190)
    }
    stage.append(el)
    hideOrigin(item)
    const from = originBox(item)
    if (grow && !still() && from.width && item.kind !== "frame") {
      el.animate([{ transform: flip(from, el.getBoundingClientRect()) }, { transform: "none" }], {
        duration: 420,
        easing: EASE,
      })
    } else if (!still()) {
      el.animate(
        [
          { opacity: 0, translate: `${direction * 40}px 0` },
          { opacity: 1, translate: "0 0" },
        ],
        { duration: 260, easing: EASE },
      )
    }
  }

  /** Show the current picture's light or dark version, in place: same size, same zoom. */
  const showVersion = async (dark: boolean) => {
    const item = all[index]
    if (!item.pair || media?.tagName !== "IMG") return
    const want = dark ? item.pair.dark : item.pair.light
    if (item.src === want) return
    item.src = want
    const img = media as HTMLImageElement
    const next = new Image()
    next.src = want
    await next.decode().catch(() => {})
    if (all[index] !== item) return
    // twins are the same size; one that isn't is fitted again
    const same = Math.abs(next.naturalWidth / next.naturalHeight - img.naturalWidth / img.naturalHeight) < 0.01
    if (!same) return void show(item, false)
    img.src = want
    describe(item)
  }
  copyCode.addEventListener("click", async () => {
    const code = media?.querySelector("code")
    if (!code) return
    try {
      await navigator.clipboard.writeText(code.innerText.replace(/\n$/, ""))
    } catch {
      return
    }
    copyCode.innerHTML = ICON("check")
    copyCode.dataset.done = "true"
    setTimeout(() => {
      copyCode.innerHTML = ICON("copy")
      delete copyCode.dataset.done
    }, 1400)
  })
  themeSwitch.addEventListener("click", () => {
    const item = all[index]
    if (item.pair) showVersion(item.src !== item.pair.dark)
  })
  // the page's theme turned while it's open: follow it
  const followTheme = () => showVersion(isDark())
  document.addEventListener("themechange", followTheme)

  const step = (by: number) => {
    if (all.length < 2) return
    index = (index + by + all.length) % all.length
    show(all[index], false, by)
  }

  // ---- closing: back into its place, always, even if an animation stalls ----
  let closing = false
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    if (hidden) hidden.style.visibility = ""
    resize.disconnect()
    document.removeEventListener("themechange", followTheme)
    if (dialog.open) dialog.close()
    dialog.remove()
    delete document.documentElement.dataset.viewer
    if (current === handle) current = null
    returnFocus?.focus?.({ preventScroll: true })
  }
  const shut = (now = false) => {
    if (now) return finish()
    if (closing) return
    closing = true
    const item = all[index]
    const to = originBox(item)
    const onScreen = to.width && to.bottom > 0 && to.top < innerHeight
    const duration = still() ? 80 : 300
    if (scale > 1.01) {
      scale = 1
      tx = ty = 0
      apply()
    }
    dialog.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: EASE, fill: "forwards" })
    if (onScreen && !still() && item.kind !== "frame" && media) {
      dialog.style.background = "transparent"
      media.animate(
        [{ transform: media.style.transform }, { transform: flip(to, media.getBoundingClientRect()) }],
        { duration, easing: EASE, fill: "forwards" },
      )
    }
    setTimeout(finish, duration + 20)
  }
  const handle = { close: shut }
  current = handle

  // a turned phone or a resized window: fit again
  let first = true
  const resize = new ResizeObserver(() => {
    if (first) return void (first = false)
    if (!closing) show(all[index], false)
  })

  close.addEventListener("click", () => shut())
  prev.addEventListener("click", () => step(-1))
  next.addEventListener("click", () => step(1))
  zoom.addEventListener("click", () => toggleZoom())
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault()
    shut()
  })
  // the browser may close it itself (a second escape with no click between):
  // tidy up all the same
  dialog.addEventListener("close", () => {
    if (!closing) {
      closing = true
      finish()
    }
  })
  dialog.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const keys: Record<string, () => void> = {
      Escape: () => shut(),
      ArrowLeft: () => step(-1),
      ArrowRight: () => step(1),
      z: () => toggleZoom(),
      t: () => themeSwitch.click(),
      "+": () => zoomTo(scale * 1.5),
      "=": () => zoomTo(scale * 1.5),
      "-": () => zoomTo(scale / 1.5),
      "0": () => zoomTo(1),
    }
    const act = keys[e.key]
    if (!act) return
    e.preventDefault()
    act()
  })

  // ---- pointer: click to zoom, drag to pan, pinch, swipe, the wheel ----
  const fromCentre = (e: { clientX: number; clientY: number }) => {
    const r = stage.getBoundingClientRect()
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2] as const
  }
  const pointers = new Map<number, { x: number; y: number }>()
  let gesture: {
    x: number
    y: number
    tx: number
    ty: number
    moved: boolean
    pinch?: { d: number; scale: number }
  } | null = null
  let lastTap = 0
  // code scrolls and selects as text: only a touch swipe (sideways for the
  // next, down from its top to close) and a tap beside it act on the viewer
  // (touch events, not pointer ones: the browser takes a pointer that scrolls)
  let codeSwipe: { x: number; y: number; top: number } | null = null
  stage.addEventListener(
    "touchstart",
    (e) => {
      if (media?.dataset.kind !== "code" || e.touches.length !== 1) return void (codeSwipe = null)
      codeSwipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, top: media.scrollTop }
    },
    { passive: true },
  )
  stage.addEventListener("touchend", (e) => {
    if (media?.dataset.kind !== "code" || !codeSwipe) return
    const t = e.changedTouches[0]
    const dx = t.clientX - codeSwipe.x
    const dy = t.clientY - codeSwipe.y
    const top = codeSwipe.top
    codeSwipe = null
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && media.scrollWidth <= media.clientWidth) step(dx < 0 ? 1 : -1)
    else if (dy > 90 && top <= 0) shut()
  })
  stage.addEventListener("click", (e) => {
    if (media?.dataset.kind === "code" && e.target === stage) shut()
  })
  stage.addEventListener("pointerdown", (e) => {
    if (!media || media.dataset.kind === "frame" || media.dataset.kind === "code") return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    stage.setPointerCapture(e.pointerId)
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      gesture = { ...gesture!, moved: true, pinch: { d: Math.hypot(a.x - b.x, a.y - b.y), scale } }
    } else gesture = { x: e.clientX, y: e.clientY, tx, ty, moved: false }
  })
  stage.addEventListener("pointermove", (e) => {
    if (!gesture || !pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (gesture.pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const [x, y] = fromCentre({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })
      zoomTo((gesture.pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) / gesture.pinch.d, x, y, false)
      return
    }
    const dx = e.clientX - gesture.x
    const dy = e.clientY - gesture.y
    if (Math.hypot(dx, dy) > 6) gesture.moved = true
    if (!gesture.moved) return
    if (scale > 1.01) {
      tx = gesture.tx + dx
      ty = gesture.ty + dy
      clamp()
      apply()
    } else {
      // at fit, a drag follows the finger: sideways to the next, down to close
      media.style.translate = Math.abs(dx) > Math.abs(dy) ? `${dx}px 0` : `0 ${Math.max(0, dy)}px`
      media.style.opacity = String(1 - Math.min(0.5, Math.max(0, dy) / 400))
    }
  })
  const release = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId) || !gesture) return
    if (pointers.size) return
    const g = gesture
    gesture = null
    if (g.pinch) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    media.style.translate = ""
    media.style.opacity = ""
    if (!g.moved) {
      // a tap on the picture zooms (a double tap, on touch); anywhere else closes
      const r = media.getBoundingClientRect()
      const onMedia = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      if (!onMedia) return shut()
      if (e.pointerType === "touch") {
        const now = Date.now()
        if (now - lastTap < 320) {
          lastTap = 0
          return toggleZoom(...fromCentre(e))
        }
        lastTap = now
        return
      }
      return toggleZoom(...fromCentre(e))
    }
    if (scale > 1.01) return
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1)
    else if (dy > 90) shut()
  }
  stage.addEventListener("pointerup", release)
  stage.addEventListener("pointercancel", release)
  stage.addEventListener(
    "wheel",
    (e) => {
      if (!media || media.dataset.kind === "frame" || media.dataset.kind === "code") return
      e.preventDefault()
      if (e.ctrlKey || scale <= 1.01) {
        // a pinch on a trackpad, or the wheel at fit: zoom about the pointer
        zoomTo(scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), ...fromCentre(e), false)
      } else {
        tx -= e.deltaX
        ty -= e.deltaY
        clamp()
        apply()
      }
    },
    { passive: false },
  )
  // the backdrop around the stage closes too
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) shut()
  })

  if (!still()) dialog.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: EASE })
  await show(all[index], true)
  resize.observe(stage)
}

/** A diagram or a frame gets a visible way into the viewer; an image is its own. */
function addExpands(root: ParentNode, signal: AbortSignal) {
  const targets = `${DIAGRAMS}, figure.embed-frame, figure.diagram-graph`
  for (const el of root.querySelectorAll<HTMLElement>(targets)) {
    if (el.querySelector(":scope > .viewer-expand") || el.closest(ELSEWHERE)) continue
    const b = button("viewer-expand", "full screen", ICON("expand"))
    b.addEventListener(
      "click",
      (e) => {
        e.stopPropagation()
        // a live graph can't be copied into the viewer: it goes full screen
        // itself, and graphembed.ts refits its camera to the new room
        if (el.matches("figure.diagram-graph")) toggleFullscreen(el)
        else openViewer(el)
      },
      { signal },
    )
    el.append(b)
    if (el.matches("figure.diagram-graph")) fullscreenButton(b, el, signal)
  }
  // a long code block (not a code file, whose bar has its own button)
  for (const pre of root.querySelectorAll<HTMLElement>("article pre")) {
    if (pre.closest(`figure.code-file, figure.diagram, ${ELSEWHERE}, .mermaid-source`) || pre.matches(":has(> code.mermaid)")) continue
    const block = pre.closest<HTMLElement>("figure[data-rehype-pretty-code-figure]") ?? pre
    if (block.hasAttribute("data-viewer-code")) continue
    const lines = pre.querySelectorAll("[data-line], .line").length || (pre.textContent ?? "").split("\n").length
    if (lines <= LONG_CODE) continue
    block.dataset.viewerCode = ""
    const b = button("viewer-expand", "full screen", ICON("expand"))
    b.addEventListener(
      "click",
      (e) => {
        e.stopPropagation()
        openViewer(block)
      },
      { signal },
    )
    block.append(b)
  }
}

/** A code file's full-screen button opens it here (codefile.ts). */
export const openCode = (figure: HTMLElement) => openViewer(figure)

// a link to a picture opens it here rather than going to the file (⌘/ctrl
// still does). In capture, before Astro's router takes the click.
document.addEventListener(
  "click",
  (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const target = e.target as Element
    // the link itself, or the picture its preview shows in the side content
    const preview = target.closest?.<HTMLElement>(".margin-hover > .margin-image:not([data-leaving])")
    const link = preview
      ? [...document.querySelectorAll<HTMLAnchorElement>(IMAGE_LINKS)].find(
          (a) => ownLink(a) && new URL(a.href).pathname === preview.dataset.src,
        )
      : target.closest?.("a")
    if (!link || !ownLink(link)) return
    e.preventDefault()
    e.stopPropagation()
    const src = new URL(link.href).pathname
    const shownPreview =
      preview ??
      [...document.querySelectorAll<HTMLElement>(".margin-hover > .margin-image:not([data-leaving])")].find(
        (p) => p.dataset.src === src,
      )
    openViewer(link, { from: shownPreview?.querySelector("img") ?? undefined })
  },
  { capture: true },
)

// one listener for the whole page, so an image in the margin opens as well as
// one in the text
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
  const target = e.target as Element
  if (target.closest(".basalt-viewer, a, button")) return
  const el = target.closest<HTMLElement>(`img.zoomable, ${DIAGRAMS}`)
  if (!el || el.closest(ELSEWHERE)) return
  e.preventDefault()
  openViewer(el)
})
document.addEventListener("keydown", (e) => {
  const el = e.target as HTMLElement
  if ((e.key === "Enter" || e.key === " ") && el.matches?.("img.zoomable")) {
    e.preventDefault()
    openViewer(el, { key: true })
  }
})

/** an image opens on Enter too; a copy hidden from assistive tech stays out of the tab order */
function operable(img: HTMLImageElement) {
  if (img.closest(ELSEWHERE) || img.dataset.viewable) return
  img.dataset.viewable = ""
  if (img.closest("[aria-hidden='true']")) return
  img.tabIndex = 0
  img.setAttribute("role", "button")
  if (!img.getAttribute("aria-label")) img.setAttribute("aria-label", `view ${img.alt || "image"} full screen`)
}

export function startViewer(signal: AbortSignal) {
  addExpands(document, signal)
  // mermaid draws after the page arrives: give its figures their expand too
  document.addEventListener("basalt:diagram", () => addExpands(document, signal), { signal })
  document.querySelectorAll<HTMLImageElement>("img.zoomable").forEach(operable)
  signal.addEventListener("abort", () => current?.close(true))
}
