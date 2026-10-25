// The site's notes, as one Astro collection. Each note is read, its
// Obsidian syntax turned into markdown (textTransforms), rendered with
// Basalt's plugins, and stored with what the plugins found. While serving,
// a saved note is rendered again on its own; a note added or removed
// re-renders every note, since links resolve against all of them.

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Loader, LoaderContext } from "astro/loaders"
import { refreshRegistry, registry } from "./lib/registry"
import { linkOne, linkPublic, sourceDirs, type SiteFile } from "./lib/site"
import { textTransforms } from "./markdown"

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

export function basaltLoader(): Loader {
  return {
    name: "basalt-notes",
    load: async (ctx: LoaderContext) => {
      const { store, logger, watcher } = ctx
      let reg = refreshRegistry()
      linkPublic(reg.site, reg.files)

      const code = codeDigest(reg.site.dir)
      const sync = async (file: SiteFile, force = false) => {
        const raw = fs.readFileSync(file.abs, "utf8")
        const existing = store.get(file.slug)
        // the notes it embeds are part of it (the store skips an unchanged digest)
        const embeds = ((existing?.data.transcludes as string[] | undefined) ?? [])
          .map((slug) => reg.bySlug.get(slug as never))
          .map((f) => (f && fs.existsSync(f.abs) ? fs.statSync(f.abs).mtimeMs : 0))
        const digest = ctx.generateDigest(raw + reg.slugs.length + code + embeds.join(","))
        if (!force && existing && existing.digest === digest) return
        const rendered = await ctx.renderMarkdown(transform(raw, file), {
          fileURL: pathToFileURL(file.abs),
        })
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
          digest,
        })
      }

      const all = async () => {
        const notes = reg.files.filter((f) => f.isNote)
        const keep = new Set(notes.map((f) => f.slug))
        for (const id of store.keys()) if (!keep.has(id as never)) store.delete(id)
        const failed: string[] = []
        for (const f of notes) {
          try {
            await sync(f)
          } catch (err) {
            failed.push(f.rel)
            logger.error(`${f.rel}: ${(err as Error).message}`)
          }
        }
        logger.info(`${notes.length} notes${failed.length ? `, ${failed.length} failed` : ""}`)
      }
      await all()

      if (!watcher) return
      const dirs = sourceDirs(reg.site)
      watcher.add(dirs)
      const inSite = (p: string) => dirs.some((d) => p === d || p.startsWith(d + path.sep))
      watcher.on("change", async (p) => {
        if (!inSite(p)) return
        const file = registry().byAbs.get(p)
        if (!file?.isNote) return
        try {
          await sync(file)
          // and every note that embeds it
          for (const entry of store.values()) {
            const embeds = (entry.data.transcludes as string[] | undefined) ?? []
            const other = registry().bySlug.get(entry.id as never)
            if (other && embeds.includes(file.slug)) {
              await sync(other, true)
              logger.info(`${other.rel}: embeds ${file.rel}, rendered again`)
            }
          }
        } catch (err) {
          logger.error(`${file.rel}: ${(err as Error).message}`)
        }
      })
      const restructure = async (p: string) => {
        if (!inSite(p)) return
        reg = refreshRegistry()
        const file = reg.byAbs.get(p)
        if (file && !file.isNote) linkOne(path.join(reg.site.work, "public"), file)
        await all()
      }
      watcher.on("add", restructure)
      watcher.on("unlink", restructure)
    },
  }
}
