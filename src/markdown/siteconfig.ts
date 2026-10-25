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
// finds `./plugins.ts`.

import fs from "node:fs"
import path from "node:path"
import { registerHooks } from "node:module"
import { pathToFileURL } from "node:url"
import type { PluggableList } from "unified"
import type { SiteFile } from "../lib/site"

export type TextTransform = (text: string, file: SiteFile) => string

export interface SiteMarkdown {
  textTransforms: TextTransform[]
  remarkPlugins: PluggableList
  rehypePlugins: PluggableList
}

const HOOKED = Symbol.for("basalt.siteResolve")

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
    },
    load(url, context, next) {
      if (url.startsWith("file:") && /\.(m?ts|tsx)(\?|$)/.test(url) && !url.includes("/node_modules/"))
        return next(url, { ...context, format: "module-typescript" })
      return next(url, context)
    },
  })
}

/**
 * A dynamic import Vite leaves alone, so node loads the module itself. The
 * markdown plugins are loaded with the Astro config, through a module runner
 * that's closed by the time they run.
 */
export const nativeImport = new Function("url", "return import(url)") as (url: string) => Promise<Record<string, unknown>>

export async function loadSiteMarkdown(siteDir: string, basalt = process.cwd()): Promise<SiteMarkdown> {
  const empty: SiteMarkdown = { textTransforms: [], remarkPlugins: [], rehypePlugins: [] }
  const file = ["basalt.config.ts", "basalt.config.js", "basalt.config.mjs"]
    .map((f) => path.join(siteDir, f))
    .find((f) => fs.existsSync(f))
  if (!file) return empty
  hookResolution(basalt)
  const mod = await nativeImport(pathToFileURL(file).href + `?t=${fs.statSync(file).mtimeMs}`)
  const config = (mod.default ?? {}) as { markdown?: Partial<SiteMarkdown> }
  const md = (mod.markdown ?? config.markdown ?? {}) as Partial<SiteMarkdown>
  return {
    textTransforms: md.textTransforms ?? [],
    remarkPlugins: md.remarkPlugins ?? [],
    rehypePlugins: md.rehypePlugins ?? [],
  }
}
