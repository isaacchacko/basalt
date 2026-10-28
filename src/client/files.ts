// The explorer manages the site's notes in editing view, the way Obsidian's
// file explorer does (lib/fileops.ts): a new note or folder, in a folder or
// at the top; a note or folder renamed where it is, moved by dragging it onto
// a folder or with "Move to…", deleted once you've said so. A right click (a
// long press on a phone), the ⋯ an entry shows on hover or focus, or a
// folder's + gets there; the menu goes by arrow keys. A rename or a move asks
// whether to take the links to it along, as Obsidian does. A new note opens
// in the editor at once.
//
// While serving, each op is the dev server's to do at once (POST
// /__basalt/files); the explorer is read again once the site's built. A built
// site's ops join its draft (draft.ts) till they're published with it
// (publish.ts, commit.ts): the explorer shows them where they'd be, marked as
// unpublished, and a new note is edited on a page of its own made here, since
// there's none deployed yet. edit.ts loads this with the editor, so a reader
// never downloads it.

import { after, applyOps, badName, dirOf, join, nameOf, pageOf, repoPathOf, treePathOf, within, type FileOp, type Root } from "../lib/fileops"
import { slugifyFilePath, type FilePath } from "../lib/path"
import { draftsOf, draftsUnder, filesStore, publishedKey } from "./draft"

const root = document.documentElement
let words: Record<string, string> = {}
/** a word, its {name}s filled in, in the form for its count when it has two (as editor.ts says them) */
const say = (key: string, vars: Record<string, string> = {}) => {
  const forms = (words[key] ?? key).split("|")
  const form = forms.length > 1 && vars.n !== "1" ? forms[forms.length - 1] : forms[0]
  return form.replace(/\{(\w+)\}/g, (all, k) => vars[k] ?? all)
}

const explorer = () => document.querySelector<HTMLElement>(".explorer[data-edit-files]")
const tree = () => explorer()?.querySelector<HTMLUListElement>(".explorer-content > ul") ?? null
const github = () => explorer()?.dataset.editFiles === "github"
const editing = () => root.hasAttribute("data-editing")
const json = { "content-type": "application/json", "x-basalt-edit": "1" }

/** a note's or a folder's entry in the explorer */
interface Entry {
  path: string
  folder: boolean
  li: HTMLLIElement
  /** what the explorer calls it (a note's title) */
  label: string
}

function entryOf(el: Element | null | undefined): Entry | undefined {
  const li = el?.closest<HTMLLIElement>(".explorer-content li")
  const own = li && ([...li.children].find((c) => c.matches("a[data-path], .folder-container[data-path]")) as HTMLElement | undefined)
  if (!li || !own || li.dataset.pending === "deleted") return undefined
  const folder = own.classList.contains("folder-container")
  const label = (folder ? own.querySelector(".folder-title") : own)?.textContent?.trim() ?? nameOf(own.dataset.path!)
  return { path: own.dataset.path!, folder, li, label }
}

/** every note's and folder's path the explorer shows (what's unpublished included, what's deleted not) */
function shown(): { notes: Set<string>; folders: Set<string> } {
  const notes = new Set<string>()
  const folders = new Set<string>()
  for (const el of tree()?.querySelectorAll<HTMLElement>("a[data-path], .folder-container[data-path]") ?? []) {
    if (el.closest("li[data-pending=deleted]")) continue
    if (el.classList.contains("folder-container")) folders.add(el.dataset.path!)
    else notes.add(el.dataset.path!)
  }
  for (const f of folders) {
    // a folder's index note is the folder's own entry
    notes.add(join(f, "index.md"))
    for (let d = dirOf(f); d; d = dirOf(d)) folders.add(d)
  }
  return { notes, folders }
}

/** the note this page is of, as the tree has it */
function here(): string | undefined {
  const slug = document.body.dataset.slug ?? "index"
  const ex = explorer()
  const a = ex?.querySelector<HTMLElement>(`a[data-path][data-for="${CSS.escape(slug)}"]`)
  if (a) return a.dataset.path
  const folder = ex?.querySelector<HTMLElement>(`.folder-container[data-path][data-folderpath="${CSS.escape(slug)}"]`)
  return folder ? join(folder.dataset.path!, "index.md") : slug === "index" ? "index.md" : undefined
}

// ---------- a built site's ops, kept till they're published ----------

const repoOf = () => {
  const { editRepo: repo, editBranch: branch } = explorer()?.dataset ?? {}
  return repo && branch ? { repo, branch } : undefined
}
const roots = (): Root[] => JSON.parse(explorer()?.dataset.editRoots ?? "[]")
const kept = () => {
  const r = repoOf()
  return r ? filesStore(r.repo, r.branch) : undefined
}

