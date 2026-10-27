// Search, ported from Quartz's search.inline.ts. ⌘F / ctrl+F opens it; with
// it open, a second ⌘F is the browser's own find. ⌘K toggles it, ⌘⇧K
// searches tags ("#tag query" narrows a search to a tag). "@page query"
// searches inside one page, and "@here query" the page you're on: each
// result is a passage, and choosing one scrolls to it and marks it. The
// index is built from /static/contentIndex.json the first time search opens.
import { adoptSheets } from "./sheets"

interface Details {
  slug: string
  title: string
  content: string
  tags: string[]
}
type ContentIndex = Record<string, Details>
type SearchType = "basic" | "tags"
let searchType: SearchType = "basic"
let currentSearchTerm = ""
const contextWindowWords = 30
const numSearchResults = 8
const numTagResults = 5

const encoder = (str: string): string[] => {
  const tokens: string[] = []
  let bufferStart = -1
  let bufferEnd = -1
  const lower = str.toLowerCase()
  let i = 0
  for (const char of lower) {
    const code = char.codePointAt(0)!
    const isCJK =
      (code >= 0x3040 && code <= 0x309f) ||
      (code >= 0x30a0 && code <= 0x30ff) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x20000 && code <= 0x2a6df)
    const isWhitespace = code === 32 || code === 9 || code === 10 || code === 13
    if (isCJK) {
      if (bufferStart !== -1) {
        tokens.push(lower.slice(bufferStart, bufferEnd))
        bufferStart = -1
      }
      tokens.push(char)
    } else if (isWhitespace) {
      if (bufferStart !== -1) {
        tokens.push(lower.slice(bufferStart, bufferEnd))
        bufferStart = -1
      }
    } else {
      if (bufferStart === -1) bufferStart = i
      bufferEnd = i + char.length
    }
    i += char.length
  }
  if (bufferStart !== -1) tokens.push(lower.slice(bufferStart))
  return tokens
}

// flexsearch loads the first time search opens, not with every page
let index: any
async function makeIndex() {
  const { default: FlexSearch } = await import("flexsearch")
  index = new FlexSearch.Document({
    encode: encoder,
    document: {
      id: "id",
      tag: "tags",
      index: [
        { field: "title", tokenize: "forward" },
        { field: "content", tokenize: "forward" },
        { field: "tags", tokenize: "forward" },
      ],
    },
  } as any)
}

let data: ContentIndex = {}
let slugs: string[] = []
let ready: Promise<void> | undefined
function fill(): Promise<void> {
  ready ??= Promise.all([fetch("/static/contentIndex.json").then((r) => r.json()), makeIndex()])
    .then(async ([d]: [ContentIndex, void]) => {
      data = d
      slugs = Object.keys(d)
      await Promise.all(
        slugs.map((slug, id) =>
          index.addAsync(id, { id, slug, title: d[slug].title, content: d[slug].content, tags: d[slug].tags }),
        ),
      )
    })
  return ready
}

const hrefOf = (slug: string) => {
  const s = slug.replace(/(^|\/)index$/, "")
  return s === "" ? "/" : `/${s}`
}

const tokenizeTerm = (term: string) => {
  const tokens = term.split(/\s+/).filter((t) => t.trim() !== "")
  const n = tokens.length
  for (let i = 1; i < n; i++) tokens.push(tokens.slice(0, i + 1).join(" "))
  return tokens.sort((a, b) => b.length - a.length)
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const escapeHTML = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

function highlight(searchTerm: string, text: string, trim?: boolean) {
  const terms = tokenizeTerm(searchTerm)
  let words = text.split(/\s+/).filter((t) => t !== "")
  let startIndex = 0
  let endIndex = words.length - 1
  if (trim) {
    const hits = words.map((tok) => terms.some((term) => tok.toLowerCase().startsWith(term.toLowerCase())))
    let bestSum = 0
    let bestIndex = 0
    for (let i = 0; i < Math.max(words.length - contextWindowWords, 0); i++) {
      const sum = hits.slice(i, i + contextWindowWords).reduce((t, c) => t + (c ? 1 : 0), 0)
      if (sum >= bestSum) {
        bestSum = sum
        bestIndex = i
      }
    }
    startIndex = Math.max(bestIndex - contextWindowWords, 0)
    endIndex = Math.min(startIndex + 2 * contextWindowWords, words.length - 1)
    words = words.slice(startIndex, endIndex)
  }
  const slice = words
    .map((tok) => {
      tok = escapeHTML(tok)
      for (const term of terms) {
        if (tok.toLowerCase().includes(term.toLowerCase())) {
          return tok.replace(new RegExp(escapeRegex(term.toLowerCase()), "gi"), `<span class="highlight">$&</span>`)
        }
      }
      return tok
    })
    .join(" ")
  return `${startIndex === 0 ? "" : "..."}${slice}${endIndex === words.length - 1 ? "" : "..."}`
}

function highlightHTML(searchTerm: string, el: HTMLElement) {
  const html = new DOMParser().parseFromString(el.innerHTML, "text/html")
  const span = (text: string) => {
    const s = document.createElement("span")
    s.className = "highlight"
    s.textContent = text
    return s
  }
  const walk = (node: Node, term: string) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? ""
      const matches = text.match(new RegExp(escapeRegex(term.toLowerCase()), "gi"))
      if (!matches) return
      const box = document.createElement("span")
      let last = 0
      for (const m of matches) {
        const at = text.indexOf(m, last)
        box.appendChild(document.createTextNode(text.slice(last, at)))
        box.appendChild(span(m))
        last = at + m.length
      }
      box.appendChild(document.createTextNode(text.slice(last)))
      node.parentNode?.replaceChild(box, node)
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as HTMLElement).classList.contains("highlight")) return
      Array.from(node.childNodes).forEach((c) => walk(c, term))
    }
  }
  for (const term of tokenizeTerm(searchTerm)) walk(html.body, term)
  return html.body
}

