// The edit toggle (components/EditToggle.astro). With html[data-editing], the
// page's blocks open to their markdown where they are (client/editor.ts,
// loaded the first time it's wanted, so a reader never downloads it). ⌘E
// turns it on and off, as in Obsidian, and so does the pencil; ?edit in the
// url turns it on (a phone has no ⌘E). It stays on from page to page, like
// the source toggle, until it's turned off or the page is reloaded. A page
// with no note of its own (a tag's, a folder's without an index.md) has
// nothing to edit.
//
// A built site's pencil shows once this browser has connected to its GitHub
// repository (a token kept for it); till then ⌘E or ?edit connects. A page
// whose note has a draft not yet published (draft.ts) opens editing it, as
// it was left, reloaded or come back to.

import { draftKey, draftStore } from "./draft"

const root = document.documentElement
let editor: Promise<typeof import("./editor")> | undefined
const load = () => (editor ??= import("./editor"))

const button = () => document.querySelector<HTMLButtonElement>(".edit-toggle")
const article = () => document.querySelector<HTMLElement>("article[data-edit-slug]")

function sync() {
  const b = button()
  const a = article()
  if (a?.dataset.edit === "github") {
    let kept = false
    try {
      kept = !!localStorage.getItem(`basalt-github-token:${a.dataset.editRepo}`)
    } catch {}
    root.toggleAttribute("data-edit-connected", kept || root.hasAttribute("data-edit-connected"))
  }
  if (!b) return
  b.disabled = !a
  b.setAttribute("aria-pressed", String(root.hasAttribute("data-editing")))
}

async function toggle(on = !root.hasAttribute("data-editing")) {
  if (!article()) return
  const { setEditing } = await load()
  await setEditing(on)
  sync()
}

document.addEventListener("click", (e) => {
  if (!(e.target as Element).closest?.(".edit-toggle")) return
  void toggle()
})

document.addEventListener(
  "keydown",
  (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "e") return
    if (!button() || !article()) return
    e.preventDefault()
    e.stopPropagation()
    void toggle()
  },
  true,
)

document.addEventListener("astro:before-swap", (e) => {
  e.newDocument.documentElement.toggleAttribute("data-editing", root.hasAttribute("data-editing"))
  e.newDocument.documentElement.toggleAttribute("data-edit-connected", root.hasAttribute("data-edit-connected"))
})

document.addEventListener("astro:page-load", () => {
  sync()
  if (editor) void editor.then((m) => m.pageLoaded()).then(sync)
})

/** a built site's page whose note has a draft, in a browser that's connected */
function drafted() {
  const a = article()
  if (a?.dataset.edit !== "github" || !root.hasAttribute("data-edit-connected")) return false
  const { editRepo, editBranch, editPath } = a.dataset as Record<string, string>
  return !!draftStore(draftKey(editRepo, editBranch, editPath)).get()
}

sync()
if ((new URLSearchParams(location.search).has("edit") || drafted()) && button()) void toggle(true)

export {}
