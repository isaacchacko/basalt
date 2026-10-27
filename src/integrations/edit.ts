// Editing in place, the server's side (the page's is client/editor.ts):
//
//   GET /__basalt/source?slug=<slug>   { slug, file, text, sha }: the note's file as it is
//   PUT /__basalt/source               { slug, text, base } writes it, when `base`
//                                      (the sha it was edited from) is still its sha;
//                                      else 409 with { text, sha } as it is now
//
// A write is a save like any other: the page gets it as a swap (agent.ts).
// Only while serving, only a note of the site's, and only from a page of the
// site itself: a PUT needs JSON and the x-basalt-edit header, which another
// site can't send without asking first (CORS), and is turned away if it says
// it came from somewhere else.
//
// It also tells Basalt's build-time code which command is running (lib/edit.ts).

import fs from "node:fs"
import path from "node:path"
import type { AstroIntegration } from "astro"
import type { IncomingMessage, ServerResponse } from "node:http"
import { loadSite, walkSite } from "../lib/site"
import { blobSha } from "../lib/edit"

export function editInPlace(): AstroIntegration {
  return {
    name: "basalt-edit",
    hooks: {
      "astro:config:setup": ({ command }) => {
        process.env.BASALT_COMMAND = command
      },
      "astro:server:setup": ({ server }) => {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url ?? "/", "http://basalt")
          if (url.pathname !== "/__basalt/source") return next()
          void answer(req, res, url).catch((err: Error) => reply(res, 500, { error: err.message }))
        })
      },
    },
  }
}

function reply(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json")
  res.setHeader("Cache-Control", "no-store")
  res.end(JSON.stringify(body))
}

function noteFile(slug: string | null | undefined) {
  if (!slug) return undefined
  const site = loadSite()
  const file = walkSite(site).find((f) => f.isNote && f.slug === slug)
  return file && { site, file }
}

async function answer(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (req.method === "GET") {
    const found = noteFile(url.searchParams.get("slug"))
    if (!found) return reply(res, 404, { error: "no such note" })
    const text = fs.readFileSync(found.file.abs, "utf8")
    return reply(res, 200, { slug: found.file.slug, file: path.relative(found.site.dir, found.file.abs), text, sha: blobSha(text) })
  }
  if (req.method !== "PUT") return reply(res, 405, { error: "GET or PUT" })
  const host = req.headers.host
  const origin = req.headers.origin
  if (req.headers["x-basalt-edit"] !== "1" || !req.headers["content-type"]?.startsWith("application/json") || (origin && host && new URL(origin).host !== host)) {
    return reply(res, 403, { error: "only the site's own pages edit it" })
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const { slug, text, base } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { slug?: string; text?: unknown; base?: string }
  const found = noteFile(slug)
  if (!found) return reply(res, 404, { error: "no such note" })
  if (typeof text !== "string") return reply(res, 400, { error: "text is the note's whole file" })
  const now = fs.readFileSync(found.file.abs, "utf8")
  if (base !== blobSha(now)) return reply(res, 409, { text: now, sha: blobSha(now) })
  if (text !== now) fs.writeFileSync(found.file.abs, text)
  return reply(res, 200, { sha: blobSha(text) })
}
