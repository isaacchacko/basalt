// A note's history (lib/history.ts), on its page. The clock in the navbar's
// tray (components/HistoryToggle.astro) turns it on: the navbar's explorer gives
// its place to a timeline of the commits that touched the note, newest first, and
// a click on one shows the note as it was then, its changes marked (added
// highlighted, removed struck through; "Plain" shows it without them). ↑/↓
// (j/k) step from commit to commit, Esc comes back to now, and ?at=<sha> in
// the url is a link to that version. It's on for this page, or with "Every
// page" for every page that has a history, as this browser remembers.
//
// A version is drawn in the article, over its own blocks (hidden), and its
// parts started there (content.ts), as the editor draws blocks (editor.ts);
// the margin takes its notes from it (margin.ts). Editing and a version
// exclude each other: ⌘E or the pencil comes back to now first.

import { startContent } from "./content"
import { needSheets } from "./sheets"

interface Commit {
  sha: string
  date: string
  subject: string
  author: string
  path: string
  change: "A" | "M" | "R"
}
interface Commits {
  slug: string
  complete: boolean
  commits: Commit[]
}
interface Version {
  sha: string
  base: string | null
  path: string
  html: string
  plain: string
}

declare global {
  interface Window {
    /** for tests: the note's commits, the version shown (null: now), show one, and wait till it's drawn */
    basaltHistory?: { commits(): Commit[]; at(): string | null; show(sha: string | null): Promise<void>; idle(): Promise<void> }
  }
}

const root = document.documentElement
const KEY = "basalt-history"

type Kept = { everywhere: boolean; pages: string[]; plain: boolean }
function kept(): Kept {
  try {
    return { everywhere: false, pages: [], plain: false, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }
  } catch {
    return { everywhere: false, pages: [], plain: false }
  }
}
function keep(change: Partial<Kept>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...kept(), ...change }))
  } catch {}
}

const button = () => document.querySelector<HTMLButtonElement>(".history-toggle")
const article = () => document.querySelector<HTMLElement>("article[data-history]")
const slugOf = (art: HTMLElement) => document.body.dataset.slug ?? art.dataset.editSlug ?? ""

/** what the button says, from the page (the site's own words) */
function said(key: string): string {
  try {
    return JSON.parse(button()?.dataset.historyWords ?? "{}")[key] ?? key
  } catch {
    return key
  }
}

const source = (art: HTMLElement, slug: string, sha?: string) =>
  art.dataset.history === "dev"
    ? `/__basalt/history?slug=${encodeURIComponent(slug)}${sha ? `&at=${sha}` : ""}`
    : `/static/history/${slug.split("/").map(encodeURIComponent).join("/")}${sha ? `/${sha}` : ""}.json`

async function json<T>(url: string): Promise<T | undefined> {
  const res = await fetch(url).catch(() => undefined)
  return res?.ok ? res.json() : undefined
}

// the page's history, while it's on
let on:
  | {
      art: HTMLElement
      slug: string
      timeline: HTMLElement
      commits: Commit[]
      at: string | null
      drawn: Promise<void>
      started?: AbortController
      shown?: HTMLElement
    }
  | undefined
const versions = new Map<string, Promise<Version | undefined>>()

