// The dev server's source endpoint, on a site of its own, through a real
// http server running the middleware the integration installs.
import "../markdown/test-hooks.ts"
import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import type { AddressInfo } from "node:net"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-source-"))
fs.mkdirSync(path.join(dir, "notes", "sub"), { recursive: true })
fs.writeFileSync(path.join(dir, "basalt.json"), JSON.stringify({ content: [{ from: "notes" }] }))
const note = path.join(dir, "notes", "sub", "a.md")
const ORIGINAL = "---\ntitle: a\n---\n\nHello.\n"
fs.writeFileSync(path.join(dir, "outside.md"), "not the site's\n")
process.env.BASALT_SITE = dir

const { editInPlace } = await import("./edit.ts")
const { blobSha } = await import("../lib/edit.ts")

type Middleware = (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void
let server: http.Server
let base: string
const command = process.env.BASALT_COMMAND

before(async () => {
  const hooks = editInPlace().hooks as Record<string, (arg: unknown) => void>
  hooks["astro:config:setup"]({ command: "dev" })
  let mw: Middleware | undefined
  hooks["astro:server:setup"]({ server: { middlewares: { use: (fn: Middleware) => (mw = fn) } } })
  server = http.createServer((req, res) =>
    mw!(req, res, () => {
      res.statusCode = 418
      res.end("next")
    }),
  )
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => {
  server.close()
  if (command === undefined) delete process.env.BASALT_COMMAND
  else process.env.BASALT_COMMAND = command
})

const reset = () => fs.writeFileSync(note, ORIGINAL)
const json = { "content-type": "application/json", "x-basalt-edit": "1" }
const put = (body: unknown, headers: Record<string, string> = json) =>
  fetch(`${base}/__basalt/source`, { method: "PUT", headers, body: typeof body === "string" ? body : JSON.stringify(body) })

test("tells Basalt's build-time code it's serving", () => {
  assert.equal(process.env.BASALT_COMMAND, "dev")
})

test("leaves every other path to the rest of the server", async () => {
  assert.equal((await fetch(`${base}/__basalt/status`)).status, 418)
  assert.equal((await fetch(`${base}/sub/a`)).status, 418)
})

describe("GET", () => {
  test("a note's file as it is, with its sha", async () => {
    reset()
    const res = await fetch(`${base}/__basalt/source?slug=sub/a`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get("cache-control"), "no-store")
    assert.deepEqual(await res.json(), { slug: "sub/a", file: path.join("notes", "sub", "a.md"), text: ORIGINAL, sha: blobSha(ORIGINAL) })
  })

  test("404 for a slug that isn't a note of the site's", async () => {
    for (const slug of ["", "nope", "../outside", "basalt.json", "sub/a.md"]) {
      assert.equal((await fetch(`${base}/__basalt/source?slug=${encodeURIComponent(slug)}`)).status, 404, slug)
    }
    assert.equal((await fetch(`${base}/__basalt/source`)).status, 404)
  })

  test("only GET and PUT", async () => {
    assert.equal((await fetch(`${base}/__basalt/source?slug=sub/a`, { method: "POST", headers: json, body: "{}" })).status, 405)
    assert.equal((await fetch(`${base}/__basalt/source?slug=sub/a`, { method: "DELETE" })).status, 405)
  })
})

describe("PUT", () => {
  test("writes the file when it's still what the page edited", async () => {
    reset()
    const text = ORIGINAL.replace("Hello.", "Hello, there.")
    const res = await put({ slug: "sub/a", text, base: blobSha(ORIGINAL) })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { sha: blobSha(text) })
    assert.equal(fs.readFileSync(note, "utf8"), text)
  })

  test("writes it byte for byte: CRLF, no newline at the end, unicode", async () => {
    reset()
    const text = "---\r\ntitle: a\r\n---\r\n\r\nnaïve — 💡"
    assert.equal((await put({ slug: "sub/a", text, base: blobSha(ORIGINAL) })).status, 200)
    assert.deepEqual(fs.readFileSync(note), Buffer.from(text, "utf8"))
  })

  test("the same text again doesn't touch the file (no save, no rebuild)", async () => {
    reset()
    const past = new Date(Date.now() - 60_000)
    fs.utimesSync(note, past, past)
    const before = fs.statSync(note).mtimeMs
    assert.equal((await put({ slug: "sub/a", text: ORIGINAL, base: blobSha(ORIGINAL) })).status, 200)
    assert.equal(fs.statSync(note).mtimeMs, before)
  })

  test("409 with the file as it is now, when it changed since the page read it", async () => {
    reset()
    const theirs = ORIGINAL + "\nAdded elsewhere.\n"
    fs.writeFileSync(note, theirs)
    const res = await put({ slug: "sub/a", text: ORIGINAL.replace("Hello.", "Mine."), base: blobSha(ORIGINAL) })
    assert.equal(res.status, 409)
    assert.deepEqual(await res.json(), { text: theirs, sha: blobSha(theirs) })
    assert.equal(fs.readFileSync(note, "utf8"), theirs)
  })

  test("409 with no base at all", async () => {
    reset()
    assert.equal((await put({ slug: "sub/a", text: "x" })).status, 409)
    assert.equal(fs.readFileSync(note, "utf8"), ORIGINAL)
  })

  test("404 for a note that isn't the site's, 400 for text that isn't a file", async () => {
    reset()
    const sha = blobSha(ORIGINAL)
    assert.equal((await put({ slug: "../outside", text: "x", base: sha })).status, 404)
    assert.equal((await put({ text: "x", base: sha })).status, 404)
    assert.equal((await put({ slug: "sub/a", text: 3, base: sha })).status, 400)
    assert.equal((await put({ slug: "sub/a", base: sha })).status, 400)
    assert.equal(fs.readFileSync(note, "utf8"), ORIGINAL)
    assert.equal(fs.readFileSync(path.join(dir, "outside.md"), "utf8"), "not the site's\n")
  })

  test("a body that isn't JSON is turned away, and the server keeps going", async () => {
    reset()
    const res = await put("{not json")
    assert.ok(res.status >= 400, String(res.status))
    assert.equal(fs.readFileSync(note, "utf8"), ORIGINAL)
    assert.equal((await fetch(`${base}/__basalt/source?slug=sub/a`)).status, 200)
  })
})

describe("only the site's own pages write", () => {
  const body = () => ({ slug: "sub/a", text: "pwned\n", base: blobSha(ORIGINAL) })
  const turnedAway = async (headers: Record<string, string>) => {
    reset()
    const res = await put(body(), headers)
    assert.equal(res.status, 403, JSON.stringify(headers))
    assert.equal(fs.readFileSync(note, "utf8"), ORIGINAL)
  }

  test("without the x-basalt-edit header", () => turnedAway({ "content-type": "application/json" }))
  test("with the header saying something else", () => turnedAway({ "content-type": "application/json", "x-basalt-edit": "true" }))
  test("as a form or plain text (what a page elsewhere can send without asking)", async () => {
    await turnedAway({ "content-type": "text/plain", "x-basalt-edit": "1" })
    await turnedAway({ "content-type": "application/x-www-form-urlencoded", "x-basalt-edit": "1" })
    await turnedAway({ "x-basalt-edit": "1" })
  })
  test("from another origin", async () => {
    await turnedAway({ ...json, origin: "https://evil.example" })
    await turnedAway({ ...json, origin: "http://127.0.0.1:1" })
  })

  test("from the page's own origin, it writes", async () => {
    reset()
    const res = await put(body(), { ...json, origin: base, "content-type": "application/json; charset=utf-8" })
    assert.equal(res.status, 200)
    assert.equal(fs.readFileSync(note, "utf8"), "pwned\n")
  })
})

describe("POST /__basalt/render: the note as it would render with the text typed, saved or not", () => {
  let renderServer: http.Server
  let rbase: string
  const asked: { abs: string; text: string }[] = []
  before(async () => {
    const hooks = editInPlace(async (abs, text) => {
      asked.push({ abs, text })
      return `<p data-src="5-5">${text.length}</p>`
    }).hooks as Record<string, (arg: unknown) => void>
    let mw: Middleware | undefined
    hooks["astro:server:setup"]({ server: { middlewares: { use: (fn: Middleware) => (mw = fn) } } })
    renderServer = http.createServer((req, res) => mw!(req, res, () => ((res.statusCode = 418), res.end())))
    await new Promise<void>((resolve) => renderServer.listen(0, "127.0.0.1", resolve))
    rbase = `http://127.0.0.1:${(renderServer.address() as AddressInfo).port}`
  })
  after(() => renderServer.close())
  const post = (body: unknown, headers: Record<string, string> = json, method = "POST") =>
    fetch(`${rbase}/__basalt/render`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body) })

  test("renders the text it's sent for the note, with its sha, and doesn't touch the file", async () => {
    reset()
    asked.length = 0
    const text = ORIGINAL + "\nTyped, not saved.\n"
    const res = await post({ slug: "sub/a", text })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { sha: string; html: string; ms: number }
    assert.equal(body.sha, blobSha(text))
    assert.equal(body.html, `<p data-src="5-5">${text.length}</p>`)
    assert.equal(typeof body.ms, "number")
    assert.deepEqual(asked, [{ abs: note, text }])
    assert.equal(fs.readFileSync(note, "utf8"), ORIGINAL)
  })

  test("only POST", async () => {
    assert.equal((await post(undefined, json, "GET")).status, 405)
    assert.equal((await post({ slug: "sub/a", text: "x" }, json, "PUT")).status, 405)
  })

  test("404 for a note that isn't the site's, 400 for text that isn't a file", async () => {
    asked.length = 0
    assert.equal((await post({ slug: "../outside", text: "x" })).status, 404)
    assert.equal((await post({ slug: "sub/a", text: 3 })).status, 400)
    assert.deepEqual(asked, [])
  })

  test("only the site's own pages: the header, JSON and the origin", async () => {
    asked.length = 0
    assert.equal((await post({ slug: "sub/a", text: "x" }, { "content-type": "application/json" })).status, 403)
    assert.equal((await post({ slug: "sub/a", text: "x" }, { "content-type": "text/plain", "x-basalt-edit": "1" })).status, 403)
    assert.equal((await post({ slug: "sub/a", text: "x" }, { ...json, origin: "https://evil.example" })).status, 403)
    assert.deepEqual(asked, [])
    assert.equal((await post({ slug: "sub/a", text: "x" }, { ...json, origin: rbase })).status, 200)
  })

  test("a render that fails is a 500 with its message, and the server goes on", async () => {
    const hooks = editInPlace(async () => {
      throw new Error("the pipeline broke")
    }).hooks as Record<string, (arg: unknown) => void>
    let mw: Middleware | undefined
    hooks["astro:server:setup"]({ server: { middlewares: { use: (fn: Middleware) => (mw = fn) } } })
    const failing = http.createServer((req, res) => mw!(req, res, () => res.end()))
    await new Promise<void>((resolve) => failing.listen(0, "127.0.0.1", resolve))
    try {
      const url = `http://127.0.0.1:${(failing.address() as AddressInfo).port}/__basalt/render`
      const res = await fetch(url, { method: "POST", headers: json, body: JSON.stringify({ slug: "sub/a", text: "x" }) })
      assert.equal(res.status, 500)
      assert.match(((await res.json()) as { error: string }).error, /the pipeline broke/)
      assert.equal((await fetch(url.replace("render", "source") + "?slug=sub/a")).status, 200)
    } finally {
      failing.close()
    }
  })
})

test("without a renderer (a build), /__basalt/render isn't answered", async () => {
  assert.equal((await fetch(`${base}/__basalt/render`, { method: "POST", headers: json, body: "{}" })).status, 418)
})
