// Editing in place, the server's side (the page's is client/editor.ts):
//
//   GET /__basalt/source?slug=<slug>   { slug, file, text, sha }: the note's file as it is
//   PUT /__basalt/source               { slug, text, base } writes it, when `base`
//                                      (the sha it was edited from) is still its sha;
//                                      else 409 with { text, sha } as it is now
//   POST /__basalt/render              { slug, text }: the note rendered with that text
//   GET /__basalt/history              a note's history (integrations/history.ts)
//   POST /__basalt/files               { op } a file op of the explorer's (lib/fileops.ts) done:
//                                      a note made, a note or folder moved (its links taken
//                                      along with `relink`), deleted; with `dry`, only the
//                                      links that would be taken along
//
// A write is a save like any other: the page gets it as a swap (agent.ts).
// Only while serving, only a note of the site's (a file op: only inside a
// folder of its notes, never over a file that's there), and only from a page
// of the site itself: a PUT or POST needs JSON and the x-basalt-edit header, which another
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
import { after, applyOps, movesOf, pageOf, relink, within, type FileOp } from "../lib/fileops"
import { answerHistory } from "./history"

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
          else if (url.pathname === "/__basalt/files") void files(req, res).catch((err: Error) => reply(res, 500, { error: err.message }))
          else if (url.pathname === "/__basalt/render" && render) void rendered(req, res, render).catch((err: Error) => reply(res, 500, { error: err.message }))
          else if (url.pathname === "/__basalt/history" && render) void answerHistory(req, res, url, render).catch((err: Error) => reply(res, 500, { error: err.message }))
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

// ---------- the explorer's file ops ----------

/** where a path in the tree is on disk: in the folder of notes it's under (the deepest), never out of it */
function onDisk(site: ReturnType<typeof loadSite>, p: string): string | undefined {
  const root = site.config.content
    .map(({ from, to = "" }) => ({ abs: path.resolve(site.dir, from), to: to.replace(/^\/+|\/+$/g, "") }))
    .filter((r) => (!r.to || within(p, r.to)) && fs.statSync(r.abs, { throwIfNoEntry: false })?.isDirectory())
    .sort((a, b) => b.to.length - a.to.length)[0]
  if (!root) return undefined
  const abs = path.resolve(root.abs, p.slice(root.to.length).replace(/^\//, ""))
  const rel = path.relative(root.abs, abs)
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? abs : undefined
}

const isOp = (op: unknown): op is FileOp => {
  const o = op as Record<string, unknown>
  if (!o || typeof o !== "object") return false
  if (o.op === "create" || o.op === "delete") return typeof o.path === "string"
  return o.op === "move" && typeof o.from === "string" && typeof o.to === "string"
}

/** POST /__basalt/files { op, dry }: the op done (or, dry, only the links it would take along) */
async function files(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return reply(res, 405, { error: "POST" })
  const body = await own(req, res)
  if (!body) return
  const op = body.op
  if (!isOp(op)) return reply(res, 400, { error: "an op: create, move or delete" })
  const site = loadSite()
  const all = walkSite(site)
  const paths = all.map((f) => f.rel as string)
  const done = applyOps(paths, [op])
  const why = done.errors[0]?.why
  if (why) return reply(res, why === "exists" ? 409 : why === "missing" ? 404 : 400, { error: why })
  // a note stays a note: made as one, and moved as one
  const notes = (p: string) => p.endsWith(".md")
  if ((op.op === "create" && !notes(op.path)) || (op.op === "move" && !op.folder && notes(op.from) !== notes(op.to))) return reply(res, 400, { error: "a note is a .md" })
  const touched = op.op === "move" ? [op.from, op.to] : [op.path]
  const abs = touched.map((p) => onDisk(site, p))
  if (abs.some((a) => !a)) return reply(res, 400, { error: "path" })

  // the notes whose links would go along: each by where it is now, and where it'll be
  const relinked: { was: string; path: string; text: string; links: number }[] = []
  if (op.op === "move") {
    const moved = movesOf(paths, [op])
    for (const f of all) {
      if (!f.isNote) continue
      const now = after(op, f.rel)!
      const out = relink(fs.readFileSync(f.abs, "utf8"), { was: f.rel, now }, paths, done.files, moved)
      if (out.links) relinked.push({ was: f.abs, path: now, text: out.text, links: out.links })
    }
  }
  const links = relinked.map(({ path, links }) => ({ path, links }))
  if (body.dry) return reply(res, 200, { links })

  if (op.op === "create") {
    fs.mkdirSync(path.dirname(abs[0]!), { recursive: true })
    // "wx": not over a file that came meanwhile
    fs.writeFileSync(abs[0]!, typeof op.text === "string" ? op.text : "", { flag: "wx" })
    return reply(res, 200, { path: op.path, href: pageOf(op.path) })
  }
  if (op.op === "delete") {
    fs.rmSync(abs[0]!, { recursive: !!op.folder })
    return reply(res, 200, { path: op.path })
  }
  const [from, to] = abs as string[]
  // nothing there meanwhile, unless it's the same file named otherwise (a disk that doesn't mind case)
  if (fs.existsSync(to) && from.toLowerCase() !== to.toLowerCase()) return reply(res, 409, { error: "exists" })
  if (body.relink) for (const r of relinked) fs.writeFileSync(r.was, r.text)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.renameSync(from, to)
  return reply(res, 200, { path: op.to, href: pageOf(op.to), links: body.relink ? links : [] })
}