/** a commit's date, and its time when another the same day has one too (under it) */
function day(iso: string, all: Commit[]) {
  const d = new Date(iso)
  const lang = root.lang || undefined
  const date = element("span", { class: "history-date" }, d.toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" }))
  const twin = all.some((c) => c.date !== iso && new Date(c.date).toDateString() === d.toDateString())
  return twin ? [date, element("span", { class: "history-time" }, d.toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit" }))] : [date]
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...children: (Node | string)[]) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) el.setAttribute(k, v)
  el.append(...children)
  return el
}

function timelineOf(slug: string): HTMLElement {
  const close = element("button", { class: "history-close", type: "button", "aria-label": said("historyClose") }, "×")
  const plain = element("button", { class: "history-plain", type: "button", "aria-pressed": String(kept().plain) }, said("historyPlain"))
  const every = element("input", { class: "history-everywhere", type: "checkbox" }) as HTMLInputElement
  every.checked = kept().everywhere
  const nav = element(
    "nav",
    { class: "history-timeline", "aria-label": said("historyTitle"), "data-slug": slug },
    element("div", { class: "history-head" }, element("span", { class: "history-title" }, said("historyTitle")), close),
    element("div", { class: "history-options" }, plain, element("label", { class: "history-every" }, every, said("historyEverywhere"))),
    element("ol", { class: "history-entries" }, element("li", {}, element("a", { class: "history-entry history-now", href: "?", "aria-current": "true" }, said("historyNow")))),
  )
  close.addEventListener("click", () => void turn(false))
  plain.addEventListener("click", () => {
    const now = !kept().plain
    keep({ plain: now })
    plain.setAttribute("aria-pressed", String(now))
    root.toggleAttribute("data-history-plain", now)
    if (on?.at) void show(on.at)
  })
  every.addEventListener("change", () => keep({ everywhere: every.checked }))
  nav.addEventListener("click", (e) => {
    const entry = (e.target as Element).closest<HTMLAnchorElement>(".history-entry")
    if (!entry) return
    e.preventDefault()
    // the keys step from here (no ring for a click)
    entry.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
    void show(entry.dataset.sha ?? null)
  })
  return nav
}

function listed(nav: HTMLElement, list: Commits) {
  const ol = nav.querySelector("ol")!
  for (const c of list.commits) {
    const a = element(
      "a",
      { class: "history-entry", href: `?at=${c.sha}`, "data-sha": c.sha, "data-date": c.date, title: `${c.subject}, ${c.author}` },
      element("time", { datetime: c.date }, ...day(c.date, list.commits)),
    )
    ol.append(element("li", {}, a))
  }
  if (!list.commits.length) nav.append(element("p", { class: "history-empty" }, said("historyNone")))
  else if (!list.complete) nav.append(element("p", { class: "history-partial" }, said("historyPartial")))
}

/** The note as it was at `sha`, its changes marked (or plain), in the article; null: as it is. */
function show(sha: string | null): Promise<void> {
  const h = on
  if (!h) return Promise.resolve()
  h.at = sha
  for (const a of h.timeline.querySelectorAll(".history-entry")) a.toggleAttribute("aria-current", ((a as HTMLElement).dataset.sha ?? null) === sha)
  h.timeline.querySelector("[aria-current]")?.setAttribute("aria-current", "true")
  h.timeline.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest" })
  const url = new URL(location.href)
  if (sha) url.searchParams.set("at", sha)
  else url.searchParams.delete("at")
  history.replaceState(history.state, "", url)
  h.drawn = (async () => {
    const v = sha ? await (versions.get(`${h.slug}\0${sha}`) ?? versions.set(`${h.slug}\0${sha}`, json<Version>(source(h.art, h.slug, sha))).get(`${h.slug}\0${sha}`)!) : undefined
    // another came since
    if (on !== h || h.at !== sha) return
    h.started?.abort()
    h.shown?.remove()
    h.shown = undefined
    if (v) {
      h.started = new AbortController()
      const drawn = element("div", { class: "history-version" })
      drawn.innerHTML = kept().plain ? v.plain : v.html
      h.art.append(drawn)
      h.shown = drawn
      h.art.dataset.historyAt = sha!
      startContent(h.started.signal, drawn)
    } else h.art.removeAttribute("data-history-at")
    document.dispatchEvent(new Event("basalt:drawn"))
  })()
  return h.drawn
}

/** Turns the page's history on or off. */
async function turn(want: boolean) {
  const art = article()
  if (!art) return
  const slug = slugOf(art)
  if (want === !!on) return
  if (!want) {
    await show(null)
    on?.timeline.remove()
    on = undefined
    root.removeAttribute("data-history")
    root.removeAttribute("data-history-plain")
    const k = kept()
    keep({ everywhere: false, pages: k.pages.filter((p) => p !== slug) })
    sync()
    return
  }
  const k = kept()
  if (!k.pages.includes(slug)) keep({ pages: [...k.pages, slug] })
  await needSheets(["history"])
  if (on || article() !== art) return
  const timeline = timelineOf(slug)
  // in the navbar, where its explorer is (history.scss hides that)
  const nav = document.querySelector(".sidebar.left")
  const explorer = nav?.querySelector(":scope > .explorer")
  if (explorer) explorer.after(timeline)
  else if (nav) nav.insertBefore(timeline, nav.querySelector(":scope > .nav-tray"))
  else document.querySelector("#quartz-body")?.prepend(timeline)
  on = { art, slug, timeline, commits: [], at: null, drawn: Promise.resolve() }
  root.setAttribute("data-history", "")
  root.toggleAttribute("data-history-plain", k.plain)
  sync()
  const h = on
  h.drawn = (async () => {
    const list = await json<Commits>(source(art, slug))
    if (on !== h) return
    h.commits = list?.commits ?? []
    listed(timeline, list ?? { slug, complete: true, commits: [] })
    const at = new URL(location.href).searchParams.get("at")
    if (at && h.commits.some((c) => c.sha === at)) await show(at)
  })()
  await h.drawn
}

function sync() {
  const b = button()
  if (!b) return
  b.hidden = !article()
  b.setAttribute("aria-pressed", String(!!on))
}

/** one step through the commits: older (1) or newer (-1), now being newest of all */
function step(by: 1 | -1) {
  if (!on) return
  const shas = [null, ...on.commits.map((c) => c.sha)]
  const i = Math.min(shas.length - 1, Math.max(0, shas.indexOf(on.at) + by))
  void show(shas[i])
}

document.addEventListener("click", (e) => {
  if (!(e.target as Element).closest?.(".history-toggle")) return
  void turn(!on)
})

document.addEventListener("keydown", (e) => {
  if (!on || e.metaKey || e.ctrlKey || e.altKey || root.hasAttribute("data-editing")) return
  const t = e.target as HTMLElement
  if (t.closest?.("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return
  const across = getComputedStyle(on.timeline).flexDirection === "row"
  const older = e.key === "ArrowDown" || e.key === "j" || (across && e.key === "ArrowRight")
  const newer = e.key === "ArrowUp" || e.key === "k" || (across && e.key === "ArrowLeft")
  if (older || newer) {
    e.preventDefault()
    step(older ? 1 : -1)
  } else if (e.key === "Escape" && on.at) {
    e.preventDefault()
    void show(null)
  }
})

// editing is of the note as it is: a version shown goes first (before edit.ts hears of it)
const now = () => {
  if (on?.at) void show(null)
}
addEventListener("keydown", (e) => (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e" && now(), true)
addEventListener("click", (e) => (e.target as Element).closest?.(".edit-toggle") && now(), true)

document.addEventListener("astro:before-swap", () => {
  on?.started?.abort()
  // the navbar it's in is kept across pages; the timeline is this page's
  on?.timeline.remove()
  on = undefined
  root.removeAttribute("data-history")
  root.removeAttribute("data-history-plain")
})

document.addEventListener("astro:page-load", () => {
  sync()
  const art = article()
  if (!art) return
  const k = kept()
  if (k.everywhere || k.pages.includes(slugOf(art)) || new URL(location.href).searchParams.has("at")) void turn(true)
})

window.basaltHistory = {
  commits: () => on?.commits ?? [],
  at: () => on?.at ?? null,
  show,
  idle: () => on?.drawn ?? Promise.resolve(),
}
