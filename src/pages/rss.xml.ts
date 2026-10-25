// The site's newest notes as an RSS feed, at the site's baseUrl: every note,
// or only those under the site's `layout.feed.folders` (its writing, say).
import type { APIRoute } from "astro"
import { registry } from "../lib/registry"
import { inFeed, layout } from "../lib/config"
import { say } from "../lib/strings"
import { dateOf, descriptionOf, hrefOf, notes, textOf, titleOf } from "../layouts/notes"

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export async function feed(): Promise<string> {
  const { config } = registry().site
  const base = `https://${(config.baseUrl ?? "example.com").replace(/\/$/, "")}`
  const cfg = await layout()
  const limit = cfg.rssLimit
  const items = (await notes())
    .filter((n) => inFeed(n.id, cfg))
    .map((n) => ({ n, date: dateOf(n) }))
    .sort((a, b) =>
      a.date && b.date
        ? b.date.getTime() - a.date.getTime()
        : a.date
          ? -1
          : b.date
            ? 1
            : titleOf(a.n).localeCompare(titleOf(b.n)),
    )
    .slice(0, limit)
    .map(({ n, date }) => {
      const url = base + hrefOf(n.id)
      const about = descriptionOf(n) ?? textOf(n).split(" ").slice(0, 60).join(" ")
      return `<item>
      <title>${esc(titleOf(n))}</title>
      <link>${esc(url)}</link>
      <guid>${esc(url)}</guid>
      <description><![CDATA[ ${about} ]]></description>${date ? `\n      <pubDate>${date.toUTCString()}</pubDate>` : ""}
    </item>`
    })
  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>${esc(config.title)}</title>
    <link>${base}</link>
    <description>${esc(config.description ?? say(cfg.strings, "feed", { n: limit, title: config.title }))}</description>
    <generator>Basalt</generator>
    ${items.join("\n    ")}
  </channel>
</rss>`
}

export const GET: APIRoute = async () =>
  new Response(await feed(), { headers: { "content-type": "application/rss+xml; charset=utf-8" } })
