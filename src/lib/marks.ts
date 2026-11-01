// What changed between two renderings of a note, marked in the newer one:
// added text in <ins>, removed text in <del>, a block wholly added or removed
// classed history-added or history-removed. A note's history marks each
// commit's changes this way (history.ts).

import type { Element, ElementContent, Root, RootContent, Text } from "hast"
import { fromHtml } from "hast-util-from-html"
import { toHtml } from "hast-util-to-html"
import { toString } from "hast-util-to-string"
import { diffArrays, diffWords } from "diff"
import { commonLines } from "./linemap.ts"

/** a block, and the stretches of lines (0-based, inclusive) it came from */
type Block = { el: Element; lines: [number, number][]; from: number; to: number }

const lf = (s: string) => s.replace(/\r\n?/g, "\n")

const linesOf = (e: Element): [number, number] | undefined => {
  const m = /^(\d+)-(\d+)$/.exec(String(e.properties?.dataSrc ?? ""))
  return m ? [Number(m[1]) - 1, Number(m[2]) - 1] : undefined
}

const isFootnotes = (e: Element) => e.tagName === "section" && (e.properties?.dataFootnotes !== undefined || [e.properties?.className].flat().includes("footnotes"))

/** the footnotes' list: its items are the definitions */
const footnoteList = (e: Element) => e.children.find((c): c is Element => c.type === "element" && (c.tagName === "ol" || c.tagName === "ul"))

/**
 * The top-level blocks of a rendering, with the lines of the text they came
 * from. The footnotes came from each definition's own line, wherever it's
 * written, not all the lines from the first to the last (the paragraphs
 * between are theirs).
 */
