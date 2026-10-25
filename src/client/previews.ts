// What's hovered, in the margin: a link to another note shows that note's
// title and opening, anything that asks for a tooltip ([data-tip], or a
// title= in the note) shows its words, quietly, and anything with a child
// marked [data-secondary] (an island's card: a site's screenshot, the track
// that's playing) shows that child, which never shows in the text itself.
// A link to an image shows the image, captioned with the link's words; a
// click on it opens the viewer (viewer.ts), growing out of that preview. Each sits level with the line
// of what it's about. One shows at a time; the notes under it fade back
// instead of moving, and come back when it goes. It goes after a short grace,
// unless the pointer is on it.
//
// Only beside a margin: on a phone, a link is just a link.

import { isDark, isImageLink, themedPair } from "./embeds"
import { isBeside, levelWith, lineOf, onPage } from "./margin"

const SHOW_MS = 90
const HIDE_MS = 420
/** how much of a note's opening a preview shows, in characters */
const OPENING = 420

type Item = { key: string; build: () => Promise<HTMLElement | null> }

const parser = new DOMParser()
const pages = new Map<string, Promise<Document | { image: string } | null>>()

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text) node.textContent = text
  return node
}

/** A page, fetched once. */
function page(url: URL) {
  const key = url.pathname
  if (!pages.has(key))
    pages.set(
      key,
      fetch(url)
        .then(async (res) => {
          if (!res.ok) return null
          const type = res.headers.get("content-type") ?? ""
          if (type.startsWith("image/")) return { image: url.pathname }
          if (!type.startsWith("text/html")) return null
          return parser.parseFromString(await res.text(), "text/html")
        })
        .catch(() => null),
    )
  return pages.get(key)!
}

