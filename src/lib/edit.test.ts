import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, test } from "node:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { blobSha, editable, editTarget, repoOf, repoPath } from "./edit.ts"
import { loadSite } from "./site.ts"

const ENV = ["BASALT_COMMAND", "GITHUB_REPOSITORY", "GITHUB_REF_NAME", "GITHUB_REF_TYPE", "VERCEL_GIT_REPO_OWNER", "VERCEL_GIT_REPO_SLUG", "VERCEL_GIT_COMMIT_REF"]
let saved: Record<string, string | undefined>
let warn: typeof console.warn
let warnings: string[]

// an Action sets GITHUB_*, so each test starts with none of them
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k]
  warnings = []
  warn = console.warn
  console.warn = (msg: string) => void warnings.push(msg)
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  console.warn = warn
})

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()

/** a site (editTarget remembers each one, so every call gets a new folder), in a git checkout with `origin` when given */
function site(edit: unknown, opts: { origin?: string; branch?: string; git?: boolean; detached?: boolean } = {}) {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "basalt-edit-")))
  const dir = path.join(top, "garden")
  fs.mkdirSync(path.join(dir, "notes"), { recursive: true })
  fs.writeFileSync(path.join(dir, "basalt.json"), JSON.stringify({ edit, content: [{ from: "notes" }] }))
  fs.writeFileSync(path.join(dir, "notes", "a.md"), "a\n")
  if (opts.git !== false) {
    git(top, "init", "-q", "-b", opts.branch ?? "trunk")
    if (opts.origin) git(top, "remote", "add", "origin", opts.origin)
    git(top, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x")
    if (opts.detached) git(top, "checkout", "-q", "--detach")
  }
  return { top, site: loadSite(dir) }
}

describe("repoOf", () => {
  test("owner/name from a GitHub remote, https or ssh, with or without .git", () => {
    assert.equal(repoOf("https://github.com/me/garden.git"), "me/garden")
    assert.equal(repoOf("https://github.com/me/garden"), "me/garden")
    assert.equal(repoOf("https://github.com/me/garden/\n"), "me/garden")
    assert.equal(repoOf("git@github.com:me/garden.git"), "me/garden")
    assert.equal(repoOf("ssh://git@github.com/me/my.garden.git"), "me/my.garden")
  })

  test("nothing from a remote that isn't GitHub's", () => {
    assert.equal(repoOf("https://gitlab.com/me/garden.git"), undefined)
    assert.equal(repoOf(""), undefined)
  })
})