function blocksOf(root: Root): Block[] {
  return root.children.flatMap((n) => {
    if (n.type !== "element") return []
    const own = linesOf(n)
    if (!own) return []
    const items = isFootnotes(n) ? (footnoteList(n)?.children ?? []).flatMap((c) => (c.type === "element" && linesOf(c) ? [linesOf(c)!] : [])) : []
    const lines = items.length ? items : [own]
    return [{ el: n, lines, from: Math.min(...lines.map((l) => l[0])), to: Math.max(...lines.map((l) => l[1])) }]
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
      for (const [from, to] of k.lines) for (let l = from; l <= to && l < n; l++) at[l] = i
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
      // paired in order, kind with kind (a paragraph with a paragraph, the footnotes with the footnotes); the rest whole
      const kind = (e: Element) => (isFootnotes(e) ? "footnotes" : e.tagName)
      const ga = g.a.map((x) => kind(a[x].el))
      const gb = g.b.map((y) => kind(b[y].el))
      let x = 0
      let y = 0
      const pair = (i: number, j: number) => {
        const old = a[i].el
        const now = b[j].el
        if (old.tagName !== now.tagName || opaque(old) || opaque(now)) {
          put(i, now)
          shown.set(now, [classed(now, "history-added")])
        } else shown.set(now, [words(old, now)])
      }
      const parts = diffArrays(ga, gb)
      for (let p = 0; p < parts.length; p++) {
        const part = parts[p]
        const n = part.count ?? part.value.length
        if (part.removed && parts[p + 1]?.added) {
          const m = parts[p + 1].count ?? parts[p + 1].value.length
          for (let k = 0; k < Math.max(n, m); k++) {
            if (k < n && k < m) pair(g.a[x + k], g.b[y + k])
            else if (k < n) put(g.a[x + k], b[g.b[Math.min(y + m, g.b.length) - 1]].el)
            else shown.set(b[g.b[y + k]].el, [classed(b[g.b[y + k]].el, "history-added")])
          }
          x += n
          y += m
          p++
        } else if (part.removed) {
          for (let k = 0; k < n; k++) put(g.a[x + k], g.b[y] !== undefined ? b[g.b[y]].el : b[g.b[g.b.length - 1]].el)
          x += n
        } else if (part.added) {
          for (let k = 0; k < n; k++) shown.set(b[g.b[y + k]].el, [classed(b[g.b[y + k]].el, "history-added")])
          y += n
        } else {
          for (let k = 0; k < n; k++) pair(g.a[x + k], g.b[y + k])
          x += n
          y += n
        }
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

/** `now`, with the words it has that `old` hadn't in <ins>, and those it lost in <del>; a list item by item, the footnotes too */
function words(old: Element, now: Element): Element {
  if ((now.tagName === "ul" || now.tagName === "ol") && old.tagName === now.tagName) return items(old, now)
  if (isFootnotes(old) && isFootnotes(now)) {
    const was = footnoteList(old)
    const is = footnoteList(now)
    if (was && is && was.tagName === is.tagName) return { ...now, children: now.children.map((c) => (c === is ? items(was, is) : c)) }
  }
  return inline(old, now)
}

/** a list's items paired by their text: an item gone or come whole, the rest word by word */
function items(old: Element, now: Element): Element {
  const li = (e: Element) => e.children.filter((c): c is Element => c.type === "element" && c.tagName === "li")
  const was = li(old)
  const is = li(now)
  // an item by its text; a footnote's definition by its name, its words compared once it's paired
  const key = (e: Element) => (e.properties?.id ? `#${e.properties.id}` : toString(e).trim())
  const parts = diffArrays(was.map(key), is.map(key))
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
      for (let k = 0; k < n; k++) out.push(toString(was[x + k]) === toString(is[y + k]) ? is[y + k] : inline(was[x + k], is[y + k]))
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

/** a footnote's reference, by the footnote's name: its number is only where it falls among the others */
const refName = (e: Element): string | undefined => {
  if (e.tagName !== "sup") return undefined
  const a = e.children.find((c): c is Element => c.type === "element" && c.tagName === "a")
  const name = a?.properties?.dataSidenote ?? (a?.properties?.dataFootnoteRef !== undefined ? a?.properties?.href : undefined)
  return name === undefined ? undefined : String(name)
}

/** a note's number (markdown/margin.ts): its footnote's, which another put in before it changes */
const isNumber = (e: Element) => [e.properties?.className].flat().includes("sidenote-number")

/** a block's text, its texts, and the notes and footnote references in it with where they are in its text (theirs isn't in it) */
function walk(block: Element) {
  const texts: Text[] = []
  const notes: { el: Element; at: number }[] = []
  const refs: { el: Element; at: number; name: string }[] = []
  let text = ""
  const go = (e: Element) => {
    for (const c of e.children) {
      if (c.type === "text") {
        texts.push(c)
        text += c.value
      } else if (c.type === "element") {
        const name = refName(c)
        if (isNote(c)) notes.push({ el: c, at: text.length })
        else if (name !== undefined) refs.push({ el: c, at: text.length, name })
        else if (!isNumber(c)) go(c)
      }
    }
  }
  go(block)
  return { texts, notes, refs, text }
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
  // a footnote's reference: one in both as it is (renumbered or not), one new marked, one gone struck where it was
  const ins = (value: string): Element => ({ type: "element", tagName: "ins", properties: {}, children: [{ type: "text", value }] })
  const had = new Set(was.refs.map((r) => r.name))
  const has = new Set(is.refs.map((r) => r.name))
  for (const r of was.refs) if (!has.has(r.name)) gone.push({ at: moved(r.at), value: toString(r.el) })
  const markRef = (e: Element): Element => ({ ...e, children: e.children.map((c) => (c.type === "text" ? ins(c.value) : c.type === "element" ? markRef(c) : c)) })
  for (const r of is.refs) if (!had.has(r.name)) instead.set(r.el, markRef(r.el))
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
    children: e.children.flatMap((c) => (c.type === "text" ? marks(c) : c.type === "element" ? [instead.get(c) ?? (isNote(c) || isNumber(c) || refName(c) !== undefined ? c : rewrite(c))] : [c])),
  })
  const out = rewrite(now)
  if (left.length) out.children.push(...left.flatMap(del))
  return out
}
