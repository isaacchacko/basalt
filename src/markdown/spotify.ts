// [[spotify:<link>|a caption]], or <spotify src="<link>">a caption</spotify>:
// a song or an album as a card in the note, its cover, its name, the artist
// and the album, linking to Spotify, with the caption under it. The cover
// opens full screen in the viewer (client/viewer.ts), at the biggest size
// Spotify has, so it's beside the link, not in it. The link is a
// share link (https://open.spotify.com/track/…) or a Spotify URI
// (spotify:track:…). ofm.ts makes the tag of the wikilink.
//
// The song comes from its Spotify page at build time, kept with its cover in
// the site's cache, as a <sound>'s does (sound.ts). Offline, or for a link
// that isn't a song or an album, the card is the caption, linking to it.

import type { Element, ElementContent, Root } from "hast"
import { visit } from "unist-util-visit"
import { track, type Track } from "./sound.ts"

// spotify:track:… (or track:…, from [[spotify:track:…]])
const uriRegex = /^(?:spotify:)?(track|album|playlist|episode|show|artist):(\w+)$/

/** A Spotify URI or a bare open.spotify.com link as a url. */
export function spotifyUrl(link: string): string {
  const uri = uriRegex.exec(link.trim())
  if (uri) return `https://open.spotify.com/${uri[1]}/${uri[2]}`
  return /^https?:\/\//.test(link.trim()) ? link.trim() : `https://${link.trim()}`
}

const el = (tagName: string, properties: Element["properties"], children: ElementContent[] = []): Element => ({
  type: "element",
  tagName,
  properties,
  children,
})
const line = (className: string, value?: string): ElementContent[] =>
  value ? [el("span", { className: [className] }, [{ type: "text", value }])] : []

/** The card: the song when it's known, else the caption as a link. */
export function spotifyCard(url: string, caption: ElementContent[], song?: Track): ElementContent[] {
  const link = { href: url, target: "_blank", rel: ["noopener", "noreferrer"] }
  if (!song) {
    const label = caption.length ? caption : [{ type: "text" as const, value: "Spotify" }]
    return [el("a", { ...link, className: ["basalt-song-card", "basalt-song-bare"] }, [el("span", { className: ["basalt-song-name"] }, label)])]
  }
  const cover = song.cover
    ? [el("img", { className: ["basalt-song-cover", "zoomable"], src: song.cover, ...(song.coverFull ? { dataFull: song.coverFull } : {}), alt: song.title, width: 72, height: 72, loading: "lazy" })]
    : []
  return [
    el("span", { className: ["basalt-song-card"] }, [
      ...cover,
      el("a", { ...link, className: ["basalt-song-text"] }, [
        ...line("basalt-song-name", song.title),
        ...line("basalt-song-artist", song.artist),
        ...line("basalt-song-album", song.album),
      ]),
    ]),
    ...(caption.length ? [el("span", { className: ["basalt-song-caption"] }, caption)] : []),
  ]
}

export function rehypeSpotify() {
  return async (tree: Root) => {
    const cards: Element[] = []
    visit(tree, "element", (node) => {
      if (node.tagName === "spotify") cards.push(node)
    })
    await Promise.all(
      cards.map(async (node) => {
        const url = spotifyUrl(String(node.properties?.src ?? ""))
        node.tagName = "span"
        node.properties = { className: ["basalt-song"] }
        node.children = spotifyCard(url, node.children, await track(url))
      }),
    )
  }
}