/** the ops just published, while this navbar's still of the tree they were published over (20 minutes at most) */
function deploying(): FileOp[] {
  const r = repoOf()
  if (!r) return []
  try {
    const key = publishedKey(r.repo, r.branch)
    const out = JSON.parse(localStorage.getItem(key) ?? "null")
    const tree = document.querySelector<HTMLElement>(".sidebar.left[data-tree]")?.dataset.tree
    if (out && out.tree === tree && Date.now() - out.at < 20 * 60_000) return out.ops
    localStorage.removeItem(key)
  } catch {}
  return []
}

/** the explorer as it was built, by its list: drawn over with what's unpublished */
const built = new WeakMap<HTMLElement, string>()

/** The explorer, its entries' controls, and (a built site's) its unpublished ops drawn where they'd be. */
function draw() {
  const ul = tree()
  if (!ul) return
  if (!built.has(ul)) built.set(ul, ul.innerHTML)
  else ul.innerHTML = built.get(ul)!
  if (github()) {
    // what's just been published, drawn as it is now till the deploy's in; then what isn't yet
    for (const op of deploying()) unpublished(ul, op)
    for (const li of ul.querySelectorAll<HTMLElement>("li[data-pending]")) {
      if (li.dataset.pending === "deleted") li.remove()
      else {
        delete li.dataset.pending
        delete li.dataset.was
        li.title = say("editFileDeploying")
      }
    }
    for (const op of kept()?.get() ?? []) unpublished(ul, op)
  }
  decorate(ul)
  document.dispatchEvent(new Event("basalt:explorer"))
}

const CHEVRON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="5 8 14 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><polyline points="6 9 12 15 18 9"></polyline></svg>`

/** the list a folder's entries are in (the top's: the explorer's own), made, unpublished, where it isn't there */
function listOf(ul: HTMLUListElement, dir: string): HTMLUListElement {
  if (!dir) return ul
  const box = ul.querySelector<HTMLElement>(`.folder-container[data-path="${CSS.escape(dir)}"]`)
  const inner = box?.nextElementSibling?.querySelector<HTMLUListElement>(":scope > ul")
  if (inner) return inner
  const li = document.createElement("li")
  li.dataset.pending = "created"
  li.title = say("editFileCreated")
  const slug = slugifyFilePath(join(dir, "index.md") as FilePath)
  li.innerHTML = `<div class="folder-container" data-folderpath="${slug}">${CHEVRON}<div><a class="folder-title"></a></div></div><div class="folder-outer open"><ul class="content"></ul></div>`
  const c = li.querySelector<HTMLElement>(".folder-container")!
  c.dataset.path = dir
  const a = li.querySelector("a")!
  a.href = pageOf(dir)
  a.dataset.for = slug
  a.textContent = nameOf(dir)
  place(listOf(ul, dirOf(dir)), li)
  return li.querySelector<HTMLUListElement>("ul")!
}

/** an entry put in a folder's list: folders first, then notes, each by name */
function place(list: HTMLUListElement, li: HTMLLIElement) {
  const folder = !!li.querySelector(":scope > .folder-container")
  const name = (el: Element) => el.querySelector(":scope > a, :scope > .folder-container .folder-title")?.textContent?.trim() ?? ""
  const before = [...list.children].find((c) => {
    if (c.classList.contains("explorer-home")) return false
    if (c.classList.contains("overflow-end")) return true
    const isFolder = !!c.querySelector(":scope > .folder-container")
    if (isFolder !== folder) return !isFolder
    return name(c).localeCompare(name(li), undefined, { numeric: true, sensitivity: "base" }) > 0
  })
  list.insertBefore(li, before ?? null)
}

const ownOf = (li: Element) => [...li.children].find((c) => c.matches("a[data-path], .folder-container[data-path]")) as HTMLElement | undefined
const liAt = (ul: HTMLUListElement, p: string) => ul.querySelector<HTMLElement>(`a[data-path="${CSS.escape(p)}"], .folder-container[data-path="${CSS.escape(p)}"]`)?.closest("li")

/** one unpublished op, drawn in the explorer where it'd be */
function unpublished(ul: HTMLUListElement, op: FileOp) {
  if (op.op === "create") {
    if (op.path.endsWith("/index.md") || op.path === "index.md") return void listOf(ul, dirOf(op.path))
    const li = document.createElement("li")
    li.dataset.pending = "created"
    li.title = say("editFileCreated")
    const a = document.createElement("a")
    a.href = pageOf(op.path)
    a.dataset.path = op.path
    a.dataset.for = slugifyFilePath(op.path as FilePath)
    a.textContent = nameOf(op.path).replace(/\.md$/, "")
    li.append(a)
    return place(listOf(ul, dirOf(op.path)), li)
  }
  if (op.op === "delete") {
    const li = liAt(ul, op.path)
    if (!li) return
    if (li.dataset.pending === "created") return li.remove()
    li.dataset.pending = "deleted"
    li.title = say("editFileGone")
    return
  }
  const li = liAt(ul, op.from)
  if (!li) return
  for (const el of li.querySelectorAll<HTMLElement>("[data-path]")) if (within(el.dataset.path!, op.from)) el.dataset.path = op.to + el.dataset.path!.slice(op.from.length)
  const own = ownOf(li)!
  const label = own.classList.contains("folder-container") ? own.querySelector(".folder-title")! : own
  // renamed: called by its new name; moved, it keeps its title
  if (nameOf(op.from) !== nameOf(op.to)) label.textContent = nameOf(op.to).replace(/\.md$/, "")
  if (li.dataset.pending !== "created") {
    li.dataset.pending = "moved"
    li.title = say("editFileWas", { path: li.dataset.was ?? op.from })
    li.dataset.was ??= op.from
  }
  place(listOf(ul, dirOf(op.to)), li as HTMLLIElement)
}

