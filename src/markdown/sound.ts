// <sound src="/assets/clip.mp3" spotify="https://open.spotify.com/track/…">word</sound>:
// a word that plays a clip when clicked (or enter or space, tabbed to), with a
// ♪ after it, and while it plays, a card in the side content: the song's
// cover, title, artist and album, from its Spotify page. `label` names the
// clip ("the chorus"). A song that isn't on Spotify (or to say it
// differently) takes `title`, `artist`, `album` and `cover` (a file in the
// site), over whatever Spotify says. One word can have several clips: `src`
// and `spotify` take comma-separated lists, `label`, `title`, `artist`,
// `album` and `cover` lists split by "|"; the word plays the first, its card
// has a row for each. Anywhere else it's just the word.
//
// The song comes from the track page's og tags (title; "Artist · Album · Song
// · Year"; the cover), fetched at build time with no key, once: it and the
// cover are kept in the site's cache (cache/spotify.json, cache/covers/), and
// the cover is served from the site (src/pages/basalt/cover/[file].ts), not
// Spotify's. Offline, a clip still plays; its card names only the word. An
// album's page is read the same way, for [[spotify:…]] (spotify.ts).
// The click and the card are src/client/sound.ts.

import fs from "node:fs"
import path from "node:path"
import type { Element, Root } from "hast"
import { visit } from "unist-util-visit"
import { reg } from "./context.ts"

/** `cover` is a card's (300px); `coverFull` the biggest Spotify has (the original, else 640px), for the viewer */
export type Track = { title: string; artist?: string; album?: string; year?: string; cover?: string; coverFull?: string; url: string }
export type Clip = { src: string; label?: string; track?: Track }

const UA = "Mozilla/5.0 (compatible; Twitterbot/1.0)"
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? all),
  )
const og = (html: string, key: string) =>
  html.match(new RegExp(`<meta[^>]+property="og:${key}"[^>]+content="([^"]*)"`))?.[1]

/** "Artist · Album · Song · Year" */
export function splitDescription(desc: string): { artist?: string; album?: string; year?: string } {
  const parts = desc.split(" · ").map((p) => p.trim())
  return { artist: parts[0] || undefined, album: parts[1] || undefined, year: parts.at(-1)?.match(/^\d{4}$/)?.[0] }
}

export type SpotifyKind = "track" | "album"

/** A Spotify link's kind and id, when it's a song or an album. */
export function spotifyItem(url: string): { kind: SpotifyKind; id: string } | undefined {
  const m = url.match(/open\.spotify\.com\/(?:intl-[\w-]+\/)?(track|album)\/([A-Za-z0-9]+)/)
  return m ? { kind: m[1] as SpotifyKind, id: m[2] } : undefined
}

/** A track's or an album's page, as a Track (an album's is its name, artist and year). */
export function trackOf(kind: SpotifyKind, url: string, html: string): Track | undefined {
  const title = og(html, "title")
  if (!title) return undefined
  const desc = unescape(og(html, "description") ?? "")
  if (kind === "track") return { title: unescape(title), url, ...splitDescription(desc) }
  // "Listen to <name> - Album by <artist> | Spotify"; "Artist · album · Year · N songs"
  const [artist, , year] = desc.split(" · ").map((p) => p.trim())
  return {
    title: unescape(title).replace(/^Listen to (.+) - [\w ]+ by .+ \| Spotify$/, "$1"),
    url,
    ...(artist ? { artist } : {}),
    ...(/^\d{4}$/.test(year ?? "") ? { year } : {}),
  }
}

const pending = new Map<string, Promise<Track | undefined>>()

/** The song (or album) a Spotify url is, from the cache or its page. */
export function track(url: string): Promise<Track | undefined> {
  const item = spotifyItem(url)
  if (!item) return Promise.resolve(undefined)
  if (!pending.has(item.id)) pending.set(item.id, fetchTrack(item.kind, item.id).catch(() => undefined))
  return pending.get(item.id)!
}

