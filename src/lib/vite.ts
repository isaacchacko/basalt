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
//   basalt:config         the default export of <site>/basalt.config.ts, or {}
//   basalt:site-styles    <site>/styles/custom.scss, if there is one
//
// A component, config or stylesheet added to or removed from the site while
// serving reloads the page with the new resolution.

import fs from "node:fs"
import path from "node:path"
import type { Plugin, PluginOption, ViteDevServer } from "vite"
import { siteDir } from "./site"

const BASALT_COMPONENTS = path.resolve("src/components")
const PREFIX = "basalt:components/"
const VIRTUAL = { config: "basalt:config", styles: "basalt:site-styles" }

function shadowing(): Plugin {
  const site = siteDir()
  const own = path.join(site, "components")
  const configFile = path.join(site, "basalt.config.ts")
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
      if (id === VIRTUAL.config || id === VIRTUAL.styles) return "\0" + id
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
      if (id === "\0" + VIRTUAL.config) {
        return fs.existsSync(configFile)
          ? `export { default } from ${JSON.stringify(configFile)}`
          : "export default {}"
      }
      if (id === "\0" + VIRTUAL.styles) {
        return fs.existsSync(customStyles) ? `import ${JSON.stringify(customStyles)}` : ""
      }
    },
    configureServer(server: ViteDevServer) {
      const watched = [own, configFile, path.dirname(customStyles)]
      server.watcher.add(watched)
      const restructure = (file: string) => {
        const hit =
          file === configFile ||
          file === customStyles ||
          (file.startsWith(own + path.sep) && file.endsWith(".astro"))
        if (!hit) return
        for (const env of Object.values(server.environments)) env.moduleGraph.invalidateAll()
        server.ws.send({ type: "full-reload" })
      }
      server.watcher.on("add", restructure)
      server.watcher.on("unlink", restructure)
    },
  }
}

export const vitePlugins: PluginOption[] = [shadowing()]