// ---------- the controls ----------

const MORE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`
const PLUS = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`
const NOTE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 12v6M9 15h6"/></svg>`
const FOLDER = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/></svg>`

function button(cls: string, label: string, icon: string) {
  const b = document.createElement("button")
  b.type = "button"
  b.className = cls
  b.setAttribute("aria-label", label)
  b.title = label
  b.innerHTML = icon
  return b
}

/** each entry's ⋯ (a folder's +, too), and the bar at the explorer's top: shown only in editing view (edit.scss) */
function decorate(ul: HTMLUListElement) {
  const content = ul.parentElement!
  if (!content.querySelector(":scope > .files-bar")) {
    const bar = document.createElement("div")
    bar.className = "files-bar"
    bar.append(button("files-new-note", say("editFileNewNote"), NOTE), button("files-new-folder", say("editFileNewFolder"), FOLDER))
    content.prepend(bar)
  }
  for (const own of ul.querySelectorAll<HTMLElement>("a[data-path], .folder-container[data-path]")) {
    const li = own.closest("li")!
    if (li.querySelector(":scope > .files-more, :scope > .folder-container > .files-more")) continue
    const e = entryOf(own)
    if (!e) continue
    const host = e.folder ? own : li
    if (e.folder) host.append(button("files-add", say("editFileNewIn", { name: e.label }), PLUS))
    host.append(button("files-more", say("editFileMore", { name: e.label }), MORE))
    host.querySelector(".files-more")!.setAttribute("aria-haspopup", "menu")
    const link = own.matches("a") ? own : own.querySelector("a")
    link?.setAttribute("draggable", "true")
  }
}

// ---------- the menu ----------

type Item = { label: string; run(): void; danger?: boolean }
let menu: { el: HTMLElement; back: HTMLElement | null } | null = null

function closeMenu(refocus = true) {
  if (!menu) return
  const { el, back } = menu
  menu = null
  el.remove()
  if (refocus) back?.focus()
}

function itemsFor(e: Entry | null): Item[] {
  const dir = e ? (e.folder ? e.path : null) : ""
  const items: Item[] = []
  if (dir !== null) items.push({ label: say("editFileNewNote"), run: () => void ask({ dir }) }, { label: say("editFileNewFolder"), run: () => void ask({ dir, folder: true }) })
  if (e) {
    items.push(
      { label: say("editFileRename"), run: () => void rename(e) },
      { label: say("editFileMove"), run: () => void moveTo(e) },
      { label: say("editFileDelete"), run: () => void remove(e), danger: true },
    )
  }
  return items
}

/** The menu for an entry (null: the top of the explorer), at a point or under the control that opened it. */
function openMenu(e: Entry | null, at: { x: number; y: number } | HTMLElement) {
  closeMenu(false)
  const el = document.createElement("div")
  el.className = "files-menu"
  el.setAttribute("role", "menu")
  el.setAttribute("aria-label", e?.label ?? say("editFileTop"))
  for (const item of itemsFor(e)) {
    const b = document.createElement("button")
    b.type = "button"
    b.setAttribute("role", "menuitem")
    b.tabIndex = -1
    b.textContent = item.label
    if (item.danger) b.dataset.danger = ""
    b.addEventListener("click", () => {
      closeMenu(false)
      item.run()
    })
    el.append(b)
  }
  document.body.append(el)
  const back = at instanceof HTMLElement ? at : (document.activeElement as HTMLElement | null)
  menu = { el, back }
  const r = at instanceof HTMLElement ? at.getBoundingClientRect() : { left: at.x, bottom: at.y, right: at.x }
  const w = el.offsetWidth
  const h = el.offsetHeight
  el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`
  el.style.top = `${Math.max(8, Math.min(r.bottom + 4, innerHeight - h - 8))}px`
  ;(el.querySelector("button") as HTMLElement | null)?.focus()
  el.addEventListener("keydown", (ev) => {
    const all = [...el.querySelectorAll<HTMLElement>("button")]
    const i = all.indexOf(document.activeElement as HTMLElement)
    const go = (j: number) => (ev.preventDefault(), all[(j + all.length) % all.length].focus())
    if (ev.key === "ArrowDown") go(i + 1)
    else if (ev.key === "ArrowUp") go(i - 1)
    else if (ev.key === "Home") go(0)
    else if (ev.key === "End") go(all.length - 1)
    else if (ev.key === "Escape" || ev.key === "Tab") {
      ev.preventDefault()
      closeMenu()
    }
  })
}

