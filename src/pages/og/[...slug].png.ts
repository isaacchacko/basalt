// Each note's card for where it's shared, /og/<slug>.png (lib/socialimage.ts).
import type { APIRoute } from "astro"
import path from "node:path"
import { registry } from "../../lib/registry"
import { iconData } from "../../lib/icon"
import { layout } from "../../lib/config"
import { canDrawCards, cardPng } from "../../lib/socialimage"
import { descriptionOf, hrefOf, notes, titleOf, type Note } from "../../layouts/notes"

export async function getStaticPaths() {
  const cfg = await layout()
  // behind a password, a card would show the note to anyone it's shared with
  if (!cfg.socialImages || cfg.password === true || !canDrawCards()) return []
  const all = (await notes()).filter((n) => !n.id.startsWith("tags/"))
  // building: every card drawn at once (sharp draws on its own threads), each
  // page then takes its own
  if (import.meta.env.PROD) for (const note of all) drawn.set(note.id, draw(note))
  return all.map((note) => ({ params: { slug: note.id }, props: { note } }))
}

const drawn = new Map<string, Promise<Buffer | null>>()

export const GET: APIRoute = async ({ props }) => {
  const note = (props as { note: Note }).note
  const png = await (drawn.get(note.id) ?? draw(note))
  if (!png) return new Response(null, { status: 404 })
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } })
}

async function draw(note: Note): Promise<Buffer | null> {
  const { site } = registry()
  const cfg = await layout()
  const href = hrefOf(note.id)
  // the site's own icon, where it has one (svg, png or jpeg), else Basalt's mark
  const data = iconData(site.config.icon, registry().files)
  const icon = data && /^data:image\/(svg\+xml|png|jpeg);/.test(data) ? data : undefined
  return cardPng(
    {
      title: titleOf(note),
      description: descriptionOf(note),
      site: site.config.title,
      where: site.config.baseUrl ? site.config.baseUrl.replace(/\/$/, "") + (href === "/" ? "" : href) : undefined,
      colors: cfg.theme.colors.lightMode,
      icon,
    },
    path.join(site.work, "cache", "og"),
  )
}
