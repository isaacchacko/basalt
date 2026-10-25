// How a site lays out its pages: which of Basalt's parts show, and which of
// the opt-in ones (graph, contents, backlinks) are on for every page.
//
// Basalt's defaults, then basalt.json's "layout", then the "layout" of an
// optional <site>/basalt.config.ts (its default export), each over the last:
//
//   // basalt.json
//   { "layout": { "toc": true, "footer": { "links": { "GitHub": "https://…" } } } }
//
//   // basalt.config.ts
//   export default { layout: { components: { breadcrumbs: false } } }
//
// A page turns an opt-in part on (or off) for itself in its frontmatter:
// `graph: true`, `toc: true`, `backlinks: true`.

import fs from "node:fs"
import path from "node:path"
// the site's basalt.config.ts, or {} (see vite.ts)
import siteConfig from "basalt:config"
import { siteDir } from "./site"

export interface LayoutConfig {
  /** which of the page's parts show */
  components: {
    breadcrumbs: boolean
    explorer: boolean
    search: boolean
    darkmode: boolean
    meta: boolean
    tags: boolean
    footer: boolean
  }
  /** the opt-in parts, on for every page (a page's frontmatter still wins) */
  graph: boolean
  toc: boolean
  backlinks: boolean
  explorer: {
    /** folders the note you're on isn't in start "collapsed" or "open" */
    folderDefaultState: "collapsed" | "open"
  }
  breadcrumbs: { rootName: string }
  footer: { links: Record<string, string> }
  /** how many notes rss.xml carries */
  rssLimit: number
}

export interface BasaltConfig {
  layout?: DeepPartial<LayoutConfig>
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

export const defaults: LayoutConfig = {
  components: {
    breadcrumbs: true,
    explorer: true,
    search: true,
    darkmode: true,
    meta: true,
    tags: true,
    footer: true,
  },
  graph: false,
  toc: false,
  backlinks: false,
  explorer: { folderDefaultState: "collapsed" },
  breadcrumbs: { rootName: "Home" },
  footer: { links: {} },
  rssLimit: 10,
}

function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== "object" || Array.isArray(over)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(over)) {
    const b = out[k]
    // links are the site's own list, not merged into Basalt's
    out[k] =
      b && typeof b === "object" && !Array.isArray(b) && k !== "links" ? merge(b, v) : (v ?? b)
  }
  return out as T
}

/** The site's layout, read fresh each call (basalt.json can change while serving). */
export function layout(): LayoutConfig {
  const file = path.join(siteDir(), "basalt.json")
  let json: { layout?: unknown } = {}
  try {
    json = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {}
  return merge(merge(defaults, json.layout), (siteConfig as BasaltConfig).layout)
}

export interface Features {
  graph: boolean
  toc: boolean
  backlinks: boolean
}

/** Which opt-in parts a page shows: its frontmatter, else the site's layout. */
export function features(data: Record<string, unknown>, cfg = layout()): Features {
  const pick = (key: keyof Features) => {
    const v = data[key]
    if (v === true || v === "true") return true
    if (v === false || v === "false") return false
    return cfg[key]
  }
  return { graph: pick("graph"), toc: pick("toc"), backlinks: pick("backlinks") }
}