// ---------- asking: a name, a folder, yes or no ----------

/** an input in the explorer, in place: the name typed (Enter, or leaving it), else null (Esc, or nothing changed) */
function nameIn(host: HTMLElement, value: string, valid: (name: string) => string | undefined): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input")
    input.className = "files-name"
    input.value = value
    input.setAttribute("aria-label", say("editFileName"))
    input.spellcheck = false
    input.autocomplete = "off"
    const hint = document.createElement("span")
    hint.className = "files-hint"
    hint.setAttribute("role", "alert")
    hint.id = `files-hint-${Math.random().toString(36).slice(2)}`
    input.setAttribute("aria-describedby", hint.id)
    host.append(input, hint)
    input.focus()
    input.select()
    let over = false
    const end = (name: string | null) => {
      if (over) return
      over = true
      input.remove()
      hint.remove()
      resolve(name)
    }
    const check = () => {
      const why = input.value.trim() === value ? undefined : valid(input.value.trim())
      hint.textContent = why ?? ""
      input.toggleAttribute("aria-invalid", !!why)
      return !why
    }
    input.addEventListener("input", check)
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation()
      if (ev.key === "Escape") {
        ev.preventDefault()
        end(null)
      } else if (ev.key === "Enter") {
        ev.preventDefault()
        if (check()) end(input.value.trim() === value ? null : input.value.trim())
      }
    })
    input.addEventListener("blur", () => end(check() && input.value.trim() !== value ? input.value.trim() : null))
  })
}

/** why a name can't go in a folder: a bad one, or one that's there */
function nameCheck(dir: string, note: boolean, except?: string) {
  const { notes, folders } = shown()
  return (name: string) => {
    if (badName(name)) return say("editFileBad")
    const p = join(dir, note ? `${name}.md` : name)
    if (p === except) return undefined
    if (notes.has(p) || folders.has(p)) return say("editFileTaken", { name })
    return undefined
  }
}

/** a dialog of Basalt's (the connect dialog's look): resolves with what's chosen, null when it's closed */
function dialog<T>(title: string, build: (form: HTMLFormElement, done: (v: T | null) => void) => void): Promise<T | null> {
  return new Promise((resolve) => {
    const d = document.createElement("dialog")
    d.className = "edit-connect files-dialog"
    d.setAttribute("aria-label", title)
    const form = document.createElement("form")
    form.method = "dialog"
    const h = document.createElement("h2")
    h.textContent = title
    form.append(h)
    d.append(form)
    const done = (v: T | null) => {
      d.close()
      d.remove()
      resolve(v)
    }
    d.addEventListener("cancel", (e) => {
      e.preventDefault()
      done(null)
    })
    build(form, done)
    document.body.append(d)
    d.showModal()
    form.querySelector<HTMLElement>("[autofocus]")?.focus()
  })
}

function buttons(form: HTMLFormElement, pairs: { label: string; cls?: string; run(): void; focus?: boolean }[]) {
  const m = document.createElement("menu")
  for (const p of pairs) {
    const b = document.createElement("button")
    b.type = "button"
    b.textContent = p.label
    if (p.cls) b.className = p.cls
    if (p.focus) b.autofocus = true
    b.addEventListener("click", p.run)
    m.append(b)
  }
  form.append(m)
}

/** whether to take the links to `name` along: yes, no, or null (asked no more: the op's off) */
function askLinks(name: string, links: { path: string; links: number }[]): Promise<boolean | null> {
  const n = links.reduce((a, l) => a + l.links, 0)
  return dialog<boolean>(say("editFileLinksTitle"), (form, done) => {
    const p = document.createElement("p")
    p.textContent = say("editFileLinks", { n: String(n), name })
    const ul = document.createElement("ul")
    ul.className = "files-links"
    for (const l of links) {
      const li = document.createElement("li")
      li.textContent = say("editFileLinksIn", { path: l.path, n: String(l.links) })
      ul.append(li)
    }
    form.append(p, ul)
    buttons(form, [
      { label: say("editFileLinksNo"), run: () => done(false) },
      { label: say("editFileLinksYes"), cls: "files-yes", run: () => done(true), focus: true },
    ])
  })
}

// ---------- the ops ----------

