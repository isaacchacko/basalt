// The dev server's history endpoint (integrations/history.ts), on a site in
// a git repository of its own, through a real http server.
import "../markdown/test-hooks.ts"
import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import type { AddressInfo } from "node:net"

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "basalt-history-api-")))
let when = 0
const g = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, GIT_AUTHOR_DATE: `@${1_700_000_000 + ++when}`, GIT_COMMITTER_DATE: `@${1_700_000_000 + when}`, GIT_AUTHOR_NAME: "A", GIT_AUTHOR_EMAIL: "a@a", GIT_COMMITTER_NAME: "A", GIT_COMMITTER_EMAIL: "a@a" },
  }).trim()
fs.mkdirSync(path.join(dir, "notes"))
fs.writeFileSync(path.join(dir, "basalt.json"), JSON.stringify({ content: [{ from: "notes" }] }))
fs.writeFileSync(path.join(dir, "notes", "garden.md"), "One.\n")
fs.writeFileSync(path.join(dir, "notes", "secret.md"), "---\nhistory: false\n---\n\nHidden.\n")
g("init", "-q", "-b", "main")
g("add", ".")
g("commit", "-qm", "start")
fs.writeFileSync(path.join(dir, "notes", "garden.md"), "One.\n\nTwo.\n")
g("commit", "-qam", "two")

process.env.BASALT_SITE = dir
const command = process.env.BASALT_COMMAND
process.env.BASALT_COMMAND = "dev"
const { answerHistory } = await import("./history.ts")
const { forgetGitDates } = await import("../lib/gitdates.ts")
forgetGitDates()

const rendered: string[] = []
const render = async (_abs: string, text: string) => {
  rendered.push(text)
  return text
    .split(/\n\n+/)
    .filter((p) => p.trim())
    .map((p, i) => `<p data-src="${i * 2 + 1}-${i * 2 + 1}">${p.trim()}</p>`)
    .join("\n")
}

let server: http.Server
let base: string
before(async () => {
  server = http.createServer((req, res) => void answerHistory(req, res, new URL(req.url ?? "/", "http://x"), render))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/__basalt/history`
})
after(() => {
  server.close()
  fs.rmSync(dir, { recursive: true, force: true })
  if (command === undefined) delete process.env.BASALT_COMMAND
  else process.env.BASALT_COMMAND = command
})

const get = async (q: string, init?: RequestInit) => {
  const res = await fetch(`${base}?${q}`, init)
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { commits?: { subject: string; sha: string }[] } }
}

test("a note's commits, newest first, and complete", async () => {
  const { status, body } = await get("slug=garden")
  assert.equal(status, 200)
  assert.equal(body.slug, "garden")
  assert.equal(body.complete, true)
  assert.deepEqual(
    body.commits!.map((c) => c.subject),
    ["two", "start"],
  )
})

test("a version: rendered, its changes marked, its base", async () => {
  const [two, start] = (await get("slug=garden")).body.commits!
  const { status, body } = await get(`slug=garden&at=${two.sha}`)
  assert.equal(status, 200)
  assert.equal(body.sha, two.sha)
  assert.equal(body.base, start.sha)
  assert.equal(body.path, "notes/garden.md")
  assert.match(String(body.html), /class="history-added"[^>]*>Two\.</)
  assert.equal(body.plain, '<p data-src="1-1">One.</p>\n<p data-src="3-3">Two.</p>')
})

test("a version is rendered once, then kept", async () => {
  const [two] = (await get("slug=garden")).body.commits!
  await get(`slug=garden&at=${two.sha}`)
  const count = rendered.length
  await get(`slug=garden&at=${two.sha}`)
  assert.equal(rendered.length, count)
})

test("404 for a commit that isn't the note's, a note that isn't there, or one whose history is off", async () => {
  assert.equal((await get(`slug=garden&at=${"0".repeat(40)}`)).status, 404)
  assert.equal((await get("slug=nope")).status, 404)
  assert.equal((await get("")).status, 404)
  const secret = await get("slug=secret")
  assert.equal(secret.status, 404)
  assert.match(String(secret.body.error), /off/)
})

test("only GET", async () => {
  assert.equal((await get("slug=garden", { method: "POST", body: "{}" })).status, 405)
})

test("a commit made while serving shows next time it's asked for", async () => {
  fs.writeFileSync(path.join(dir, "notes", "garden.md"), "One.\n\nTwo.\n\nThree.\n")
  g("commit", "-qam", "three")
  assert.deepEqual(
    (await get("slug=garden")).body.commits!.map((c) => c.subject),
    ["three", "two", "start"],
  )
})
