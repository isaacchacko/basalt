// The site's notes, as one Astro collection. Each note is read, its
// Obsidian syntax turned into markdown (textTransforms), rendered with
// Basalt's plugins, and stored with what the plugins found. While serving,
// a saved note is rendered again on its own; a note added or removed
// re-renders every note, since links resolve against all of them.
//
// A note that fails to render (its frontmatter doesn't parse, say) keeps its
// last good version, and is reported with its file and line to the agent API
// (integrations/agent.ts, through integrations/bus.ts), to `basalt build`
// and to `basalt check`. The rest of the site renders as usual.

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import type { Loader, LoaderContext } from "astro/loaders"
import { parseFrontmatter } from "@astrojs/markdown-remark"
import { refreshRegistry, registry } from "./lib/registry"
import { linkOne, linkPublic, sourceDirs, type SiteFile } from "./lib/site"
import { textTransforms } from "./markdown"
import { findIslands } from "./markdown/islands"
import { resolveFile } from "./markdown/embeds"
import { nativeImport } from "./markdown/siteconfig"
import { begin, end, lineOf, noteFailed, noteGone, noteWarned, bus, type Problem } from "./integrations/bus"

// a change to Basalt's markdown code (or a site's own plugins) re-renders
// every note, not just the ones whose text changed
function codeDigest(siteDir: string): string {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "markdown")
  const files = [
    ...fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => path.join(dir, f)),
    path.join(siteDir, "basalt.config.ts"),
  ]
  return files.map((f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0)).join(",")
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/

function transform(raw: string, file: SiteFile): string {
  const head = FRONTMATTER.exec(raw)?.[0] ?? ""
  let body = raw.slice(head.length)
  for (const t of textTransforms) body = t(body, file)
  return head + body
}

/** What went wrong rendering a note, with the line it's on when that can be told. */
function problemOf(err: unknown, raw: string, rel: string): Problem {
  const e = err as Error & { linePos?: { line: number; col: number }[]; loc?: { line?: number; column?: number } }
  // its own frontmatter, parsed again here: an error from a note it embeds
  // shouldn't be put on this one's line
  try {
    parseFrontmatter(raw)
  } catch (fm) {
    const f = fm as Error & { linePos?: { line: number; col: number }[] }
    const at = f.linePos?.[0] ?? null
    return { file: rel, line: at?.line ?? null, col: at?.col ?? null, message: firstLine(f.message), kind: "frontmatter" }
  }
  return {
    file: rel,
    line: e.loc?.line ?? null,
    col: e.loc?.column ?? null,
    message: firstLine(e.message ?? String(err)),
    kind: "markdown",
  }
}

const firstLine = (s: string) =>
  s
    .replace(/^Failed to parse Markdown file "[^"]*":\s*/i, "")
    .split("\n")[0]
    .replace(/ at line \d+, column \d+:?$/, "")
    .trim()

/** islands a note's page has that the site doesn't (its islands/ folder), each with its line */
function unknownIslands(html: string, raw: string, rel: string, known: Map<string, string>): Problem[] {
  const out: Problem[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/data-island="([^"]+)"/g)) {
    const name = m[1]
    if (known.has(name) || seen.has(name)) continue
    seen.add(name)
    // only this note's own: one it embeds says so itself
    const line = lineOf(raw, new RegExp(`<island\\b[^>]*\\bname=["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`))
    if (line === null) continue
    const have = [...known.keys()]
    out.push({
      file: rel,
      line,
      col: null,
      message: `unknown island "${name}" (${have.length ? `have: ${have.join(", ")}` : "the site's islands/ folder is empty"})`,
      kind: "unknown island",
    })
  }
  return out
}

/**
 * Astro writes the content store to disk half a second after its last change,
 * and only then do pages see it. A note that's just been rendered is written
 * at once (falling back to Astro's own timing if its internals ever move).
 */
let flushStore: () => Promise<void> = async () => {}
try {
  const require = createRequire(path.join(process.cwd(), "package.json"))
  const astro = fs.realpathSync(path.dirname(require.resolve("astro/package.json")))
  const instance = pathToFileURL(path.join(astro, "dist", "content", "instance.js")).href
  flushStore = async () => {
    try {
      const { globalContentLayer } = (await nativeImport(instance)) as {
        globalContentLayer?: { get(): { store?: { waitUntilSaveComplete?: () => Promise<void> } } | null }
      }
      await globalContentLayer?.get()?.store?.waitUntilSaveComplete?.()
    } catch {}
  }
} catch {}

