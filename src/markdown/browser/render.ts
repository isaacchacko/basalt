// A note rendered in the browser, for a built site's page being edited in
// place (client/github.ts): Basalt's own plugins (plugins.ts), in Astro's
// order, so a block drawn from what's typed is the block the build would
// make of it. Loaded only once editing starts.
//
// What a plugin would read from the site comes from the build (the site's
// facts: /static/edit/site.json, pages/static/edit) or is fetched as it's
// wanted: another note's text (transclusion), from the repo; any other file's
// (a code file embedded, an island's data), from the site, where it's served.
// node's fs and path here are browser/fs.ts and browser/path.ts (lib/vite.ts),
// every file of the site at "/site/<rel>".
//
// What can't be known here, a block is left undrawn (its markdown shows, with
// a word that it's drawn once published):
//
//   a song (<sound spotify>, [[spotify:…]]) the build hasn't looked up: its
//   page is Spotify's, which the browser can't read, and its cover is kept
//   by the build
//
//   an `ssr` island with props the build hasn't rendered: its module is
//   bundled for node
//
//   a ```streak of a GitHub or LeetCode user the build hasn't fetched:
//   their calendars can't be read from a browser either (a streak of the
//   block's own days draws as it's typed)
//
// A site with markdown plugins of its own (basalt.config.ts) isn't rendered
// here at all: they're its own code, for node.

import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkRehype from "remark-rehype"
import rehypeRaw from "rehype-raw"
import rehypeStringify from "rehype-stringify"
import { VFile } from "vfile"
import { parseFrontmatter } from "@astrojs/markdown-remark"
import type { Registry } from "../../lib/registry"
import type { SiteFile } from "../../lib/site"
import type { FilePath, FullSlug } from "../../lib/path"
import { useRegistry } from "../context"
import { unsaved, remarkSourceBlocks, rehypeSourceLines } from "../lines"
import { rehypeNoteLists, renderNoteLists, type Listed } from "../notelist"
import { useTargets, type Target } from "../transclude"
import { useIslands } from "../islands"
import { lookUpSongs, spotifyItem } from "../sound"
import { spotifyUrl } from "../spotify"
import { lookUpStreaks } from "../streak"
import { basaltRehype, basaltRemark, basaltText, processorOptions, renderTime, targetOf, transformText, treeProcessor } from "../plugins"
import { rehypeHeadingIds } from "./astro"
import { files, wanted } from "./fs"
import { islandKey, type SiteFacts } from "./facts"

/** How the site's files are read: a note by its path in the repo, any other file by its slug (where the site serves it). */
export interface Reader {
  note(repo: string): Promise<string>
  file(slug: string): Promise<string>
}

export interface Rendering {
  html: string
  title: string
}

const ROOT = "/site"
const SITE: Registry["site"] = { dir: ROOT, work: `${ROOT}/.basalt/astro`, config: { title: "", locale: "en-US", content: [], edit: true } }
const SONGS = `${SITE.work}/cache/spotify.json`
const STREAKS = `${SITE.work}/cache/streaks.json`
const UNDRAWN = "basalt-undrawn"

