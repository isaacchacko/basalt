// The dev server's file ops (POST /__basalt/files), on a site of its own,
// through a real http server running the middleware the integration installs.
import "../markdown/test-hooks.ts"
import assert from "node:assert/strict"
import { after, before, beforeEach, describe, test } from "node:test"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import type { AddressInfo } from "node:net"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-files-"))
const notes = path.join(dir, "notes")
const posts = path.join(dir, "posts")
fs.writeFileSync(path.join(dir, "basalt.json"), JSON.stringify({ content: [{ from: "notes" }, { from: "posts", to: "blog" }] }))
process.env.BASALT_SITE = dir

const SEED: Record<string, string> = {
  "notes/index.md": "Home. See [[plants]] and [[blog/first post|the first post]].\n",
  "notes/plants.md": "# Plants\n\nBasil. Back [[index|home]].\n",
  "notes/garden/index.md": "The garden: [[plants#Basil]], ![[plants]].\n",
  "notes/garden/beds.md": "Beds, by [[plants]]. `[[plants]]` stays.\n",
  "posts/first post.md": "First. [[garden]] and [[garden/beds]].\n",
}
const outside = path.join(dir, "outside.md")

const { editInPlace } = await import("./edit.ts")

type Middleware = (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void
let server: http.Server
let base: string
const command = process.env.BASALT_COMMAND

before(async () => {
  const hooks = editInPlace().hooks as Record<string, (arg: unknown) => void>
  hooks["astro:config:setup"]({ command: "dev" })
  let mw: Middleware | undefined
  hooks["astro:server:setup"]({ server: { middlewares: { use: (fn: Middleware) => (mw = fn) } } })
  server = http.createServer((req, res) => mw!(req, res, () => ((res.statusCode = 418), res.end("next"))))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => {
  server.close()
  fs.rmSync(dir, { recursive: true, force: true })
  if (command === undefined) delete process.env.BASALT_COMMAND
  else process.env.BASALT_COMMAND = command
})

beforeEach(() => {
  fs.rmSync(notes, { recursive: true, force: true })
  fs.rmSync(posts, { recursive: true, force: true })
  for (const [p, text] of Object.entries(SEED)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true })
    fs.writeFileSync(path.join(dir, p), text)
  }
  fs.writeFileSync(outside, "not the site's\n")
})

const json = { "content-type": "application/json", "x-basalt-edit": "1" }
const post = (body: unknown, headers: Record<string, string> = json) =>
  fetch(`${base}/__basalt/files`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) })

/** every file under the site's folders of notes, with its text */
function disk() {
  const out: Record<string, string> = {}
  const walk = (abs: string) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, e.name)
      if (e.isDirectory()) walk(p)
      else out[path.relative(dir, p).split(path.sep).join("/")] = fs.readFileSync(p, "utf8")
    }
  }
  for (const d of [notes, posts]) if (fs.existsSync(d)) walk(d)
  return out
}
const seed = () => ({ ...SEED })

describe("only the site's own pages", () => {
  test("JSON, the x-basalt-edit header, from the site's own origin", async () => {
    const op = { op: { op: "create", path: "new.md" } }
    assert.equal((await post(op, { "content-type": "application/json" })).status, 403)
    assert.equal((await post(op, { "x-basalt-edit": "1", "content-type": "text/plain" })).status, 403)
    assert.equal((await post(op, { ...json, origin: "https://evil.example" })).status, 403)
    // a form another site posts: no header, no JSON
    assert.equal((await post("op=create", { "content-type": "application/x-www-form-urlencoded" })).status, 403)
    assert.deepEqual(disk(), seed())
    assert.equal((await post(op, { ...json, origin: base })).status, 200)
  })
  test("only POST, and only an op", async () => {
    assert.equal((await fetch(`${base}/__basalt/files`)).status, 405)
    assert.equal((await post({ op: { op: "chmod", path: "plants.md" } })).status, 400)
    assert.equal((await post({ op: { op: "move", from: "plants.md" } })).status, 400)
    assert.deepEqual(disk(), seed())
  })
})

