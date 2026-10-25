// A ```tree's folders fold by themselves (they're <details>). This adds what
// a file browser does: alt-click (or alt-enter) on a folder folds or opens it
// and everything in it.

export function startTrees(signal: AbortSignal) {
  document.addEventListener(
    "click",
    (e) => {
      if (!e.altKey || !(e.target instanceof Element)) return
      const summary = e.target.closest<HTMLElement>("figure.tree summary.tree-row")
      if (!summary || e.target.closest("a")) return
      const details = summary.parentElement as HTMLDetailsElement
      e.preventDefault()
      const open = !details.open
      details.open = open
      for (const inner of details.querySelectorAll("details")) inner.open = open
    },
    { signal },
  )
}
