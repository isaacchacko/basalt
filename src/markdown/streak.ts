// A ```streak block: a year of days as GitHub draws contributions, seven rows
// (Sunday on top) by a column a week, ending at this week, each day shaded by
// how much happened on it, with the total, the current streak and the longest
// under it. Its days come from one of
//
//   github: <user>      the user's contributions, from their profile's calendar
//   leetcode: <user>    the user's submissions, from LeetCode's calendar
//   (neither)           the block's own lines, a day each:
//                         2026-10-01               once
//                         2026-10-02: 3            three times
//                         2026-10-05..2026-10-12   each day of it, once
//
// and `title:` (over the grid; GitHub's and LeetCode's name theirs) and
// `weeks:` (53, a year, GitHub's) set it out. A line that's none of these is
// left out, and said so: a warning in the build, and under the grid, so it's
// seen where it's written. In Obsidian it's a code block, and reads as one.
//
// A user's days are fetched at build time, with no key, and kept in the
// site's cache (cache/streaks.json), as a song is (sound.ts). Unlike a song's
// they change daily, so every build fetches them again, and the cache is
// there for when it can't: then the grid says the day they're as of, or, with
// none kept, that the site couldn't reach them. Drawn in the browser
// (browser/render.ts), where neither can be fetched, they're the build's.
//
// Drawn here as an svg; styles/streak.scss shades it from the site's colours.

import fs from "node:fs"
import path from "node:path"
import type { Code, Html, Root } from "mdast"
import type { Element } from "hast"
import type { VFile } from "vfile"
import { fromHtml } from "hast-util-from-html"
import { toString } from "hast-util-to-string"
import { visit } from "unist-util-visit"
import { noteOf, reg } from "./context.ts"

export type Source = "github" | "leetcode"
/** a count a day, by its date (YYYY-MM-DD) */
export type Days = Record<string, number>
/** a user's days as fetched, and the day they were (YYYY-MM-DD) */
export type Fetched = { at: string; days: Days }

export interface Streak {
  source?: { kind: Source; user: string }
  title?: string
  weeks: number
  /** the block's own days (and a fetched user's, added to them) */
  days: Days
  /** the lines that are none of the block's kinds, by their line in it (from 1) */
  bad: { line: number; text: string }[]
}

const NAMES: Record<Source, string> = { github: "GitHub", leetcode: "LeetCode" }
const PROFILES: Record<Source, (user: string) => string> = {
  github: (user) => `https://github.com/${user}`,
  leetcode: (user) => `https://leetcode.com/u/${user}/`,
}
const WEEKS = 53
const DAY = 86_400_000

// ---------- days as numbers: a day's count from 1970, in UTC, so no DST ----------

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** a YYYY-MM-DD date as its day number, or undefined when it isn't a day */
export function dayOf(date: string): number | undefined {
  const m = DATE.exec(date)
  if (!m) return undefined
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3])
  return new Date(t).toISOString().startsWith(date) ? t / DAY : undefined
}

export const dateOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10)

/** the day it is where the site's built */
export function today(): string {
  const now = new Date()
  return dateOf(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY)
}

// ---------- the block ----------

const KEY = /^(github|leetcode|title|weeks)\s*:\s*(.*)$/i
const ENTRY = /^(\d{4}-\d{2}-\d{2})(?:\s*\.\.\s*(\d{4}-\d{2}-\d{2})|\s*:\s*(\d+))?$/

export function parseStreak(source: string): Streak {
  const s: Streak = { weeks: WEEKS, days: {}, bad: [] }
  source.split(/\r?\n/).forEach((raw, i) => {
    const text = raw.trim()
    if (!text) return
    const bad = () => s.bad.push({ line: i + 1, text })
    const entry = ENTRY.exec(text)
    if (entry) {
      const from = dayOf(entry[1])
      const to = entry[2] ? dayOf(entry[2]) : from
      if (from === undefined || to === undefined || to < from) return bad()
      for (let d = from; d <= to; d++) s.days[dateOf(d)] = (s.days[dateOf(d)] ?? 0) + Number(entry[3] ?? 1)
      return
    }
    const key = KEY.exec(text)
    if (!key || !key[2].trim()) return bad()
    const [name, value] = [key[1].toLowerCase(), key[2].trim()]
    if (name === "title") s.title = value
    else if (name === "weeks") {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 1) return bad()
      s.weeks = n
    } else if (s.source) bad()
    else s.source = { kind: name as Source, user: value.replace(/^@/, "") }
  })
  return s
}

