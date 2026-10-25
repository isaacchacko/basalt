// What the layouts and routes know about the site's notes as a whole: which
// are published, their titles, dates and tags, the folder tree the explorer
// and folder pages show, and who links to whom.

import { getCollection, type CollectionEntry } from "astro:content"
import readingTime from "reading-time"
import { fromHtml } from "hast-util-from-html"
import { toString } from "hast-util-to-string"
import { remove } from "./prune"
import { registry } from "../lib/registry"
import {
  getAllSegmentPrefixes,
  simplifySlug,
  slugifyFilePath,
  slugTag,
  type FilePath,
  type FullSlug,
} from "../lib/path"

export type Note = CollectionEntry<"notes">
type Data = Record<string, any>

const yes = (v: unknown) => v === true || v === "true"

/** A note marked draft or private isn't published (md marks them; frontmatter as a fallback). */
export const isPublished = (note: Note) => !yes((note.data as Data).draft) && !yes((note.data as Data).private)

/** Every published note. */
export async function notes(): Promise<Note[]> {
  return (await getCollection("notes")).filter(isPublished)
}

export function titleOf(note: Note): string {
  const t = (note.data as Data).title
  if (typeof t === "string" && t.trim()) return t
  const last = note.id.split("/").pop()!
  return last === "index" ? (note.id.split("/").at(-2) ?? registry().site.config.title) : last
}

export function dateOf(note: Note): Date | undefined {
  const d = (note.data as Data).date ?? (note.data as Data).created
  const date = d ? new Date(d) : undefined
  return date && !isNaN(date.getTime()) ? date : undefined
}

export function readingTimeOf(note: Note): number {
  const t = (note.data as Data).readingTime
  if (typeof t === "number") return Math.max(1, Math.ceil(t))
  return Math.max(1, Math.ceil(readingTime(note.body ?? "").minutes))
}