/** The site's notes, rendered here; null for a site that has plugins of its own. */
export function browserRenderer(facts: SiteFacts, read: Reader): ((slug: string, text: string, at?: string) => Promise<Rendering>) | null {
  if (facts.own) return null
  const site = { ...SITE, config: { ...SITE.config, title: facts.title, locale: facts.locale } }
  const all: SiteFile[] = facts.files.map((f) => ({ abs: `${ROOT}/${f.rel}`, rel: f.rel as FilePath, slug: f.slug as FullSlug, isNote: f.isNote }))
  const reg: Registry = {
    site,
    files: all,
    slugs: all.map((f) => f.slug),
    byAbs: new Map(all.map((f) => [f.abs, f])),
    bySlug: new Map(all.map((f) => [f.slug, f])),
  }
  // the plugins that ask context.ts, and the ones that ask lib/registry.ts (themed.ts), have this site
  useRegistry(() => reg)
  ;(globalThis as Record<symbol, unknown>)[Symbol.for("basalt.registry")] = reg

  files.set(SONGS, JSON.stringify(facts.songs))
  lookUpSongs(false)
  files.set(STREAKS, JSON.stringify(facts.streaks ?? {}))
  lookUpStreaks(false)
  useIslands(async (_dir, name, props) => facts.islands[islandKey(name, JSON.stringify(props))] ?? `<${UNDRAWN}></${UNDRAWN}>`)
  const listed: Listed[] = facts.listed.map((n) => ({ ...n, date: n.date ? new Date(n.date) : undefined }))

  const repo = new Map(facts.files.map((f) => [`${ROOT}/${f.rel}`, f.repo]))
  const notes = new Map<string, Promise<string>>()
  const textOf = (file: SiteFile) => {
    const at = repo.get(file.abs)
    if (!at) return Promise.reject(new Error(`basalt: ${file.rel} isn't in the repo`))
    if (!notes.has(at)) notes.set(at, read.note(at).catch((err) => (notes.delete(at), Promise.reject(err))))
    return notes.get(at)!
  }
  const own = treeProcessor([remarkSourceBlocks, ...basaltRemark], basaltRehype)
  useTargets(async (slug) => {
    const file = reg.bySlug.get(slug)
    if (!file?.isNote) return undefined
    return targetOf(own, slug, file.abs, transformText(await textOf(file), file, basaltText))
  })

  // Astro's processor (@astrojs/markdown-remark's createMarkdownProcessor), with Basalt's plugins
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use([remarkSourceBlocks, ...basaltRemark])
    .use(remarkRehype, { ...processorOptions.remarkRehype, passThrough: [] })
    .use([
      ...basaltRehype,
      rehypeSourceLines,
      ...renderTime.map((p) => (p === rehypeNoteLists ? () => (tree: never) => renderNoteLists(tree, facts.locale, () => listed) : p)),
    ])
    .use(rehypeHeadingIds)
    .use(rehypeRaw)
    .use(rehypeStringify, { allowDangerousHtml: true })

  /** the files wanted and not yet held, fetched */
  const fetchWanted = async () => {
    const want = [...wanted].filter((p) => !files.has(p))
    wanted.clear()
    await Promise.all(
      want.map(async (abs) => {
        const file = reg.byAbs.get(abs)
        if (file) files.set(abs, await (file.isNote ? textOf(file) : read.file(file.slug)))
      }),
    )
    return want.length > 0
  }

  /** each folder of notes in the repo, and where its notes go in the site (a note's repo path, less its path in the site) */
  const sources = [...new Set(facts.files.flatMap((f) => (f.repo?.endsWith(f.rel) ? [f.repo.slice(0, f.repo.length - f.rel.length)] : [])))].sort((a, b) => b.length - a.length)
  /** a note the build hasn't (one the explorer made since, files.ts), by its path in the repo: in the site where it'll be */
  const adopt = (slug: string, at: string): SiteFile | undefined => {
    const source = sources.find((p) => at.startsWith(p))
    if (source === undefined) return undefined
    const file: SiteFile = { abs: `${ROOT}/${at.slice(source.length)}`, rel: at.slice(source.length) as FilePath, slug: slug as FullSlug, isNote: true }
    reg.files.push(file)
    reg.slugs.push(file.slug)
    reg.byAbs.set(file.abs, file)
    reg.bySlug.set(file.slug, file)
    repo.set(file.abs, at)
    return file
  }

  return async (slug, text, at) => {
    const file = reg.bySlug.get(slug as FullSlug) ?? (at ? adopt(slug, at) : undefined)
    if (!file) throw new Error(`basalt: ${slug} isn't one of the site's notes`)
    const { frontmatter, content } = parseFrontmatter(transformText(text, file, basaltText))
    let html = ""
    let title = ""
    // a file a plugin wanted that wasn't here: fetched, and the note rendered again
    for (let round = 0; ; round++) {
      wanted.clear()
      const vfile = new VFile({ value: content, path: file.abs, data: { astro: { frontmatter: structuredClone(frontmatter) } } })
      unsaved.set(file.abs, text)
      let failed: unknown
      try {
        html = String(await processor.process(vfile))
        title = String(vfile.data.frontmatter?.title ?? "")
      } catch (err) {
        failed = err
      } finally {
        unsaved.delete(file.abs)
      }
      if (round < 3 && (await fetchWanted())) continue
      if (failed) throw failed
      break
    }
    return { html: undrawn(html, text, facts), title }
  }
}

/** a song's id, in a note's text, wherever it's linked (a share link, a spotify: uri) */
const SONG = /open\.spotify\.com\/(?:intl-[\w-]+\/)?(?:track|album)\/[A-Za-z0-9]+|spotify:(?:track|album):[A-Za-z0-9]+/g

/** The rendering, its blocks that can't be drawn here each a stand-in for its lines (the editor shows their markdown). */
function undrawn(html: string, text: string, facts: SiteFacts): string {
  const t = document.createElement("template")
  t.innerHTML = html
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  for (const el of [...t.content.children] as HTMLElement[]) {
    const src = el.dataset.src
    if (!src) continue
    const [a, b] = src.split("-").map(Number)
    // a song's card or clip, of a song the build hasn't looked up (an embedded player needs none)
    const songs = el.querySelector(".basalt-song-bare, .sound") ? (lines.slice(a - 1, b).join("\n").match(SONG) ?? []) : []
    const unknown = songs.some((s) => {
      const id = spotifyItem(spotifyUrl(s))?.id
      return id !== undefined && !facts.songs[id]
    })
    if (!unknown && !el.querySelector(UNDRAWN)) continue
    const stand = document.createElement("div")
    stand.dataset.src = src
    stand.dataset.editUndrawn = ""
    el.replaceWith(stand)
  }
  return t.innerHTML
}
