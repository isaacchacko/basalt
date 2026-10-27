// When each file in the site was written and last changed, from git: one
// `git log` per repository, renames followed, so a note moved to another
// folder keeps the day it was written. A note's
// frontmatter date comes first, then these, then the file system's, which on
// a host that builds from a fresh clone (Vercel) are all the clone's moment.
//
// A file with changes not yet committed was last changed when it was saved.
// A build's shallow clone is fetched whole first, where it can be
// (deepen.ts); where it can't, files untouched since its oldest commit get
// that commit's date: the best there is.

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { deepen } from "./deepen.ts"

export interface FileDates {
  created: Date
  modified: Date
}

const git = (cwd: string, args: string[]) =>
  execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 })

/** the top of the repository a folder is in, or null */
export function topOf(dir: string): string | null {
  try {
    return fs.realpathSync(git(dir, ["rev-parse", "--show-toplevel"]).trim())
  } catch {
    return null
  }
}

/** A commit that touched a file: when, by whom, and what the file was called then. */
export interface Commit {
  sha: string
  /** committer date, ms */
  t: number
  author: string
  subject: string
  /** the file's path at this commit, relative to the repository's top */
  path: string
  /** how it touched it: made it (A), changed it (M), or moved it here (R) */
  change: "A" | "M" | "R"
}

/** the log's format: a line of each commit's fields, after a NUL, then its files */
const FORMAT = "%x00%ct%x00%H%x00%an%x00%s"

/**
 * `git log --name-status` read newest first: every path's commits, newest
 * first, with a rename's older history given to the file it became. Paths are
 * relative to the repository's top.
 */
export function parseCommits(log: string): Map<string, Commit[]> {
  const out = new Map<string, Commit[]>()
  // what a path, as it was at this point in history, is now
  const now = new Map<string, Commit[] | null>()
  let at = { t: 0, sha: "", author: "", subject: "" }
  for (const line of log.split("\n")) {
    if (line.startsWith("\0")) {
      const [, t, sha = "", author = "", subject = ""] = line.split("\0")
      at = { t: Number(t) * 1000, sha, author, subject }
      continue
    }
    if (!line.trim()) continue
    const [status, a, b] = line.split("\t")
    const p = status.startsWith("R") || status.startsWith("C") ? b : a
    if (!p) continue
    let commits = now.get(p)
    if (commits === undefined) {
      // first seen, deleted: the file it was is gone
      if (status === "D") {
        now.set(p, null)
        continue
      }
      commits = []
      now.set(p, commits)
      out.set(p, commits)
    }
    if (commits === null) continue
    commits.push({ ...at, path: p, change: status.startsWith("R") ? "R" : status === "A" ? "A" : "M" })
    if (status.startsWith("R")) {
      now.set(a, commits)
      // older history under the new name was another file's
      now.set(p, null)
    } else if (status === "A") now.set(p, null)
  }
  return out
}

/** every path's newest and oldest commit (parseCommits) */
export function parseLog(log: string): Map<string, { created: number; modified: number }> {
  return new Map([...parseCommits(log)].map(([p, commits]) => [p, { created: commits.at(-1)!.t, modified: commits[0].t }]))
}

const cache = new Map<string, Map<string, FileDates>>()
const histories = new Map<string, Map<string, Commit[]>>()
/** a repository with more commits than this is read only under the site's folders */
const WHOLE_LOG = 5000

/** The git dates of every committed file under `dirs`, by absolute path (cached per set of folders). */
export function gitDates(dirs: string[]): Map<string, FileDates> {
  const key = dirs.join("\0")
  const hit = cache.get(key)
  if (hit) return hit
  const out = new Map<string, FileDates>()
  const history = new Map<string, Commit[]>()
  cache.set(key, out)
  histories.set(key, history)
  const byTop = new Map<string, string[]>()
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue
    const top = topOf(fs.statSync(d).isDirectory() ? d : path.dirname(d))
    if (!top) continue
    byTop.set(top, [...(byTop.get(top) ?? []), path.relative(top, fs.realpathSync(d)) || "."])
  }
  for (const [top, specs] of byTop) {
    let log: string
    let dirty: string
    deepen(top)
    try {
      // the whole history, so a note moved in from elsewhere in the repository
      // keeps its day; in a big one, only the site's folders
      const commits = Number(git(top, ["rev-list", "--count", "HEAD"]).trim())
      log = git(top, ["log", `--format=${FORMAT}`, "--name-status", "-M", ...(commits > WHOLE_LOG ? ["--", ...specs] : [])])
      dirty = git(top, ["status", "--porcelain", "-z", "--", ...specs])
    } catch {
      continue
    }
    const changed = new Set(
      dirty
        .split("\0")
        .filter((e) => e.length > 3)
        .map((e) => e.slice(3)),
    )
    for (const [rel, list] of parseCommits(log)) {
      const abs = path.join(top, rel)
      history.set(abs, list)
      const rec = { created: list.at(-1)!.t, modified: list[0].t }
      let modified = new Date(rec.modified)
      if (changed.has(rel)) {
        const st = fs.statSync(abs, { throwIfNoEntry: false })
        if (st) modified = st.mtime
      }
      out.set(abs, { created: new Date(rec.created), modified })
    }
  }
  return out
}

/** A file's dates: git's when it's committed, else the file system's. */
export function datesOf(abs: string, dirs: string[]): FileDates {
  const real = fs.realpathSync(abs)
  const fromGit = gitDates(dirs).get(real)
  if (fromGit) return fromGit
  const st = fs.statSync(abs)
  return { created: st.birthtime, modified: st.mtime }
}

/** The commits that touched a file, newest first, renames followed: none when it isn't committed. */
export function commitsOf(abs: string, dirs: string[]): Commit[] {
  gitDates(dirs)
  return histories.get(dirs.join("\0"))?.get(fs.realpathSync(abs)) ?? []
}

/** forget what git said (a note was added or committed while serving) */
export function forgetGitDates(): void {
  cache.clear()
  histories.clear()
}
