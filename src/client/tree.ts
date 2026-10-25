// A ```tree's folders fold by themselves (they're <details>). This adds what
// a file browser does: alt-click (or alt-enter) on a folder folds or opens it
// and everything in it.

function foldAll(summary: HTMLElement) {
  const details = summary.parentElement as HTMLDetailsElement
  const open = !details.open
  details.open = open
  for (const inner of details.querySelectorAll("details")) inner.open = open
}

const folderOf = (e: Event) =>
  e.target instanceof Element && !e.target.closest("a")
    ? e.target.closest<HTMLElement>("figure.tree summary.tree-row")
    : null

export function startTrees(signal: AbortSignal) {
  document.addEventListener(
    "click",
    (e) => {
      const summary = e.altKey && folderOf(e)
      if (!summary) return
      e.preventDefault()
      foldAll(summary)
    },
    { signal },
  )
  // enter's own click doesn't carry the alt key
  document.addEventListener(
    "keydown",
    (e) => {
      const summary = e.altKey && e.key === "Enter" && folderOf(e)
      if (!summary) return
      e.preventDefault()
      foldAll(summary)
    },
    { signal },
  )
}
