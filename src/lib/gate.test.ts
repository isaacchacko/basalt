import test, { describe } from "node:test"
import assert from "node:assert"
import { COOKIE, gate, LOGIN, LOGOUT, session } from "./gate.ts"

const page = "<form>{{message}}<input name=next value=\"{{next}}\"></form>"
const opts = { password: "correct horse", page, wrong: "That isn't the password." }
const site = "https://notes.example.com"

const get = (path: string, cookie?: string) => new Request(site + path, { headers: cookie ? { cookie } : {} })
const login = (password: string, next = "/") =>
  new Request(site + LOGIN, { method: "POST", body: new URLSearchParams({ password, next }) })
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1"

describe("gate", () => {
  test("without the cookie, anything asked for is the login page, unstored", async () => {
    for (const path of ["/", "/a-note", "/static/contentIndex.json", "/_astro/Page.css", "/nowhere"]) {
      const res = await gate(get(path), opts)
      assert.strictEqual(res.status, 401, path)
      assert.ok(!passes(res), path)
      assert.strictEqual(res.headers.get("cache-control"), "no-store")
      assert.match(await res.text(), new RegExp(`value="${path.replace(/[.]/g, "\\.")}"`))
    }
  })

  test("the right password sets the cookie and goes back where the reader was going", async () => {
    const res = await gate(login("correct horse", "/notes/a?x=1"), opts)
    assert.strictEqual(res.status, 303)
    assert.strictEqual(res.headers.get("location"), "/notes/a?x=1")
    const set = res.headers.get("set-cookie")!
    assert.match(set, new RegExp(`^${COOKIE}=\\d+\\.[\\w-]+; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure$`))
    const cookie = set.split(";")[0]
    assert.ok(passes(await gate(get("/notes/a", cookie), opts)))
    assert.ok(passes(await gate(get("/static/contentIndex.json", `theme=dark; ${cookie}`), opts)))
  })

  test("a wrong password is the login page again, saying so", async () => {
    const res = await gate(login("hunter2", "/a"), opts)
    assert.strictEqual(res.status, 401)
    assert.ok(!res.headers.get("set-cookie"))
    const html = await res.text()
    assert.match(html, /That isn't the password\./)
    assert.match(html, /value="\/a"/)
  })

  test("it goes back only to a path on the site", async () => {
    for (const next of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      const res = await gate(login("correct horse", next), opts)
      assert.strictEqual(res.headers.get("location"), "/", next)
    }
  })

  test("a forged, expired or old-password cookie doesn't get in", async () => {
    const now = Date.now()
    const forged = `${COOKIE}=${now + 1e6}.AAAA`
    const expired = `${COOKIE}=${await session("correct horse", now - 1)}`
    const old = `${COOKIE}=${await session("an old password", now + 1e6)}`
    for (const cookie of [forged, expired, old, `${COOKIE}=`, `${COOKIE}=garbage`]) {
      assert.strictEqual((await gate(get("/", cookie), opts)).status, 401, cookie)
    }
  })

  test("logging out clears the cookie", async () => {
    const res = await gate(get(LOGOUT), opts)
    assert.strictEqual(res.status, 303)
    assert.match(res.headers.get("set-cookie")!, new RegExp(`^${COOKIE}=; Path=/; Max-Age=0`))
  })

  test("without BASALT_PASSWORD it lets no one in", async () => {
    const none = { ...opts, password: undefined }
    assert.strictEqual((await gate(get("/"), none)).status, 503)
    assert.strictEqual((await gate(login(""), none)).status, 503)
    assert.strictEqual((await gate(login("undefined"), none)).status, 503)
  })

  test("what's put in the page is escaped, \"$\" and all", async () => {
    const html = await (await gate(get('/a"><script>$&$\''), opts)).text()
    assert.doesNotMatch(html, /<script>/)
    assert.match(html, /\$&amp;\$/)
  })
})
