// An editor's unsaved buffer, shown in the page as you type (lib/buffers.ts):
//
//   PUT    /__basalt/buffer   { file, text }  the note as its buffer has it
//   DELETE /__basalt/buffer   { file }        dropped: the note is its file again
//
// `file` is the note's path, absolute or from the site's folder. Either is a
// save like any other: the page gets it as a swap (agent.ts). Only while
// serving, only a note of the site's, and only from a client that isn't a web
// page: JSON with the x-basalt-buffer header, which another site can't send
// without asking first (CORS), and turned away if it says where it came from.
//
// It also tells Basalt's build-time code which command is running (serving, lib/site.ts).

import fs from "node:fs"
import path from "node:path"
import type { AstroIntegration } from "astro"
import type { IncomingMessage, ServerResponse } from "node:http"
import { loadSite, walkSite } from "../lib/site"
import { buffers, setBuffer } from "../lib/buffers"

export function editorBuffers(): AstroIntegration {
  return {
    name: "basalt-buffer",
    hooks: {
      "astro:config:setup": ({ command }) => {
        process.env.BASALT_COMMAND = command
      },
      "astro:server:setup": ({ server }) => {
        server.middlewares.use((req, res, next) => {
          if (new URL(req.url ?? "/", "http://basalt").pathname !== "/__basalt/buffer") return next()
          void answerBuffer(req, res, (abs) => server.watcher.emit("change", abs)).catch((err: Error) => reply(res, 500, { error: err.message }))
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

const real = (p: string) => {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

export async function answerBuffer(req: IncomingMessage, res: ServerResponse, changed: (abs: string) => void) {
  if (req.method !== "PUT" && req.method !== "DELETE") return reply(res, 405, { error: "PUT or DELETE" })
  if (req.headers["x-basalt-buffer"] !== "1" || !req.headers["content-type"]?.startsWith("application/json") || req.headers.origin)
    return reply(res, 403, { error: "only an editor sends its buffers" })
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { file?: unknown; text?: unknown }
  if (typeof body.file !== "string") return reply(res, 400, { error: "file is the note's path" })
  const site = loadSite()
  const want = real(path.resolve(site.dir, body.file))
  const note = walkSite(site).find((f) => f.isNote && (f.abs === want || real(f.abs) === want))
  if (!note) return reply(res, 404, { error: "not a note of this site" })
  if (req.method === "PUT") {
    if (typeof body.text !== "string") return reply(res, 400, { error: "text is the buffer's whole text" })
    if (buffers().get(note.abs)?.text === body.text) return reply(res, 200, { file: note.abs })
    setBuffer(note.abs, body.text)
  } else if (!buffers().delete(note.abs)) return reply(res, 200, { file: note.abs })
  changed(note.abs)
  return reply(res, 200, { file: note.abs })
}
