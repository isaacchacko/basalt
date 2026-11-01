// A Basalt site is a folder: its notes, plus a few optional files that set it
// up. Basalt reads it from BASALT_SITE (or --site), and never writes into it
// except under <site>/.basalt/astro.
//
//   basalt.json         { title, baseUrl, description, icon, content: [{ from, to }] }
//   basalt.config.ts    optional: markdown plugins, layout choices (see config.ts)
//   styles/custom.scss  the site's look, on top of Basalt's
//   islands/            interactive components
//   components/         .astro components that replace Basalt's own, by name
//
// `content` lists folders (or single files) gathered into one tree of notes,
// each at a path inside it: { "from": "../posts", "to": "blog" }. With no
// `content`, the site's notes/ folder is the whole tree.

import fs from "node:fs"
import path from "node:path"
import { slugifyFilePath, type FilePath, type FullSlug } from "./path.ts"

export interface SiteConfig {
  title: string
  description?: string
  /** the host it's published at, e.g. "basalt.isaacchacko.com" (no protocol) */
  baseUrl?: string
  /** a file in the site's tree for the tab's icon, e.g. "assets/icon.svg"; Basalt's mark without one */
  icon?: string
  locale: string
  content: { from: string; to?: string }[]
}

export interface Site {
  dir: string
  config: SiteConfig
  /** where Basalt writes for this site: <site>/.basalt/astro (the Quartz build keeps <site>/.basalt) */
  work: string
}

/** One file in the site's tree of notes. */
export interface SiteFile {
  /** where it is on disk */
  abs: string
  /** its path in the tree, e.g. "blog/a post.md" */
  rel: FilePath
  /** e.g. "blog/a-post" for a note, "assets/card.png" for anything else */
  slug: FullSlug
  isNote: boolean
}

export function siteDir(): string {
  return path.resolve(process.env.BASALT_SITE ?? "examples/showcase")
}

/** `basalt dev`, as against a build (set by integrations/buffer.ts) */
export const serving = () => process.env.BASALT_COMMAND === "dev"

export function loadSite(dir = siteDir()): Site {
  const file = path.join(dir, "basalt.json")
  const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}
  const config: SiteConfig = {
    title: raw.title ?? path.basename(dir),
    description: raw.description,
    baseUrl: raw.baseUrl,
    icon: typeof raw.icon === "string" && raw.icon.trim() ? raw.icon.trim() : undefined,
    locale: raw.locale ?? "en-US",
    content: Array.isArray(raw.content) ? raw.content : [{ from: "notes" }],
  }
  return { dir, config, work: path.join(dir, ".basalt", "astro") }
}

const IGNORED = /(^|\/)(\.|node_modules\/|private\/)/

/** Every file in the site's tree, notes and the rest. Two sources may share a folder, not a file. */
export function walkSite(site: Site): SiteFile[] {
  const seen = new Map<string, SiteFile>()
  const add = (abs: string, rel: string) => {
    rel = rel.split(path.sep).join("/")
    if (IGNORED.test(rel)) return
    const prior = seen.get(rel)
    if (prior) {
      throw new Error(`basalt.json: ${prior.abs} and ${abs} are both ${rel}`)
    }
    const isNote = rel.endsWith(".md")
    seen.set(rel, {
      abs,
      rel: rel as FilePath,
      slug: slugifyFilePath(rel as FilePath),
      isNote,
    })
  }
  const walk = (abs: string, rel: string) => {
    const stat = fs.statSync(abs, { throwIfNoEntry: false })
    if (!stat) return
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(abs)) walk(path.join(abs, entry), path.posix.join(rel, entry))
    } else add(abs, rel)
  }
  for (const { from, to = "" } of site.config.content) {
    const abs = path.resolve(site.dir, from)
    if (!fs.existsSync(abs)) {
      console.warn(`basalt.json: ${from} doesn't exist, skipping it`)
      continue
    }
    if (fs.statSync(abs).isDirectory()) walk(abs, to)
    else add(abs, to || path.basename(abs))
  }
  return [...seen.values()].sort((a, b) => a.rel.localeCompare(b.rel))
}

/** The folders the site's notes come from, to watch while serving. */
export function sourceDirs(site: Site): string[] {
  return site.config.content.map(({ from }) => path.resolve(site.dir, from))
}

/**
 * Everything that isn't a note is served as it is, at its slug: Basalt keeps a
 * tree of links to them in <site>/.basalt/astro/public, Astro's public folder.
 */
export function linkPublic(site: Site, files: SiteFile[]): string {
  const out = path.join(site.work, "public")
  fs.mkdirSync(out, { recursive: true })
  // brought up to date in place, never wiped: a build while a dev server is
  // serving the same folder mustn't leave it serving nothing
  const want = new Map<string, string>()
  const own = path.join(site.dir, "public")
  const walkOwn = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walkOwn(abs)
      else want.set(path.relative(own, abs), abs)
    }
  }
  if (fs.existsSync(own)) walkOwn(own)
  for (const f of files) if (!f.isNote) want.set(f.slug, f.abs)
  const have = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      const rel = path.relative(out, abs)
      if (entry.isDirectory()) {
        have(abs)
        if (!fs.readdirSync(abs).length) fs.rmdirSync(abs)
      } else if (!want.has(rel) || fs.readlinkSync(abs) !== want.get(rel)) fs.rmSync(abs)
    }
  }
  have(out)
  for (const [rel, abs] of want) {
    const dest = path.join(out, rel)
    if (fs.lstatSync(dest, { throwIfNoEntry: false })) continue
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.symlinkSync(abs, dest)
  }
  return out
}

export function linkOne(out: string, f: SiteFile) {
  const dest = path.join(out, f.slug)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.rmSync(dest, { force: true })
  fs.symlinkSync(f.abs, dest)
}
