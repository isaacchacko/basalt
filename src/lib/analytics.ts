// Who's reading: the site's analytics, as a top-level "analytics" in
// basalt.json (or basalt.config.ts):
//
//   { "analytics": { "provider": "vercel" } }                       Vercel Web Analytics, and Speed Insights
//   { "analytics": { "provider": "vercel", "speedInsights": false } }
//   { "analytics": { "provider": "plausible" } }                    domain: baseUrl; host: https://plausible.io
//   { "analytics": { "provider": "umami", "websiteId": "…" } }      host: https://cloud.umami.is
//   { "analytics": { "provider": "goatcounter", "code": "mysite" } }
//   { "analytics": { "provider": "google", "tagId": "G-…" } }
//
// Only in a built site, never while serving, so writing doesn't count as
// reading. The scripts persist across the client router's page changes (one
// load, not one per page) and count each page change: Vercel's, Plausible's,
// Umami's and Google's follow the history themselves; GoatCounter is told.

export type Analytics =
  | { provider: "vercel"; speedInsights?: boolean }
  | { provider: "plausible"; domain?: string; host?: string }
  | { provider: "umami"; websiteId: string; host?: string }
  | { provider: "goatcounter"; code?: string; endpoint?: string }
  | { provider: "google"; tagId: string }

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
const js = (s: string) => JSON.stringify(s).replace(/</g, "\\u003c")
const host = (h: string | undefined, fallback: string) => (h ?? fallback).replace(/\/+$/, "")
/** a script kept by the client router from page to page */
const keep = (id: string) => `data-astro-transition-persist="basalt-analytics-${id}"`

/** The <script> tags for the site's analytics, as HTML for the page's head ("" for none, or while serving). */
export function analyticsHtml(a: Analytics | undefined, opts: { built: boolean; baseUrl?: string }): string {
  if (!a || !opts.built) return ""
  switch (a.provider) {
    case "vercel": {
      const out = [
        `<script ${keep("va")}>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)}</script>`,
        `<script defer src="/_vercel/insights/script.js" ${keep("va-script")}></script>`,
      ]
      if (a.speedInsights !== false)
        out.push(
          `<script ${keep("si")}>window.si=window.si||function(){(window.siq=window.siq||[]).push(arguments)}</script>`,
          `<script defer src="/_vercel/speed-insights/script.js" ${keep("si-script")}></script>`,
        )
      return out.join("\n")
    }
    case "plausible": {
      const domain = a.domain ?? opts.baseUrl
      if (!domain) return ""
      return `<script defer data-domain="${attr(domain)}" src="${attr(host(a.host, "https://plausible.io"))}/js/script.js" ${keep("plausible")}></script>`
    }
    case "umami":
      if (!a.websiteId) return ""
      return `<script defer src="${attr(host(a.host, "https://cloud.umami.is"))}/script.js" data-website-id="${attr(a.websiteId)}" ${keep("umami")}></script>`
    case "goatcounter": {
      const endpoint = a.endpoint ?? (a.code ? `https://${a.code}.goatcounter.com/count` : undefined)
      if (!endpoint) return ""
      return [
        `<script async data-goatcounter="${attr(endpoint)}" src="https://gc.zgo.at/count.js" ${keep("goatcounter")}></script>`,
        // it counts the first page itself; the client router's pages, when told
        `<script ${keep("goatcounter-pages")}>document.addEventListener("astro:after-swap",function(){window.goatcounter&&window.goatcounter.count&&window.goatcounter.count({path:location.pathname+location.search+location.hash})})</script>`,
      ].join("\n")
    }
    case "google":
      if (!a.tagId) return ""
      return [
        `<script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(a.tagId)}" ${keep("gtag")}></script>`,
        `<script ${keep("gtag-config")}>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config",${js(a.tagId)})</script>`,
      ].join("\n")
    default:
      return ""
  }
}
