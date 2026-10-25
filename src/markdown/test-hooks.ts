// For the tests (and render.ts) only: node runs TypeScript itself, but
//   - resolves imports the way it does javascript's, so `./path` (which Vite
//     finds) has to be found as `./path.ts`, and
//   - only strips types, so TypeScript that needs compiling (graph's
//     parameter properties) is compiled here, the way Vite would.
// Import this first, then what's tested with `await import(...)`, since
// static imports resolve before any module runs.

import fs from "node:fs"
import path from "node:path"
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"
import { transformSync } from "rolldown/utils"

// Basalt's root, wherever it's checked out
const basalt = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..") + path.sep

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
    if (!url.startsWith("file:") || !/\.tsx?$/.test(url)) return next(url, context)
    const file = fileURLToPath(url)
    // Basalt's own files node strips itself; anything else (graph, which is
    // in node_modules once installed, where node won't strip types) is
    // read and compiled here
    if (!file.includes(`${path.sep}node_modules${path.sep}`) && file.startsWith(basalt)) return next(url, context)
    const source = fs.readFileSync(file, "utf8")
    const { code, errors } = transformSync(file, source, { lang: url.endsWith("x") ? "tsx" : "ts" })
    if (errors.length) throw new Error(errors.map((e) => e.message).join("\n"))
    return { format: "module", source: code, shortCircuit: true }
  },
})
