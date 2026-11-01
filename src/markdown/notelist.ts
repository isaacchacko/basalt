// A list of notes, embedded in a note:
//
//   <note-list folder="blog" limit="4" more="see the rest"></note-list>
//
// lists the notes in `folder` (its index aside), newest first, each with its
// date, and when `limit` cuts it short, a link to the folder saying `more`.
// `tag="x"` lists a tag's notes instead. Each note's title, date and tags come
// from its frontmatter, read here, since this note renders on its own.

import type { Element, ElementContent, Root } from "hast"
import { SKIP, visit } from "unist-util-visit"
import { parseFrontmatter } from "@astrojs/markdown-remark"
import { simplifySlug, slugTag, type FullSlug } from "../lib/path"
import { hrefOf } from "../lib/links.ts"
import { reg } from "./context.ts"
import { datesOf } from "../lib/gitdates.ts"
import { sourceDirs } from "../lib/site.ts"
import { readNote } from "../lib/buffers.ts"

export interface Listed {
  slug: FullSlug
  title: string
  date?: Date
  tags: string[]
}

const asDate = (v: unknown): Date | undefined => {
  if (v === undefined || v === null || v === "") return undefined
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Every note, as a list knows it. */
export function listed(): Listed[] {
  return reg()
    .files.filter((f) => f.isNote)
    .map((f) => {
      const raw = readNote(f.abs)
      const fm = parseFrontmatter(raw).frontmatter as Record<string, unknown>
      const tags = fm.tags ?? fm.tag
      return {
        slug: f.slug,
        title: fm.title ? String(fm.title) : (f.slug.split("/").pop() ?? f.slug),
        date: asDate(fm.date ?? fm.created ?? fm.published) ?? datesOf(f.abs, sourceDirs(reg().site)).created,
        tags: (Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",") : [])
          .map((t) => slugTag(String(t).trim())),
        draft: fm.draft === true || fm.draft === "true" || fm.private === true || fm.private === "true",
      }
    })
    .filter((n) => !n.draft)
}

export function notesFor(props: Element["properties"], notes: Listed[]): Listed[] {
  const folder = typeof props.folder === "string" ? props.folder.replace(/^\/|\/$/g, "") : undefined
  const tag = typeof props.tag === "string" ? props.tag : undefined
  return notes.filter((f) => {
    if (f.slug.endsWith("/index") || f.slug === "index") return false
    if (folder !== undefined && !f.slug.startsWith(folder + "/")) return false
    if (tag !== undefined && !f.tags.includes(tag)) return false
    return true
  })
}

const el = (tagName: string, properties: Element["properties"], children: ElementContent[]): Element => ({
  type: "element",
  tagName,
  properties,
  children,
})

const formatDate = (d: Date, locale: string) =>
  // a frontmatter date is a day, read as midnight UTC: shown as that day anywhere
  d.toLocaleDateString(locale, { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" })

export function renderNoteLists(root: Root, locale = "en-US", all: () => Listed[] = listed) {
  let notes: Listed[] | undefined
  visit(root, "element", (node, _index, parent) => {
    if (node.tagName !== "note-list") return
    const p = node.properties
    // a list on a line of its own is in a paragraph, which a list can't be in:
    // it takes the paragraph's place (and its lines, lines.ts)
    const alone =
      parent?.type === "element" &&
      parent.tagName === "p" &&
      parent.children.every((c) => c === node || (c.type === "text" && !c.value.trim()))
    if (alone && parent.properties.dataSrc !== undefined) p.dataSrc = parent.properties.dataSrc
    notes ??= all()
    const time = (f: Listed) => f.date?.getTime() ?? 0
    const chosen = notesFor(p, notes).sort((a, b) => time(b) - time(a))
    const limit = Number(p.limit) || chosen.length
    const items = chosen.slice(0, limit).map((f) =>
      el("li", {}, [
        ...(f.date
          ? [el("span", { className: ["note-list-date"] }, [{ type: "text", value: formatDate(f.date, locale) }])]
          : []),
        el("a", { href: hrefOf(f.slug), className: ["internal"], dataSlug: f.slug }, [
          { type: "text", value: f.title ?? simplifySlug(f.slug) },
        ]),
      ]),
    )
    const children: ElementContent[] = [el("ul", { className: ["note-list"] }, items)]
    const folder = typeof p.folder === "string" ? p.folder.replace(/^\/|\/$/g, "") : undefined
    if (folder && chosen.length > limit) {
      const label = typeof p.more === "string" && p.more ? p.more : `see ${chosen.length - limit} more`
      children.push(
        el("p", { className: ["note-list-more"] }, [
          el("a", { href: hrefOf(`${folder}/index`), className: ["internal"] }, [
            { type: "text", value: `${label} →` },
          ]),
        ]),
      )
    }
    node.tagName = "div"
    // and the lines it's written on (lines.ts)
    node.properties = { className: ["note-list-block"], ...(p.dataSrc !== undefined && { dataSrc: p.dataSrc }) }
    node.children = children
    if (alone) {
      parent.tagName = "div"
      parent.properties = { className: ["note-list-block"], ...(p.dataSrc !== undefined && { dataSrc: p.dataSrc }) }
      parent.children = children
      return SKIP
    }
  })
}

export function rehypeNoteLists() {
  return (tree: Root) => renderNoteLists(tree, reg().site.config.locale)
}
