// GitHub mode's API calls (github.ts), against a stand-in for fetch: the
// requests each makes, what it makes of GitHub's answers, and the wait for a deploy.
import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import { API, GitHubError, base64, deployed, editShaOf, gitHub } from "./github.ts"

type Seen = { url: string; method: string; headers: Record<string, string>; body?: unknown; cache?: string }
const real = globalThis.fetch
let seen: Seen[] = []
/** answers each request with what `answer` gives for it */
function stub(answer: (req: Seen) => { status?: number; body?: unknown }) {
  seen = []
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const req: Seen = {
      url: String(url),
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      cache: init.cache,
    }
    seen.push(req)
    const { status = 200, body = {} } = answer(req)
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  }) as typeof fetch
}
afterEach(() => {
  globalThis.fetch = real
})

const TEXT = "---\ntitle: naïve\n---\n\nUnicode — 💡, and a long line " + "x".repeat(70000) + "\n"

describe("base64", () => {
  test("round-trips utf-8, long text included, and reads GitHub's line-wrapped base64", () => {
    assert.equal(base64.decode(base64.encode(TEXT)), TEXT)
    assert.equal(base64.encode("é"), Buffer.from("é").toString("base64"))
    const wrapped = Buffer.from(TEXT).toString("base64").replace(/(.{60})/g, "$1\n")
    assert.equal(base64.decode(wrapped), TEXT)
  })
})

describe("gitHub", () => {
  const gh = (api?: string) => gitHub("me/garden", "test-token", api)

  test("every call carries the token and GitHub's headers, uncached, to the repo", async () => {
    stub(() => ({ body: { permissions: { push: true } } }))
    await gh().canPush()
    const [req] = seen
    assert.equal(req.url, `${API}/repos/me/garden`)
    assert.equal(req.headers.authorization, "Bearer test-token")
    assert.equal(req.headers.accept, "application/vnd.github+json")
    assert.equal(req.headers["x-github-api-version"], "2022-11-28")
    assert.equal(req.cache, "no-store")
  })

  test("a stand-in's api, for the mock", async () => {
    stub(() => ({ body: { permissions: { push: true } } }))
    await gh("http://127.0.0.1:9/api").canPush()
    assert.equal(seen[0].url, "http://127.0.0.1:9/api/repos/me/garden")
  })

  test("canPush: only a token that may push", async () => {
    stub(() => ({ body: { permissions: { push: true } } }))
    assert.equal(await gh().canPush(), true)
    stub(() => ({ body: { permissions: { push: false, pull: true } } }))
    assert.equal(await gh().canPush(), false)
    stub(() => ({ status: 401, body: { message: "Bad credentials" } }))
    assert.equal(await gh().canPush(), false)
    globalThis.fetch = (async () => {
      throw new TypeError("offline")
    }) as typeof fetch
    assert.equal(await gh().canPush(), false)
  })

  test("read: the note on the branch, its path's parts escaped", async () => {
    stub(() => ({ body: { content: Buffer.from(TEXT).toString("base64").replace(/(.{60})/g, "$1\n"), sha: "a".repeat(40) } }))
    assert.deepEqual(await gh().read("garden/notes/my note #1.md", "feature/x"), { text: TEXT, sha: "a".repeat(40) })
    assert.equal(seen[0].url, `${API}/repos/me/garden/contents/garden/notes/my%20note%20%231.md?ref=feature%2Fx`)
  })

  test("read: an error says GitHub's status, and is a GitHubError with it", async () => {
    stub(() => ({ status: 404, body: { message: "Not Found" } }))
    await assert.rejects(gh().read("a.md", "main"), (err: unknown) => err instanceof GitHubError && err.status === 404 && /404: Not Found/.test(err.message))
    stub(() => ({ status: 401, body: { message: "Bad credentials" } }))
    await assert.rejects(gh().read("a.md", "main"), (err: unknown) => err instanceof GitHubError && err.status === 401)
  })

  test("write: a commit over the version it was read at", async () => {
    stub(() => ({ status: 200, body: { content: { sha: "b".repeat(40) } } }))
    assert.deepEqual(await gh().write("notes/a.md", "main", TEXT, "a".repeat(40), "Edit notes/a.md"), { sha: "b".repeat(40) })
    const [req] = seen
    assert.equal(req.method, "PUT")
    assert.equal(req.url, `${API}/repos/me/garden/contents/notes/a.md`)
    assert.equal(req.headers["content-type"], "application/json")
    const body = req.body as { message: string; content: string; sha: string; branch: string }
    assert.deepEqual({ ...body, content: Buffer.from(body.content, "base64").toString("utf8") }, { message: "Edit notes/a.md", content: TEXT, sha: "a".repeat(40), branch: "main" })
  })

  for (const status of [409, 422]) {
    test(`write: ${status} because it was committed to since gives the note as it is now`, async () => {
      stub((req) => (req.method === "PUT" ? { status, body: { message: "sha does not match" } } : { body: { content: base64.encode("theirs\n"), sha: "c".repeat(40) } }))
      assert.deepEqual(await gh().write("a.md", "main", "mine\n", "a".repeat(40), "m"), { conflict: { text: "theirs\n", sha: "c".repeat(40) } })
      assert.deepEqual(
        seen.map((r) => r.method),
        ["PUT", "GET"],
      )
    })
  }

  test("write: a 422 for something else (the sha is still the base) is an error, not a conflict", async () => {
    stub((req) => (req.method === "PUT" ? { status: 422, body: { message: "Invalid request" } } : { body: { content: base64.encode("same\n"), sha: "a".repeat(40) } }))
    await assert.rejects(gh().write("a.md", "main", "mine\n", "a".repeat(40), "m"), (err: unknown) => err instanceof GitHubError && err.status === 422)
  })

  test("write: no permission is an error", async () => {
    stub(() => ({ status: 403, body: { message: "Resource not accessible by personal access token" } }))
    await assert.rejects(gh().write("a.md", "main", "x", "a".repeat(40), "m"), (err: unknown) => err instanceof GitHubError && err.status === 403)
  })

  test("blob: an older version by its sha", async () => {
    stub(() => ({ body: { content: base64.encode("old\n"), encoding: "base64" } }))
    assert.equal(await gh().blob("d".repeat(40)), "old\n")
    assert.equal(seen[0].url, `${API}/repos/me/garden/git/blobs/${"d".repeat(40)}`)
  })
})

