// ```streak: its lines, the shades, the streaks, GitHub's and LeetCode's
// calendars (as recorded, in fixtures/) and the grid.
import "./test-hooks.ts"
import test from "node:test"
import assert from "node:assert"
import fs from "node:fs"

const { parseStreak, levels, tally, dayOf, dateOf, githubDays, leetcodeDays, streakHtml } = await import("./streak.ts")

const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")

test("a block's keys, its days and ranges, and what's neither", () => {
  const s = parseStreak("title: Pushups\nweeks: 10\n\n2026-10-01\n2026-10-02: 3\n2026-10-05..2026-10-07\n2026-10-06: 2\nyesterday\n2026-02-30\n2026-10-09..2026-10-08")
  assert.strictEqual(s.title, "Pushups")
  assert.strictEqual(s.weeks, 10)
  assert.strictEqual(s.source, undefined)
  assert.deepStrictEqual(s.days, { "2026-10-01": 1, "2026-10-02": 3, "2026-10-05": 1, "2026-10-06": 3, "2026-10-07": 1 })
  assert.deepStrictEqual(s.bad, [
    { line: 8, text: "yesterday" },
    { line: 9, text: "2026-02-30" },
    { line: 10, text: "2026-10-09..2026-10-08" },
  ])
})

test("one source, a user each; a second is a bad line", () => {
  const s = parseStreak("github: @isaacchacko\nleetcode: isaacchacko\nweeks: none")
  assert.deepStrictEqual(s.source, { kind: "github", user: "isaacchacko" })
  assert.strictEqual(s.weeks, 53)
  assert.deepStrictEqual(s.bad.map((b) => b.line), [2, 3])
})

test("shades are the quartiles of the days that have any, as GitHub's", () => {
  const level = levels([0, 0, 1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map(level), [0, 1, 1, 2, 2, 3, 3, 4, 4])
  // all alike, every day with any is done
  assert.deepStrictEqual([0, 1].map(levels([1, 1, 0, 1])), [0, 4])
  assert.strictEqual(levels([])(0), 0)
})

test("the total, the run still going and the longest", () => {
  const d = (date: string) => dayOf(date)!
  const days = { "2026-10-01": 2, "2026-10-02": 1, "2026-10-03": 1, "2026-10-05": 4, "2026-10-06": 1 }
  // today (the 7th) has nothing yet: the run to yesterday still counts
  assert.deepStrictEqual(tally(days, d("2026-09-28"), d("2026-10-07")), { total: 9, current: 2, longest: 3 })
  assert.deepStrictEqual(tally(days, d("2026-09-28"), d("2026-10-06")), { total: 9, current: 2, longest: 3 })
  assert.deepStrictEqual(tally(days, d("2026-09-28"), d("2026-10-08")), { total: 9, current: 0, longest: 3 })
})

test("dates are days, and only real ones", () => {
  assert.strictEqual(dateOf(dayOf("2026-03-08")! + 1), "2026-03-09")
  assert.strictEqual(dayOf("2026-13-01"), undefined)
  assert.strictEqual(dayOf("2026-1-01"), undefined)
})

test("GitHub's calendar: a day's cell and its tool-tip's count", () => {
  assert.deepStrictEqual(githubDays(fixture("streak-github.html")), {
    "2025-10-26": 0,
    "2025-11-09": 12,
    "2026-01-18": 1,
    "2026-10-25": 305,
    "2026-10-27": 127,
  })
})

test("LeetCode's calendars, a year each, as days", () => {
  const days = leetcodeDays(JSON.parse(fixture("streak-leetcode.json")))!
  assert.strictEqual(days["2025-08-26"], 93)
  assert.strictEqual(days["2026-10-17"], 11)
  assert.strictEqual(days["2026-10-20"], 46)
  assert.strictEqual(Object.keys(days).length, 14)
  assert.strictEqual(leetcodeDays({ data: { matchedUser: null } }), undefined)
})

test("the grid: a column a week to this one, Sunday on top, each day said", () => {
  const s = parseStreak("title: Pushups\nweeks: 2\n2026-10-20\n2026-10-21: 3\n2026-10-22..2026-10-28")
  const html = streakHtml(s, "2026-10-28")
  // the 18th (a Sunday) to the 28th (a Wednesday): no days to come
  assert.strictEqual(html.match(/<rect /g)?.length, 11)
  assert.match(html, /^<figure class="streak"><figcaption class="streak-title">Pushups<\/figcaption><div class="streak-scroll"><svg class="streak-grid"/)
  assert.match(html, /<rect class="streak-day" data-level="0" x="28" y="15" width="10" height="10" rx="2"><title>Nothing on Oct 18, 2026<\/title><\/rect>/)
  assert.match(html, /data-level="1" x="28" y="41" [^>]*><title>Once on Oct 20, 2026</)
  assert.match(html, /data-level="4" x="28" y="54" [^>]*><title>3 times on Oct 21, 2026</)
  assert.match(html, /data-level="1" x="41" y="54" [^>]*><title>Once on Oct 28, 2026<\/title><\/rect><\/svg>/)
  assert.match(html, /<div class="streak-stats">11 times in the last 2 weeks · current streak 9 days · longest 9 days<\/div><\/figure>$/)
})

test("a user's grid: named and linked, and dated when it isn't today's", () => {
  const s = parseStreak("github: isaacchacko")
  const html = streakHtml(s, "2026-10-28", "en-US", { at: "2026-10-20", days: { "2026-10-19": 4 } })
  assert.match(html, /^<figure class="streak" data-streak="github"><figcaption class="streak-title"><a href="https:\/\/github.com\/isaacchacko">GitHub · isaacchacko<\/a>/)
  assert.match(html, /<title>4 contributions on Oct 19, 2026<\/title>/)
  assert.match(html, /4 contributions in the last year · current streak 0 days · longest 1 day · as of Oct 20, 2026</)
  // the year's months over the weeks they start, and the days of the week down the side
  assert.match(html, />Nov<\/text>.*>Oct<\/text><text x="0" y="37">Mon<\/text><text x="0" y="63">Wed<\/text><text x="0" y="89">Fri<\/text>/)
  assert.strictEqual(streakHtml(parseStreak("leetcode: nobody"), "2026-10-28"), '<figure class="streak" data-streak="leetcode"><figcaption class="streak-title"><a href="https://leetcode.com/u/nobody/">LeetCode · nobody</a></figcaption><div class="streak-missing">couldn’t reach LeetCode</div></figure>')
})
