// A note's history: the commits that touched its file (renames followed,
// gitdates.ts), and the note as it was at each, rendered as its page renders
// it, with what that commit changed marked: added text in <ins>, removed text
// in <del>, a block wholly added or removed classed history-added or
// history-removed. While serving, the dev server answers for it
// (integrations/history.ts); a build writes it out (pages/static/history).
//
// A commit's changes are against the commit before it that touched the note
// (its base). Its blocks are paired with the base's by the lines they came
// from (data-src, markdown/lines.ts) and a line diff of the two texts; inside
// a pair, the words are diffed (jsdiff), and a list's items first.

import path from "node:path"
import { execFileSync } from "node:child_process"
import type { Element, ElementContent, Root, RootContent, Text } from "hast"
import { fromHtml } from "hast-util-from-html"
import { toHtml } from "hast-util-to-html"
import { toString } from "hast-util-to-string"
import { diffArrays, diffWords } from "diff"
import { commitsOf, topOf, type Commit } from "./gitdates.ts"
import { commonLines } from "./linemap.ts"
import { deepen } from "./deepen.ts"
import { serving } from "./edit.ts"
import { sourceDirs, type Site } from "./site.ts"

/** a built site's history of a note: its newest commits, no more */
export const MOST = 100

export interface Commits {
  slug: string
  /** false: older commits aren't here (a shallow clone, or more than MOST) */
  complete: boolean
  commits: { sha: string; date: string; subject: string; author: string; path: string; change: Commit["change"] }[]
}

export interface Version {
  sha: string
  /** the commit before it that touched the note, which its changes are against */
  base: string | null
  path: string
  /** rendered, with its changes marked */
  html: string
  /** rendered */
  plain: string
}

/** Whether a note's page shows its history: its frontmatter's `history`, else the site's (while serving unless false; built when true). */
export function historyOn(site: Site, frontmatter: Record<string, unknown> | undefined): boolean {
  const own = frontmatter?.history
  if (typeof own === "boolean") return own
  return serving() ? site.config.history !== false : site.config.history === true
}

const git = (cwd: string, args: string[]) =>
  execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 })

/** The commits that touched a note, newest first (at most `most`). */
export function commitsFor(site: Site, abs: string, slug: string, most = Infinity): Commits {
  const all = commitsOf(abs, sourceDirs(site))
  const top = topOf(path.dirname(abs))
  // a shallow clone (deepen.ts couldn't fetch the rest): history before the commit it starts at isn't here
  const cut = top ? deepen(top).boundary : new Set<string>()
  const shown = all.slice(0, most)
  return {
    slug,
    complete: shown.length === all.length && !(all.length && cut.has(all.at(-1)!.sha)),
    commits: shown.map((c) => ({ sha: c.sha, date: new Date(c.t).toISOString(), subject: c.subject, author: c.author, path: c.path, change: c.change })),
  }
}

/** The note as it was at `sha`, rendered (`render`: markdown/rendernote.ts), with that commit's changes marked; undefined for a commit that didn't touch it. */
export async function versionAt(site: Site, abs: string, sha: string, render: (abs: string, text: string) => Promise<string>): Promise<Version | undefined> {
  const all = commitsOf(abs, sourceDirs(site))
  const i = all.findIndex((c) => c.sha === sha)
  const top = topOf(path.dirname(abs))
  if (i < 0 || !top) return undefined
  const at = all[i]
  const base = all[i + 1]
  const [text, html] = await renderedAt(top, abs, at, render)
  const [was, wasHtml] = base ? await renderedAt(top, abs, base, render) : ["", ""]
  return { sha: at.sha, base: base?.sha ?? null, path: at.path, html: marked(was, wasHtml, text, html), plain: html }
}

// a commit's text and its rendering: each is a version and the base of the one after
const renderings = new Map<string, Promise<[string, string]>>()
function renderedAt(top: string, abs: string, c: Commit, render: (abs: string, text: string) => Promise<string>) {
  const key = `${abs}\0${c.sha}`
  let got = renderings.get(key)
  if (!got) {
    const text = git(top, ["show", `${c.sha}:${c.path}`])
    got = render(abs, text).then((html) => [text, html])
    renderings.set(key, got)
  }
  return got
}

// ---------- the marks ----------

type Block = { el: Element; from: number; to: number }

const lf = (s: string) => s.replace(/\r\n?/g, "\n")

/** the top-level blocks of a rendering, with the lines (0-based, inclusive) of the text they came from */
function blocksOf(root: Root): Block[] {
  return root.children.flatMap((n) => {
    if (n.type !== "element") return []
    const m = /^(\d+)-(\d+)$/.exec(String(n.properties?.dataSrc ?? ""))
    return m ? [{ el: n, from: Number(m[1]) - 1, to: Number(m[2]) - 1 }] : []
  })
}