export function basaltLoader(): Loader {
  return {
    name: "basalt-notes",
    load: async (ctx: LoaderContext) => {
      const { store, logger, watcher } = ctx
      let reg = refreshRegistry()
      linkPublic(reg.site, reg.files)
      const rel = (f: SiteFile) => path.relative(reg.site.dir, f.abs)
      const islandsDir = path.join(reg.site.dir, "islands")

      const code = codeDigest(reg.site.dir)
      /** the site files a note's islands read (<island data="cool.json">) */
      const islandData = (raw: string): SiteFile[] => {
        const rels = registry().files.map((f) => f.rel)
        return [...raw.matchAll(/<island\b[^>]*?\bdata=["']([^"']+)["']/g)]
          .map((m) => resolveFile(rels, m[1]))
          .flatMap((found) => registry().files.filter((f) => f.rel === found))
      }
      /** renders a note (if it changed): whether the store changed */
      const sync = async (file: SiteFile, force = false): Promise<boolean> => {
        const raw = fs.readFileSync(file.abs, "utf8")
        const existing = store.get(file.slug)
        // the notes it embeds are part of it (the store skips an unchanged digest)
        const embeds = ((existing?.data.transcludes as string[] | undefined) ?? [])
          .map((slug) => reg.bySlug.get(slug as never))
          .map((f) => (f && fs.existsSync(f.abs) ? fs.statSync(f.abs).mtimeMs : 0))
        // and a note that embeds or lists others depends on which are broken
        // (they're missing from it), and a list on every note's frontmatter
        const others = /!\[\[|<note-list\b/.test(raw) ? [...bus().noteErrors.keys()].sort().join(",") : ""
        const listed = /<note-list\b/.test(raw)
          ? reg.files.filter((f) => f.isNote && f !== file).map((f) => fs.statSync(f.abs, { throwIfNoEntry: false })?.mtimeMs ?? 0).join(",")
          : ""
        // and on the files its islands read: a change there is a change to it
        const read = islandData(raw)
          .map((f) => fs.statSync(f.abs, { throwIfNoEntry: false })?.mtimeMs ?? 0)
          .join(",")
        const digest = ctx.generateDigest(raw + reg.slugs.length + code + embeds.join(",") + others + listed + read)
        if (!force && existing && existing.digest === digest && !bus().noteErrors.has(file.abs)) {
          noteWarned(file.abs, unknownIslands(existing.rendered?.html ?? "", raw, rel(file), findIslands(islandsDir)))
          return false
        }
        let rendered
        try {
          rendered = await ctx.renderMarkdown(transform(raw, file), {
            fileURL: pathToFileURL(file.abs),
          })
        } catch (err) {
          const problem = problemOf(err, raw, rel(file))
          noteFailed(file.abs, problem)
          logger.error(`${problem.file}${problem.line ? `:${problem.line}${problem.col ? `:${problem.col}` : ""}` : ""}: ${problem.message}${existing ? " (its last good version stays up)" : ""}`)
          return false
        }
        noteFailed(file.abs, null)
        noteWarned(file.abs, unknownIslands(rendered.html, raw, rel(file), findIslands(islandsDir)))
        const stat = fs.statSync(file.abs)
        const data = {
          ...rendered.metadata?.frontmatter,
          slug: file.slug,
          rel: file.rel,
          modified: stat.mtime.toISOString(),
          created: stat.birthtime.toISOString(),
        }
        store.set({
          id: file.slug,
          data: await ctx.parseData({ id: file.slug, data }),
          body: raw,
          rendered,
          filePath: path.relative(process.cwd(), file.abs),
          // a forced render (an island it renders at build time changed, a note
          // it lists was fixed) is stored even though its own text is the same
          digest: force ? ctx.generateDigest(digest + rendered.html) : digest,
        })
        return true
      }

      /** a note that embeds or lists others: what it shows depends on theirs */
      const dependsOnOthers = (f: SiteFile) => {
        try {
          return /!\[\[|<note-list\b/.test(fs.readFileSync(f.abs, "utf8"))
        } catch {
          return false
        }
      }

      const all = async (force = false) => {
        const notes = reg.files.filter((f) => f.isNote)
        const keep = new Set(notes.map((f) => f.slug))
        let changed = false
        for (const id of store.keys()) {
          if (!keep.has(id as never)) {
            store.delete(id)
            changed = true
          }
        }
        for (const abs of [...bus().noteErrors.keys(), ...bus().noteWarnings.keys()]) {
          if (!reg.byAbs.get(abs)?.isNote) noteGone(abs)
        }
        // which notes' frontmatter doesn't parse, first: the notes that embed
        // or list them depend on it
        for (const f of notes) {
          const raw = fs.readFileSync(f.abs, "utf8")
          try {
            parseFrontmatter(raw)
          } catch (err) {
            noteFailed(f.abs, problemOf(err, raw, rel(f)))
          }
        }
        for (const f of notes) {
          try {
            if (await sync(f, force)) changed = true
          } catch (err) {
            logger.error(`${rel(f)}: ${(err as Error).message}`)
          }
        }
        const failed = notes.filter((f) => bus().noteErrors.has(f.abs)).length
        logger.info(`${notes.length} notes${failed ? `, ${failed} failed` : ""}`)
        return changed
      }

      /** one round of rendering, told to the agent API as it starts and ends */
      const round = async (work: () => Promise<boolean>) => {
        begin()
        let stored = false
        try {
          stored = await work()
          if (stored && watcher) await flushStore()
        } catch (err) {
          logger.error((err as Error).message)
        } finally {
          end(stored)
        }
      }

      await round(() => all())

      if (!watcher) return
      const dirs = sourceDirs(reg.site)
      watcher.add([...dirs, islandsDir])
      const inSite = (p: string) => dirs.some((d) => p === d || p.startsWith(d + path.sep))
      // a file an island reads (data="cool.json") changed: the notes that read it
      watcher.on("change", (p) => {
        if (!inSite(p)) return
        const file = registry().byAbs.get(p)
        if (!file || file.isNote) return
        const readers = registry().files.filter(
          (f) => f.isNote && fs.existsSync(f.abs) && islandData(fs.readFileSync(f.abs, "utf8")).includes(file),
        )
        if (!readers.length) return
        logger.info(`${rel(file)}: read by ${readers.map(rel).join(", ")}, rendered again`)
        void round(async () => {
          let changed = false
          for (const f of readers) if (await sync(f)) changed = true
          return changed
        })
      })
      watcher.on("change", (p) => {
        if (!inSite(p)) return
        const file = registry().byAbs.get(p)
        if (!file?.isNote) return
        void round(async () => {
          let changed = await sync(file)
          const nowBroken = bus().noteErrors.has(file.abs)
          for (const other of registry().files) {
            if (!other.isNote || other === file) continue
            const entry = store.get(other.slug)
            const embeds = (entry?.data.transcludes as string[] | undefined) ?? []
            // while it's broken, the notes that show it keep its last good version
            if (nowBroken) break
            // every note that embeds it, and any that embeds or lists others
            // (whether they show it, or what of it, may have changed)
            const embedsIt = embeds.includes(file.slug)
            if (!embedsIt && !dependsOnOthers(other)) continue
            if (await sync(other, embedsIt)) {
              changed = true
              logger.info(`${rel(other)}: shows ${rel(file)}, rendered again`)
            }
          }
          return changed
        })
      })
      // an island rendered at build time (ssr) is part of the notes it's in
      watcher.on("change", (p) => {
        if (path.dirname(p) !== islandsDir) return
        const name = path.basename(p).replace(/\.\w+$/, "")
        const users = registry().files.filter((f) => {
          const html = f.isNote ? store.get(f.slug)?.rendered?.html : undefined
          return !!html && new RegExp(`<[^>]*\\bdata-island="${name}"[^>]*\\bdata-island-ssr`).test(html)
        })
        if (!users.length) return
        logger.info(`islands/${path.basename(p)}: rendering ${users.map(rel).join(", ")} again`)
        void round(async () => {
          let changed = false
          for (const f of users) if (await sync(f, true)) changed = true
          return changed
        })
      })
      const restructure = (p: string) => {
        // an island added or removed: notes that name it may now find it
        if (path.dirname(p) === islandsDir) {
          const name = path.basename(p).replace(/\.\w+$/, "")
          const users = registry().files.filter((f) => f.isNote && fs.existsSync(f.abs) && fs.readFileSync(f.abs, "utf8").includes(name))
          if (users.length) {
            void round(async () => {
              let changed = false
              for (const f of users) if (await sync(f, true)) changed = true
              return changed
            })
          }
          return
        }
        if (!inSite(p)) return
        void round(async () => {
          reg = refreshRegistry()
          const file = reg.byAbs.get(p)
          if (file && !file.isNote) linkOne(path.join(reg.site.work, "public"), file)
          if (!file) noteGone(p)
          return all()
        })
      }
      watcher.on("add", restructure)
      watcher.on("unlink", restructure)
    },
  }
}
