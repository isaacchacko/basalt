import "../markdown/test-hooks.ts"
import test, { describe } from "node:test"
import assert from "node:assert"
const { say, strings } = await import("./strings.ts")
const { ordered, inFeed, defaults } = await import("./config.ts")

describe("strings", () => {
  test("Basalt's own, unless the site sets one", () => {
    assert.strictEqual(say({}, "explorer"), "Explorer")
    assert.strictEqual(say({ explorer: "the garden" }, "explorer"), "the garden")
    assert.strictEqual(say({ explorer: "the garden" }, "search"), strings.search)
  })

  test("counts take the form for one or many, and fill in their names", () => {
    assert.strictEqual(say({}, "tagCount", { n: 1 }), "1 tag in all")
    assert.strictEqual(say({}, "tagCount", { n: 0 }), "0 tags in all")
    assert.strictEqual(say({}, "tag", { tag: "math" }), "Tag: math")
    assert.strictEqual(say({ minRead: "{n} min" }, "minRead", { n: 4 }), "4 min")
    assert.strictEqual(say({}, "feed", { n: 10, title: "a site" }), "The last 10 notes on a site")
  })
})

describe("the explorer's order", () => {
  const nodes = ["blog", "about", "arch", "library", "now", "running"].map((slug) => ({ slug }))
  test("listed slugs first, in order; the rest as they were", () => {
    const sort = ordered<{ slug: string }>(["about", "now", "blog", "library", "running", "arch"], () => 0)
    assert.deepStrictEqual([...nodes].sort(sort).map((n) => n.slug), ["about", "now", "blog", "library", "running", "arch"])
    const some = ordered<{ slug: string }>(["now", "/arch/"], () => 0)
    assert.deepStrictEqual([...nodes].sort(some).map((n) => n.slug), ["now", "arch", "blog", "about", "library", "running"])
  })
  test("home is always first", () => {
    const sort = ordered<{ slug: string }>(["about", "index"], () => 0)
    assert.deepStrictEqual([{ slug: "about" }, { slug: "blog" }, { slug: "index" }].sort(sort).map((n) => n.slug), ["index", "about", "blog"])
  })
  test("no order keeps Basalt's", () => {
    const sort = ordered<{ slug: string }>([], () => 0)
    assert.deepStrictEqual([...nodes].sort(sort), nodes)
  })
})

describe("the feed's folders", () => {
  const cfg = (folders: string[]) => ({ ...defaults, feed: { folders } })
  test("every note when none are listed", () => {
    assert.ok(inFeed("about", cfg([])))
    assert.ok(inFeed("blog/a-post", cfg([])))
  })
  test("only the notes under them, not their index", () => {
    assert.ok(inFeed("blog/a-post", cfg(["blog"])))
    assert.ok(inFeed("blog/2026/a-post", cfg(["/blog/"])))
    assert.ok(!inFeed("blog/index", cfg(["blog"])))
    assert.ok(!inFeed("about", cfg(["blog"])))
    assert.ok(!inFeed("blogroll", cfg(["blog"])))
  })
})