// ---------- what the grid says ----------

/**
 * A count's shade, 0 (nothing) to 4, as GitHub's: by the quartiles of the
 * days that have any. When they all have the same, they're all 4.
 */
export function levels(counts: number[]): (n: number) => number {
  const some = counts.filter((n) => n > 0).sort((a, b) => a - b)
  if (!some.length || some[0] === some.at(-1)) return (n) => (n > 0 ? 4 : 0)
  const q = (p: number) => some[Math.ceil(p * some.length) - 1]
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)]
  return (n) => (n <= 0 ? 0 : n <= q1 ? 1 : n <= q2 ? 2 : n <= q3 ? 3 : 4)
}

/** the days from `from` to `to`'s total, the run of days ending on `to` (or the day before, when `to` has none yet) and the longest run */
export function tally(days: Days, from: number, to: number): { total: number; current: number; longest: number } {
  let total = 0
  let run = 0
  let longest = 0
  for (let d = from; d <= to; d++) {
    const n = days[dateOf(d)] ?? 0
    total += n
    run = n > 0 ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  // a run is still going until the day after its last has passed with nothing
  const ending = (days[dateOf(to)] ?? 0) > 0 ? to : to - 1
  let current = 0
  for (let d = ending; d >= from && (days[dateOf(d)] ?? 0) > 0; d--) current++
  return { total, current, longest }
}

// ---------- GitHub's calendar and LeetCode's ----------

/** a profile's contributions calendar (github.com/users/<user>/contributions): each day's cell and its tool-tip's count */
export function githubDays(html: string): Days {
  const tree = fromHtml(html, { fragment: true })
  const dates = new Map<string, string>()
  const tips = new Map<string, string>()
  visit(tree, "element", (el: Element) => {
    const p = el.properties
    if (el.tagName === "td" && typeof p.dataDate === "string" && typeof p.id === "string") dates.set(p.id, p.dataDate)
    if (el.tagName === "tool-tip" && p.htmlFor) tips.set(String(p.htmlFor), toString(el))
  })
  const days: Days = {}
  for (const [id, date] of dates) {
    // "12 contributions on November 9th.", "No contributions on …"
    const n = /^([\d,]+) contributions?\b/.exec(tips.get(id)?.trim() ?? "")?.[1]
    days[date] = n ? Number(n.replace(/,/g, "")) : 0
  }
  return days
}

/** LeetCode's graphql answer, a calendar a year (`y2026: userCalendar(year: 2026)`), as days: its submissionCalendar is JSON, unix seconds (a UTC midnight) to a count */
export function leetcodeDays(answer: unknown): Days | undefined {
  const user = (answer as { data?: { matchedUser?: Record<string, { submissionCalendar?: string } | null> | null } })?.data?.matchedUser
  if (!user) return undefined
  const days: Days = {}
  for (const year of Object.values(user)) {
    const calendar: Record<string, number> = JSON.parse(year?.submissionCalendar || "{}")
    for (const [seconds, n] of Object.entries(calendar)) days[dateOf(Math.floor(Number(seconds) / 86_400))] = n
  }
  return days
}

const timeout = () => AbortSignal.timeout(10_000)

/** GitHub serves a year of a calendar at a time */
async function fetchGithub(user: string, from: number, to: number): Promise<Days | undefined> {
  const days: Days = {}
  for (let a = from; a <= to; a += 365) {
    const b = Math.min(a + 364, to)
    const res = await fetch(`https://github.com/users/${encodeURIComponent(user)}/contributions?from=${dateOf(a)}&to=${dateOf(b)}`, { signal: timeout() })
    if (!res.ok) return undefined
    Object.assign(days, githubDays(await res.text()))
  }
  return days
}

async function fetchLeetcode(user: string, from: number, to: number): Promise<Days | undefined> {
  const years = []
  for (let y = Number(dateOf(from).slice(0, 4)); y <= Number(dateOf(to).slice(0, 4)); y++) years.push(y)
  const query = `query($user: String!) { matchedUser(username: $user) { ${years.map((y) => `y${y}: userCalendar(year: ${y}) { submissionCalendar }`).join(" ")} } }`
  const res = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", referer: "https://leetcode.com" },
    body: JSON.stringify({ query, variables: { user } }),
    signal: timeout(),
  })
  return res.ok ? leetcodeDays(await res.json()) : undefined
}

