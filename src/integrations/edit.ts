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

/** a note's text rendered as its page's note would be: its html, blocks marked with data-src (markdown/lines.ts) */
export type RenderNote = (abs: string, text: string) => Promise<string>

export function editInPlace(render?: RenderNote): AstroIntegration {
  return {
    name: "basalt-edit",
    hooks: {
      "astro:config:setup": ({ command }) => {
        process.env.BASALT_COMMAND = command
      },
      "astro:server:setup": ({ server }) => {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url ?? "/", "http://basalt")
          if (url.pathname === "/__basalt/source") void answer(req, res, url).catch((err: Error) => reply(res, 500, { error: err.message }))
          else if (url.pathname === "/__basalt/render" && render) void rendered(req, res, render).catch((err: Error) => reply(res, 500, { error: err.message }))
          else next()
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
  const body = await own(req, res)
  if (!body) return
  const { slug, text, base } = body as { slug?: string; text?: unknown; base?: string }
  const found = noteFile(slug)
  if (!found) return reply(res, 404, { error: "no such note" })
  if (typeof text !== "string") return reply(res, 400, { error: "text is the note's whole file" })
  const now = fs.readFileSync(found.file.abs, "utf8")
  if (base !== blobSha(now)) return reply(res, 409, { text: now, sha: blobSha(now) })
  if (text !== now) fs.writeFileSync(found.file.abs, text)
  return reply(res, 200, { sha: blobSha(text) })
}

/** the JSON a page of the site's own sent, else undefined (and the answer sent) */
async function own(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | undefined> {
  const host = req.headers.host
  const origin = req.headers.origin
  if (req.headers["x-basalt-edit"] !== "1" || !req.headers["content-type"]?.startsWith("application/json") || (origin && host && new URL(origin).host !== host)) {
    reply(res, 403, { error: "only the site's own pages edit it" })
    return undefined
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

/** POST /__basalt/render { slug, text }: the note as it would render with that text, saved or not */
async function rendered(req: IncomingMessage, res: ServerResponse, render: RenderNote) {
  if (req.method !== "POST") return reply(res, 405, { error: "POST" })
  const body = await own(req, res)
  if (!body) return
  const found = noteFile(body.slug as string)
  if (!found) return reply(res, 404, { error: "no such note" })
  if (typeof body.text !== "string") return reply(res, 400, { error: "text is the note's whole file" })
  const started = performance.now()
  const html = await render(found.file.abs, body.text)
  return reply(res, 200, { sha: blobSha(body.text), html, ms: Math.round(performance.now() - started) })
}