describe("editShaOf", () => {
  test("the article's data-edit-sha, wherever it is among the attributes", () => {
    const sha = "e".repeat(40)
    assert.equal(editShaOf(`<html><body><article class="popover-hint" data-edit="github" data-edit-sha="${sha}" data-edit-slug="a">`), sha)
    assert.equal(editShaOf(`<article data-edit-sha="${sha}">`), sha)
  })

  test("nothing from a page without one, or with something that isn't a sha", () => {
    assert.equal(editShaOf(`<article class="x">`), undefined)
    assert.equal(editShaOf(`<div data-edit-sha="${"e".repeat(40)}">`), undefined)
    assert.equal(editShaOf(`<article data-edit-sha="nope">`), undefined)
  })
})

describe("deployed", () => {
  test("polls till the page is built from the commit waited for", async () => {
    const shas = ["old", "old", "new"]
    let fetched = 0
    const got = await deployed(
      async () => shas[fetched++],
      (p) => p,
      () => ({ sha: "new", since: Date.now() }),
      { every: 1 },
    )
    assert.equal(got, "new")
    assert.equal(fetched, 3)
  })

  test("a page that didn't come (an error) is tried again", async () => {
    const pages = [undefined, "new"]
    let i = 0
    assert.equal(await deployed(async () => pages[i++], (p) => p, () => ({ sha: "new", since: Date.now() }), { every: 1 }), "new")
  })

  test("follows the commit waited for when a newer one is made meanwhile", async () => {
    let want = { sha: "one", since: Date.now() }
    let i = 0
    const pages = ["one", "two"]
    const got = await deployed(
      async () => {
        const p = pages[i++]
        // a second commit lands while the first's page is being fetched
        want = { sha: "two", since: Date.now() }
        return p
      },
      (p) => p,
      () => want,
      { every: 1 },
    )
    assert.equal(got, "two")
  })

  test("nothing to wait for any more: undefined; too long: slow", async () => {
    assert.equal(await deployed(async () => "x", (p) => p, () => null, { every: 1 }), undefined)
    assert.equal(await deployed(async () => "old", (p) => p, () => ({ sha: "new", since: Date.now() - 10_000 }), { every: 1, timeout: 5_000 }), "slow")
  })

  test("ticks once per poll", async () => {
    let ticks = 0
    let i = 0
    await deployed(async () => (++i >= 3 ? "new" : "old"), (p) => p, () => ({ sha: "new", since: Date.now() }), { every: 1, tick: () => ticks++ })
    assert.equal(ticks, 3)
  })
})
