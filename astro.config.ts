import { defineConfig } from "astro/config"
import preact from "@astrojs/preact"
import { unified } from "@astrojs/markdown-remark"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadSite, siteDir } from "./src/lib/site"
import { processorOptions, remarkPlugins, renderTarget, syntaxHighlight } from "./src/markdown"
import { rehype } from "./src/markdown/rehype"
import { useTargets } from "./src/markdown/transclude"
import { vitePlugins } from "./src/lib/vite"
import { agentApi } from "./src/integrations/agent"
import { passwordGate } from "./src/integrations/password"
import { editorBuffers } from "./src/integrations/buffer"

const site = loadSite(siteDir())
// Basalt itself, wherever it's run from: a site's root is its own .basalt
// folder (so two sites can be served at once), and Basalt's src is shared
const basalt = path.dirname(fileURLToPath(import.meta.url))

useTargets((slug) => renderTarget(slug).catch(() => undefined))

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
  // JSX is only in .tsx and .jsx (islands): left to its default, the preset runs
  // Babel over every .ts and .js outside node_modules, Basalt's own client code
  // included, which is ~0.6 s of every build
  // editorBuffers first: it says which command is running, which the rest reads (serving, lib/site.ts)
  integrations: [editorBuffers(), preact({ compat: true, include: [/\.[jt]sx$/] }), agentApi(), passwordGate()],
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
    // and Astro's router, which the hot swap imports: found late, it re-optimises
    // and reloads the page a moment after a fresh server's first page opens
    optimizeDeps: {
      include: [
        "pdfjs-dist",
        "preact",
        "@isaacchacko/graph",
        "astro/virtual-modules/transitions-router.js",
        "astro/virtual-modules/transitions-events.js",
        "astro/virtual-modules/transitions-swap-functions.js",
        "astro/virtual-modules/transitions-types.js",
      ],
    },
  },
})
