import { defineConfig } from "astro/config"
import preact from "@astrojs/preact"
import { unified } from "@astrojs/markdown-remark"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadSite, siteDir } from "./src/lib/site"
import { processorOptions, rehypePlugins, remarkPlugins, syntaxHighlight } from "./src/markdown"
import { vitePlugins } from "./src/lib/vite"
import { agentApi } from "./src/integrations/agent"

const site = loadSite(siteDir())
// Basalt itself, wherever it's run from: a site's root is its own .basalt
// folder (so two sites can be served at once), and Basalt's src is shared
const basalt = path.dirname(fileURLToPath(import.meta.url))

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
      rehypePlugins: rehypePlugins as never,
      ...processorOptions,
    }),
  },
  vite: {
    plugins: vitePlugins,
    // a site's root links to Basalt's src and packages (bin/basalt.mjs):
    // keep their paths inside the root, so Vite treats them as the project's
    resolve: {
      preserveSymlinks: true,
      alias: { "@site": site.dir, "@basalt": path.join(basalt, "src") },
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
    optimizeDeps: { include: ["mermaid", "pdfjs-dist", "preact", "graph/packages/renderer/src/renderer"] },
  },
})
