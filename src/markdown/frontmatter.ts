// What a note says about itself, and what the page needs to know of it.
//
// remarkNote runs first: it tells every later plugin which note this is
// (file.data.slug) and tidies the frontmatter the way Quartz's FrontMatter
// did, as file.data.frontmatter. That is the same object as Astro's
// file.data.astro.frontmatter, so whatever a plugin (Basalt's or a site's)
// sets there becomes the note's entry data.
//
// rehypeNoteData runs after the links, embeds and margin notes: it adds the
// note's description, reading time, and the files it uses (its pictures,
// sounds, videos, pdfs, code and data, from any attribute that points at one).
//
// The data contract (what the page can count on):
//   title, links, files, tags, aliases, description, readingTime, date,
//   draft, private, transcludes (set by transclude.ts)

import fs from "node:fs"
import type { Root as HtmlRoot } from "hast"
import { toString } from "hast-util-to-string"
import { SKIP, visit } from "unist-util-visit"
import readingTime from "reading-time"
import type { VFile } from "vfile"
import { slugTag, type FullSlug } from "../lib/path"
import { crawlLinks } from "../lib/links.ts"
import { noteOf, reg, slugOf } from "./context.ts"
import { datesOf } from "../lib/gitdates.ts"
import { sourceDirs } from "../lib/site.ts"

function coalesce(data: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (data[key] !== undefined && data[key] !== null) return data[key]
}

function coerceToArray(input: unknown): string[] | undefined {
  if (input === undefined || input === null) return undefined
  const list = Array.isArray(input) ? input : String(input).split(",").map((t) => t.trim())
  return list
    .filter((t: unknown) => typeof t === "string" || typeof t === "number")
    .map((t: string | number) => t.toString())
}

const truthy = (v: unknown) => v === true || v === "true"

function isoDate(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

export function remarkNote() {
  return (_tree: unknown, file: VFile) => {
    const note = noteOf(file)
    if (note) file.data.slug = note.slug
    const astro = (file.data.astro ??= {}) as { frontmatter?: Record<string, unknown> }
    const data = (astro.frontmatter ??= {})

    data.title = data.title != null && data.title.toString() !== "" ? data.title.toString() : (file.stem ?? "Untitled")

    const tags = coerceToArray(coalesce(data, ["tags", "tag"]))
    data.tags = tags ? [...new Set(tags.map((tag) => slugTag(tag)))] : []

    const aliases = coerceToArray(coalesce(data, ["aliases", "alias"]))
    data.aliases = aliases ?? []

    const cssclasses = coerceToArray(coalesce(data, ["cssclasses", "cssclass"]))
    if (cssclasses) data.cssclasses = cssclasses

    // frontmatter's date, else when the file was made: its first commit, else
    // the file system's (a fresh clone's is the clone's)
    const given = isoDate(coalesce(data, ["date", "created", "published", "publishDate"]))
    data.date =
      given ?? (file.path && fs.existsSync(file.path) ? datesOf(file.path, sourceDirs(reg().site)).created.toISOString() : undefined)
    // whether the note says when it's from (a site can show dates only then)
    data.dated = given !== undefined

    // not published: the page route leaves these out
    data.draft = truthy(data.draft)
    data.private = truthy(data.private)

    file.data.frontmatter = data as VFile["data"]["frontmatter"]
  }
}

/** Links are crawled here, before the embeds (which read their resolved srcs). */
export function rehypeLinks() {
  return (tree: HtmlRoot, file: VFile) => {
    const links = crawlLinks(tree, slugOf(file), reg().slugs)
    if (file.data.frontmatter) file.data.frontmatter.links = links
    // Astro collected the note's images to optimise them as its own assets;
    // Basalt serves them as they are, from the srcs just resolved
    const astro = file.data.astro as { localImagePaths?: string[]; remoteImagePaths?: string[] } | undefined
    if (astro) astro.localImagePaths = astro.remoteImagePaths = []
  }
}

/** The note's first paragraph as plain text, without its sidenotes' numbers or text. */
function firstParagraph(tree: HtmlRoot): string {
  for (const node of tree.children) {
    if (node.type !== "element" || node.tagName !== "p") continue
    const p = structuredClone(node)
    visit(p, "element", (el, i, parent) => {
      const cls = (el.properties.className ?? []) as string[]
      if (parent && i !== undefined && (el.tagName === "sup" || cls.includes("sidenote"))) {
        parent.children.splice(i, 1)
        return [SKIP, i]
      }
    })
    const text = toString(p).replace(/\s+/g, " ").trim()
    if (text) return text
  }
  return ""
}

/**
 * The note's description: the frontmatter's, else its first paragraph's
 * first sentences, up to about 150 characters (Quartz's rule, but from the
 * first paragraph, not whatever text comes first); and how many minutes it
 * takes to read.
 */
export function describe(tree: HtmlRoot, given?: string): { description: string; readingTime: number } {
  const minutes = Math.ceil(readingTime(toString(tree)).minutes)
  if (given) return { description: given, readingTime: minutes }

  const sentences = firstParagraph(tree).split(/\.\s/)
  let desc = ""
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]
    if (!sentence) break
    const current = /[.!?:]$/.test(sentence) ? sentence : sentence + "."
    const next = desc.length + current.length + (desc ? 1 : 0)
    // always at least one sentence
    if (next <= 150 || i === 0) desc += (desc ? " " : "") + current
    else break
  }
  return { description: desc.length > 300 ? desc.slice(0, 300) + "…" : desc, readingTime: minutes }
}

/**
 * The site's files a note uses, other notes aside: whatever an attribute points
 * at, in its markdown or its raw html (an embed's src, a link's href, a pdf's
 * data-pdf, a sound's data-sound), if it's a file in the site. A picture's dark
 * version counts as the picture.
 */
export function filesUsed(tree: HtmlRoot, has: (slug: string) => boolean): string[] {
  const found = new Set<string>()
  visit(tree, "element", (el) => {
    // an attribute may hold a list (a <sound>'s clips: "/a.mp3, /b.mp3")
    for (const value of Object.values(el.properties ?? {}).flatMap((v) => (typeof v === "string" ? v.split(/\s*,\s*/) : []))) {
      if (!value.startsWith("/") || value.startsWith("//")) continue
      let slug: string
      try {
        slug = decodeURIComponent(value.split(/[?#]/)[0].slice(1))
      } catch {
        continue
      }
      slug = slug.replace(/\.dark(\.[^./]+)$/, "$1")
      if (slug && has(slug)) found.add(slug)
    }
  })
  return [...found].sort()
}

export function rehypeNoteData() {
  return (tree: HtmlRoot, file: VFile) => {
    const fm = file.data.frontmatter
    if (!fm) return
    const given = typeof fm.description === "string" ? fm.description : undefined
    Object.assign(fm, describe(tree, given))
    fm.links ??= [] as FullSlug[]
    fm.transcludes ??= []
    const { bySlug } = reg()
    fm.files = filesUsed(tree, (slug) => bySlug.get(slug as FullSlug)?.isNote === false)
  }
}