/** Relative hrefs and srcs in what came from `base`, made to work here. */
function rebase(node: Element, base: URL) {
  for (const n of node.querySelectorAll<HTMLElement>("[href], [src]")) {
    for (const attr of ["href", "src"]) {
      const v = n.getAttribute(attr)
      if (v && !/^(#|[a-z]+:|\/)/i.test(v)) n.setAttribute(attr, new URL(v, base).pathname)
    }
  }
}

const SKIP = "style, script, aside, .marginnote, .sidenote, section[data-footnotes], .footnotes, .margin, nav"

/** A note's opening: blocks from `start` until about OPENING characters. */
function opening(start: Element | null, stopAtDepth?: number): Element[] {
  const out: Element[] = []
  let length = 0
  for (let n = start; n && length < OPENING && out.length < 4; n = n.nextElementSibling) {
    if (n.matches(SKIP) || n.matches("h1")) continue
    const depth = /^H([1-6])$/.exec(n.tagName)?.[1]
    if (stopAtDepth && out.length && depth && Number(depth) <= stopAtDepth) break
    const copy = n.cloneNode(true) as Element
    copy.querySelectorAll(".sidenote, sup:has(> a[data-footnote-ref]), .marginnote, style, script").forEach((x) => x.remove())
    copy.querySelectorAll("[id]").forEach((x) => x.removeAttribute("id"))
    copy.removeAttribute("id")
    out.push(copy)
    length += copy.textContent?.length ?? 0
  }
  return out
}

function notePreview(link: HTMLAnchorElement): Item {
  const url = new URL(link.href)
  const hash = decodeURIComponent(url.hash.slice(1))
  url.hash = ""
  url.search = ""
  return {
    key: `note:${url.pathname}#${hash}`,
    build: async () => {
      const got = await page(url)
      if (!got) return null
      const box = el("div", "margin-preview")
      const title = el("a", "margin-preview-title")
      title.href = link.href
      title.dataset.noPreview = "true"
      if ("image" in got) {
        title.textContent = decodeURIComponent(url.pathname.split("/").pop() ?? "")
        const img = el("img")
        img.src = got.image
        img.alt = title.textContent
        const body = el("div", "margin-preview-body")
        body.append(img)
        box.append(title, body)
        return box
      }
      const article = got.querySelector("main article") ?? got.querySelector("article")
      if (!article) return null
      // the page's own title, never an h1 inside it (a note it embeds has one)
      title.textContent =
        got.querySelector("h1.article-title")?.textContent?.trim() || got.title.split(" · ")[0] || url.pathname
      const heading = hash ? article.querySelector(`[id="${CSS.escape(hash)}"]`) : null
      const section = heading?.closest("h2, h3, h4, h5, h6") ?? null
      const blocks = section
        ? opening(section, Number(section.tagName[1]))
        : opening(article.firstElementChild)
      const body = el("div", "margin-preview-body")
      body.append(...blocks.map((b) => document.importNode(b, true)))
      rebase(body, url)
      // a page preview is a window onto another page, and says so: where the
      // page is above it, that it goes on below it. (A tooltip, or a card the
      // page itself wrote, has neither.)
      box.classList.add("margin-page")
      const crumbs = [...got.querySelectorAll(".breadcrumb-container .breadcrumb-element")]
        // a crumb's words, without the arrow drawn after it
        .map((c) => c.textContent?.replace(/[❯›>»]/g, "").trim())
        .filter(Boolean)
      const head = el("div", "margin-page-head")
      head.innerHTML = PAGE_GLYPH
      head.append(el("span", "margin-page-path", crumbs.length ? crumbs.join(" › ") : url.pathname))
      const foot = el("a", "margin-page-foot", hash ? "Open the page at this section" : "Open the page")
      foot.href = link.href
      foot.dataset.noPreview = "true"
      box.append(head, title, body, foot)
      return box
    },
  }
}

const PAGE_GLYPH =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>'

function imagePreview(link: HTMLAnchorElement): Item {
  const src = new URL(link.href).pathname
  return {
    key: `image:${src}`,
    build: async () => {
      const box = el("figure", "margin-image")
      box.dataset.src = src
      const img = el("img")
      // a picture with a dark version shows the one for the page's theme
      const pair = themedPair(link)
      if (pair) {
        img.dataset.light = pair.light
        img.dataset.dark = pair.dark
      }
      img.src = pair ? (isDark() ? pair.dark : pair.light) : src
      img.alt = link.textContent?.trim() ?? ""
      img.draggable = false
      // measured once it has a size, so it lands level with its line at once
      const ok = await Promise.race([
        img.decode().then(() => true, () => false),
        new Promise<boolean>((r) => setTimeout(() => r(true), 1500)),
      ])
      if (!ok) return null
      box.append(img)
      const words = link.textContent?.trim()
      if (words) box.append(el("figcaption", "margin-image-caption", words))
      return box
    },
  }
}

function tooltip(target: HTMLElement): Item | null {
  // a native tooltip would show too: a title= becomes data-tip the first time
  if (target.hasAttribute("title")) {
    target.dataset.tip = target.getAttribute("title") ?? ""
    target.removeAttribute("title")
  }
  const tip = target.dataset.tip?.trim()
  if (!tip) return null
  const what = target.tagName === "ABBR" ? target.textContent?.trim() : undefined
  return {
    key: `tip:${what ?? ""}:${tip}`,
    build: async () => {
      const box = el("div", "margin-tip")
      if (what) box.append(el("span", "margin-tip-title", what), " ")
      box.append(tip)
      return box
    },
  }
}

/**
 * Something a page or island marks: its `[data-secondary]` child, shown as a
 * card, titled by `data-secondary-title`.
 */
function marked(content: HTMLElement): Item {
  const key = content.dataset.secondaryKey ?? content.textContent?.trim().slice(0, 80) ?? ""
  return {
    key: `marked:${key}`,
    build: async () => {
      const box = el("div", "margin-marked")
      box.dataset.kind = content.dataset.secondary ?? ""
      const title = content.dataset.secondaryTitle?.trim()
      if (title) box.append(el("span", "margin-tip-title margin-marked-title", title))
      const copy = content.cloneNode(true) as HTMLElement
      copy.removeAttribute("data-secondary")
      copy.removeAttribute("hidden")
      copy.querySelectorAll("[id]").forEach((x) => x.removeAttribute("id"))
      const body = el("div", "margin-marked-body")
      body.append(copy)
      box.append(body)
      return box
    },
  }
}

/** What, if anything, the margin has to say about what's under the pointer. */
function itemFor(target: Element, article: Element): [Item, Element] | null {
  if (!article.contains(target)) return null
  // inside a link that isn't a note's, only a marked card can still show
  let inLink = false
  for (let node: Element | null = target; node && node !== article; node = node.parentElement) {
    if (node.matches(".sidenote, .marginnote, sup:has(> a[data-footnote-ref])")) return null
    const content = node.querySelector<HTMLElement>(":scope > [data-secondary]")
    if (content) return [marked(content), node]
    if (node instanceof HTMLAnchorElement) {
      if (isImageLink(node)) return [imagePreview(node), node]
      if (
        node.matches("a.internal[data-slug]") &&
        node.dataset.footnoteRef === undefined &&
        node.dataset.noPopover !== "true" &&
        node.getAttribute("role") !== "anchor" &&
        new URL(node.href).pathname !== location.pathname
      )
        return [notePreview(node), node]
      inLink = true
      continue
    }
    if (!inLink && node instanceof HTMLElement && (node.dataset.tip !== undefined || node.hasAttribute("title"))) {
      const tip = tooltip(node)
      if (tip) return [tip, node]
    }
  }
  return null
}

onPage((signal) => {
  const margin = document.querySelector<HTMLElement>(".margin")
  const article =
    margin?.parentElement?.querySelector<HTMLElement>(":scope > article") ??
    document.querySelector<HTMLElement>("article")
  if (!margin || !article) return

  const hover = el("div", "margin-hover")
  hover.setAttribute("aria-live", "polite")
  margin.append(hover)

  let shown: { key: string; node: HTMLElement; anchor: Element; y: number } | null = null
  let showTimer: ReturnType<typeof setTimeout> | undefined
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let wanted: string | undefined

  const covered = () => margin.querySelectorAll<HTMLElement>(".margin-layer > .in-margin, .margin-part")
  const uncover = () => covered().forEach((n) => n.classList.remove("is-covered"))

  /** Level with its line, kept on screen; what it lies over fades back. */
  const place = () => {
    if (!shown) return
    const { node, anchor, y } = shown
    const column = margin.getBoundingClientRect()
    const height = node.offsetHeight
    const want = levelWith(node, lineOf(anchor, y), column)
    const highest = 16 - column.top
    const lowest = innerHeight - column.top - height - 16
    const top = Math.max(highest, Math.min(want, lowest))
    node.style.top = `${top}px`
    for (const n of covered()) {
      const t = n.offsetTop
      n.classList.toggle("is-covered", t < top + height + 8 && t + n.offsetHeight > top - 8)
    }
  }

  const leave = (node: HTMLElement) => {
    node.dataset.leaving = "true"
    setTimeout(() => node.remove(), 180)
  }

  const hide = () => {
    clearTimeout(showTimer)
    clearTimeout(hideTimer)
    wanted = undefined
    if (shown) leave(shown.node)
    shown = null
    uncover()
    delete document.documentElement.dataset.marginHover
  }

  const hideSoon = () => {
    clearTimeout(showTimer)
    wanted = undefined
    if (!shown) return
    clearTimeout(hideTimer)
    hideTimer = setTimeout(hide, HIDE_MS)
  }

  const show = (item: Item, anchor: Element, y: number) => {
    clearTimeout(hideTimer)
    if (shown?.key === item.key && shown.anchor === anchor) return
    if (wanted === item.key) return
    wanted = item.key
    clearTimeout(showTimer)
    showTimer = setTimeout(async () => {
      const node = await item.build().catch(() => null)
      if (wanted !== item.key || signal.aborted) return
      if (!node) return hide()
      if (shown) leave(shown.node)
      node.dataset.key = item.key
      hover.append(node)
      shown = { key: item.key, node, anchor, y }
      document.documentElement.dataset.marginHover = node.className
      place()
      // a preview's images change its height when they arrive
      node.querySelectorAll("img").forEach((img) => img.addEventListener("load", place, { once: true }))
    }, SHOW_MS)
  }

  document.addEventListener(
    "pointerover",
    (e) => {
      if (e.pointerType === "touch" || !isBeside()) return
      const target = e.target as Element
      // reading the preview: keep it
      if (hover.contains(target)) {
        clearTimeout(hideTimer)
        return
      }
      const found = itemFor(target, article)
      if (found) show(found[0], found[1], e.clientY)
      else hideSoon()
    },
    { signal },
  )
  document.addEventListener(
    "pointerout",
    (e) => {
      if (!e.relatedTarget) hideSoon()
    },
    { signal },
  )
  // what's focused from the keyboard shows the way a hover does
  document.addEventListener(
    "focusin",
    (e) => {
      const target = e.target as Element
      if (!isBeside() || !target.matches?.(":focus-visible") || hover.contains(target)) return
      const found = itemFor(target, article)
      if (found) show(found[0], found[1], found[1].getBoundingClientRect().top + 1)
    },
    { signal },
  )
  document.addEventListener("focusout", () => shown && hideSoon(), { signal })
  document.addEventListener("keydown", (e) => e.key === "Escape" && hide(), { signal })
  // the theme turned: a shown picture swaps to its other version
  document.addEventListener(
    "themechange",
    () => {
      for (const img of hover.querySelectorAll<HTMLImageElement>("img[data-dark]"))
        img.src = isDark() ? img.dataset.dark! : img.dataset.light!
    },
    { signal },
  )
  addEventListener("resize", place, { signal })
  margin.addEventListener("margin:placed", place, { signal })

  signal.addEventListener("abort", () => {
    clearTimeout(showTimer)
    clearTimeout(hideTimer)
    hover.remove()
    uncover()
    delete document.documentElement.dataset.marginHover
  })
})
