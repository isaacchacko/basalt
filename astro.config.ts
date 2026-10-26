import { defineConfig } from "astro/config"
import preact from "@astrojs/preact"
import { parseFrontmatter, unified } from "@astrojs/markdown-remark"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadSite, siteDir } from "./src/lib/site"
import { processorOptions, rehypePlugins, remarkPlugins, renderTarget, syntaxHighlight } from "./src/markdown"
import { useTargets } from "./src/markdown/transclude"
import { listed, rehypeNoteLists, renderNoteLists } from "./src/markdown/notelist"
import { useRegistry } from "./src/markdown/context"
import { registry } from "./src/lib/registry"
import { vitePlugins } from "./src/lib/vite"
import { agentApi } from "./src/integrations/agent"

const site = loadSite(siteDir())
// Basalt itself, wherever it's run from: a site's root is its own .basalt
// folder (so two sites can be served at once), and Basalt's src is shared
const basalt = path.dirname(fileURLToPath(import.meta.url))

// A note whose frontmatter doesn't parse is an error of its own (the loader
// reports it, with its line). A note that embeds or lists it still renders:
// the embed says there's nothing to embed, and the list leaves it out.
useTargets((slug) => renderTarget(slug).catch(() => undefined))
const parses = (abs: string) => {
  try {
    parseFrontmatter(fs.readFileSync(abs, "utf8"))
    return true
  } catch {
    return false
  }
}
const listedSafely = () => {
  try {
    return listed()
  } catch {
    const reg = registry()
    const files = reg.files.filter((f) => !f.isNote || parses(f.abs))
    useRegistry(() => ({ ...reg, files }))
    try {
      return listed()
    } finally {
      useRegistry(registry)
    }
  }
}
const rehype = rehypePlugins.map((p) =>
  p === rehypeNoteLists ? () => (tree: never) => renderNoteLists(tree, registry().site.config.locale, listedSafely) : p,
)

export default defineConfig({
  site: site.config.baseUrl ? `https://${site.config.baseUrl}` : undefined,
  // a site's non-note files (images, pdfs, code) are served from here: see linkPublic
  publicDir: path.join(site.work, "public"),
  outDir: path.join(site.work, "dist"),
  // per site, so sites (and worktrees sharing node_modules) don't share a cache
  cacheDir: path.join(site.work, "cache"),
  trailingSlash: "ignore",
  // Astro's own dev toolbar: not part of a Basalt page (it also appeared inside island frames)
  devToolbar: { enabled: false },
  integrations: [preact({ compat: true }), agentApi()],
  markdown: {
    syntaxHighlight,
    // unified's PluggableList and Astro's plugin types describe the same thing
    processor: unified({
      remarkPlugins: remarkPlugins as never,
      rehypePlugins: rehype as never,
      ...processorOptions,
    }),
  },
  vite: {
    plugins: vitePlugins,
    // Vite's own cache (its prebundled dependencies) per site too: shared, two
    // sites served at once re-bundle over each other and their pages get 504s
    cacheDir: path.join(site.work, "vite"),
    // a site's root links to Basalt's src and packages (bin/basalt.mjs):
    // keep their paths inside the root, so Vite treats them as the project's
    resolve: {
      preserveSymlinks: true,
      // @basalt by the root's own link to Basalt's src, as Basalt's own imports
      // are: by its real path, a component a site's file imports is a second
      // module, and outside a home folder its compiled script goes missing
      alias: { "@site": site.dir, "@basalt": path.join(site.work, "src") },
    },
    // (merged with resolve above)
    server: { fs: { allow: [site.dir, basalt] } },
    // a site stylesheet written for the Quartz build still compiles (see quartz-compat)
    css: {
      preprocessorOptions: {
        scss: { loadPaths: [path.join(basalt, "src", "styles", "quartz-compat")] },
      },
    },
    // found up front, so a lazy import of one doesn't fail after Vite re-optimises
    optimizeDeps: { include: ["mermaid", "pdfjs-dist", "preact", "@isaacchacko/graph"] },
  },
})