describe("inside the folders of notes", () => {
  test("no path climbs out, starts at the top, or goes somewhere hidden or private", async () => {
    for (const p of ["../outside.md", "../../etc/x.md", "/tmp/x.md", "a/../../outside.md", ".hidden.md", "private/x.md", "a//b.md", "x\\..\\y.md"]) {
      const res = await post({ op: { op: "create", path: p } })
      assert.equal(res.status, 400, p)
    }
    assert.equal((await post({ op: { op: "move", from: "plants.md", to: "../outside.md" } })).status, 400)
    assert.equal((await post({ op: { op: "move", from: "../outside.md", to: "x.md" } })).status, 404)
    assert.equal((await post({ op: { op: "delete", path: "../outside.md" } })).status, 404)
    assert.equal((await post({ op: { op: "delete", path: "garden/../../outside.md", folder: true } })).status, 404)
    assert.deepEqual(disk(), seed())
    assert.equal(fs.readFileSync(outside, "utf8"), "not the site's\n")
  })
  test("never over a note or folder that's there", async () => {
    assert.equal((await post({ op: { op: "create", path: "plants.md" } })).status, 409)
    assert.equal((await post({ op: { op: "create", path: "garden" } })).status, 409, "a folder's there")
    assert.equal((await post({ op: { op: "create", path: "notes.txt" } })).status, 400, "a note is a .md")
    assert.equal((await post({ op: { op: "move", from: "plants.md", to: "garden/beds.md" } })).status, 409)
    assert.equal((await post({ op: { op: "move", from: "garden/beds.md", to: "garden.md" } })).status, 200, "a note beside a folder of its name")
    assert.equal((await post({ op: { op: "move", from: "plants.md", to: "garden" } })).status, 409)
    assert.equal((await post({ op: { op: "move", from: "garden", to: "garden/inner", folder: true } })).status, 400)
    assert.equal((await post({ op: { op: "move", from: "plants.md", to: "plants.txt" } })).status, 400)
  })
})

describe("the ops", () => {
  test("a note made, empty, where it's asked for, and its page", async () => {
    const res = await post({ op: { op: "create", path: "garden/new bed.md" } })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { path: "garden/new bed.md", href: "/garden/new-bed" })
    assert.deepEqual(disk(), { ...seed(), "notes/garden/new bed.md": "" })
    // a new folder is its index note, made with its title; one in a folder of notes of its own goes there
    assert.equal((await (await post({ op: { op: "create", path: "blog/drafts/index.md", text: "---\ntitle: Drafts\n---\n" } })).json()).href, "/blog/drafts")
    assert.equal(disk()["posts/drafts/index.md"], "---\ntitle: Drafts\n---\n")
  })
  test("a rename asks first which links would go along, and changes nothing", async () => {
    const res = await post({ op: { op: "move", from: "plants.md", to: "herbs.md" }, dry: true })
    assert.deepEqual(await res.json(), {
      links: [
        { path: "garden/beds.md", links: 1 },
        { path: "garden/index.md", links: 2 },
        { path: "index.md", links: 1 },
      ],
    })
    assert.deepEqual(disk(), seed())
  })
  test("a rename takes its links along, on yes", async () => {
    const res = await post({ op: { op: "move", from: "plants.md", to: "herbs.md" }, relink: true })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).href, "/herbs")
    const want = seed()
    delete want["notes/plants.md"]
    want["notes/herbs.md"] = SEED["notes/plants.md"]
    want["notes/index.md"] = "Home. See [[herbs]] and [[blog/first post|the first post]].\n"
    want["notes/garden/index.md"] = "The garden: [[herbs#Basil]], ![[herbs]].\n"
    want["notes/garden/beds.md"] = "Beds, by [[herbs]]. `[[plants]]` stays.\n"
    assert.deepEqual(disk(), want)
  })
  test("and leaves them be, on no", async () => {
    await post({ op: { op: "move", from: "plants.md", to: "herbs.md" } })
    const want = seed()
    delete want["notes/plants.md"]
    want["notes/herbs.md"] = SEED["notes/plants.md"]
    assert.deepEqual(disk(), want)
  })
  test("a folder moved into another folder of notes, everything in it, its links along", async () => {
    const res = await post({ op: { op: "move", from: "garden", to: "blog/garden", folder: true }, relink: true })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).href, "/blog/garden")
    const d = disk()
    assert.equal(d["posts/garden/index.md"], SEED["notes/garden/index.md"])
    assert.equal(d["posts/garden/beds.md"], SEED["notes/garden/beds.md"])
    assert.equal(d["notes/garden/index.md"], undefined)
    // a name alone that's still enough stays; a path is written again
    assert.equal(d["posts/first post.md"], "First. [[blog/garden]] and [[blog/garden/beds]].\n")
  })
  test("a note deleted, a folder deleted with everything in it", async () => {
    assert.equal((await post({ op: { op: "delete", path: "plants.md" } })).status, 200)
    assert.equal((await post({ op: { op: "delete", path: "garden", folder: true } })).status, 200)
    const want = seed()
    for (const p of ["notes/plants.md", "notes/garden/index.md", "notes/garden/beds.md"]) delete want[p]
    assert.deepEqual(disk(), want)
    assert.equal(fs.existsSync(path.join(notes, "garden")), false)
    assert.equal((await post({ op: { op: "delete", path: "plants.md" } })).status, 404)
  })
})