let online = true

/** Whether a user's days are fetched: not from the browser, which can't (browser/render.ts) and draws the build's. */
export function lookUpStreaks(on: boolean) {
  online = on
}

// a long `basalt dev` fetches again after an hour
const FRESH = 3_600_000
const pending = new Map<string, { since: number; days: Promise<Fetched | undefined> }>()

/** A user's days from `from` to `to`: fetched, else the cache's, else undefined. */
export function fetched(kind: Source, user: string, from: number, to: number): Promise<Fetched | undefined> {
  const key = `${kind}:${user.toLowerCase()}`
  const was = pending.get(key)
  if (was && (!online || Date.now() - was.since < FRESH)) return was.days
  const days = fetchDays(key, kind, user, from, to).catch(() => undefined)
  pending.set(key, { since: Date.now(), days })
  return days
}

async function fetchDays(key: string, kind: Source, user: string, from: number, to: number): Promise<Fetched | undefined> {
  const cacheFile = path.join(reg().site.work, "cache", "streaks.json")
  const cached = (): Record<string, Fetched> => (fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {})
  const days = online ? await (kind === "github" ? fetchGithub : fetchLeetcode)(user, from, to).catch(() => undefined) : undefined
  if (!days) return cached()[key]
  const found = { at: today(), days }
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
  // read again: other users' may have landed while this one was fetched
  fs.writeFileSync(cacheFile, JSON.stringify({ ...cached(), [key]: found }, null, 2))
  return found
}

// ---------- the html ----------

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const CELL = 10
const STEP = 13
const LEFT = 28
const TOP = 15

/** what a day's count is a count of */
function counted(kind: Source | undefined, n: number, locale: string): string {
  const count = n.toLocaleString(locale)
  if (kind === "github") return n === 1 ? "1 contribution" : `${n ? count : "No"} contributions`
  if (kind === "leetcode") return n === 1 ? "1 submission" : `${n ? count : "No"} submissions`
  return n === 0 ? "Nothing" : n === 1 ? "Once" : `${count} times`
}

const daysSaid = (n: number) => (n === 1 ? "1 day" : `${n} days`)

/**
 * The block drawn: its title, the grid of `weeks` weeks to the one `on` is in,
 * and what it adds up to. `user` is a source's days as fetched; a source with
 * none couldn't be reached.
 */