/** an op done: at once while serving (and the explorer read again), else kept with the draft and drawn */
async function apply(op: FileOp): Promise<boolean> {
  try {
    if (!github()) {
      // what's typed is saved first: the note may be what moves
      await window.basaltEdit?.idle()
      const res = await fetch("/__basalt/files", { method: "POST", headers: json, body: JSON.stringify({ op, relink: op.op === "move" && op.relink }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(reason(body.error ?? String(res.status), op))
      return true
    }
    const store = kept()!
    // what the explorer shows (a folder by its index note): an op that can't be done there isn't kept
    const why = applyOps(shown().notes, [op]).errors[0]?.why
    if (why) throw new Error(reason(why, op))
    store.put([...store.get(), op])
    document.dispatchEvent(new Event("basalt:files"))
    return true
  } catch (err) {
    failed(err)
    return false
  }
}

/** what an op that couldn't be done says: there's one there by that name, else why as it came */
const reason = (why: string, op: FileOp) => (why === "exists" ? say("editFileTaken", { name: nameOf(op.op === "move" ? op.to : op.path).replace(/\.md$/, "") }) : why)

function failed(err: unknown) {
  const el = document.querySelector<HTMLElement>(".edit-status") ?? document.body.appendChild(Object.assign(document.createElement("div"), { className: "edit-status" }))
  el.setAttribute("role", "status")
  el.dataset.state = "message"
  el.textContent = say("editFileFailed", { error: (err as Error).message })
}

/** the links to what moves that would point to nothing, note by note */
async function linksFor(op: Extract<FileOp, { op: "move" }>): Promise<{ path: string; links: number }[]> {
  if (!github()) {
    const res = await fetch("/__basalt/files", { method: "POST", headers: json, body: JSON.stringify({ op, dry: true }) })
    return res.ok ? (await res.json()).links : []
  }
  const f = await filingFor()
  if (!f) return []
  // what this op adds to what the ops kept take along: planned with it, and without it
  const head = await f.gh.head(f.branch)
  const read = cached(f.gh)
  const { plan, linkingFrom, linkIndex } = await import("./commit")
  const index = await linkIndex()
  // the notes' drafts too: their links go along as well
  const r = repoOf()!
  const prefix = draftsOf(r.repo, r.branch)
  const drafts = new Map(draftsUnder(prefix, "").flatMap((d) => {
    const p = treePathOf(roots(), d.key.slice(prefix.length))
    return p === undefined ? [] : [[p, d.text] as const]
  }))
  const planned = (ops: FileOp[]) => plan({ head, roots: roots(), ops, drafts, read, linking: (moved) => linkingFrom(index, moved) })
  const was = await planned(kept()!.get())
  const now = await planned([...kept()!.get(), { ...op, relink: true }])
  // each note by where it'll be once this op's done too
  const before = new Map(was.links.map((l) => [after(op, l.path), l.links]))
  return now.links.map((l) => ({ path: l.path, links: l.links - (before.get(l.path) ?? 0) })).filter((l) => l.links > 0)
}

let blobs: Map<string, Promise<string>> | undefined
const cached = (gh: { blob(sha: string): Promise<string> }) => (sha: string) => {
  blobs ??= new Map()
  if (!blobs.has(sha)) blobs.set(sha, gh.blob(sha))
  return blobs.get(sha)!
}
/** the repo, through the token this browser keeps for it */
async function filingFor() {
  const r = repoOf()
  if (!r) return undefined
  let token: string | null = null
  try {
    token = localStorage.getItem(`basalt-github-token:${r.repo}`)
  } catch {}
  if (!token) return undefined
  const { gitHub } = await import("./github")
  return { gh: gitHub(r.repo, token), branch: r.branch }
}

/** A new note (or folder: its index note) asked for in `dir`, by its name typed in place; made, and opened in the editor. */
async function ask({ dir, folder = false }: { dir: string; folder?: boolean }) {
  const ul = tree()
  if (!ul) return
  // where it'd go, open, the name typed there
  const list = dir ? ul.querySelector<HTMLElement>(`.folder-container[data-path="${CSS.escape(dir)}"]`)?.nextElementSibling?.querySelector<HTMLUListElement>(":scope > ul") : ul
  if (!list) return
  list.closest(".folder-outer")?.classList.add("open")
  const li = document.createElement("li")
  li.className = "files-new"
  list.prepend(li)
  const name = await nameIn(li, "", nameCheck(dir, !folder))
  li.remove()
  if (!name) return
  // a folder's index note says what the folder's called (else it'd be "index")
  const op: FileOp = folder ? { op: "create", path: join(join(dir, name), "index.md"), text: `---\ntitle: ${JSON.stringify(name)}\n---\n` } : { op: "create", path: join(dir, `${name}.md`) }
  if (await apply(op)) await open(op.path)
}

async function rename(e: Entry) {
  const own = ownOf(e.li)!
  const label = (own.classList.contains("folder-container") ? own.querySelector<HTMLElement>(".folder-title") : own)!
  const name = e.folder ? nameOf(e.path) : nameOf(e.path).replace(/\.md$/, "")
  label.style.display = "none"
  const typed = await nameIn(label.parentElement!, name, nameCheck(dirOf(e.path), !e.folder, e.path))
  label.style.display = ""
  if (!typed) return
  await move(e, join(dirOf(e.path), e.folder ? typed : `${typed}.md`))
}

/** a note or folder moved (renamed, too) to `to`: the links to it taken along if that's wanted */
async function move(e: Entry, to: string) {
  if (to === e.path) return
  const op: Extract<FileOp, { op: "move" }> = { op: "move", from: e.path, to, ...(e.folder ? { folder: true } : {}) }
  const links = await linksFor(op).catch(() => [])
  if (links.length) {
    const yes = await askLinks(e.label, links)
    if (yes === null) return
    op.relink = yes
  }
  const now = here()
  if (!(await apply(op))) return
  // the note this page is of moved: its page, where it's gone (while serving; a built site's comes once it's published)
  if (!github() && now && within(now, e.path)) await open(after(op, now)!)
  else if (!github()) await reread()
}

async function moveTo(e: Entry) {
  const { folders } = shown()
  const choices = ["", ...[...folders].sort((a, b) => a.localeCompare(b))].filter((f) => f !== dirOf(e.path) && !(e.folder && within(f, e.path)))
  const to = await dialog<string>(say("editFileMoveTitle", { name: e.label }), (form, done) => {
    const input = document.createElement("input")
    input.type = "search"
    input.placeholder = say("editFileMoveFind")
    input.setAttribute("aria-label", say("editFileMoveFind"))
    input.autofocus = true
    const ul = document.createElement("ul")
    ul.className = "files-folders"
    ul.id = "files-folders"
    ul.setAttribute("role", "listbox")
    input.setAttribute("role", "combobox")
    input.setAttribute("aria-controls", ul.id)
    input.setAttribute("aria-expanded", "true")
    ul.setAttribute("aria-label", say("editFileMoveTitle", { name: e.label }))
    let at = 0
    const draw = () => {
      const q = input.value.trim().toLowerCase()
      const shownNow = choices.filter((f) => !q || (f || say("editFileTop")).toLowerCase().includes(q))
      at = Math.min(at, Math.max(0, shownNow.length - 1))
      ul.replaceChildren(
        ...shownNow.map((f, i) => {
          const li = document.createElement("li")
          li.setAttribute("role", "option")
          li.id = `files-folder-${i}`
          li.setAttribute("aria-selected", String(i === at))
          li.textContent = f ? `${f}/` : say("editFileTop")
          li.addEventListener("click", () => done(f))
          return li
        }),
      )
      ul.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest" })
      input.setAttribute("aria-activedescendant", shownNow.length ? `files-folder-${at}` : "")
      return shownNow
    }
    let list = draw()
    input.addEventListener("input", () => ((at = 0), (list = draw())))
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault()
        at = (at + (ev.key === "ArrowDown" ? 1 : -1) + list.length) % Math.max(1, list.length)
        list = draw()
      } else if (ev.key === "Enter") {
        ev.preventDefault()
        if (list[at] !== undefined) done(list[at])
      }
    })
    form.append(input, ul)
    buttons(form, [{ label: say("editCancel"), run: () => done(null) }])
  })
  if (to === null) return
  const target = join(to, nameOf(e.path))
  const { notes, folders: dirs } = shown()
  if (notes.has(target) || dirs.has(target)) return failed(new Error(say("editFileTaken", { name: nameOf(e.path) })))
  await move(e, target)
}

