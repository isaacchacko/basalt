// The rest of node's modules in the browser (lib/vite.ts): there for the
// imports of modules the markdown plugins share with the build (git's dates,
// a site's config, an island's bundle, reading-time's stream), which a note
// rendered in the browser never calls.

const absent = (name: string) => () => {
  throw new Error(`basalt: ${name} isn't in the browser`)
}

export const execFileSync = absent("child_process")
export const registerHooks = absent("module")
export const createRequire = absent("module")
export const pathToFileURL = (p: string) => new URL(`file://${p}`)
export const fileURLToPath = (u: string | URL) => decodeURIComponent(new URL(u).pathname)
export const createHash = absent("crypto")
export const homedir = absent("os")
export const tmpdir = absent("os")
export class Transform {}
export const inherits = () => {}

export default { execFileSync, registerHooks, createRequire, pathToFileURL, fileURLToPath, createHash, homedir, tmpdir, Transform, inherits }
