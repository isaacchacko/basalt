// <sound> (src/markdown/sound.ts): a click on the word (or enter or space on
// it) plays its first clip, and again stops it; a ▶ row in its card in the
// side content (previews.ts) plays that row's clip. One clip at a time, on
// the whole site. While one plays, a card for its song stays in the side
// content, level with its word and then held at the top as the word scrolls
// away, with the clip's progress; on a phone, a bar at the foot of the
// screen. It goes when the clip ends, is stopped, or the page changes.

import { isBeside, lineOf } from "./margin"

type Track = { title: string; artist?: string; album?: string; year?: string; cover?: string; url?: string }
export type Clip = { src: string; label?: string; track?: Track }

export const clipsOf = (word: HTMLElement): Clip[] => {
  try {
    return JSON.parse(word.dataset.clips ?? "[]")
  } catch {
    return []
  }
}
const srcsOf = (word: Element) => (word.getAttribute("data-sound") ?? "").split(/\s*,\s*/).filter(Boolean)
const wordFor = (src: string) =>
  [...document.querySelectorAll<HTMLElement>("article .sound")].find((w) => srcsOf(w).includes(src)) ?? null

let now: { audio: HTMLAudioElement; clip: Clip; word: HTMLElement | null; card: HTMLElement; holder: HTMLElement } | null = null

/** what's playing, marked wherever it shows: its word, and its rows in cards */
function mark(src: string | null) {
  for (const el of document.querySelectorAll<HTMLElement>(".sound[data-playing], [data-sound-play].is-playing")) {
    el.removeAttribute("data-playing")
    el.classList.remove("is-playing")
  }
  if (!src) return
  for (const el of document.querySelectorAll<HTMLElement>("[data-sound-play]"))
    if (el.dataset.soundPlay === src) el.classList.add("is-playing")
  ;(now?.word ?? wordFor(src))?.setAttribute("data-playing", "")
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
  const node = document.createElement(tag)
  node.className = cls
  if (text) node.textContent = text
  return node
}

/** the card for what's playing: its cover (or a ♪), song, artist and album, progress, stop */
function cardFor(clip: Clip, word: HTMLElement | null) {
  const card = el("div", "basalt-now-playing")
  card.setAttribute("role", "status")
  const t = clip.track
  const link = (cls: string) => {
    if (!t?.url) return el("span", cls)
    const a = el("a", cls)
    a.href = t.url
    a.target = "_blank"
    a.rel = "noopener"
    return a
  }
  const cover = link("basalt-now-playing-cover")
  if (t?.cover) {
    const img = el("img", "")
    img.src = t.cover
    img.alt = ""
    cover.append(img)
  } else cover.append(el("span", "basalt-now-playing-blank", "♪"))
  const text = el("div", "basalt-now-playing-text")
  text.append(el("span", "basalt-now-playing-what", clip.label ? `now playing · ${clip.label}` : "now playing"))
  const title = link("basalt-now-playing-title")
  title.textContent = t?.title ?? word?.textContent?.trim() ?? "a clip"
  text.append(title)
  const by = [t?.artist, t?.album].filter(Boolean).join(" · ")
  if (by) text.append(el("span", "basalt-now-playing-by", by))
  const stop = el("button", "basalt-now-playing-stop")
  stop.type = "button"
  stop.setAttribute("aria-label", "stop")
  stop.title = "stop"
  stop.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/></svg>'
  stop.addEventListener("click", () => halt())
  const bar = el("span", "basalt-now-playing-bar")
  card.append(cover, text, stop, bar)
  return card
}

/** Where the card goes: beside the word, held at the top past it; or, with no side content, the foot of the screen. */
function place(card: HTMLElement, word: HTMLElement | null): HTMLElement {
  const margin = document.querySelector<HTMLElement>("aside.margin")
  if (isBeside() && margin && word && word.closest("article")) {
    const rail = el("div", "basalt-now-playing-rail")
    rail.style.top = `${Math.max(0, lineOf(word).top - margin.getBoundingClientRect().top)}px`
    rail.append(card)
    margin.append(rail)
    return rail
  }
  card.classList.add("is-bar")
  document.body.append(card)
  return card
}

function halt() {
  if (!now) return
  const { audio, card, holder } = now
  now = null
  audio.pause()
  mark(null)
  card.classList.add("is-leaving")
  setTimeout(() => holder.remove(), 220)
}

export function play(clip: Clip, word: HTMLElement | null) {
  // the same clip of the same word, again: stop
  if (now?.clip.src === clip.src && now.word === word) return halt()
  halt()
  document.dispatchEvent(new CustomEvent("basalt:sound", { detail: { src: clip.src } }))
  const audio = new Audio(clip.src)
  const card = cardFor(clip, word)
  const holder = place(card, word)
  now = { audio, clip, word, card, holder }
  mark(clip.src)
  const mine = () => now?.audio === audio
  audio.addEventListener("timeupdate", () => {
    if (mine() && audio.duration) card.style.setProperty("--done", `${(audio.currentTime / audio.duration) * 100}%`)
  })
  audio.addEventListener("ended", () => mine() && halt())
  audio.play().catch(() => mine() && halt())
}

/** the clip a ▶ row means: its word's own (with its song), else just the file */
const clipFor = (src: string): [Clip, HTMLElement | null] => {
  const word = wordFor(src)
  return [(word && clipsOf(word).find((c) => c.src === src)) || { src }, word]
}

const act = (target: EventTarget | null): boolean => {
  const t = target as Element | null
  const row = t?.closest?.<HTMLElement>("[data-sound-play]")
  if (row?.dataset.soundPlay) {
    play(...clipFor(row.dataset.soundPlay))
    return true
  }
  const word = t?.closest?.<HTMLElement>(".sound")
  if (!word || word.closest(".basalt-now-playing")) return false
  const first = clipsOf(word)[0] ?? (srcsOf(word)[0] ? { src: srcsOf(word)[0] } : null)
  if (first) play(first, word)
  return !!first
}
document.addEventListener("click", (e) => {
  if (e.button === 0 && act(e.target)) e.preventDefault()
})
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && act(e.target)) e.preventDefault()
})
document.addEventListener("astro:before-swap", halt)
