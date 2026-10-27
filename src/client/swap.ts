// A newer version of the page you're on, swapped in where it is: the way a
// navigation swaps pages, with the scroll and the #part kept and no arrival.
// The dev server's saves come in this way (hotswap.ts), and so does a built
// page once an edit made on it is deployed (editor.ts).
//
// Just before, "basalt:swap-document" is sent with the new document, for
// whatever on this page must carry over into it (an editor open on it).

declare global {
  interface Window {
    basaltHotSwap?: boolean
  }
}

// the router, imported once, up front: imported at each save it cost 40-70ms
// of every one (in dev, Vite answers the import again after a content change)
const router = import("astro:transitions/client")

// a swap that comes while the last one's transition runs skips that one, and
// the browser rejects its promises: nothing's wrong, the newer page is coming
addEventListener("unhandledrejection", (e) => {
  const err = e.reason as Error | undefined
  if (err instanceof DOMException && /Transition was skipped/.test(err.message)) e.preventDefault()
})

/** The page at the current url, fetched fresh: its document, or undefined when it doesn't come (an error page). */
export async function fetchPage(): Promise<Document | undefined> {
  const url = location.pathname + location.search
  try {
    const res = await fetch(url, { headers: { accept: "text/html" }, cache: "no-store" })
    if (!res.ok) return undefined
    const doc = new DOMParser().parseFromString(await res.text(), "text/html")
    doc.querySelectorAll("noscript").forEach((el) => el.remove())
    return doc
  } catch {
    return undefined
  }
}

/** the documents swapIn brought in: a newer version of the page, not another page */
export const swapped = new WeakSet<Document>()

export async function swapIn(doc: Document) {
  if (!doc.querySelector('[name="astro-view-transitions-enabled"]')) return void location.reload()
  swapped.add(doc)
  document.dispatchEvent(new CustomEvent("basalt:swap-document", { detail: doc }))
  const url = location.pathname + location.search
  const hash = location.hash
  const { navigate } = await router
  const x = scrollX
  const y = scrollY
  window.basaltHotSwap = true
  // the page just fetched is the one swapped in (no second request)
  const target = new URL(url, location.href).href
  const prepare = (e: Event) => {
    const ev = e as Event & { to: URL; loader: () => Promise<void>; newDocument: Document }
    if (ev.to.href.split("#")[0] !== target.split("#")[0]) return
    ev.loader = async () => {
      ev.newDocument = doc
    }
  }
  document.addEventListener("astro:before-preparation", prepare)
  // instant: the page's smooth scrolling would glide there from the top
  const restore = () => scrollTo({ left: x, top: y, behavior: "instant" })
  document.addEventListener("astro:after-swap", restore, { once: true })
  document.addEventListener(
    "astro:page-load",
    () => {
      if (hash) history.replaceState(history.state, "", url + hash)
      restore()
      // and once more after anything laid out on load (the margin) settles
      requestAnimationFrame(() => requestAnimationFrame(restore))
      window.basaltHotSwap = false
    },
    { once: true },
  )
  try {
    // not to its #part: Astro takes that for a scroll down this page, and
    // swaps nothing. The #part goes back once it's in
    await navigate(url, { history: "replace" })
  } finally {
    document.removeEventListener("astro:before-preparation", prepare)
  }
}
