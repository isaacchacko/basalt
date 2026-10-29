// What a built site's page being edited needs to know of the site to render
// its note in the browser (render.ts), written by the build
// (pages/static/edit/[name].json.ts).

import type { Listed } from "../notelist"
import type { Track } from "../sound"
import type { Fetched } from "../streak"

export interface SiteFacts {
  title: string
  locale: string
  /** whether the site has markdown plugins of its own: its notes aren't rendered here */
  own: boolean
  /** the site's files; a note's, where it is in the repo */
  files: { rel: string; slug: string; isNote: boolean; repo?: string }[]
  /** what a <note-list> lists (notelist.ts), dated in ISO */
  listed: (Omit<Listed, "date"> & { date?: string })[]
  /** the songs looked up (sound.ts's cache), by id */
  songs: Record<string, Track>
  /** the users' days fetched for ```streak blocks (streak.ts's cache), by "github:<user>" */
  streaks: Record<string, Fetched>
  /** each `ssr` island as built: its markup, by islandKey */
  islands: Record<string, string>
}

/** an `ssr` island's markup is known by its name and its props */
export const islandKey = (name: string, props: string) => `${name} ${props}`

