// A note's history on a built site (lib/history.ts), for its page to read
// (client/history.ts): only for notes whose history is on, its newest
// commits (MOST), each version a file of its own, read when it's clicked.
//
//   /static/history/<slug>.json          its commits
//   /static/history/<slug>/<sha>.json    it at that commit, rendered, its changes marked

import type { APIRoute, GetStaticPaths } from "astro"
import { notes } from "../../../layouts/notes"
import { registry } from "../../../lib/registry"
import { commitsFor, historyOn, MOST, versionAt } from "../../../lib/history"
import { renderNote } from "../../../markdown/rendernote"

export const getStaticPaths: GetStaticPaths = async () => {
  const { site, bySlug } = registry()
  const paths = []
  for (const note of await notes()) {
    const file = bySlug.get(note.id as never)
    if (!file || note.body === undefined || !historyOn(site, note.data as Record<string, unknown>)) continue
    const list = commitsFor(site, file.abs, note.id, MOST)
    paths.push({ params: { path: note.id }, props: { list } })
    for (const c of list.commits) paths.push({ params: { path: `${note.id}/${c.sha}` }, props: { abs: file.abs, sha: c.sha } })
  }
  return paths
}

export const GET: APIRoute = async ({ props }) => {
  const body = "list" in props ? props.list : await versionAt(registry().site, props.abs, props.sha, renderNote)
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
}