// a page as it is, notes and all, for "@page query"
const rawCache = new Map<string, Element[]>()
async function fetchWhole(slug: string): Promise<Element[]> {
  const hit = rawCache.get(slug)
  if (hit) return hit
  const html = new DOMParser().parseFromString(await (await fetch(new URL(hrefOf(slug), location.href))).text(), "text/html")
  adoptSheets(html)
  const roots = [...html.querySelectorAll("article")]
  rawCache.set(slug, roots)
  return roots
}

const pageCache = new Map<string, Element[]>()
async function fetchContent(slug: string): Promise<Element[]> {
  const hit = pageCache.get(slug)
  if (hit) return hit
  const url = new URL(hrefOf(slug), location.href)
  const html = new DOMParser().parseFromString(await (await fetch(url)).text(), "text/html")
  adoptSheets(html)
  // a page's links are root-absolute already; ids would clash with this page's
  html.querySelectorAll("[id]").forEach((n) => (n.id = `search-preview-${n.id}`))
  // the margin's notes would be spliced into their sentences, numbers and
  // all: a preview reads as the text alone
  html
    .querySelectorAll(".sidenote, .marginnote, sup:has(> a[data-footnote-ref]), section[data-footnotes], section.footnotes")
    .forEach((n) => n.remove())
  const contents = [...html.getElementsByClassName("popover-hint")]
  pageCache.set(slug, contents)
  return contents
}

// ---------- "@page query": passages inside one page ----------

// the blocks a page reads as: paragraphs, list items, headings, cells,
// captions, code; the innermost, so a list item and its paragraph aren't both
const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, td, th, figcaption, dt, dd, pre"
// A page's notes are its content too: in the page you're on, the copies
// shown in the side content (the inline ones are hidden), in a fetched page
// the notes where they're written.
const NOTE_BLOCKS = ".sidenote, .marginnote"
function blocksOf(roots: Element[], live = false): Element[] {
  const all = roots.flatMap((r) => [
    ...r.querySelectorAll(BLOCKS),
    // a note that's one line, with no paragraph of its own
    ...[...r.querySelectorAll(NOTE_BLOCKS)].filter((n) => !n.querySelector(BLOCKS)),
  ])
  return all.filter(
    (b) =>
      !b.closest(".search, nav, .page-header, section[data-footnotes], section.footnotes") &&
      !b.querySelector(BLOCKS) &&
      !(live && b.getClientRects().length === 0) &&
      (b.textContent ?? "").trim() !== "",
  )
}
const liveRoots = () =>
  [document.querySelector("article"), document.querySelector(".margin-layer")].filter((x): x is Element => !!x)

/** The heading a block sits under, for a result's title. */
function sectionOf(block: Element): string | null {
  for (let el: Element | null = block; el; el = el.previousElementSibling ?? el.parentElement) {
    if (el !== block && /^H[1-6]$/.test(el.tagName)) return (el.textContent ?? "").trim()
    if (el.tagName === "ARTICLE") break
  }
  return null
}

const words = (q: string) =>
  q
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== "")

