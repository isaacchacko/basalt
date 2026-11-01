// A note's history: the commits that touched its file (renames followed,
// gitdates.ts), and the note as it was at each, rendered as its page renders
// it, with what that commit changed marked: added text in <ins>, removed text
// in <del>, a block wholly added or removed classed history-added or
// history-removed (marks.ts). While serving, the dev server answers for it
// (integrations/history.ts); a build writes it out (pages/static/history).
//
// A commit's changes are against the commit before it that touched the note
// (its base). Its blocks are paired with the base's by the lines they came
// from (data-src, markdown/lines.ts) and a line diff of the two texts; inside
// a pair, the words are diffed (jsdiff), and a list's items first. A footnote
// is known by its name, not its number: one put in before others renumbers
// them, and that alone marks nothing.

import path from "node:path"
import { execFileSync } from "node:child_process"
import { commitsOf, topOf, type Commit } from "./gitdates.ts"
import { marked } from "./marks.ts"
import { deepen } from "./deepen.ts"
import { serving, sourceDirs, type Site } from "./site.ts"

/** a built site's history of a note: its newest commits, no more */
export const MOST = 100

export interface Commits {
  slug: string
  /** false: older commits aren't here (a shallow clone, or more than MOST) */
  complete: boolean
  commits: { sha: string; date: string; subject: string; author: string; path: string; change: Commit["change"] }[]
}

export interface Version {
  sha: string
  /** the commit before it that touched the note, which its changes are against */
  base: string | null
  path: string
  /** rendered, with its changes marked */
  html: string
  /** rendered */
  plain: string
}

/** Whether a note's page shows its history: its frontmatter's `history`, else the site's (while serving unless false; built when true). */
export function historyOn(site: Site, frontmatter: Record<string, unknown> | undefined): boolean {
  const own = frontmatter?.history
  if (typeof own === "boolean") return own
  return serving() ? site.config.history !== false : site.config.history === true
}

const git = (cwd: string, args: string[]) =>
  execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 })

/** The commits that touched a note, newest first (at most `most`). */
export function commitsFor(site: Site, abs: string, slug: string, most = Infinity): Commits {
  const all = commitsOf(abs, sourceDirs(site))
  const top = topOf(path.dirname(abs))
  // a shallow clone (deepen.ts couldn't fetch the rest): history before the commit it starts at isn't here
  const cut = top ? deepen(top).boundary : new Set<string>()
  const shown = all.slice(0, most)
  return {
    slug,
    complete: shown.length === all.length && !(all.length && cut.has(all.at(-1)!.sha)),
    commits: shown.map((c) => ({ sha: c.sha, date: new Date(c.t).toISOString(), subject: c.subject, author: c.author, path: c.path, change: c.change })),
  }
}

/** The note as it was at `sha`, rendered (`render`: markdown/rendernote.ts), with that commit's changes marked; undefined for a commit that didn't touch it. */
export async function versionAt(site: Site, abs: string, sha: string, render: (abs: string, text: string) => Promise<string>): Promise<Version | undefined> {
  const all = commitsOf(abs, sourceDirs(site))
  const i = all.findIndex((c) => c.sha === sha)
  const top = topOf(path.dirname(abs))
  if (i < 0 || !top) return undefined
  const at = all[i]
  const base = all[i + 1]
  const [text, html] = await renderedAt(top, abs, at, render)
  const [was, wasHtml] = base ? await renderedAt(top, abs, base, render) : ["", ""]
  return { sha: at.sha, base: base?.sha ?? null, path: at.path, html: marked(was, wasHtml, text, html), plain: html }
}

// a commit's text and its rendering: each is a version and the base of the one after
const renderings = new Map<string, Promise<[string, string]>>()
function renderedAt(top: string, abs: string, c: Commit, render: (abs: string, text: string) => Promise<string>) {
  const key = `${abs}\0${c.sha}`
  let got = renderings.get(key)
  if (!got) {
    const text = git(top, ["show", `${c.sha}:${c.path}`])
    got = render(abs, text).then((html) => [text, html])
    renderings.set(key, got)
  }
  return got
}

export { marked }
