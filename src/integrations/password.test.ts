// A real build of the test site behind a password, served the way Vercel
// serves its Build Output API: each request through the gate it wrote, then
// the files, then 404.html.
import test, { before, describe } from "node:test"
import assert from "node:assert"
import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { MARK } from "../lib/icon.ts"

const basalt = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const password = crypto.randomBytes(18).toString("base64")

function siteWith(json: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-password-"))
  fs.cpSync(path.join(basalt, "test", "fixtures", "site"), dir, { recursive: true })
  const file = path.join(dir, "basalt.json")
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), ...json }))
  return dir
}

const build = (dir: string) =>
  spawnSync(process.execPath, [path.join(basalt, "bin", "basalt.mjs"), "build", dir], {
    encoding: "utf8",
    env: { ...process.env, BASALT_PASSWORD: password },
  })

describe("a site behind a password", () => {
  let out: string
  let middleware: (request: Request) => Promise<Response>
  let cookie = ""

  /** what Vercel answers: the gate, then the file (a folder's index.html), then 404.html */
  async function vercel(pathname: string, init: RequestInit = {}): Promise<Response> {
    const request = new Request(`https://notes.example.com${pathname}`, {
      ...init,
      headers: { ...(cookie ? { cookie } : {}), ...(init.headers as Record<string, string>) },
    })
    const gated = await middleware(request)
    if (gated.headers.get("x-middleware-next") !== "1") return gated
    const file = path.join(out, "static", decodeURIComponent(new URL(request.url).pathname))
    const found = [file, path.join(file, "index.html")].find((f) => fs.statSync(f, { throwIfNoEntry: false })?.isFile())
    if (found) return new Response(fs.readFileSync(found), { status: 200 })
    return new Response(fs.readFileSync(path.join(out, "static", "404.html")), { status: 404 })
  }

  // every kind of thing the site serves
  const asked = (): string[] => {
    const css = fs.readdirSync(path.join(out, "static", "_astro")).find((f) => f.endsWith(".css"))!
    return ["/", "/margin", "/tags", "/static/contentIndex.json", "/assets/card.png", "/assets/basalt.pdf", `/_astro/${css}`, "/404.html", "/no-such-note"]
  }

  before(async () => {
    const dir = siteWith({ password: true, icon: "assets/card.png" })
    const result = build(dir)
    assert.strictEqual(result.status, 0, result.stderr)
    out = path.join(dir, ".vercel", "output")
    process.env.BASALT_PASSWORD = password
    middleware = (await import(pathToFileURL(path.join(out, "functions", "_middleware.func", "index.js")).href)).default
  })

  test("it's written as Vercel's Build Output API, with the gate in front of every path", () => {
    const config = JSON.parse(fs.readFileSync(path.join(out, "config.json"), "utf8"))
    assert.deepStrictEqual(config.routes[0], { src: "/(.*)", middlewarePath: "_middleware", continue: true })
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(out, "functions", "_middleware.func", ".vc-config.json"), "utf8")), { runtime: "edge", entrypoint: "index.js" })
  })

  test("no sitemap, feeds or cards are built, and no page points at them", () => {
    for (const f of ["sitemap.xml", "rss.xml", "index.xml", "og"]) assert.ok(!fs.existsSync(path.join(out, "static", f)), f)
    const home = fs.readFileSync(path.join(out, "static", "index.html"), "utf8")
    assert.doesNotMatch(home, /rss\.xml|og:image/)
  })

  test("the password is nowhere in what's deployed", () => {
    const files = fs.readdirSync(out, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
    for (const e of files) assert.ok(!fs.readFileSync(path.join(e.parentPath, e.name)).includes(password), e.name)
  })

  test("without the cookie, every kind of file is refused with the login page", async () => {
    cookie = ""
    for (const p of asked()) {
      const res = await vercel(p)
      assert.strictEqual(res.status, 401, p)
      assert.match(await res.text(), /<form method="post" action="\/__basalt\/login">/, p)
    }
  })

  test("the login page's tab shows the site's own icon, inline, since the file itself is behind the gate", async () => {
    cookie = ""
    const png = fs.readFileSync(path.join(basalt, "test", "fixtures", "site", "notes", "assets", "card.png")).toString("base64")
    const html = await (await vercel("/")).text()
    assert.ok(html.includes(`<link rel="icon" href="data:image/png;base64,${png}">`))
    assert.match(html, /<title>Basalt<\/title>/)
  })

  test("a wrong password is refused; the right one gets in, to all of it", async () => {
    const login = (given: string) =>
      vercel("/__basalt/login", { method: "POST", body: new URLSearchParams({ password: given, next: "/margin" }), redirect: "manual" })
    const wrong = await login("not it")
    assert.strictEqual(wrong.status, 401)
    assert.ok(!wrong.headers.get("set-cookie"))
    const right = await login(password)
    assert.strictEqual(right.status, 303)
    assert.strictEqual(right.headers.get("location"), "/margin")
    cookie = right.headers.get("set-cookie")!.split(";")[0]
    for (const p of asked()) {
      const res = await vercel(p)
      assert.strictEqual(res.status, p === "/no-such-note" ? 404 : 200, p)
    }
    const index = JSON.parse(await (await vercel("/static/contentIndex.json")).text())
    assert.ok(index.margin, "search's index, once in")
  })

  test("without an icon of its own, the login page's tab shows Basalt's mark", () => {
    const dir = siteWith({ password: true })
    assert.strictEqual(build(dir).status, 0)
    const gate = fs.readFileSync(path.join(dir, ".vercel", "output", "functions", "_middleware.func", "index.js"), "utf8")
    assert.ok(gate.includes(JSON.stringify(`<link rel="icon" href="${MARK}">`).slice(1, -1)))
  })

  test("a password written into basalt.json is refused", () => {
    const result = build(siteWith({ password: "hunter2" }))
    assert.notStrictEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /BASALT_PASSWORD env var/)
  })
})
