// Basalt's embeds, in the browser, and what the media scripts share. Everything
// here upgrades markup that works without it: a facade is a link to the video,
// a tweet is a quote with a link.

export const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches
export const EASE = "cubic-bezier(0.2, 0.7, 0.1, 1)"

/** A link to a picture in the garden: `[[phone.png|on a phone]]`, `[x](assets/a.jpg)`. */
export const isImageLink = (a: Element): boolean =>
  a instanceof HTMLAnchorElement &&
  a.matches("a.internal[data-slug]") &&
  /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(a.dataset.slug ?? "")

export const icon = (d: string, size = 18, stroke = 1.8) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`

export const PATHS = {
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  collapse: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  prev: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  zoom: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M11 8v6M8 11h6"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  sun: '<circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path fill="currentColor" d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
}

export function button(cls: string, label: string, svg: string): HTMLButtonElement {
  const b = document.createElement("button")
  b.type = "button"
  b.className = cls
  b.setAttribute("aria-label", label)
  b.title = label
  b.innerHTML = svg
  return b
}

/** A link the router and the link previews leave alone. */
export function link(cls: string, label: string, svg: string): HTMLAnchorElement {
  const a = document.createElement("a")
  a.className = cls
  a.setAttribute("aria-label", label)
  a.title = label
  a.innerHTML = svg
  a.dataset.noPopover = "true"
  a.dataset.astroReload = ""
  return a
}

/**
 * A picture's light and dark versions, when it has both (src/markdown/themed.ts):
 * an `img.themed-light` and its `img.themed-dark` twin, or a link to one,
 * carrying the dark one as `data-dark-src`.
 */
export function themedPair(el: Element): { light: string; dark: string } | undefined {
  if (el instanceof HTMLAnchorElement) return el.dataset.darkSrc ? { light: el.href, dark: el.dataset.darkSrc } : undefined
  if (!(el instanceof HTMLImageElement)) return undefined
  const light = el.classList.contains("themed-light")
  if (!light && !el.classList.contains("themed-dark")) return undefined
  const twin = el.parentElement?.querySelector<HTMLImageElement>(light ? ":scope > img.themed-dark" : ":scope > img.themed-light")
  if (!twin) return undefined
  const src = (img: HTMLImageElement) => img.currentSrc || img.src
  return light ? { light: src(el), dark: src(twin) } : { light: src(twin), dark: src(el) }
}

/** Whether the page is dark: the toggle's choice if it made one, else the system's. */
export function isDark(): boolean {
  const root = document.documentElement
  const chosen = root.getAttribute("saved-theme") ?? root.dataset.theme
  if (chosen === "dark" || chosen === "light") return chosen === "dark"
  if (root.classList.contains("dark")) return true
  return matchMedia("(prefers-color-scheme: dark)").matches
}

/** Calls `fn` whenever the page turns light or dark, until `signal` aborts. */
export function onTheme(fn: () => void, signal: AbortSignal) {
  let dark = isDark()
  const check = () => {
    if (isDark() === dark) return
    dark = !dark
    fn()
  }
  const watch = new MutationObserver(check)
  watch.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["saved-theme", "data-theme", "class"],
  })
  const system = matchMedia("(prefers-color-scheme: dark)")
  system.addEventListener("change", check, { signal })
  document.addEventListener("themechange", check, { signal })
  signal.addEventListener("abort", () => watch.disconnect())
}

function playFacade(facade: HTMLAnchorElement) {
  const iframe = document.createElement("iframe")
  iframe.src = facade.dataset.embedSrc!
  iframe.title = facade.dataset.embedTitle ?? ""
  iframe.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture"
  iframe.allowFullscreen = true
  iframe.referrerPolicy = "strict-origin-when-cross-origin"
  iframe.className = "embed-playing"
  facade.replaceWith(iframe)
}

type Twttr = { widgets?: { load: (el?: Element) => void } }
let widgets: Promise<void> | null = null

function loadTweets(root: Element) {
  const tweets = root.querySelectorAll("blockquote.twitter-tweet")
  if (!tweets.length) return
  const theme = isDark() ? "dark" : "light"
  tweets.forEach((t) => t.setAttribute("data-theme", theme))
  widgets ??= new Promise((resolve) => {
    const script = document.createElement("script")
    script.src = "https://platform.twitter.com/widgets.js"
    script.async = true
    script.onload = () => resolve()
    // blocked by a content blocker: the quote and its link stay, which is fine
    script.onerror = () => resolve()
    document.head.appendChild(script)
  })
  // not on a page swapped out meanwhile (a save): the script fails on one
  widgets.then(() => root.isConnected && (window as unknown as { twttr?: Twttr }).twttr?.widgets?.load(root))
}

const PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z"/></svg>'
const PAUSE = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect fill="currentColor" x="6.5" y="5" width="4" height="14" rx="1"/><rect fill="currentColor" x="13.5" y="5" width="4" height="14" rx="1"/></svg>'

const clock = (s: number) => {
  if (!Number.isFinite(s)) return "0:00"
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`
}

