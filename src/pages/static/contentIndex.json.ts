// The site's notes for search (and anything else that wants the whole site in
// the browser): Quartz's contentIndex.json, keyed by slug.
import type { APIRoute } from "astro"
import { dateOf, descriptionOf, notes, tagsOf, textOf, titleOf } from "../../layouts/notes"

export const GET: APIRoute = async () => {
  const index: Record<string, unknown> = {}
  for (const note of await notes()) {
    const data = note.data as Record<string, any>
    index[note.id] = {
      slug: note.id,
      filePath: data.rel,
      title: titleOf(note),
      links: Array.isArray(data.links) ? data.links : [],
      tags: tagsOf(note),
      content: textOf(note),
      date: dateOf(note)?.toISOString(),
      description: descriptionOf(note) ?? "",
    }
  }
  return new Response(JSON.stringify(index), { headers: { "content-type": "application/json" } })
}