describe("editTarget", () => {
  test("serving, every site edits through the dev server, with or without \"edit\"", () => {
    process.env.BASALT_COMMAND = "dev"
    assert.deepEqual(editTarget(site(undefined).site), { kind: "dev" })
    assert.deepEqual(editTarget(site(undefined, { git: false }).site), { kind: "dev" })
  })

  test("built without \"edit\", a site doesn't edit", () => {
    process.env.BASALT_COMMAND = "build"
    assert.equal(editTarget(site(undefined, { origin: "https://github.com/me/garden" }).site), undefined)
  })

  test("the repo and branch \"edit\" names come first", () => {
    process.env.GITHUB_REPOSITORY = "ci/repo"
    process.env.GITHUB_REF_TYPE = "branch"
    process.env.GITHUB_REF_NAME = "ci-branch"
    process.env.VERCEL_GIT_REPO_OWNER = "v"
    process.env.VERCEL_GIT_REPO_SLUG = "repo"
    process.env.VERCEL_GIT_COMMIT_REF = "v-branch"
    const { top, site: s } = site({ repo: "me/garden", branch: "pages" }, { origin: "https://github.com/o/origin" })
    assert.deepEqual(editTarget(s), { kind: "github", repo: "me/garden", branch: "pages", top })
  })

  test("then a GitHub Action's, over Vercel's and git's", () => {
    process.env.GITHUB_REPOSITORY = "ci/repo"
    process.env.GITHUB_REF_TYPE = "branch"
    process.env.GITHUB_REF_NAME = "ci-branch"
    process.env.VERCEL_GIT_REPO_OWNER = "v"
    process.env.VERCEL_GIT_REPO_SLUG = "repo"
    process.env.VERCEL_GIT_COMMIT_REF = "v-branch"
    const { top, site: s } = site(true, { origin: "https://github.com/o/origin" })
    assert.deepEqual(editTarget(s), { kind: "github", repo: "ci/repo", branch: "ci-branch", top })
  })

  test("an Action building a tag commits to the branch from elsewhere, not the tag", () => {
    process.env.GITHUB_REPOSITORY = "ci/repo"
    process.env.GITHUB_REF_TYPE = "tag"
    process.env.GITHUB_REF_NAME = "v1.0.0"
    const { site: s } = site(true, { branch: "trunk" })
    assert.equal((editTarget(s) as { branch: string }).branch, "trunk")
  })

  test("then Vercel's, over git's", () => {
    process.env.VERCEL_GIT_REPO_OWNER = "v"
    process.env.VERCEL_GIT_REPO_SLUG = "repo"
    process.env.VERCEL_GIT_COMMIT_REF = "v-branch"
    const { top, site: s } = site(true, { origin: "https://github.com/o/origin" })
    assert.deepEqual(editTarget(s), { kind: "github", repo: "v/repo", branch: "v-branch", top })
  })

  test("Vercel's owner without its slug isn't a repo", () => {
    process.env.VERCEL_GIT_REPO_OWNER = "v"
    const { site: s } = site(true, { origin: "git@github.com:o/origin.git" })
    assert.equal((editTarget(s) as { repo: string }).repo, "o/origin")
  })

  test("then git's origin and the branch checked out", () => {
    const { top, site: s } = site(true, { origin: "git@github.com:o/origin.git", branch: "drafts" })
    assert.deepEqual(editTarget(s), { kind: "github", repo: "o/origin", branch: "drafts", top })
  })

  test("a detached HEAD commits to main", () => {
    const { site: s } = site(true, { origin: "https://github.com/o/origin", detached: true })
    assert.equal((editTarget(s) as { branch: string }).branch, "main")
  })

  test("half of \"edit\" given: the rest from the build", () => {
    const { site: s } = site({ branch: "pages" }, { origin: "https://github.com/o/origin" })
    assert.deepEqual([(editTarget(s) as { repo: string }).repo, (editTarget(s) as { branch: string }).branch], ["o/origin", "pages"])
  })

  test("no GitHub repository to be found: no editing, and it says why", () => {
    assert.equal(editTarget(site(true, { origin: "https://gitlab.com/o/origin" }).site), undefined)
    assert.match(warnings.join("\n"), /"edit" needs a GitHub repository/)
  })

  test("not in a git checkout: no editing, and it says why", () => {
    const { site: s } = site({ repo: "me/garden" }, { git: false })
    assert.equal(editTarget(s), undefined)
    assert.match(warnings.join("\n"), /git checkout/)
  })
})

describe("editable", () => {
  test("pages carry their lines while serving, and built with \"edit\"", () => {
    const plain = site(undefined).site
    const editing = site(true, { origin: "https://github.com/o/origin" }).site
    process.env.BASALT_COMMAND = "dev"
    assert.equal(editable(plain), true)
    process.env.BASALT_COMMAND = "build"
    assert.equal(editable(plain), false)
    assert.equal(editable(editing), true)
    delete process.env.BASALT_COMMAND
    assert.equal(editable(plain), false)
  })
})

test("a note's path in its repository", () => {
  const { top, site: s } = site(true, { origin: "https://github.com/o/origin" })
  const target = editTarget(s)
  assert.ok(target?.kind === "github")
  assert.equal(repoPath(target, path.join(top, "garden", "notes", "a.md")), "garden/notes/a.md")
  // the site reached through a link (macOS's /var is /private/var): git's top is the real path
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "basalt-link-")), "top")
  fs.symlinkSync(top, link)
  assert.equal(repoPath(target, path.join(link, "garden", "notes", "a.md")), "garden/notes/a.md")
})

test("blobSha is git's name for the contents", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-sha-"))
  for (const text of ["", "a\n", "naïve — ünïcode\r\nline two", "no newline"]) {
    fs.writeFileSync(path.join(dir, "f"), text)
    assert.equal(blobSha(text), git(dir, "hash-object", "f"))
  }
})