/** Where a page's passage is, after the page arrives: scrolled to and marked. */
const FIND = "basalt:find"
function findPassage(text: string) {
  const want = text.replace(/\s+/g, " ").trim()
  const blocks = blocksOf(liveRoots(), true)
  const norm = (b: Element) => (b.textContent ?? "").replace(/\s+/g, " ").trim()
  const hit = blocks.find((b) => norm(b) === want) ?? blocks.find((b) => norm(b).includes(want.slice(0, 60)))
  if (hit) mark(hit)
}
function mark(el: Element) {
  el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })
  el.classList.remove("search-found")
  void (el as HTMLElement).offsetWidth
  el.classList.add("search-found")
  setTimeout(() => el.classList.remove("search-found"), 3200)
}
document.addEventListener("astro:page-load", () => {
  let text: string | null = null
  try {
    text = sessionStorage.getItem(FIND)
    sessionStorage.removeItem(FIND)
  } catch {}
  if (text) requestAnimationFrame(() => findPassage(text!))
})

// ---------- the search on the current page ----------

let page: AbortController | undefined

function setup() {
  page?.abort()
  page = new AbortController()
  const signal = page.signal
  const search = document.querySelector<HTMLElement>(".search")
  const container = search?.querySelector<HTMLElement>(".search-container")
  const button = search?.querySelector<HTMLButtonElement>(".search-button")
  const bar = search?.querySelector<HTMLInputElement>(".search-bar")
  const layout = search?.querySelector<HTMLElement>(".search-layout")
  if (!search || !container || !button || !bar || !layout) return

  const enablePreview = layout.dataset.preview === "true"
  const results = document.createElement("div")
  results.className = "results-container"
  layout.replaceChildren(results)
  let preview: HTMLDivElement | undefined
  if (enablePreview) {
    preview = document.createElement("div")
    preview.className = "preview-container"
    layout.appendChild(preview)
  }
  let currentHover: HTMLElement | null = null

  const isOpen = () => container.classList.contains("active")
  function hide() {
    container!.classList.remove("active")
    bar!.value = ""
    results.replaceChildren()
    preview?.replaceChildren()
    layout!.classList.remove("display-results")
    searchType = "basic"
    root.classList.remove("search-open")
  }
  function show(type: SearchType) {
    searchType = type
    container!.classList.add("active")
    root.classList.add("search-open")
    bar!.focus()
    void fill()
  }

  async function displayPreview(el: HTMLElement | null) {
    if (!enablePreview || !el || !preview || el.classList.contains("no-match")) return
    const contents = await fetchContent(el.dataset.slug!)
    const inner = document.createElement("div")
    inner.classList.add("preview-inner")
    inner.append(...contents.flatMap((c) => [...highlightHTML(currentSearchTerm, c as HTMLElement).children]))
    preview.replaceChildren(inner)
    const marks = [...preview.getElementsByClassName("highlight")].sort((a, b) => b.innerHTML.length - a.innerHTML.length)
    marks[0]?.scrollIntoView({ block: "start" })
  }

  function highlightTags(term: string, tags: string[]) {
    if (!tags || searchType !== "tags") return []
    return tags
      .map((tag) =>
        tag.toLowerCase().includes(term.toLowerCase())
          ? `<li><p class="match-tag">#${escapeHTML(tag)}</p></li>`
          : `<li><p>#${escapeHTML(tag)}</p></li>`,
      )
      .slice(0, numTagResults)
  }

  const format = (term: string, id: number) => {
    const slug = slugs[id]
    const d = data[slug]
    return {
      slug,
      title: searchType === "tags" ? escapeHTML(d.title) : highlight(term, d.title ?? ""),
      content: highlight(term, d.content ?? "", true),
      tags: highlightTags(term.substring(1), d.tags),
    }
  }

  const card = ({ slug, title, content, tags }: ReturnType<typeof format>) => {
    const a = document.createElement("a")
    a.classList.add("result-card")
    a.dataset.slug = slug
    a.href = hrefOf(slug)
    a.innerHTML = `<h3 class="card-title">${title}</h3>${tags.length ? `<ul class="tags">${tags.join("")}</ul>` : ""}<p class="card-description">${content}</p>`
    a.addEventListener("click", (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      hide()
    })
    a.addEventListener("mouseenter", () => displayPreview(a))
    return a
  }

  async function displayResults(items: ReturnType<typeof format>[]) {
    results.replaceChildren()
    if (items.length === 0) {
      results.innerHTML = `<a class="result-card no-match"><h3>No results.</h3><p>Try another search term?</p></a>`
      preview?.replaceChildren()
      return
    }
    results.append(...items.map(card))
    const first = results.firstElementChild as HTMLElement
    first.classList.add("focus")
    currentHover = first
    await displayPreview(first)
  }

  async function onType() {
    await fill()
    currentSearchTerm = bar!.value
    layout!.classList.toggle("display-results", currentSearchTerm !== "")
    if (currentSearchTerm.startsWith("@")) return onAt(currentSearchTerm)
    searchType = currentSearchTerm.startsWith("#") ? "tags" : "basic"
    let found: any[] = []
    if (searchType === "tags") {
      currentSearchTerm = currentSearchTerm.substring(1).trim()
      const sep = currentSearchTerm.indexOf(" ")
      if (sep !== -1) {
        const tag = currentSearchTerm.substring(0, sep)
        const query = currentSearchTerm.substring(sep + 1).trim()
        found = await index.searchAsync({ query, limit: Math.max(numSearchResults, 10000), index: ["title", "content"], tag: { tags: tag } } as any)
        for (const r of found) r.result = r.result.slice(0, numSearchResults)
        searchType = "basic"
        currentSearchTerm = query
      } else {
        found = await index.searchAsync({ query: currentSearchTerm, limit: numSearchResults, index: ["tags"] } as any)
      }
    } else {
      found = await index.searchAsync({ query: currentSearchTerm, limit: numSearchResults, index: ["title", "content"] } as any)
    }
    const byField = (field: string): number[] => [...(found.find((x) => x.field === field)?.result ?? [])]
    const ids = new Set([...byField("title"), ...byField("content"), ...byField("tags")])
    await displayResults([...ids].map((id) => format(currentSearchTerm, id)))
  }

  // ---- "@": a page to search in, then passages in it ----
  const here = () => document.body.dataset.slug ?? "index"
  const titleOf = (slug: string) => data[slug]?.title ?? slug.split("/").pop() ?? slug
  // what "@token" calls a page: the last part of its slug, unless another
  // page's is the same, then all of it
  const tokenOf = (slug: string) => {
    const tail = slug.replace(/\/index$/, "").split("/").pop() || "index"
    const same = slugs.filter((s2) => (s2.replace(/\/index$/, "").split("/").pop() || "index") === tail)
    return same.length > 1 ? slug : tail
  }
  const resolve = (token: string): string | undefined => {
    if (token === "here") return here()
    const t = token.toLowerCase()
    return (
      slugs.find((s2) => s2.toLowerCase() === t) ??
      slugs.find((s2) => tokenOf(s2).toLowerCase() === t) ??
      slugs.find((s2) => titleOf(s2).toLowerCase().replace(/\s+/g, "-") === t)
    )
  }
  const pick = (title: string, note: string, value: string) => {
    const a = document.createElement("a")
    a.classList.add("result-card", "at-pick")
    a.href = "#"
    a.innerHTML = `<h3 class="card-title">${escapeHTML(title)}</h3><p class="card-description">${escapeHTML(note)}</p>`
    a.addEventListener("click", (e) => {
      e.preventDefault()
      bar!.value = value
      bar!.focus()
      void onType()
    })
    return a
  }
  const show_ = (cards: HTMLElement[], empty: string) => {
    results.replaceChildren()
    preview?.replaceChildren()
    if (!cards.length) {
      results.innerHTML = `<a class="result-card no-match"><h3>${escapeHTML(empty)}</h3></a>`
      return
    }
    results.append(...cards)
    cards[0].classList.add("focus")
    currentHover = cards[0]
  }

  async function onAt(term: string) {
    const m = /^@(\S*)(\s+([\s\S]*))?$/.exec(term)!
    const token = m[1]
    // no space yet: which page
    if (m[2] === undefined) {
      const t = token.toLowerCase()
      // names that start with what's typed first, then titles that hold it; A to Z
      const rank = (s2: string) =>
        !t || tokenOf(s2).toLowerCase().startsWith(t) ? 0 : titleOf(s2).toLowerCase().startsWith(t) ? 1 : 2
      const pages = slugs
        .filter((s2) => !s2.startsWith("tags/"))
        .filter((s2) => !t || tokenOf(s2).toLowerCase().startsWith(t) || titleOf(s2).toLowerCase().includes(t))
        .sort((a, b) => rank(a) - rank(b) || tokenOf(a).localeCompare(tokenOf(b)))
        .slice(0, numSearchResults)
      const cards = [
        ...("here".startsWith(t) ? [pick("This page", `@here · ${titleOf(here())}`, "@here ")] : []),
        ...pages.map((s2) => pick(titleOf(s2), `@${tokenOf(s2)}`, `@${tokenOf(s2)} `)),
      ]
      return show_(cards, `No page called @${token}`)
    }
    const slug = resolve(token)
    if (!slug) return show_([], `No page called @${token}`)
    const query = (m[3] ?? "").trim()
    const title = titleOf(slug)
    if (!query) return show_([], `Search in ${token === "here" ? "this page" : title}…`)
    const isHere = slug === here()
    const roots: Element[] = isHere ? liveRoots() : await fetchWhole(slug)
    const ws = words(query)
    const hits = blocksOf(roots, isHere)
      .filter((b) => {
        const text = (b.textContent ?? "").toLowerCase()
        return ws.every((w) => text.includes(w))
      })
      .slice(0, 30)
    currentSearchTerm = query
    const cards = hits.map((b) => {
      const text = (b.textContent ?? "").replace(/\s+/g, " ").trim()
      const a = document.createElement("a")
      a.classList.add("result-card", "at-passage")
      a.dataset.slug = slug
      a.href = hrefOf(slug)
      const section = sectionOf(b)
      a.innerHTML = `<h3 class="card-title">${escapeHTML(section ?? title)}</h3><p class="card-description">${highlight(query, text, true)}</p>`
      a.addEventListener("click", (e) => {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
        hide()
        if (isHere) {
          e.preventDefault()
          mark(b)
          return
        }
        try {
          sessionStorage.setItem(FIND, text)
        } catch {}
      })
      a.addEventListener("mouseenter", () => displayPreview(a))
      return a
    })
    show_(cards, `Nothing in ${isHere ? "this page" : title} matches "${query}"`)
    if (cards.length) await displayPreview(cards[0])
  }

  async function onKey(e: KeyboardEvent) {
    // taken already (⌘F in a note being edited finds in the note, editor.ts)
    if (e.defaultPrevented) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (mod && key === "f" && !e.shiftKey && !e.altKey) {
      // open, a second ⌘F is the browser's
      if (isOpen()) return
      e.preventDefault()
      show("basic")
      return
    }
    if (mod && key === "k") {
      e.preventDefault()
      if (isOpen()) return hide()
      show(e.shiftKey ? "tags" : "basic")
      if (e.shiftKey) bar!.value = "#"
      return
    }
    if (!isOpen()) return
    if (e.key.startsWith("Esc")) {
      e.preventDefault()
      hide()
      button!.focus()
      return
    }
    currentHover?.classList.remove("focus")
    if (e.key === "Enter" && !e.isComposing) {
      const active = results.contains(document.activeElement)
        ? (document.activeElement as HTMLElement)
        : (results.querySelector(".result-card") as HTMLElement | null)
      if (!active || active.classList.contains("no-match")) return
      active.click()
    } else if (e.key === "ArrowUp" || (e.shiftKey && e.key === "Tab")) {
      e.preventDefault()
      if (results.contains(document.activeElement) || currentHover) {
        const prev = (currentHover ?? (document.activeElement as HTMLElement))?.previousElementSibling as HTMLElement | null
        if (prev) {
          prev.focus()
          currentHover = prev
          await displayPreview(prev)
        } else bar!.focus()
      }
    } else if (e.key === "Tab" && !e.shiftKey && bar!.value.startsWith("@") && !/\s/.test(bar!.value)) {
      // "@mar" + Tab: the page under the cursor (the first, unless one's chosen)
      e.preventDefault()
      const card = (currentHover ?? results.querySelector(".at-pick")) as HTMLElement | null
      if (card?.classList.contains("at-pick")) card.click()
    } else if (e.key === "ArrowDown" || e.key === "Tab") {
      e.preventDefault()
      const from = currentHover ?? (results.firstElementChild as HTMLElement | null)
      const next = (document.activeElement === bar && !currentHover ? from : from?.nextElementSibling) as HTMLElement | null
      if (next) {
        next.focus()
        currentHover = next
        await displayPreview(next)
      }
    }
  }

  document.addEventListener("keydown", onKey, { signal })
  button.addEventListener("click", () => show("basic"), { signal })
  // the search glyph in the navbar's tray (it persists across pages, so delegated)
  document.addEventListener(
    "click",
    (e) => {
      if (!(e.target as Element).closest?.(".nav-search")) return
      ;(document.activeElement as HTMLElement | null)?.blur()
      show("basic")
    },
    { signal },
  )
  bar.addEventListener("input", onType, { signal })
  container.addEventListener("click", (e) => e.target === container && hide(), { signal })
}

const root = document.documentElement
document.addEventListener("astro:page-load", setup)

export {}