/** what a word diff can't be read into: drawn from what's written (math, a diagram) or a frame */
const opaque = (el: Element): boolean =>
  el.children.some((c) => c.type === "element" && (c.tagName === "iframe" || c.tagName === "video" || c.tagName === "audio" || [c.properties?.className].flat().some((k) => k === "katex" || k === "katex-display" || k === "mermaid") || opaque(c)))

const classed = (el: Element, name: string): Element => ({ ...el, properties: { ...el.properties, className: [...[el.properties?.className ?? []].flat(), name] as string[] } })

/** a block of the base's, shown where it was: no id or lines of its own (they're the version's) */
function removed(el: Element): Element {
  const strip = (e: Element): Element => {
    const { id, dataSrc, ...rest } = e.properties ?? {}
    void id
    void dataSrc
    return { ...e, properties: rest, children: e.children.map((c) => (c.type === "element" ? strip(c) : c)) }
  }
  return classed(strip(el), "history-removed")
}

/**
 * The version's rendering (`html`, of `text`) with what changed since the
 * base's (`wasHtml`, of `was`) marked. Both renderings' blocks carry their
 * lines (data-src).
 */
export function marked(was: string, wasHtml: string, text: string, html: string): string {
  const before = fromHtml(wasHtml, { fragment: true })
  const after = fromHtml(html, { fragment: true })
  const A = lf(was).split("\n")
  const B = lf(text).split("\n")
  const a = blocksOf(before)
  const b = blocksOf(after)
  const blockAt = (blocks: Block[], n: number) => {
    const at = new Int32Array(n).fill(-1)
    blocks.forEach((k, i) => {
      for (let l = k.from; l <= k.to && l < n; l++) at[l] = i
    })
    return at
  }
  const inA = blockAt(a, A.length)
  const inB = blockAt(b, B.length)

  // blocks that share a line, or a stretch that changed, are one group
  const parent = [...a.map((_, i) => i), ...b.map((_, i) => a.length + i)]
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  const join = (x: number, y: number) => void (parent[find(x)] = find(y))
  const changedA = new Set<number>()
  const changedB = new Set<number>()
  const common = commonLines(A, B)
  let i0 = -1
  let j0 = -1
  for (const [i, j] of [...common, [A.length, B.length] as [number, number]]) {
    const gone = [...new Set(Array.from({ length: i - i0 - 1 }, (_, k) => inA[i0 + 1 + k]).filter((x) => x >= 0))]
    const come = [...new Set(Array.from({ length: j - j0 - 1 }, (_, k) => inB[j0 + 1 + k]).filter((x) => x >= 0))]
    gone.forEach((x) => changedA.add(x))
    come.forEach((y) => changedB.add(y))
    for (const x of gone) for (const y of come) join(x, a.length + y)
    if (i < A.length && inA[i] >= 0 && inB[j] >= 0) join(inA[i], a.length + inB[j])
    i0 = i
    j0 = j
  }
  const groups = new Map<number, { a: number[]; b: number[] }>()
  const group = (x: number) => groups.get(find(x)) ?? groups.set(find(x), { a: [], b: [] }).get(find(x))!
  a.forEach((_, i) => group(i).a.push(i))
  b.forEach((_, j) => group(a.length + j).b.push(j))

  // each of the version's blocks, as it's shown; and the base's blocks shown before it
  const shown = new Map<Element, ElementContent[]>()
  const before_ = new Map<Element, Element[]>()
  const atEnd: Element[] = []
  // where a block of the base's that's gone goes: before the version's first block after it
  const placeOf = (x: number): Element | undefined => {
    const next = common.find(([i]) => i > a[x].to)
    const line = next ? next[1] : B.length
    return b.find((k) => k.from >= line)?.el
  }
  const put = (x: number, at?: Element) => {
    const el = removed(a[x].el)
    if (at) before_.set(at, [...(before_.get(at) ?? []), el])
    else atEnd.push(el)
  }
  for (const g of groups.values()) {
    const changed = g.a.some((x) => changedA.has(x)) || g.b.some((y) => changedB.has(y))
    if (!changed) continue
    if (!g.b.length) g.a.forEach((x) => put(x, placeOf(x)))
    else if (!g.a.length) g.b.forEach((y) => shown.set(b[y].el, [classed(b[y].el, "history-added")]))
    else {
      const pairs = Math.min(g.a.length, g.b.length)
      g.a.slice(pairs).forEach((x) => put(x, b[g.b[g.b.length - 1]].el))
      g.b.slice(pairs).forEach((y) => shown.set(b[y].el, [classed(b[y].el, "history-added")]))
      for (let k = 0; k < pairs; k++) {
        const old = a[g.a[k]].el
        const now = b[g.b[k]].el
        if (old.tagName !== now.tagName || opaque(old) || opaque(now)) {
          put(g.a[k], now)
          shown.set(now, [classed(now, "history-added")])
        } else shown.set(now, [words(old, now)])
      }
    }
  }

  const children: RootContent[] = []
  for (const n of after.children) {
    if (n.type === "element") {
      children.push(...(before_.get(n) ?? []))
      children.push(...((shown.get(n) as RootContent[] | undefined) ?? [n]))
    } else children.push(n)
  }
  children.push(...atEnd)
  return toHtml({ type: "root", children })
}

