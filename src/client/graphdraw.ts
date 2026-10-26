// Drawing a garden's graph with isaacchacko/graph's renderer, for the graph
// in the side content (graph.ts) and the whole garden on ⌘G (gardengraph.ts):
// the notes and their links, and the files they use (pictures, sounds,
// videos, pdfs, code, data) as smaller nodes coloured by kind, in the page's
// theme. A note's node goes to the note; a sound's plays it; a picture's or a
// pdf's opens it in the viewer; anything else opens the file.

import { navigate } from "astro:transitions/client"
import { GraphRenderer, type GraphData, type Theme } from "@isaacchacko/graph"
// static: every page has the viewer already (a dynamic import here made it a
// namespace, whose helper landed in flexsearch's chunk, loaded by every page)
import { viewSrc } from "./viewer"

export type Note = { id: string; title: string; links: string[]; files?: string[] }

export type FileKind = "image" | "sound" | "video" | "pdf" | "code" | "data" | "file"
const KINDS: [FileKind, RegExp][] = [
  ["image", /\.(png|jpe?g|gif|webp|avif|svg)$/i],
  ["sound", /\.(mp3|m4a|wav|ogg|oga|flac|aac|opus)$/i],
  ["video", /\.(mp4|webm|mov|m4v)$/i],
  ["pdf", /\.pdf$/i],
  ["data", /\.(csv|tsv|json|ya?ml)$/i],
  ["code", /\.(py|ts|tsx|js|jsx|mjs|rs|go|c|h|cpp|java|rb|sh|lua|hs|tex|sql)$/i],
]
/** what kind of file a slug is, by its extension */
export const kindOf = (slug: string): FileKind => KINDS.find(([, re]) => re.test(slug))?.[0] ?? "file"
/** a file's node: its slug, marked so it can't be taken for a note's */
export const FILE = "file:"
export const isFile = (id: string) => id.startsWith(FILE)
const fileName = (slug: string) => decodeURIComponent(slug.split("/").pop() ?? slug)

/** each kind's colour: the site's --graph-<kind>, else one that reads in both themes */
const FALLBACK: Record<FileKind, string> = {
  image: "#3d8a6a",
  sound: "#a8569a",
  video: "#c27a2c",
  pdf: "#c0483c",
  code: "#5a6fb0",
  data: "#4f8fa8",
  file: "",
}
export const kindColour = (kind: FileKind) =>
  cssVar(`--graph-${kind}`, FALLBACK[kind] || cssVar("--gray", "#888"))

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function pageTheme(): Theme {
  return {
    background: null,
    node: cssVar("--graph-node", cssVar("--gray", "#888")),
    link: cssVar("--graph-link", cssVar("--lightgray", "#ddd")),
    text: cssVar("--graph-text", cssVar("--darkgray", "#333")),
    accent: cssVar("--graph-accent", cssVar("--tertiary", "#c84")),
    fontFamily: cssVar("--bodyFont", "system-ui, sans-serif"),
  }
}

/** A note's folder is a note too: blog/post hangs off blog. */
const folderOf = (slug: string) => slug.replace(/\/?[^/]+$/, "").replace(/^$/, "")

/**
 * The notes within `depth` links of `here`, either way, and the files they use
 * (each a link out); every note when depth < 0. `files: false` leaves the files out.
 */
