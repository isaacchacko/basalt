// A site's own markdown plugins, from <site>/basalt.config.ts:
//
//   export default {
//     markdown: { textTransforms: [...], remarkPlugins: [...], rehypePlugins: [...] },
//   }
//
// (or `export const markdown = {...}`). They run after Basalt's own. The file
// is imported by node itself, not Vite, since the config that uses it runs
// before Vite does. A site needn't install anything: a package it imports
// that isn't in its own node_modules comes from Basalt's, and `./plugins`
// finds `./plugins.ts`. The site's own modules it imports are tracked
// (siteModules), so a save to one is a save to the config: it's imported
// afresh, the server restarts, and every note is rendered again.

import fs from "node:fs"
import path from "node:path"
import { registerHooks, type ResolveHook } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { PluggableList } from "unified"
import type { SiteFile } from "../lib/site"

export type TextTransform = (text: string, file: SiteFile) => string

export interface SiteMarkdown {
  textTransforms: TextTransform[]
  remarkPlugins: PluggableList
  rehypePlugins: PluggableList
}

const HOOKED = Symbol.for("basalt.siteResolve")
// on globalThis: node's hooks, Vite's copy of this module and node's share them
const SITES = Symbol.for("basalt.siteDirs")
const MODULES = Symbol.for("basalt.siteModules")
const shared = globalThis as { [SITES]?: Set<string>; [MODULES]?: Set<string> }
const siteDirs = (shared[SITES] ??= new Set())
const modules = (shared[MODULES] ??= new Set())

/** The site's own modules its config has imported (a ./plugins.ts), as absolute paths. */
export const siteModules = (): string[] => [...modules]

const mtime = (file: string) => fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0

/** A file of the site's own, not a package or Basalt's work folder. */
function ownModule(file: string): boolean {
  if (file.includes(`${path.sep}node_modules${path.sep}`) || file.includes(`${path.sep}.basalt${path.sep}`)) return false
  return [...siteDirs].some((dir) => file.startsWith(dir + path.sep))
}

/**
 * How node finds and reads a site's own modules (its basalt.config.ts and
 * what that imports): a package the site hasn't installed comes from
 * Basalt's, `./plugins` finds `./plugins.ts`, and a site's TypeScript is an
 * ES module, whatever its nearest package.json says ("type": "commonjs", as
 * `npm init` writes, would have node read it as CommonJS and fail).
 */
export function hookResolution(basalt: string = process.cwd()) {
  const g = globalThis as { [HOOKED]?: boolean }
  if (g[HOOKED]) return
  g[HOOKED] = true
  const fromBasalt = pathToFileURL(path.join(basalt, "package.json")).href
  registerHooks({
    resolve(specifier, context, next) {
      const found = resolve(specifier, context, next)
      // (the config itself comes with its own ?t=, from importSiteConfig)
      if (!found.url.startsWith("file:") || found.url.includes("?")) return found
      const file = fileURLToPath(found.url)
      if (!ownModule(file)) return found
      modules.add(file)
      // a module node has seen is never read again: a saved one is a new url
      return { ...found, url: `${found.url.split("?")[0]}?t=${mtime(file)}` }
    },
    load(url, context, next) {
      if (url.startsWith("file:") && /\.(m?ts|tsx)(\?|$)/.test(url) && !url.includes("/node_modules/"))
        return next(url, { ...context, format: "module-typescript" })
      return next(url, context)
    },
  })

  function resolve(...[specifier, context, next]: Parameters<ResolveHook>): ReturnType<ResolveHook> {
    try {
      return next(specifier, context)
    } catch (err) {
      const relative = /^\.{1,2}\//.test(specifier)
      if (relative && !/\.[cm]?[jt]sx?$/.test(specifier)) {
        for (const ext of [".ts", ".tsx", "/index.ts"]) {
          try {
            return next(specifier + ext, context)
          } catch {}
        }
      }
      if (!relative && !specifier.startsWith("node:") && !specifier.startsWith("file:")) {
        return next(specifier, { ...context, parentURL: fromBasalt })
      }
      throw err
    }
  }
}

/**
 * A dynamic import Vite leaves alone, so node loads the module itself. The
 * markdown plugins are loaded with the Astro config, through a module runner
 * that's closed by the time they run.
 */
export const nativeImport = new Function("url", "return import(url)") as (url: string) => Promise<Record<string, unknown>>

/**
 * A site's basalt.config.ts, imported by node, afresh when it or one of the
 * site's own modules it imports has been saved since.
 */
export function importSiteConfig(file: string, basalt?: string): Promise<Record<string, unknown>> {
  hookResolution(basalt)
  // node hands back real paths: a site behind a link is known by both
  siteDirs.add(path.dirname(file)).add(fs.realpathSync(path.dirname(file)))
  const saved = Math.max(mtime(file), ...siteModules().map(mtime))
  return nativeImport(pathToFileURL(file).href + `?t=${saved}`)
}

export async function loadSiteMarkdown(siteDir: string, basalt = process.cwd()): Promise<SiteMarkdown> {
  const empty: SiteMarkdown = { textTransforms: [], remarkPlugins: [], rehypePlugins: [] }
  const file = ["basalt.config.ts", "basalt.config.js", "basalt.config.mjs"]
    .map((f) => path.join(siteDir, f))
    .find((f) => fs.existsSync(f))
  if (!file) return empty
  const mod = await importSiteConfig(file, basalt)
  const config = (mod.default ?? {}) as { markdown?: Partial<SiteMarkdown> }
  const md = (mod.markdown ?? config.markdown ?? {}) as Partial<SiteMarkdown>
  return {
    textTransforms: md.textTransforms ?? [],
    remarkPlugins: md.remarkPlugins ?? [],
    rehypePlugins: md.rehypePlugins ?? [],
  }
}
