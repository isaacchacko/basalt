// For the tests (and render.ts) only: node runs TypeScript itself, but
//   - resolves imports the way it does javascript's, so `./path` (which Vite
//     finds) has to be found as `./path.ts`, and
//   - only strips types, so TypeScript that needs compiling (graph's
//     parameter properties) is compiled here, the way Vite would.
// Import this first, then what's tested with `await import(...)`, since
// static imports resolve before any module runs.

import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"
import { transformSync } from "rolldown/utils"

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (err) {
      if (/\.[cm]?[jt]sx?$/.test(specifier)) throw err
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        try {
          return next(specifier + ext, context)
        } catch {}
      }
      throw err
    }
  },
  load(url, context, next) {
    if (!/\.tsx?$/.test(url) || url.includes("/basalt-astro")) return next(url, context)
    const result = next(url, context)
    const source = String(result.source)
    const { code, errors } = transformSync(fileURLToPath(url), source, { lang: url.endsWith("x") ? "tsx" : "ts" })
    if (errors.length) throw new Error(errors.map((e) => e.message).join("\n"))
    return { ...result, format: "module", source: code }
  },
})
