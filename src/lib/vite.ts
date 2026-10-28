// Vite plugins Basalt adds to Astro.
//
//   basalt:components/X   the site's <site>/components/X.astro if it has one,
//                         else Basalt's src/components/X.astro. Basalt's own
//                         layouts import their parts this way, and a plain
//                         import of src/components/X.astro from inside Basalt
//                         is redirected too, so a site replaces any part by
//                         dropping a file of the same name in components/.
//                         The site's file can still import Basalt's own
//                         (by path, or as @basalt/components/X.astro).
//   basalt:site-styles    <site>/styles/custom.scss, if there is one
//   browser markdown      in the page's own scripts (not the server's), node's
//                         modules and @astrojs/markdown-remark are stand-ins
//                         (src/markdown/browser), so the markdown plugins run
//                         in the browser too (a page being edited, render.ts)
//
// A component or stylesheet added to or removed from the site while serving
// reloads the page with the new resolution, and so does a save of
// basalt.json or basalt.config.ts (the layout is read as each page renders).

import fs from "node:fs"
import path from "node:path"
import type { Plugin, PluginOption, ViteDevServer } from "vite"
import { siteDir } from "./site"

const BASALT_COMPONENTS = path.resolve("src/components")
const PREFIX = "basalt:components/"
const VIRTUAL = { styles: "basalt:site-styles" }

function shadowing(): Plugin {
  const site = siteDir()
  const own = path.join(site, "components")
  const configFiles = ["basalt.json", "basalt.config.ts", "basalt.config.js", "basalt.config.mjs"].map((f) => path.join(site, f))
  const customStyles = path.join(site, "styles", "custom.scss")
  const siteHas = (name: string) => {
    const file = path.join(own, `${name}.astro`)
    return fs.existsSync(file) ? file : undefined
  }
  const fromSite = (importer?: string) => !!importer && importer.startsWith(own + path.sep)

  return {
    name: "basalt:shadowing",
    enforce: "pre",
    async resolveId(id, importer, opts) {
      if (id === VIRTUAL.styles) return "\0" + id
      if (id.startsWith(PREFIX)) {
        const name = id.slice(PREFIX.length).replace(/\.astro$/, "")
        return (!fromSite(importer) && siteHas(name)) || path.join(BASALT_COMPONENTS, `${name}.astro`)
      }
      // a relative import of one of Basalt's components, from Basalt
      if (!id.endsWith(".astro") || fromSite(importer) || !importer) return null
      const resolved = await this.resolve(id, importer, { ...opts, skipSelf: true })
      if (!resolved || path.dirname(resolved.id) !== BASALT_COMPONENTS) return null
      return siteHas(path.basename(resolved.id, ".astro")) ?? null
    },
    load(id) {
      if (id === "\0" + VIRTUAL.styles) {
        return fs.existsSync(customStyles) ? `import ${JSON.stringify(customStyles)}` : ""
      }
    },
    configureServer(server: ViteDevServer) {
      server.watcher.add([own, path.dirname(customStyles), ...configFiles])
      const restructure = (file: string) => {
        const hit = file === customStyles || (file.startsWith(own + path.sep) && file.endsWith(".astro"))
        if (!hit) return
        for (const env of Object.values(server.environments)) env.moduleGraph.invalidateAll()
        server.ws.send({ type: "full-reload" })
      }
      server.watcher.on("add", restructure)
      server.watcher.on("unlink", restructure)
      server.watcher.on("change", (file) => {
        if (configFiles.includes(file)) server.ws.send({ type: "full-reload" })
      })
    },
  }
}

const BROWSER = path.resolve("src/markdown/browser")
const STAND_INS: Record<string, string> = {
  fs: "fs.ts",
  path: "path.ts",
  "@astrojs/markdown-remark": "astro.ts",
}
const NODE = new Set(["url", "module", "child_process", "crypto", "os", "stream", "util"])

function browserMarkdown(): Plugin {
  return {
    name: "basalt:browser-markdown",
    enforce: "pre",
    resolveId(id) {
      if (this.environment.config.consumer !== "client") return null
      const name = id.replace(/^node:/, "")
      if (STAND_INS[name]) return path.join(BROWSER, STAND_INS[name])
      if (NODE.has(name)) return path.join(BROWSER, "node.ts")
      return null
    },
  }
}

export const vitePlugins: PluginOption[] = [shadowing(), browserMarkdown()]