async function remove(e: Entry) {
  const yes = await dialog<true>(say("editFileDeleteTitle", { name: e.label }), (form, done) => {
    const p = document.createElement("p")
    p.textContent = [e.folder ? say("editFileDeleteFolder") : "", say(github() ? "editFileDeleteGitHub" : "editFileDeleteDev")].filter(Boolean).join(" ")
    form.append(p)
    buttons(form, [
      { label: say("editCancel"), run: () => done(null), focus: true },
      { label: say("editFileDelete"), cls: "files-yes files-danger", run: () => done(true) },
    ])
  })
  if (!yes) return
  const now = here()
  if (!(await apply({ op: "delete", path: e.path, ...(e.folder ? { folder: true } : {}) }))) return
  if (!github() && now && within(now, e.path)) {
    const { navigate } = await import("astro:transitions/client")
    await navigate(pageOf(dirOf(e.path)))
  } else if (!github()) await reread()
}

/**
 * The note at `path` opened in the editor: while serving, its page once the
 * site's built with it; a built site's new note, on a page made for it here.
 */
async function open(path: string) {
  if (github()) return openNew(path)
  const href = pageOf(path)
  await served(href)
  const { navigate } = await import("astro:transitions/client")
  return navigate(href)
}

/** once the dev server serves the page at `href`, a note's (a few seconds at most, while the site's built again) */
async function served(href: string) {
  for (let i = 0; i < 120; i++) {
    const res = await fetch(href, { cache: "no-store", headers: { accept: "text/html" } }).catch(() => undefined)
    if (res?.ok && (await res.text()).includes("data-edit-slug")) return
    await new Promise((r) => setTimeout(r, 100))
  }
}

