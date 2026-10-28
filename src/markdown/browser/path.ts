// node:path in the browser (lib/vite.ts): the posix half, what the markdown
// plugins use of it, the site's files all being "/site/<rel>" there (render.ts).

export const sep = "/"

/** a path's parts, . and .. gone (a relative path's leading ..s kept) */
const normal = (parts: string[], abs = true) => {
  const out: string[] = []
  for (const p of parts) {
    if (!p || p === ".") continue
    if (p === ".." && out.length && out.at(-1) !== "..") out.pop()
    else if (p !== ".." || !abs) out.push(p)
  }
  return out
}

export function normalize(p: string): string {
  const abs = p.startsWith("/")
  const joined = normal(p.split("/"), abs).join("/")
  return (abs ? "/" : "") + joined || (abs ? "/" : ".")
}

export const join = (...parts: string[]) => normalize(parts.filter(Boolean).join("/"))

export function resolve(...parts: string[]): string {
  let at = "/"
  for (const p of parts) at = p.startsWith("/") ? p : `${at}/${p}`
  return normalize(at)
}

export function relative(from: string, to: string): string {
  const a = normal(resolve(from).split("/"))
  const b = normal(resolve(to).split("/"))
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/")
}

export function dirname(p: string): string {
  const trimmed = p.replace(/(.)\/+$/, "$1")
  const i = trimmed.lastIndexOf("/")
  return i < 0 ? "." : i === 0 ? "/" : trimmed.slice(0, i).replace(/\/+$/, "") || "/"
}

export function basename(p: string, ext?: string): string {
  const base = p.replace(/\/+$/, "").split("/").pop() ?? ""
  return ext && base.endsWith(ext) && base !== ext ? base.slice(0, -ext.length) : base
}

export function extname(p: string): string {
  // a name's leading dots aren't its extension's (.hidden, ..)
  const name = basename(p).replace(/^\.+/, "")
  const i = name.lastIndexOf(".")
  return i < 0 ? "" : name.slice(i)
}

export const isAbsolute = (p: string) => p.startsWith("/")

export const posix = { sep, normalize, join, resolve, relative, dirname, basename, extname, isAbsolute }

export default { ...posix, posix }
