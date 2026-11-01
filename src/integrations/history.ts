// A note's history, while serving (lib/history.ts; a build writes the same
// answers out, pages/static/history):
//
//   GET /__basalt/history?slug=<slug>            its commits, newest first
//   GET /__basalt/history?slug=<slug>&at=<sha>   it at that commit, rendered, its changes marked
//
// 404 for a note whose history is off. Read only: it says no more than the
// repository does to whoever can reach the dev server.
//
// It also tells Basalt's build-time code which command is running (serving, lib/site.ts).

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { AstroIntegration } from "astro"
import { parseFrontmatter } from "@astrojs/markdown-remark"
import { loadSite, walkSite } from "../lib/site"
import { commitsFor, historyOn, versionAt, type Version } from "../lib/history"
import { forgetGitDates, topOf } from "../lib/gitdates"

/** a note's text rendered as its page's note would be: its html, blocks marked with data-src (markdown/lines.ts) */
export type RenderNote = (abs: string, text: string) => Promise<string>

// a version doesn't change: each is rendered once
const versions = new Map<string, Version>()
// git's answers are kept till a commit's made
let head = ""

function reply(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json")
  res.setHeader("Cache-Control", "no-store")
  res.end(JSON.stringify(body))
}

export function noteHistory(render: RenderNote): AstroIntegration {
  return {
    name: "basalt-history",
    hooks: {
      "astro:config:setup": ({ command }) => {
        process.env.BASALT_COMMAND = command
      },
      "astro:server:setup": ({ server }) => {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url ?? "/", "http://basalt")
          if (url.pathname === "/__basalt/history") void answerHistory(req, res, url, render).catch((err: Error) => reply(res, 500, { error: err.message }))
          else next()
        })
      },
    },
  }
}

export async function answerHistory(req: IncomingMessage, res: ServerResponse, url: URL, render: RenderNote) {
  if (req.method !== "GET") return reply(res, 405, { error: "GET" })
  const site = loadSite()
  const slug = url.searchParams.get("slug")
  const file = walkSite(site).find((f) => f.isNote && f.slug === slug)
  if (!file) return reply(res, 404, { error: "no such note" })
  let frontmatter: Record<string, unknown> = {}
  try {
    frontmatter = parseFrontmatter(fs.readFileSync(file.abs, "utf8")).frontmatter
  } catch {}
  if (!historyOn(site, frontmatter)) return reply(res, 404, { error: "this note's history is off" })
  const top = topOf(path.dirname(file.abs))
  const now = top ? execFileSync("git", ["rev-parse", "HEAD"], { cwd: top, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() : ""
  if (now !== head) {
    forgetGitDates()
    head = now
  }
  const at = url.searchParams.get("at")
  if (!at) return reply(res, 200, commitsFor(site, file.abs, file.slug))
  const key = `${file.abs}\0${at}`
  const version = versions.get(key) ?? (await versionAt(site, file.abs, at, render))
  if (!version) return reply(res, 404, { error: "no such commit of this note" })
  versions.set(key, version)
  return reply(res, 200, version)
}