/** While serving: the explorer read again from the page once the site's built with what's changed (the editor's page isn't swapped while editing). */
async function reread() {
  const nav = document.querySelector<HTMLElement>(".sidebar.left[data-tree]")
  if (!nav) return
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 150))
    const url = (await fetch(location.pathname, { cache: "no-store" }).catch(() => undefined))?.ok ? location.pathname : "/"
    const res = await fetch(url, { cache: "no-store", headers: { accept: "text/html" } }).catch(() => undefined)
    if (!res?.ok) continue
    const doc = new DOMParser().parseFromString(await res.text(), "text/html")
    const next = doc.querySelector<HTMLElement>(".sidebar.left[data-tree]")
    const content = doc.querySelector(".explorer-content")
    if (!next || !content || next.dataset.tree === nav.dataset.tree) continue
    nav.dataset.tree = next.dataset.tree
    document.querySelector(".explorer-content")?.replaceChildren(...content.childNodes)
    return draw()
  }
}

// ---------- a built site's new note, on a page of its own ----------

/** where a new note (now at `path`) was made: its draft's kept by that path till it's published */
function madeAt(path: string): string {
  let p = path
  for (const op of [...(kept()?.get() ?? [])].reverse()) {
    if (op.op === "move" && within(p, op.to) && (op.folder || p === op.to)) p = op.from + p.slice(op.to.length)
    else if (op.op === "create" && op.path === p) break
  }
  return p
}

/** the page a new note is edited on: this one, its note's place empty, saying it's the new note's */
function pageFor(path: string): Document {
  const doc = document.cloneNode(true) as Document
  const slug = slugifyFilePath(path as FilePath)
  const name = (path.endsWith("/index.md") ? nameOf(dirOf(path)) : nameOf(path)).replace(/\.md$/, "")
  const r = repoOf()!
  doc.body.dataset.slug = slug
  doc.title = name
  const h1 = doc.querySelector(".page-header h1.article-title")
  if (h1) h1.textContent = name
  const old = doc.querySelector("article")
  const art = doc.createElement("article")
  art.className = "popover-hint"
  // what it was made with (a new folder's index note, its title) is what the editor begins with
  const made = kept()?.get().find((o): o is Extract<FileOp, { op: "create" }> => o.op === "create" && o.path === madeAt(path))
  Object.assign(art.dataset, { edit: "github", editSlug: slug, editSha: "", editRepo: r.repo, editBranch: r.branch, editPath: repoPathOf(roots(), madeAt(path)) ?? path, editNew: made?.text ?? "" })
  if (old) old.replaceWith(art)
  else doc.querySelector("main")?.append(art)
  // what's about the page it was made from goes
  doc.querySelectorAll(".page-header .content-meta, .page-header .tags, .page-footer > *, .right.sidebar > *, .breadcrumb-container, .edit-status").forEach((el) => el.remove())
  doc.querySelectorAll("[data-astro-transition-persist]").forEach((el) => {
    // the navbar's kept as it is (with what's unpublished drawn), the rest made anew
    if (!el.classList.contains("sidebar")) el.removeAttribute("data-astro-transition-persist")
  })
  return doc
}

/** A built site's new note, in the editor: at its page's url, on a page made for it. */
async function openNew(path: string) {
  const { navigate } = await import("astro:transitions/client")
  const href = pageOf(path)
  const doc = pageFor(path)
  const prepare = (e: Event) => {
    const ev = e as Event & { to: URL; loader: () => Promise<void>; newDocument: Document }
    if (ev.to.pathname !== href) return
    ev.loader = async () => {
      ev.newDocument = doc
    }
  }
  // first (capture), so the editor's own (what's typed kept, before the page goes) wraps this one
  document.addEventListener("astro:before-preparation", prepare, true)
  try {
    await navigate(href)
  } finally {
    document.removeEventListener("astro:before-preparation", prepare, true)
  }
}

// ---------- by pointer, by touch, by keyboard ----------