/** `now`, with the words it has that `old` hadn't in <ins>, and those it lost in <del>; a list item by item */
function words(old: Element, now: Element): Element {
  if ((now.tagName === "ul" || now.tagName === "ol") && old.tagName === now.tagName) return items(old, now)
  return inline(old, now)
}

/** a list's items paired by their text: an item gone or come whole, the rest word by word */
function items(old: Element, now: Element): Element {
  const li = (e: Element) => e.children.filter((c): c is Element => c.type === "element" && c.tagName === "li")
  const was = li(old)
  const is = li(now)
  const parts = diffArrays(was.map((e) => toString(e).trim()), is.map((e) => toString(e).trim()))
  const out: Element[] = []
  let x = 0
  let y = 0
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p]
    const n = part.count ?? part.value.length
    if (part.removed && parts[p + 1]?.added) {
      // items changed in place: word by word, pair by pair, the rest whole
      const next = parts[p + 1]
      const m = next.count ?? next.value.length
      for (let k = 0; k < Math.max(n, m); k++) {
        if (k < n && k < m) out.push(inline(was[x + k], is[y + k]))
        else if (k < n) out.push(removed(was[x + k]))
        else out.push(classed(is[y + k], "history-added"))
      }
      x += n
      y += m
      p++
    } else if (part.removed) {
      for (let k = 0; k < n; k++) out.push(removed(was[x + k]))
      x += n
    } else if (part.added) {
      for (let k = 0; k < n; k++) out.push(classed(is[y + k], "history-added"))
      y += n
    } else {
      for (let k = 0; k < n; k++) out.push(is[y + k])
      x += n
      y += n
    }
  }
  const children: ElementContent[] = []
  for (const e of out) children.push({ type: "text", value: "\n" }, e)
  children.push({ type: "text", value: "\n" })
  return { ...now, children }
}

const blank = (s: string) => !s.trim()

/** a sidenote or a margin note in a paragraph (markdown/margin.ts): the margin shows it, beside its line */
const isNote = (e: Element) => [e.properties?.className].flat().some((k) => k === "sidenote" || k === "marginnote")

/** a block's text, its texts, and the notes in it with where they are in its text (theirs isn't in it) */
function walk(block: Element) {
  const texts: Text[] = []
  const notes: { el: Element; at: number }[] = []
  let text = ""
  const go = (e: Element) => {
    for (const c of e.children) {
      if (c.type === "text") {
        texts.push(c)
        text += c.value
      } else if (c.type === "element") {
        if (isNote(c)) notes.push({ el: c, at: text.length })
        else go(c)
      }
    }
  }
  go(block)
  return { texts, notes, text }
}

type Gone = { at: number; value?: string; el?: Element }

/**
 * `now` with its text's changes from `old`'s marked in place, in its own
 * elements. Its notes are paired with `old`'s apart from its text: one in
 * both marked inside, one gone put back struck where it was (the margin
 * shows it, and its text doesn't run into the paragraph's), one new marked whole.
 */
