// How a site lays out its pages: which of Basalt's parts show, and which of
// the opt-in ones (graph, contents, backlinks) are on for every page.
//
// Basalt's defaults, then basalt.json's "layout", then the "layout" of an
// optional <site>/basalt.config.ts (its default export), each over the last:
//
//   // basalt.json
//   { "layout": { "toc": true, "footer": { "links": { "GitHub": "https://…" } } } }
//
//   // basalt.config.ts (beside its markdown plugins, if it has any)
//   export default { layout: { components: { breadcrumbs: false } } }
//
// a top-level "theme" (in either) for the site's palette:
//
//   { "theme": { "colors": { "lightMode": { "light": "#f5eedd" }, "darkMode": { ... } } } }
//
// a top-level "strings" for the words Basalt puts on the page (strings.ts):
//
//   { "strings": { "explorer": "the garden", "noTags": "no tags yet." } }
//
// a top-level "analytics" for who's reading (analytics.ts):
//
//   { "analytics": { "provider": "vercel" } }
//
// and a top-level "password" for who can (integrations/password.ts), its
// password the BASALT_PASSWORD env var, never a file:
//
//   { "password": true }
//
// A page turns an opt-in part on (or off) for itself in its frontmatter:
// `graph: true`, `toc: true`, `backlinks: true`.

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { hookResolution, nativeImport } from "../markdown/siteconfig"
import { siteDir } from "./site"
import { strings, type Strings } from "./strings"
import type { Analytics } from "./analytics"

export interface LayoutConfig {
  /** which of the page's parts show */
  components: {
    breadcrumbs: boolean
    explorer: boolean
    search: boolean
    darkmode: boolean
    /** the toggle that shows a page as its markdown */
    source: boolean
    /** the date and reading time: on every note, only on notes with a date of their own ("dated"), or none */
    meta: boolean | "dated"
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
    /**
     * Entries that come first, in this order, by slug: ["about", "now",
     * "blog", "blog/a-post"]. The rest follow, folders first, then by name.
     * Home, if the explorer lists it, is always first.
     */
    order: string[]
    /**
     * Folders whose entries list newest first, by their notes' dates (the
     * undated after, by name), the way a folder's own page lists them:
     * ["blog"]. Entries `order` lists still come first.
     */
    byDate?: string[]
  }
  breadcrumbs: { rootName: string }
  footer: { links: Record<string, string> }
  /**
   * Each note's card for where it's shared (og:image, made by Basalt in the
   * site's palette): on unless false. A note's frontmatter `image` (a file in
   * the site, or a url) is its card instead.
   */
  socialImages: boolean
  /** how many notes rss.xml carries */
  rssLimit: number
  feed: {
    /** the folders whose notes the feed carries (["blog"]); none listed, every note */
    folders: string[]
  }
  /** the words Basalt puts on the page, over its own (strings.ts); a top-level "strings" in basalt.json */
  strings: Strings
  /** the site's analytics (analytics.ts); a top-level "analytics" in basalt.json */
  analytics?: Analytics
  /**
   * The built site behind a password (integrations/password.ts), which is
   * the BASALT_PASSWORD env var where it's served; a top-level "password" in
   * basalt.json. Its feeds, sitemap and cards aren't built.
   */
  password?: boolean
  /**
   * The site's palette, over Basalt's (src/styles/basalt.scss): any of
   * light, lightgray, gray, darkgray, dark, secondary, tertiary, highlight,
   * textHighlight, for each mode. In basalt.json it's a top-level "theme".
   */
  theme: {
    colors: { lightMode: Record<string, string>; darkMode: Record<string, string> }
    /**
     * The site's type, over Basalt's (Palatino for everything but code): a
     * CSS font-family for `title` (the page's title and labels), `header`
     * (headings), `body` and `code`, and `load`, stylesheets that bring in
     * fonts the visitor may not have (a Google Fonts link, say).
     */
    fonts: { title?: string; header?: string; body?: string; code?: string; load?: string[] }
    /**
     * What a list hangs on: a round dot (Basalt's), a hexagon (basalt's
     * columns, seen from above), or nothing. Any of it can be set finer with
     * the --basalt-bullet-* properties (styles/basalt.scss).
     */
    bullets?: "circle" | "hexagon" | "none"
    /**
     * Where a playing <sound>'s card sits: beside its word, then held at the
     * top as you read on ("beside", Basalt's), or at the foot of the screen in
     * the side content the whole time it plays ("screen").
     */
    nowPlaying?: "beside" | "screen"
  }
}

/** each bullet, as the --basalt-bullet-* properties it sets */
const BULLETS: Record<string, Record<string, string>> = {
  circle: {},
  // flat sides left and right, like a basalt column seen from above; it turns as you point
  hexagon: {
    "basalt-bullet-shape": "polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0% 50%)",
    "basalt-bullet-size": "0.7em",
    "basalt-bullet-height": "0.62em",
    "basalt-bullet-hover-transform": "rotate(60deg) scale(1.15)",
  },
  none: { "basalt-bullet-display": "none" },
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
    source: true,
    meta: true,
    tags: true,
    footer: true,
  },
  graph: false,
  toc: false,
  backlinks: false,
  explorer: { folderDefaultState: "collapsed", order: [] },
  breadcrumbs: { rootName: "Home" },
  footer: { links: {} },
  socialImages: true,
  rssLimit: 10,
  feed: { folders: [] },
  strings,
  theme: { colors: { lightMode: {}, darkMode: {} }, fonts: {} },
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

/**
 * The site's basalt.config.ts, imported by node as the markdown plugins are
 * (src/markdown/siteconfig.ts: the same file, the same resolution), afresh
 * whenever it's saved.
 */