async function fetchTrack(kind: SpotifyKind, id: string): Promise<Track | undefined> {
  const cacheDir = path.join(reg().site.work, "cache")
  const cacheFile = path.join(cacheDir, "spotify.json")
  const cache: Record<string, Track> = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {}
  // cached before covers came full size: fetched again for it, kept as it was offline
  if (cache[id] && (!cache[id].cover || cache[id].coverFull)) return cache[id]
  const url = `https://open.spotify.com/${kind}/${id}`
  const fresh = await fetchPage(kind, id, url, cacheDir).catch(() => undefined)
  const found = fresh ?? cache[id]
  if (!found) return undefined
  // read again: other tracks may have landed while this one was fetched
  const now = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {}
  fs.writeFileSync(cacheFile, JSON.stringify({ ...now, [id]: found }, null, 2))
  return found
}

/** a cover from Spotify's image cdn into the cache: its path on the site, or undefined */
async function saveCover(image: string, cacheDir: string, file: string): Promise<string | undefined> {
  const pic = await fetch(image, { signal: AbortSignal.timeout(8000) }).catch(() => undefined)
  if (!pic?.ok) return undefined
  fs.mkdirSync(path.join(cacheDir, "covers"), { recursive: true })
  fs.writeFileSync(path.join(cacheDir, "covers", file), Buffer.from(await pic.arrayBuffer()))
  return `/basalt/cover/${file}`
}

async function fetchPage(kind: SpotifyKind, id: string, url: string, cacheDir: string): Promise<Track | undefined> {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) return undefined
  const html = await res.text()
  const found = trackOf(kind, url, html)
  if (!found) return undefined
  // Spotify's og:image is the cover at 640px (…b273…); a card shows it at
  // 300px (…1e02…), and the viewer the original (…82c1…, often 1000-2000px)
  const image = og(html, "image")
  if (image) {
    const at = (size: string) => unescape(image).replace("ab67616d0000b273", size)
    const cover = await saveCover(at("ab67616d00001e02"), cacheDir, `${id}.jpg`)
    if (cover) found.cover = cover
    const full = (await saveCover(at("ab67616d000082c1"), cacheDir, `${id}-full.jpg`)) ?? (await saveCover(at("ab67616d0000b273"), cacheDir, `${id}-full.jpg`))
    if (full) found.coverFull = full
  }
  return found
}

const list = (v: unknown, by: RegExp) =>
  v === undefined || v === null ? [] : String(v).split(by).map((s) => s.trim()).filter(Boolean)

export function rehypeSound() {
  return async (tree: Root) => {
    const sounds: Element[] = []
    visit(tree, "element", (node) => {
      if (node.tagName === "sound") sounds.push(node)
    })
    await Promise.all(
      sounds.map(async (node) => {
        const srcs = list(node.properties?.src, /\s*,\s*/)
        const songs = list(node.properties?.spotify, /\s*,\s*/)
        const by = (key: string) => list(node.properties?.[key], /\s*\|\s*/)
        const labels = by("label")
        const given = { title: by("title"), artist: by("artist"), album: by("album"), cover: by("cover") }
        const clips: Clip[] = await Promise.all(
          srcs.map(async (src, i) => {
            const found = songs[i] ? await track(songs[i]) : undefined
            // what the note says of the song, over what Spotify does
            const own = Object.fromEntries(
              Object.entries(given).flatMap(([k, v]) => (v[i] ? [[k, v[i]]] : [])),
            ) as Partial<Track>
            const song = found || own.title ? ({ url: "", ...found, ...own } as Track) : undefined
            return { src, ...(labels[i] ? { label: labels[i] } : {}), ...(song?.title ? { track: song } : {}) }
          }),
        )
        node.tagName = "span"
        node.properties = srcs.length
          ? { className: ["sound"], role: "button", tabIndex: 0, dataSound: srcs.join(", "), dataClips: JSON.stringify(clips) }
          : { className: ["sound-missing"] }
      }),
    )
  }
}
