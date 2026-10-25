// What the notes loader (src/loader.ts) tells the agent API (agent.ts): when
// it's rendering, what it found wrong in a note, and when it's done. The two
// are loaded through different module graphs (the loader with the content
// config, the integration with Astro's config), so the bus lives on globalThis.

export interface Problem {
  /** the file to edit, relative to the site's folder (e.g. "notes/creatures/anemones.md") */
  file: string | null
  line: number | null
  col: number | null
  message: string
  /** what kind of problem: "frontmatter", "markdown", "unknown island", "component", "stylesheet", ... */
  kind?: string
}

export interface Bus {
  /** notes the loader couldn't render, by absolute path: each keeps its last good version */
  noteErrors: Map<string, Problem>
  /** what's wrong in a note that still rendered (an unknown island), by absolute path */
  noteWarnings: Map<string, Problem[]>
  /** renders in progress */
  busy: number
  /** whether a render since the last build finished changed what's stored */
  stored: boolean
  /** rounds of rendering finished, ever (the first is the loader's first load) */
  rounds: number
  /** called on every change above */
  listeners: Set<() => void>
}

const KEY = Symbol.for("basalt.bus")
type Holder = { [KEY]?: Bus }

export function bus(): Bus {
  const g = globalThis as Holder
  g[KEY] ??= { noteErrors: new Map(), noteWarnings: new Map(), busy: 0, stored: false, rounds: 0, listeners: new Set() }
  return g[KEY]
}

const notify = () => {
  for (const fn of bus().listeners) fn()
}

/** The loader starts rendering. */
export function begin() {
  bus().busy++
}

/** The loader is done with what it began; `stored` if it wrote to the content store. */
export function end(stored: boolean) {
  const b = bus()
  b.busy = Math.max(0, b.busy - 1)
  b.rounds++
  if (stored) b.stored = true
  notify()
}

export function noteFailed(abs: string, problem: Problem | null) {
  const b = bus()
  if (problem) b.noteErrors.set(abs, problem)
  else b.noteErrors.delete(abs)
}

export function noteWarned(abs: string, problems: Problem[]) {
  const b = bus()
  if (problems.length) b.noteWarnings.set(abs, problems)
  else b.noteWarnings.delete(abs)
}

/** Forget a note that's gone. */
export function noteGone(abs: string) {
  noteFailed(abs, null)
  noteWarned(abs, [])
}

/** The 1-based line of the first match of `needle` in `text`, if any. */
export function lineOf(text: string, needle: string | RegExp): number | null {
  const at = typeof needle === "string" ? text.indexOf(needle) : text.search(needle)
  return at < 0 ? null : text.slice(0, at).split("\n").length
}
