// Editing a page in place (client/editor.ts). While serving, the page writes
// its note's file through the dev server (integrations/edit.ts). A built site
// with a top-level "edit" commits the note to its GitHub repository instead,
// and whatever deploys the site from it (a GitHub Action, Vercel, Netlify)
// builds it again:
//
//   { "edit": true }                                  the repo and branch it's built from
//   { "edit": { "repo": "me/garden", "branch": "main" } }
//
// Built, the repo is the build's own (GITHUB_REPOSITORY in an Action,
// VERCEL_GIT_REPO_OWNER/SLUG on Vercel), else git's origin; the branch the
// same way, else main.

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import type { Site } from "./site.ts"
import { topOf } from "./gitdates.ts"

export type EditTarget = { kind: "dev" } | { kind: "github"; repo: string; branch: string; top: string }

/** `basalt dev`, as against a build (set by integrations/edit.ts) */
export const serving = () => process.env.BASALT_COMMAND === "dev"

const git = (cwd: string, args: string[]) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return ""
  }
}

/** "owner/name" from a GitHub remote's url (https or ssh) */
export function repoOf(url: string): string | undefined {
  return /github\.com[:/]+([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1]
}

const resolved = new Map<string, EditTarget | null>()

/** Where the site's pages save their edits, or undefined when they don't edit. */
export function editTarget(site: Site): EditTarget | undefined {
  if (serving()) return { kind: "dev" }
  const cfg = site.config.edit
  if (!cfg) return undefined
  if (resolved.has(site.dir)) return resolved.get(site.dir) ?? undefined
  const own = cfg === true ? {} : cfg
  const env = process.env
  const top = topOf(site.dir)
  const repo =
    own.repo ??
    env.GITHUB_REPOSITORY ??
    (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}` : undefined) ??
    (top ? repoOf(git(top, ["remote", "get-url", "origin"])) : undefined)
  const head = top ? git(top, ["rev-parse", "--abbrev-ref", "HEAD"]) : ""
  const branch =
    own.branch ??
    (env.GITHUB_REF_TYPE === "branch" ? env.GITHUB_REF_NAME : undefined) ??
    env.VERCEL_GIT_COMMIT_REF ??
    (head && head !== "HEAD" ? head : "main")
  let target: EditTarget | null = null
  if (!repo) console.warn('basalt: "edit" needs a GitHub repository: give it one, { "edit": { "repo": "owner/name" } }')
  else if (!top) console.warn("basalt: \"edit\" needs the site in a git checkout of its repository")
  else target = { kind: "github", repo, branch, top }
  resolved.set(site.dir, target)
  return target ?? undefined
}

/** Whether pages carry what editing needs (data-src on their blocks): while serving, or with "edit". */
export function editable(site: Site): boolean {
  return serving() || !!site.config.edit
}

/** A note's path in its repository, for the GitHub API ("garden/notes/a.md"); the top is git's, a real path, so the note's is too. */
export function repoPath(target: Extract<EditTarget, { kind: "github" }>, abs: string): string {
  let real = abs
  try {
    real = fs.realpathSync(abs)
  } catch {}
  return path.relative(target.top, real).split(path.sep).join("/")
}

/** git's name for a file's contents (what the GitHub API calls its sha) */
export function blobSha(text: string): string {
  const bytes = Buffer.from(text, "utf8")
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")
}