export function neighbourhood(notes: Note[], here: string, depth: number, files = true): GraphData {
  const ids = new Set(notes.map((n) => n.id))
  const resolve = (slug: string) =>
    ids.has(slug) ? slug : ids.has(`${slug}/index`) ? `${slug}/index` : null
  const links: { source: string; target: string }[] = []
  const seen = new Set<string>()
  const add = (source: string, target: string) => {
    const key = [source, target].sort().join("\u0000")
    if (source === target || seen.has(key)) return
    seen.add(key)
    links.push({ source, target })
  }
  for (const n of notes) {
    for (const to of n.links) {
      const target = resolve(to.replace(/#.*$/, ""))
      if (target) add(n.id, target)
    }
    const folder = folderOf(n.id.replace(/\/index$/, ""))
    const parent = folder ? resolve(folder) : null
    if (parent && n.id !== parent) add(parent, n.id)
  }
  // a file is a leaf off every note that uses it
  const fileIds = new Set<string>()
  if (files)
    for (const n of notes)
      for (const f of n.files ?? []) {
        fileIds.add(FILE + f)
        add(n.id, FILE + f)
      }
  let keep = new Set([...ids, ...fileIds])
  if (depth >= 0) {
    keep = new Set([here])
    let frontier = new Set([here])
    for (let i = 0; i < depth; i++) {
      const next = new Set<string>()
      for (const l of links) {
        if (frontier.has(l.source) && !keep.has(l.target)) next.add(l.target)
        if (frontier.has(l.target) && !keep.has(l.source)) next.add(l.source)
      }
      next.forEach((s) => keep.add(s))
      frontier = next
    }
  }
  const accent = cssVar("--secondary", "#2f4a5a")
  return {
    nodes: [
      ...notes
        .filter((n) => keep.has(n.id))
        .map((n) => ({
          id: n.id,
          label: n.title,
          ...(n.id === here ? { color: accent, size: 1.6 } : {}),
        })),
      ...[...fileIds]
        .filter((id) => keep.has(id))
        .map((id) => {
          const slug = id.slice(FILE.length)
          return { id, label: fileName(slug), color: kindColour(kindOf(slug)), size: 0.6 }
        }),
    ],
    links: links
      .filter((l) => keep.has(l.source) && keep.has(l.target))
      // a file sits close to its note
      .map((l) => (isFile(l.target) ? { ...l, length: 0.55 } : l)),
  }
}

export const hrefOf = (slug: string) => "/" + slug.replace(/(^|\/)index$/, "")

/** a sound's node plays its clip, and again stops it */
let playing: { src: string; audio: HTMLAudioElement } | null = null
function playSound(src: string) {
  if (playing?.src === src && !playing.audio.paused) return void playing.audio.pause()
  playing?.audio.pause()
  const audio = new Audio(src)
  playing = { src, audio }
  audio.play().catch(() => {})
}

/** What a file's node does when clicked: play a sound, view a picture or pdf, open the rest. */
async function openFile(slug: string, at: { x: number; y: number }) {
  const src = "/" + encodeURI(slug)
  const kind = kindOf(slug)
  if (kind === "sound") return playSound(src)
  if (kind === "image" || kind === "pdf") {
    return viewSrc(src, kind === "image" ? "image" : "frame", fileName(slug), at)
  }
  window.open(src, "_blank", "noopener")
}

/**
 * A renderer in `el` that keeps to the page's theme: a click on a note goes
 * there (after `onGo`), one on a file opens it; `onHover` hears the node under
 * the pointer.
 */
export function draw(
  el: HTMLElement,
  data: () => GraphData,
  signal: AbortSignal,
  small: boolean,
  onGo?: () => void,
  onHover?: (id: string | null) => void,
) {
  const renderer = new GraphRenderer(el, {
    mode: "select",
    arrows: false,
    // in the margin, nodes sit closer and their labels are set larger, so
    // the graph reads at a column's width
    textSize: small ? 1.5 : 1,
    ...(small ? { forces: { centerForce: 0.4, repelForce: 10, linkForce: 1, linkDistance: 90 } } : {}),
    nodeSize: 1,
    // a graph in the margin is small: keep its labels at the zoom it starts at
    textFadeThreshold: -2,
    theme: pageTheme(),
  })
  renderer.setData(data())
  // for a site's own scripts (and tests): the element knows its renderer
  ;(el as HTMLElement & { graph?: GraphRenderer }).graph = renderer
  renderer.on("nodeClick", ({ id, event }) => {
    if (isFile(id)) {
      const box = el.getBoundingClientRect()
      const at = renderer.getNodeScreenBox(id)
      return void openFile(id.slice(FILE.length), {
        x: box.left + (at?.x ?? (event as PointerEvent | undefined)?.clientX ?? 0),
        y: box.top + (at?.y ?? 0),
      })
    }
    onGo?.()
    navigate(hrefOf(id))
  })
  if (onHover) renderer.on("nodeHover", ({ id }) => onHover(id))
  // this note's colour is the theme's too: the nodes keep their places
  const retheme = () => {
    renderer.setOptions({ theme: pageTheme() })
    renderer.setData(data())
  }
  const themes = new MutationObserver(retheme)
  themes.observe(document.documentElement, { attributes: true, attributeFilter: ["saved-theme", "data-theme", "class", "style"] })
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", retheme, { signal })
  document.addEventListener("themechange", retheme, { signal })
  const destroy = () => {
    themes.disconnect()
    renderer.destroy()
  }
  signal.addEventListener("abort", destroy, { once: true })
  return destroy
}