/** An <audio> with controls becomes a slim bar in the page's colours: play, time, a scrubber. */
function themeAudio(audio: HTMLAudioElement, signal: AbortSignal) {
  if (audio.dataset.themed) return
  const bar = document.createElement("div")
  bar.className = "audio-player"
  const play = button("audio-play", "play", PLAY)
  const at = document.createElement("span")
  at.className = "audio-time"
  at.textContent = "0:00"
  const seek = document.createElement("input")
  seek.type = "range"
  seek.className = "audio-seek"
  seek.min = "0"
  seek.step = "any"
  seek.value = "0"
  seek.setAttribute("aria-label", "seek")
  const total = document.createElement("span")
  total.className = "audio-time audio-total"
  total.textContent = "0:00"
  bar.append(play, at, seek, total)
  audio.dataset.themed = "true"
  audio.after(bar)

  const on = <K extends keyof HTMLMediaElementEventMap>(k: K, fn: () => void) =>
    audio.addEventListener(k, fn, { signal })
  const paint = () => {
    const d = audio.duration
    seek.max = String(Number.isFinite(d) ? d : 0)
    total.textContent = clock(d)
    at.textContent = clock(audio.currentTime)
    if (document.activeElement !== seek) seek.value = String(audio.currentTime)
    seek.style.setProperty("--done", `${d ? (audio.currentTime / d) * 100 : 0}%`)
  }
  const state = () => {
    const playing = !audio.paused
    play.innerHTML = playing ? PAUSE : PLAY
    play.setAttribute("aria-label", playing ? "pause" : "play")
    play.title = playing ? "pause" : "play"
  }
  on("loadedmetadata", paint)
  on("durationchange", paint)
  on("timeupdate", paint)
  on("play", state)
  on("pause", state)
  on("ended", state)
  play.addEventListener("click", () => (audio.paused ? audio.play() : audio.pause()), { signal })
  seek.addEventListener(
    "input",
    () => {
      audio.currentTime = Number(seek.value)
      paint()
    },
    { signal },
  )
  if (audio.readyState >= 1) paint()
  signal.addEventListener("abort", () => {
    bar.remove()
    delete audio.dataset.themed
  })
}

/**
 * A copy of the page's own content (a marked card in the side content,
 * previews.ts) has the enhanced markup but none of its listeners: build its
 * audio players and video facades again, on the copy.
 */
export function enhanceCopy(root: HTMLElement) {
  const signal = new AbortController().signal
  for (const bar of root.querySelectorAll(".audio-player")) bar.remove()
  for (const audio of root.querySelectorAll<HTMLAudioElement>("audio[data-themed]")) {
    delete audio.dataset.themed
    themeAudio(audio, signal)
  }
  for (const facade of root.querySelectorAll<HTMLAnchorElement>("a.embed-facade"))
    facade.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
      e.preventDefault()
      playFacade(facade)
    })
}

export function startEmbeds(signal: AbortSignal) {
  const article = document.querySelector("article") ?? document.body
  const onFacade = (e: MouseEvent) => {
    // a new-tab click still goes to the video's own page
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    playFacade(e.currentTarget as HTMLAnchorElement)
  }
  for (const facade of article.querySelectorAll<HTMLAnchorElement>("a.embed-facade")) {
    facade.dataset.astroReload = ""
    facade.addEventListener("click", onFacade, { signal })
  }
  for (const audio of article.querySelectorAll<HTMLAudioElement>("figure.embed-audio > audio[controls]"))
    themeAudio(audio, signal)
  loadTweets(article)
}
