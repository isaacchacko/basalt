// node:fs in the browser (lib/vite.ts): the site's files a note's rendering
// reads (a code file it embeds, an island's data), held in memory by
// render.ts. A file that isn't held yet is noted as wanted and read as
// missing; render.ts fetches what's wanted and renders again.

/** the site's files held, by their path ("/site/<rel>") */
export const files = new Map<string, string>()
/** the paths read that weren't held */
export const wanted = new Set<string>()

const missing = (p: string) => Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" })

export function readFileSync(p: string): string {
  const text = files.get(String(p))
  if (text === undefined) {
    wanted.add(String(p))
    throw missing(String(p))
  }
  return text
}

export const existsSync = (p: string) => files.has(String(p))

export function statSync(p: string, opts?: { throwIfNoEntry?: boolean }) {
  if (!files.has(String(p))) {
    if (opts?.throwIfNoEntry === false) return undefined
    throw missing(String(p))
  }
  return { mtimeMs: 0, isDirectory: () => false, isFile: () => true }
}

export const readdirSync = () => [] as string[]
export const realpathSync = (p: string) => p

// nothing is written from the browser (a song's cache, say)
export const writeFileSync = () => {}
export const mkdirSync = () => {}

export default { readFileSync, existsSync, statSync, readdirSync, realpathSync, writeFileSync, mkdirSync }