function inline(old: Element, now: Element): Element {
  const was = walk(old)
  const is = walk(now)
  // where each text is in the whole, and the changes, by where they are in the new text
  const starts = new Map<Text, number>()
  let total = 0
  for (const t of is.texts) {
    starts.set(t, total)
    total += t.value.length
  }
  const parts = diffWords(was.text, is.text)
  const added: [number, number][] = []
  const gone: Gone[] = []
  let at = 0
  for (const part of parts) {
    if (part.added) added.push([at, (at += part.value.length)])
    else if (part.removed) {
      if (!blank(part.value)) gone.push({ at, value: part.value })
    } else at += part.value.length
  }
  /** where a place in the old text is in the new */
  const moved = (p: number) => {
    let o = 0
    let n = 0
    for (const part of parts) {
      const len = part.value.length
      if (part.added) n += len
      else if (part.removed) {
        if (p <= o + len) return n
        o += len
      } else {
        if (p <= o + len) return n + (p - o)
        o += len
        n += len
      }
    }
    return n
  }
  // the notes, by their footnote (else their text)
  const key = (n: { el: Element }) => String(n.el.properties?.dataSidenote ?? toString(n.el))
  const instead = new Map<Element, Element>()
  let x = 0
  let y = 0
  const pairs = diffArrays(was.notes.map(key), is.notes.map(key))
  for (let p = 0; p < pairs.length; p++) {
    const part = pairs[p]
    const n = part.count ?? part.value.length
    if (part.removed && pairs[p + 1]?.added) {
      // changed in place: pair by pair, the rest whole
      const m = pairs[p + 1].count ?? pairs[p + 1].value.length
      for (let k = 0; k < Math.max(n, m); k++) {
        if (k < n && k < m) instead.set(is.notes[y + k].el, inline(was.notes[x + k].el, is.notes[y + k].el))
        else if (k < n) gone.push({ at: moved(was.notes[x + k].at), el: removed(was.notes[x + k].el) })
        else instead.set(is.notes[y + k].el, classed(is.notes[y + k].el, "history-added"))
      }
      x += n
      y += m
      p++
    } else if (part.removed) {
      for (let k = 0; k < n; k++) gone.push({ at: moved(was.notes[x + k].at), el: removed(was.notes[x + k].el) })
      x += n
    } else if (part.added) {
      for (let k = 0; k < n; k++) instead.set(is.notes[y + k].el, classed(is.notes[y + k].el, "history-added"))
      y += n
    } else {
      for (let k = 0; k < n; k++) instead.set(is.notes[y + k].el, inline(was.notes[x + k].el, is.notes[y + k].el))
      x += n
      y += n
    }
  }
  // a removal goes in the text with words in it that it's in, or at the end of (not into the start of
  // the next: a footnote's number, a link), else the first after it (not between a list's items);
  // words struck before a note struck at the same place (its number, then it)
  gone.sort((a, b) => a.at - b.at || Number(!!a.el) - Number(!!b.el))
  const worded = is.texts.filter((t) => !blank(t.value))
  const home = new Map<Text, Gone[]>()
  const left: Gone[] = []
  for (const g of gone) {
    const t =
      worded.find((t) => starts.get(t)! < g.at && g.at <= starts.get(t)! + t.value.length) ??
      worded.find((t) => starts.get(t)! + t.value.length > g.at)
    if (t) home.set(t, [...(home.get(t) ?? []), g])
    else left.push(g)
  }
  // the words struck, the spaces round them kept, so they stand apart from the words beside them
  const del = (g: Gone): ElementContent[] => {
    if (g.el) return [g.el]
    const [, lead, words, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(g.value!)!
    const struck: Element = { type: "element", tagName: "del", properties: {}, children: [{ type: "text", value: words }] }
    return [...(lead ? [{ type: "text" as const, value: " " }] : []), struck, ...(trail ? [{ type: "text" as const, value: " " }] : [])]
  }
  const ins = (value: string): Element => ({ type: "element", tagName: "ins", properties: {}, children: [{ type: "text", value }] })
  const marks = (t: Text): ElementContent[] => {
    const s = starts.get(t)!
    const e = s + t.value.length
    if (blank(t.value)) return [t]
    const cuts = new Set([s, e])
    for (const [x, y] of added) {
      if (x > s && x < e) cuts.add(x)
      if (y > s && y < e) cuts.add(y)
    }
    for (const g of home.get(t) ?? []) if (g.at > s && g.at < e) cuts.add(g.at)
    const points = [...cuts].sort((p, q) => p - q)
    const out: ElementContent[] = []
    for (let k = 0; k < points.length - 1; k++) {
      const [x, y] = [points[k], points[k + 1]]
      for (const g of home.get(t) ?? []) if (Math.max(g.at, s) === x && g.at < e) out.push(...del(g))
      const value = t.value.slice(x - s, y - s)
      if (!added.some(([p, q]) => x >= p && y <= q) || blank(value)) out.push({ type: "text", value })
      else {
        // the words marked, the spaces round them not
        const [, lead, words, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(value)!
        if (lead) out.push({ type: "text", value: lead })
        out.push(ins(words))
        if (trail) out.push({ type: "text", value: trail })
      }
    }
    for (const g of home.get(t) ?? []) if (g.at >= e) out.push(...del(g))
    return out
  }
  const rewrite = (e: Element): Element => ({
    ...e,
    children: e.children.flatMap((c) => (c.type === "text" ? marks(c) : c.type === "element" ? [isNote(c) ? (instead.get(c) ?? c) : rewrite(c)] : [c])),
  })
  const out = rewrite(now)
  if (left.length) out.children.push(...left.flatMap(del))
  return out
}