export function streakHtml(s: Streak, on: string, locale = "en-US", user?: Fetched): string {
  const kind = s.source?.kind
  const title = s.title ?? (s.source ? `${NAMES[s.source.kind]} · ${s.source.user}` : undefined)
  const heading = title
    ? `<figcaption class="streak-title">${s.source ? `<a href="${escapeHtml(PROFILES[s.source.kind](s.source.user))}">${escapeHtml(title)}</a>` : escapeHtml(title)}</figcaption>`
    : ""
  const bad = s.bad.length
    ? `<div class="streak-bad">Left out, not a date, a range or a key: ${s.bad.map((b) => `<code>${escapeHtml(b.text)}</code>`).join(", ")}</div>`
    : ""
  const figure = (inner: string) => `<figure class="streak"${kind ? ` data-streak="${kind}"` : ""}>${heading}${inner}${bad}</figure>`
  if (s.source && !user) return figure(`<div class="streak-missing">couldn’t reach ${NAMES[s.source.kind]}</div>`)

  const days: Days = { ...user?.days }
  for (const [date, n] of Object.entries(s.days)) days[date] = (days[date] ?? 0) + n
  const end = dayOf(on)!
  // Sunday of the first week: 1970-01-01 (day 0) was a Thursday
  const start = end - ((end + 4) % 7) - (s.weeks - 1) * 7
  const shown = Array.from({ length: end - start + 1 }, (_, i) => days[dateOf(start + i)] ?? 0)
  const level = levels(shown)

  const longDate = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
  const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" })
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" })
  const cells = shown.map((n, i) => {
    const d = start + i
    const [x, y] = [LEFT + Math.floor(i / 7) * STEP, TOP + (i % 7) * STEP]
    return `<rect class="streak-day" data-level="${level(n)}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2"><title>${escapeHtml(`${counted(kind, n, locale)} on ${longDate.format(d * DAY)}`)}</title></rect>`
  })
  // a month's name over the first week that starts in it, unless the next comes too soon after
  const months: { week: number; name: string }[] = []
  for (let w = 0; w < s.weeks; w++) {
    const sunday = dateOf(start + w * 7)
    if (w === 0 || sunday.slice(5, 7) !== dateOf(start + (w - 1) * 7).slice(5, 7)) months.push({ week: w, name: month.format((start + w * 7) * DAY) })
  }
  const labels = months
    .filter((m, i) => (months[i + 1]?.week ?? s.weeks) - m.week >= 3)
    .map((m) => `<text x="${LEFT + m.week * STEP}" y="${TOP - 5}">${escapeHtml(m.name)}</text>`)
  // Monday, Wednesday and Friday, as GitHub labels them (day 4, 1970-01-05, was a Monday)
  const rows = [1, 3, 5].map((r) => `<text x="0" y="${TOP + r * STEP + CELL - 1}">${escapeHtml(weekday.format((3 + r) * DAY))}</text>`)

  const { total, current, longest } = tally(days, start, end)
  const span = s.weeks === WEEKS ? "in the last year" : `in the last ${s.weeks} weeks`
  const stale = user && user.at !== on ? ` · as of ${longDate.format(dayOf(user.at)! * DAY)}` : ""
  const said = `${counted(kind, total, locale)} ${span} · current streak ${daysSaid(current)} · longest ${daysSaid(longest)}${stale}`
  const width = LEFT + s.weeks * STEP - (STEP - CELL)
  const height = TOP + 7 * STEP - (STEP - CELL)
  // it shrinks to fit its column, to three quarters of its size, then scrolls
  const svg = `<svg class="streak-grid" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="min-width:${Math.round(width * 0.75)}px" role="img" aria-label="${escapeHtml(said)}">${labels.join("")}${rows.join("")}${cells.join("")}</svg>`
  // a row reversed scrolls from its end: the newest week shows first, without a script
  return figure(`<div class="streak-scroll">${svg}</div><div class="streak-stats">${escapeHtml(said)}</div>`)
}

// ---------- the plugin ----------

const warned = new Set<string>()

function warn(file: VFile, s: Streak) {
  const where = noteOf(file)?.rel ?? file.path ?? "a note"
  for (const { line, text } of s.bad) {
    const message = `basalt: ${where}: a streak's line ${line} isn't a date, a range or a key, leaving it out: ${text}`
    if (warned.has(message)) continue
    warned.add(message)
    console.warn(message)
  }
}

export function remarkStreaks() {
  return async (tree: Root, file: VFile) => {
    const blocks: { node: Code; index: number; parent: { children: unknown[] } }[] = []
    visit(tree, "code", (node: Code, index, parent) => {
      if (parent && index !== undefined && node.lang?.toLowerCase() === "streak") blocks.push({ node, index, parent })
    })
    const on = today()
    const locale = reg().site.config.locale
    await Promise.all(
      blocks.map(async ({ node, index, parent }) => {
        const s = parseStreak(node.value)
        warn(file, s)
        const end = dayOf(on)!
        const user = s.source ? await fetched(s.source.kind, s.source.user, end - s.weeks * 7, end) : undefined
        // in the browser, a user the build hasn't fetched: render.ts's stand-in, so the block shows its lines
        const html = s.source && !user && !online ? '<figure class="streak"><basalt-undrawn></basalt-undrawn></figure>' : streakHtml(s, on, locale, user)
        parent.children[index] = { type: "html", value: html } satisfies Html
      }),
    )
  }
}
