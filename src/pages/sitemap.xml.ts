// Every published page, at the site's baseUrl.
import type { APIRoute } from "astro"
import { registry } from "../lib/registry"
import { modifiedOf, folders, hrefOf, notes, tagIndex, tree } from "../layouts/notes"

export const GET: APIRoute = async () => {
  const { config } = registry().site
  const base = `https://${(config.baseUrl ?? "example.com").replace(/\/$/, "")}`
  const all = await notes()
  const urls: { loc: string; lastmod?: Date }[] = all.map((n) => ({ loc: hrefOf(n.id), lastmod: modifiedOf(n) }))
  const seen = new Set(urls.map((u) => u.loc))
  for (const f of folders(tree(all))) if (!seen.has(hrefOf(f.slug))) urls.push({ loc: hrefOf(f.slug) })
  const tags = [...tagIndex(all).keys()]
  if (tags.length) urls.push({ loc: "/tags" }, ...tags.map((t) => ({ loc: `/tags/${t}` })))
  const body = urls
    .map(
      (u) =>
        `<url><loc>${base}${encodeURI(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod.toISOString()}</lastmod>` : ""}</url>`,
    )
    .join("")
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`,
    { headers: { "content-type": "application/xml; charset=utf-8" } },
  )
}
