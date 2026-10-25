// What every markdown plugin and page can ask about the whole site: its files,
// their slugs, which file a note being rendered is. Kept on globalThis because
// Astro loads the config (where the plugins live) and the content loader
// through different module graphs, and both must see one registry.

import { loadSite, walkSite, type Site, type SiteFile } from "./site"
import type { FullSlug } from "./path"

export interface Registry {
  site: Site
  files: SiteFile[]
  /** every file's slug, notes and the rest (what wikilinks resolve against) */
  slugs: FullSlug[]
  byAbs: Map<string, SiteFile>
  bySlug: Map<FullSlug, SiteFile>
}

const KEY = Symbol.for("basalt.registry")
type Holder = { [KEY]?: Registry }

export function refreshRegistry(): Registry {
  const site = loadSite()
  const files = walkSite(site)
  const reg: Registry = {
    site,
    files,
    slugs: files.map((f) => f.slug),
    byAbs: new Map(files.map((f) => [f.abs, f])),
    bySlug: new Map(files.map((f) => [f.slug, f])),
  }
  ;(globalThis as Holder)[KEY] = reg
  return reg
}

export function registry(): Registry {
  return (globalThis as Holder)[KEY] ?? refreshRegistry()
}

/** The site file a vfile (a note being rendered) came from. */
export function fileOf(vfile: { path?: string }): SiteFile | undefined {
  return vfile.path ? registry().byAbs.get(vfile.path) : undefined
}