async function siteConfig(dir: string): Promise<BasaltConfig> {
  const file = ["basalt.config.ts", "basalt.config.js", "basalt.config.mjs"]
    .map((f) => path.join(dir, f))
    .find((f) => fs.existsSync(f))
  if (!file) return {}
  try {
    hookResolution()
    const mod = await nativeImport(pathToFileURL(file).href + `?t=${fs.statSync(file).mtimeMs}`)
    const own = (mod.default ?? {}) as BasaltConfig & { theme?: unknown; strings?: unknown }
    const lay = (mod.layout ?? own.layout ?? {}) as Record<string, unknown>
    const theme = mod.theme ?? own.theme
    const words = mod.strings ?? own.strings
    const analytics = mod.analytics ?? (own as { analytics?: unknown }).analytics
    const password = mod.password ?? (own as { password?: unknown }).password
    return {
      layout: {
        ...lay,
        ...(theme ? { theme } : {}),
        ...(words ? { strings: words } : {}),
        ...(analytics ? { analytics } : {}),
        ...(password !== undefined ? { password } : {}),
      } as BasaltConfig["layout"],
    }
  } catch (err) {
    console.error(`basalt: ${file}: ${(err as Error).message}`)
    return {}
  }
}

let last: LayoutConfig | undefined

/** The site's layout, read fresh each page (basalt.json and basalt.config.ts can change while serving). */
export async function layout(): Promise<LayoutConfig> {
  const dir = siteDir()
  let json: { layout?: Record<string, unknown>; theme?: unknown; strings?: unknown; analytics?: unknown; password?: unknown } = {}
  try {
    json = JSON.parse(fs.readFileSync(path.join(dir, "basalt.json"), "utf8"))
  } catch {}
  const fromJson = {
    ...json.layout,
    ...(json.theme ? { theme: json.theme } : {}),
    ...(json.strings ? { strings: json.strings } : {}),
    ...(json.analytics ? { analytics: json.analytics } : {}),
    ...(json.password !== undefined ? { password: json.password } : {}),
  }
  last = merge(merge(defaults, fromJson), (await siteConfig(dir)).layout)
  return last
}

/**
 * The margin's opt-in parts, as the site sets them (all off by default), for
 * Margin.astro: the layout the page being rendered read (Page.astro reads it
 * before its margin renders).
 */
export const margin = {
  get graph() {
    return (last ?? defaults).graph
  },
  get toc() {
    return (last ?? defaults).toc
  },
  get backlinks() {
    return (last ?? defaults).backlinks
  },
}

export interface Features {
  graph: boolean
  toc: boolean
  backlinks: boolean
}

/** Which opt-in parts a page shows: its frontmatter, else the site's layout. */
export function features(data: Record<string, unknown>, cfg: LayoutConfig): Features {
  const pick = (key: keyof Features) => {
    const v = data[key]
    if (v === true || v === "true") return true
    if (v === false || v === "false") return false
    return cfg[key]
  }
  return { graph: pick("graph"), toc: pick("toc"), backlinks: pick("backlinks") }
}

/** The site's palette and type as css, to follow Basalt's own (empty when it has none). */
export function paletteCss(cfg: LayoutConfig): string {
  const block = (sel: string, colors: Record<string, string>) => {
    const decls = Object.entries(colors)
      .filter(([k, v]) => /^[a-zA-Z]+$/.test(k) && /^[#\w(),.\s%"'-]+$/.test(v))
      .map(([k, v]) => `--${k}: ${v};`)
      .join(" ")
    return decls ? `${sel} { ${decls} }` : ""
  }
  const fonts = cfg.theme.fonts ?? {}
  const type = Object.fromEntries(
    (["title", "header", "body", "code"] as const)
      .filter((k) => typeof fonts[k] === "string" && /^[\w\s",'-]+$/.test(fonts[k]!))
      .map((k) => [`${k}Font`, fonts[k]!]),
  )
  const bullets = Object.entries(BULLETS[cfg.theme.bullets ?? "circle"] ?? {})
    .map(([k, v]) => `--${k}: ${v};`)
    .join(" ")
  const nowPlaying = cfg.theme.nowPlaying === "screen" ? ":root { --basalt-now-playing: screen; }" : ""
  return [
    block(":root", { ...(cfg.theme.colors.lightMode ?? {}), ...type }),
    bullets ? `:root { ${bullets} }` : "",
    nowPlaying,
    block(':root[saved-theme="dark"]', cfg.theme.colors.darkMode ?? {}),
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * The explorer's order (`layout.explorer.order`) as a sort: the slugs it
 * lists first, in its order, then the rest as `rest` sorts them.
 */
export function ordered<T extends { slug: string }>(order: string[], rest: (a: T, b: T) => number) {
  const rank = new Map(order.map((slug, i) => [slug.replace(/^\/+|\/+$/g, "").replace(/(^|\/)index$/, ""), i]))
  // home ("" or "index"), when the explorer lists it, is always first
  const of = (n: T) => (n.slug === "" || n.slug === "index" ? -1 : (rank.get(n.slug) ?? Infinity))
  return (a: T, b: T) => {
    const ra = of(a)
    const rb = of(b)
    return ra === rb ? rest(a, b) : ra - rb
  }
}

/** Whether the feed carries a note: every note, or those under `feed.folders`. */
export function inFeed(slug: string, cfg: LayoutConfig): boolean {
  const folders = cfg.feed.folders.map((f) => f.replace(/^\/+|\/+$/g, "")).filter(Boolean)
  if (folders.length === 0) return true
  return folders.some((f) => slug.startsWith(f + "/") && slug !== `${f}/index`)
}
