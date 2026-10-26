import test, { describe } from "node:test"
import assert from "node:assert"
import { analyticsHtml } from "./analytics.ts"

const built = { built: true, baseUrl: "isaacchacko.com" }

describe("analytics", () => {
  test("nothing while serving, or with none set", () => {
    assert.strictEqual(analyticsHtml({ provider: "vercel" }, { built: false }), "")
    assert.strictEqual(analyticsHtml(undefined, built), "")
  })

  test("vercel: web analytics and speed insights, kept across page changes", () => {
    const html = analyticsHtml({ provider: "vercel" }, built)
    assert.match(html, /<script defer src="\/_vercel\/insights\/script\.js" data-astro-transition-persist="basalt-analytics-va-script">/)
    assert.match(html, /\/_vercel\/speed-insights\/script\.js/)
    assert.doesNotMatch(analyticsHtml({ provider: "vercel", speedInsights: false }, built), /speed-insights/)
  })

  test("plausible counts the site's own domain unless told another", () => {
    assert.match(analyticsHtml({ provider: "plausible" }, built), /data-domain="isaacchacko\.com" src="https:\/\/plausible\.io\/js\/script\.js"/)
    assert.match(analyticsHtml({ provider: "plausible", domain: "x.org", host: "https://p.x.org/" }, built), /data-domain="x\.org" src="https:\/\/p\.x\.org\/js\/script\.js"/)
    assert.strictEqual(analyticsHtml({ provider: "plausible" }, { built: true }), "")
  })

  test("umami, goatcounter and google, with what each needs, escaped", () => {
    assert.match(analyticsHtml({ provider: "umami", websiteId: 'a"b' }, built), /data-website-id="a&quot;b"/)
    const gc = analyticsHtml({ provider: "goatcounter", code: "mysite" }, built)
    assert.match(gc, /data-goatcounter="https:\/\/mysite\.goatcounter\.com\/count"/)
    // the client router's page changes are counted too
    assert.match(gc, /astro:after-swap/)
    const g = analyticsHtml({ provider: "google", tagId: "G-</script>" }, built)
    assert.match(g, /gtag\/js\?id=G-%3C%2Fscript%3E/)
    assert.doesNotMatch(g, /G-<\/script>/)
  })
})
