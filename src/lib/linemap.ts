// Which lines of one text are which lines of another: a line diff (Myers'),
// read as a map. A note's page is made from its text after textTransforms
// (which add and remove lines), and its blocks are named by the lines of the
// text as written (markdown/lines.ts); a note's history pairs one version's
// lines with the one's before it (marks.ts).

/** The lines a and b have in common, as [index in a, index in b], in order. */
export function commonLines(a: string[], b: string[]): [number, number][] {
  const n = a.length
  const m = b.length
  const max = n + m
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= n && y >= m) return backtrack(trace, n, m, off)
    }
  }
  return []
}

function backtrack(trace: Int32Array[], n: number, m: number, off: number): [number, number][] {
  const pairs: [number, number][] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d > 0; d--) {
    const v = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? k + 1 : k - 1
    const prevX = v[off + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) pairs.push([--x, --y])
    x = prevX
    y = prevY
  }
  while (x > 0 && y > 0) pairs.push([--x, --y])
  return pairs.reverse()
}

export interface LineMap {
  /** the first line of `to` that line i of `from` became (0-based) */
  first(i: number): number
  /** the last line of `to` that line i of `from` became */
  last(i: number): number
}

/** how alike two lines are, 0 to 1: their common start and end, of the longer (a blank line is like nothing) */
function likeness(a: string, b: string): number {
  if (!a.trim() || !b.trim()) return 0
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  return (p + s) / Math.max(a.length, b.length)
}

/** In a stretch that changed, the lines that are much alike, paired in order (an inline comment taken out of a line, say). */
function alike(from: string[], fromAt: number, fromEnd: number, to: string[], toAt: number, toEnd: number): [number, number][] {
  const n = fromEnd - fromAt
  const m = toEnd - toAt
  if (!n || !m || n * m > 250_000) return []
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1))
  const like = (i: number, j: number) => {
    const l = likeness(from[fromAt + i], to[toAt + j])
    return l >= 0.3 ? l : 0
  }
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      const l = like(i - 1, j - 1)
      score[i][j] = Math.max(score[i - 1][j], score[i][j - 1], l ? score[i - 1][j - 1] + l : 0)
    }
  const pairs: [number, number][] = []
  for (let i = n, j = m; i > 0 && j > 0; ) {
    const l = like(i - 1, j - 1)
    if (l && score[i][j] === score[i - 1][j - 1] + l) pairs.push([fromAt + --i, toAt + --j])
    else if (score[i][j] === score[i - 1][j]) i--
    else j--
  }
  return pairs.reverse()
}

/**
 * The lines of `from` that are lines of `to`, in order: the lines with
 * something on them they have in common, then, in each stretch between those,
 * the lines much alike, and the blank lines between those. (Blank lines
 * first would pair any blank line with any other, and carry a changed line
 * into the wrong stretch.)
 */
function pairsOf(from: string[], to: string[]): [number, number][] {
  const full = (lines: string[]) => lines.flatMap((l, i) => (l.trim() ? [i] : []))
  const f = full(from)
  const t = full(to)
  const out: [number, number][] = []
  let pf = -1
  let pt = -1
  const between = (endFrom: number, endTo: number) => {
    let qf = pf
    let qt = pt
    const inner = alike(from, pf + 1, endFrom, to, pt + 1, endTo)
    for (const [i, j] of [...inner, [endFrom, endTo] as [number, number]]) {
      for (const [a, b] of commonLines(from.slice(qf + 1, i), to.slice(qt + 1, j))) out.push([qf + 1 + a, qt + 1 + b])
      if (i < endFrom) out.push([i, j])
      qf = i
      qt = j
    }
  }
  for (const [a, b] of commonLines(
    f.map((i) => from[i]),
    t.map((j) => to[j]),
  )) {
    between(f[a], t[b])
    out.push([f[a], t[b]])
    pf = f[a]
    pt = t[b]
  }
  between(from.length, to.length)
  return out
}

/**
 * Line i of `from` as lines of `to`. A line both have is itself, and so is
 * one much like a line of the stretch it changed into; any other line in a
 * stretch that changed is the whole stretch it changed into (or, for lines
 * only `from` has, the line before where they were).
 */
export function lineMap(from: string[], to: string[]): LineMap {
  const lo = new Int32Array(from.length)
  const hi = new Int32Array(from.length)
  let prevFrom = -1
  let prevTo = -1
  const fill = (endFrom: number, endTo: number) => {
    // from's lines between the last common one and this one became to's lines between them
    const start = prevTo + 1
    const end = endTo - 1
    for (let i = prevFrom + 1; i < endFrom; i++) {
      lo[i] = end >= start ? start : Math.max(0, Math.min(prevTo, to.length - 1))
      hi[i] = end >= start ? end : lo[i]
    }
  }
  for (const [i, j] of pairsOf(from, to)) {
    fill(i, j)
    lo[i] = hi[i] = j
    prevFrom = i
    prevTo = j
  }
  fill(from.length, to.length)
  const clamp = (i: number) => Math.max(0, Math.min(from.length - 1, i))
  return {
    first: (i) => (from.length ? lo[clamp(i)] : 0),
    last: (i) => (from.length ? hi[clamp(i)] : 0),
  }
}
