// When each file in the site was written and last changed, from git: one
// `git log` per repository, renames followed, so a note moved to another
// folder keeps the day it was written. A note's
// frontmatter date comes first, then these, then the file system's, which on
// a host that builds from a fresh clone (Vercel) are all the clone's moment.
//
// A file with changes not yet committed was last changed when it was saved.
// In a shallow clone, files untouched since its oldest commit get that
// commit's date: the best there is.

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

export interface FileDates {
  created: Date
  modified: Date
}

const git = (cwd: string, args: string[]) =>
  execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 })

/** the top of the repository a folder is in, or null */
function topOf(dir: string): string | null {
  try {
    return fs.realpathSync(git(dir, ["rev-parse", "--show-toplevel"]).trim())
  } catch {
    return null
  }
}

/**
 * `git log --name-status` read newest first: every path's newest and oldest
 * commit, with a rename's older history given to the file it became. Paths
 * are relative to the repository's top.
 */
export function parseLog(log: string): Map<string, { created: number; modified: number }> {
  type Rec = { created: number; modified: number }
  const out = new Map<string, Rec>()
  // what a path, as it was at this point in history, is now
  const now = new Map<string, Rec | null>()
  let t = 0
  for (const line of log.split("\n")) {
    if (line.startsWith("\0")) {
      t = Number(line.slice(1)) * 1000
      continue
    }
    if (!line.trim()) continue
    const [status, a, b] = line.split("\t")
    const p = status.startsWith("R") || status.startsWith("C") ? b : a
    if (!p) continue
    let rec = now.get(p)
    if (rec === undefined) {
      // first seen, deleted: the file it was is gone
      if (status === "D") {
        now.set(p, null)
        continue
      }
      rec = { created: t, modified: t }
      now.set(p, rec)
      out.set(p, rec)
    }
    if (rec === null) continue
    rec.created = t
    if (status.startsWith("R")) {
      now.set(a, rec)
      // older history under the new name was another file's
      now.set(p, null)
    } else if (status === "A") now.set(p, null)
  }
  return out
}

const cache = new Map<string, Map<string, FileDates>>()
/** a repository with more commits than this is read only under the site's folders */
const WHOLE_LOG = 5000

/** The git dates of every committed file under `dirs`, by absolute path (cached per set of folders). */
export function gitDates(dirs: string[]): Map<string, FileDates> {
  const key = dirs.join("\0")
  const hit = cache.get(key)
  if (hit) return hit
  const out = new Map<string, FileDates>()
  cache.set(key, out)
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
    try {
      // the whole history, so a note moved in from elsewhere in the repository
      // keeps its day; in a big one, only the site's folders
      const commits = Number(git(top, ["rev-list", "--count", "HEAD"]).trim())
      log = git(top, ["log", "--format=%x00%ct", "--name-status", "-M", ...(commits > WHOLE_LOG ? ["--", ...specs] : [])])
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
    for (const [rel, rec] of parseLog(log)) {
      const abs = path.join(top, rel)
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

/** forget what git said (a note was added or committed while serving) */
export function forgetGitDates(): void {
  cache.clear()
}
