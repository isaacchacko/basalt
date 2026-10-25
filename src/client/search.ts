// Search, ported from Quartz's search.inline.ts. ⌘F / ctrl+F opens it; with
// it open, a second ⌘F is the browser's own find. ⌘K toggles it, ⌘⇧K
// searches tags ("#tag query" narrows a search to a tag). The index is
// built from /static/contentIndex.json the first time search opens.

import FlexSearch from "flexsearch"

interface Details {
  slug: string
  title: string
  content: string
  tags: string[]
}
type ContentIndex = Record<string, Details>
interface Item {
  id: number
  slug: string
  title: string
  content: string
  tags: string[]
}

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

const index = new FlexSearch.Document<Item>({
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

let data: ContentIndex = {}
let slugs: string[] = []
let ready: Promise<void> | undefined
function fill(): Promise<void> {
  ready ??= fetch("/static/contentIndex.json")
    .then((r) => r.json())
    .then(async (d: ContentIndex) => {
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

const pageCache = new Map<string, Element[]>()
async function fetchContent(slug: string): Promise<Element[]> {
  const hit = pageCache.get(slug)
  if (hit) return hit
  const url = new URL(hrefOf(slug), location.href)
  const html = new DOMParser().parseFromString(await (await fetch(url)).text(), "text/html")
  // a page's links are root-absolute already; ids would clash with this page's
  html.querySelectorAll("[id]").forEach((n) => (n.id = `search-preview-${n.id}`))
  const contents = [...html.getElementsByClassName("popover-hint")]
  pageCache.set(slug, contents)
  return contents
}

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

  async function onKey(e: KeyboardEvent) {
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
  bar.addEventListener("input", onType, { signal })
  container.addEventListener("click", (e) => e.target === container && hide(), { signal })
}

const root = document.documentElement
document.addEventListener("astro:page-load", setup)
