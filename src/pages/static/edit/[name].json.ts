// What a built site's page being edited needs to render its note in the
// browser (markdown/browser/render.ts) that only the build knows: the site's
// files, what a <note-list> lists, the songs looked up, the users' days a
// ```streak fetched, the `ssr` islands as rendered. Only for a site that edits on GitHub (lib/edit.ts).
//
//   /static/edit/site.json

import fs from "node:fs"
import path from "node:path"
import type { APIRoute, GetStaticPaths } from "astro"
import { fromHtml } from "hast-util-from-html"
import { toHtml } from "hast-util-to-html"
import { visit } from "unist-util-visit"
import { notes } from "../../../layouts/notes"
import { registry } from "../../../lib/registry"
import { editTarget, repoPath } from "../../../lib/edit"
import { sitePlugins } from "../../../markdown"
import { listed } from "../../../markdown/notelist"
import { islandKey, type SiteFacts } from "../../../markdown/browser/facts"

export const getStaticPaths: GetStaticPaths = () => (editTarget(registry().site)?.kind === "github" ? [{ params: { name: "site" } }] : [])

export const GET: APIRoute = async () => {
  const { site, files } = registry()
  const target = editTarget(site)
  if (target?.kind !== "github") return new Response("{}")
  const cached = (name: string) => {
    const file = path.join(site.work, "cache", name)
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}
  }
  const islands: SiteFacts["islands"] = {}
  for (const note of await notes()) {
    const html = note.rendered?.html ?? ""
    if (!html.includes("data-island-ssr")) continue
    visit(fromHtml(html, { fragment: true }), "element", (el) => {
      const p = el.properties
      if (p.dataIslandSsr === undefined || typeof p.dataIsland !== "string") return
      islands[islandKey(p.dataIsland, String(p.dataIslandProps))] = toHtml(el.children)
    })
  }
  const facts: SiteFacts = {
    title: site.config.title,
    locale: site.config.locale,
    own: sitePlugins,
    files: files.map((f) => ({ rel: f.rel, slug: f.slug, isNote: f.isNote, ...(f.isNote ? { repo: repoPath(target, f.abs) } : {}) })),
    listed: listed().map((n) => ({ ...n, date: n.date?.toISOString() })),
    songs: cached("spotify.json"),
    streaks: cached("streaks.json"),
    islands,
  }
  return new Response(JSON.stringify(facts), { headers: { "content-type": "application/json" } })
}
