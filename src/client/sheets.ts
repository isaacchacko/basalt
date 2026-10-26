// Stylesheets only some pages need (KaTeX's, for one) are linked only from
// those pages' heads, marked data-basalt-sheet. Content taken from another
// page (a preview, a search passage) brings its sheets along.

/** Link here any of `doc`'s on-demand stylesheets this page doesn't have. */
export function adoptSheets(doc: Document) {
  for (const link of doc.head.querySelectorAll<HTMLLinkElement>("link[data-basalt-sheet]")) {
    const name = link.dataset.basaltSheet!
    if (document.head.querySelector(`link[data-basalt-sheet="${CSS.escape(name)}"]`)) continue
    document.head.append(document.importNode(link, true))
  }
}