let started = false
/** In editing view: the explorer's controls, and what they do. */
export function start() {
  words = JSON.parse(document.querySelector<HTMLElement>("[data-edit-words]")?.dataset.editWords ?? "{}")
  if (explorer()) draw()
  if (started) return
  started = true
  let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean } | null = null

  document.addEventListener("click", (ev) => {
    if (!editing()) return
    // the tap that ends a long press: the menu it opened stays, and the link isn't followed
    if (press?.fired) {
      ev.preventDefault()
      ev.stopPropagation()
      press = null
      return
    }
    const t = ev.target as Element
    if (menu && !menu.el.contains(t)) closeMenu(false)
    const control = t.closest?.<HTMLElement>(".explorer .files-more, .explorer .files-add, .explorer .files-bar button")
    if (control) {
      ev.preventDefault()
      ev.stopPropagation()
      const e = entryOf(control)
      if (control.classList.contains("files-more")) openMenu(e ?? null, control)
      else if (control.classList.contains("files-add")) void ask({ dir: e!.path })
      else {
        // the bar: in the folder of the page you're on
        const now = here()
        void ask({ dir: now ? dirOf(now) : "", folder: control.classList.contains("files-new-folder") })
      }
      return
    }
    // a built site's new note has no page deployed: it's made here
    const a = t.closest?.<HTMLAnchorElement>(".explorer li[data-pending=created] a")
    if (a && github()) {
      ev.preventDefault()
      const box = a.closest(".folder-container")
      void openNew(box ? join((box as HTMLElement).dataset.path!, "index.md") : a.dataset.path!)
    }
  }, true)

  document.addEventListener("contextmenu", (ev) => {
    if (!editing()) return
    const t = ev.target as Element
    if (!t.closest?.(".explorer .explorer-content")) return
    if (t.closest("input")) return
    ev.preventDefault()
    openMenu(entryOf(t) ?? null, { x: ev.clientX, y: ev.clientY })
  })

  // a long press, on a touch screen (iOS has no contextmenu for it)
  document.addEventListener("pointerdown", (ev) => {
    if (!editing() || ev.pointerType === "mouse") return
    const t = ev.target as Element
    if (!t.closest?.(".explorer .explorer-content") || t.closest("button, input")) return
    const { clientX: x, clientY: y } = ev
    press = { x, y, fired: false, timer: setTimeout(() => {
      if (!press) return
      press.fired = true
      openMenu(entryOf(t) ?? null, { x, y })
    }, 500) }
  })
  const cancel = (ev: PointerEvent) => {
    if (press && (ev.type !== "pointermove" || Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 8)) {
      clearTimeout(press.timer)
      if (!press.fired) press = null
    }
  }
  document.addEventListener("pointermove", cancel)
  document.addEventListener("pointercancel", cancel)
  document.addEventListener("pointerup", cancel)

  // by keyboard: the menu key, ⇧F10, F2 to rename, Delete
  document.addEventListener("keydown", (ev) => {
    if (!editing() || menu) return
    const t = ev.target as Element
    if (!t.closest?.(".explorer .explorer-content") || t.closest("input")) return
    const e = entryOf(t)
    if (ev.key === "ContextMenu" || (ev.key === "F10" && ev.shiftKey)) {
      ev.preventDefault()
      openMenu(e ?? null, t as HTMLElement)
    } else if (e && ev.key === "F2") {
      ev.preventDefault()
      void rename(e)
    } else if (e && (ev.key === "Delete" || (ev.key === "Backspace" && (ev.metaKey || ev.ctrlKey)))) {
      ev.preventDefault()
      void remove(e)
    }
  })

  // dragged onto a folder (or the top of the explorer): moved there
  let dragged: Entry | undefined
  document.addEventListener("dragstart", (ev) => {
    if (!editing()) return
    dragged = entryOf(ev.target as Element)
    if (!dragged || !ev.dataTransfer) return
    ev.dataTransfer.effectAllowed = "move"
    ev.dataTransfer.setData("text/plain", dragged.path)
    root.dataset.filesDragging = ""
  })
  const dropAt = (t: Element | null): string | undefined => {
    if (!dragged || !t?.closest?.(".explorer .explorer-content")) return undefined
    const box = t.closest<HTMLElement>(".explorer-content li")
    const own = box && ownOf(box)
    // onto a folder, into it; onto a note, beside it; onto the rest, the top
    const dir = !own ? "" : own.classList.contains("folder-container") ? own.dataset.path! : dirOf(own.dataset.path!)
    if (dir === dirOf(dragged.path) || (dragged.folder && within(dir, dragged.path))) return undefined
    return dir
  }
  let over: HTMLElement | null = null
  const mark = (el: HTMLElement | null) => {
    over?.classList.remove("files-drop")
    over = el
    over?.classList.add("files-drop")
  }
  document.addEventListener("dragover", (ev) => {
    const dir = dropAt(ev.target as Element)
    if (dir === undefined) return mark(null)
    ev.preventDefault()
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move"
    const ul = tree()!
    mark(dir ? (ul.querySelector<HTMLElement>(`.folder-container[data-path="${CSS.escape(dir)}"]`)?.closest("li") ?? null) : (ul.closest(".explorer-content") as HTMLElement))
  })
  document.addEventListener("drop", (ev) => {
    const dir = dropAt(ev.target as Element)
    const e = dragged
    mark(null)
    if (dir === undefined || !e) return
    ev.preventDefault()
    const to = join(dir, nameOf(e.path))
    const { notes, folders } = shown()
    if (notes.has(to) || folders.has(to)) return failed(new Error(say("editFileTaken", { name: nameOf(e.path) })))
    void move(e, to)
  })
  document.addEventListener("dragend", () => {
    dragged = undefined
    mark(null)
    delete root.dataset.filesDragging
  })

  // a navbar made anew (another tree, a page swapped in): its controls, and what's unpublished, again;
  // and the ops kept changed (one done, or published, or discarded)
  document.addEventListener("astro:after-swap", () => editing() && draw())
  document.addEventListener("basalt:files", () => editing() && draw())
}

/** Editing view's over: no menu. */
export function stop() {
  closeMenu(false)
}
