import { defineConfig } from "astro/config"
import preact from "@astrojs/preact"
import { unified } from "@astrojs/markdown-remark"
import path from "node:path"
import { loadSite, siteDir } from "./src/lib/site"
import { processorOptions, rehypePlugins, remarkPlugins, syntaxHighlight } from "./src/markdown"
import { vitePlugins } from "./src/lib/vite"
import { agentApi } from "./src/integrations/agent"

const site = loadSite(siteDir())

export default defineConfig({
  site: site.config.baseUrl ? `https://${site.config.baseUrl}` : undefined,
  // a site's non-note files (images, pdfs, code) are served from here: see linkPublic
  publicDir: path.join(site.work, "public"),
  outDir: path.join(site.work, "dist"),
  trailingSlash: "ignore",
  integrations: [preact({ compat: true }), agentApi()],
  markdown: {
    syntaxHighlight,
    processor: unified({ remarkPlugins, rehypePlugins, ...processorOptions }),
  },
  vite: {
    plugins: vitePlugins,
    resolve: {
      alias: { "@site": site.dir, "@basalt": path.resolve("src") },
    },
    server: { fs: { allow: [site.dir, path.resolve(".")] } },
  },
})