export function tagsOf(note: Note): string[] {
  let t = (note.data as Data).tags
  if (typeof t === "string") t = t.split(/[,\s]+/)
  if (!Array.isArray(t)) return []
  return [...new Set(t.map((x) => slugTag(String(x).trim().replace(/^#/, ""))).filter(Boolean))]
}

export function descriptionOf(note: Note): string | undefined {
  const d = (note.data as Data).description
  return typeof d === "string" && d.trim() ? d.trim() : undefined
}

export function aliasesOf(note: Note): FullSlug[] {
  let a = (note.data as Data).aliases ?? (note.data as Data).alias
  if (typeof a === "string") a = [a]
  if (!Array.isArray(a)) return []
  return a
    .map((x) => String(x).trim())
    .filter(Boolean)
    .map((x) => slugifyFilePath((x.endsWith(".md") ? x : `${x}.md`) as FilePath))
}

/** Where a slug is served: "index" is /, "blog/index" is /blog, "blog/a" is /blog/a. */
export function hrefOf(slug: string): string {
  const s = simplifySlug(slug as FullSlug)
  return s === "/" ? "/" : `/${s.replace(/\/$/, "")}`
}

/** The route param for a slug ([...slug] takes undefined for the root). */
export function paramOf(slug: string): string | undefined {
  const s = slug.replace(/(^|\/)index$/, "")
  return s === "" ? undefined : s
}

/** Notes that link to `slug` (from each note's resolved `links`). */
export function backlinksOf(slug: string, all: Note[]): { slug: string; title: string }[] {
  const target = simplifySlug(slug as FullSlug)
  return all
    .filter((n) => n.id !== slug)
    .filter((n) => {
      const links = (n.data as Data).links
      if (!Array.isArray(links)) return false
      return links.some((l: string) => simplifySlug(String(l).split("#")[0] as FullSlug) === target)
    })
    .map((n) => ({ slug: n.id, title: titleOf(n) }))
}

// ---------- the folder tree ----------

export interface TreeNode {
  /** the last segment of its slug */
  segment: string
  /** a note's slug, or a folder's (with no "index") */
  slug: string
  name: string
  isFolder: boolean
  /** a folder's own index note */
  note?: Note
  children: TreeNode[]
}

/** The notes as folders and files, folders first, each sorted by name (Quartz's explorer order). */
export function tree(all: Note[]): TreeNode {
  const root: TreeNode = { segment: "", slug: "", name: "", isFolder: true, children: [] }
  for (const note of all) {
    const parts = note.id.split("/")
    // the folder names as written, for a folder with no index note to title it
    const written = String((note.data as Data).rel ?? note.id).split("/")
    let at = root
    parts.forEach((segment, i) => {
      const last = i === parts.length - 1
      if (last && segment === "index") {
        at.note = note
        if (at !== root) at.name = titleOf(note)
        return
      }
      let child = at.children.find((c) => c.segment === segment && c.isFolder === !last)
      if (!child) {
        child = {
          segment,
          slug: parts.slice(0, i + 1).join("/"),
          name: last ? titleOf(note) : (written[i] ?? segment),
          isFolder: !last,
          children: [],
        }
        at.children.push(child)
      }
      if (last) child.note = note
      at = child
    })
  }
  const sort = (n: TreeNode) => {
    n.children = n.children.filter((c) => c.segment !== "tags")
    n.children.sort((a, b) =>
      a.isFolder === b.isFolder
        ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
        : a.isFolder
          ? -1
          : 1,
    )
    n.children.forEach(sort)
  }
  sort(root)
  return root
}

export function findFolder(root: TreeNode, folder: string): TreeNode | undefined {
  if (folder === "") return root
  let at: TreeNode | undefined = root
  for (const seg of folder.split("/")) {
    at = at?.children.find((c) => c.isFolder && c.segment === seg)
    if (!at) return undefined
  }
  return at
}

/** Every folder below the root, deepest last. */
export function folders(root: TreeNode): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (n: TreeNode) => {
    for (const c of n.children) if (c.isFolder) (out.push(c), walk(c))
  }
  walk(root)
  return out
}

/** The trail from the root to a slug, for breadcrumbs. */
export function ancestry(root: TreeNode, slug: string): TreeNode[] {
  const parts = slug.replace(/(^|\/)index$/, "").split("/").filter(Boolean)
  const chain: TreeNode[] = [root]
  let at = root
  for (const seg of parts) {
    const next = at.children.find((c) => c.segment === seg)
    if (!next) break
    chain.push(next)
    at = next
  }
  return chain
}

/** A folder's entries for its listing page: its notes and subfolders, newest first. */
export interface Entry {
  slug: string
  title: string
  date?: Date
  tags: string[]
  isFolder: boolean
}

export function entriesOf(folder: TreeNode): Entry[] {
  const newest = (n: TreeNode): Date | undefined => {
    const dates = [n.note && dateOf(n.note), ...n.children.map(newest)].filter(Boolean) as Date[]
    return dates.sort((a, b) => b.getTime() - a.getTime())[0]
  }
  return folder.children.map((c) =>
    c.isFolder
      ? { slug: c.slug, title: c.name, date: newest(c), tags: [], isFolder: true }
      : { slug: c.slug, title: titleOf(c.note!), date: dateOf(c.note!), tags: tagsOf(c.note!), isFolder: false },
  )
}

/** Quartz's order: folders first, then newest first, then by title. */
export function byDate(a: Entry, b: Entry): number {
  if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
  if (a.date && b.date) return b.date.getTime() - a.date.getTime()
  if (a.date) return -1
  if (b.date) return 1
  return a.title.toLowerCase().localeCompare(b.title.toLowerCase())
}

export function toEntry(note: Note): Entry {
  return { slug: note.id, title: titleOf(note), date: dateOf(note), tags: tagsOf(note), isFolder: false }
}

// ---------- tags ----------

/** Every tag (with its parents: a/b gives a and a/b), and the notes under each. */
export function tagIndex(all: Note[]): Map<string, Note[]> {
  const index = new Map<string, Note[]>()
  for (const note of all) {
    for (const tag of new Set(tagsOf(note).flatMap(getAllSegmentPrefixes))) {
      if (!index.has(tag)) index.set(tag, [])
      index.get(tag)!.push(note)
    }
  }
  return new Map([...index].sort(([a], [b]) => a.localeCompare(b)))
}

export function formatDate(d: Date, locale = registry().site.config.locale): string {
  // in UTC: a frontmatter date is a day, not a moment, and shouldn't slip to the one before
  return d.toLocaleDateString(locale, { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" })
}

// ---------- plain text, for search and feeds ----------


/** A note's text as a reader sees it: its rendered html, less markup, code chrome and scripts. */
export function textOf(note: Note): string {
  const html = note.rendered?.html
  if (!html) return note.body ?? ""
  const tree = fromHtml(html, { fragment: true })
  remove(tree, (el) => ["script", "style", "svg", "template"].includes(el.tagName))
  return toString(tree).replace(/\s+/g, " ").trim()
}
