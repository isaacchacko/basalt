// A note's social image: the card a link to it shows where it's shared
// (og:image), 1200×630, in the site's own palette. Its title is set in TeX
// Gyre Pagella (Palatino's free twin, src/fonts), drawn as outlines, so the
// card looks the same on any machine that builds it, fonts or none; sharp
// (Astro's, when it's installed) makes the picture. Cards are kept in the
// site's cache by what's on them, so a note's is made again only when its
// title, description or the site's palette change.

import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { createRequire } from "node:module"
import { B, depth } from "./mark.ts"

export const WIDTH = 1200
export const HEIGHT = 630
const PAD = 96

/** Basalt's light palette (styles/basalt.scss), under the site's */
const PALETTE = { light: "#ffffff", lightgray: "#e3e5ec", gray: "#6b6e78", darkgray: "#1c1c1e", dark: "#000000", secondary: "#1b3fd0" }

export interface Card {
  title: string
  description?: string
  /** the site's title, above */
  site: string
  /** where the note is, below: "isaacchacko.com/blog/a-post" */
  where?: string
  /** the site's light-mode colours, over Basalt's */
  colors?: Record<string, string>
  /** the site's own icon (basalt.json "icon") as a data url, in place of Basalt's mark */
  icon?: string
}

type Font = {
  getAdvanceWidth(text: string, size: number): number
  getPath(text: string, x: number, y: number, size: number): { toPathData(decimals: number): string }
}
let fonts: { bold: Font; italic: Font } | undefined
function loadFonts() {
  if (fonts) return fonts
  const require = createRequire(path.resolve("package.json"))
  // 1.x: 2.0 draws some of Pagella's glyphs (e) as NaN, and throws on its substitutions
  const opentype = require("opentype.js") as { parse(b: ArrayBuffer): Font }
  const read = (f: string) => {
    const buf = fs.readFileSync(path.resolve("src/fonts", f))
    return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  }
  return (fonts = { bold: read("texgyrepagella-bold.otf"), italic: read("texgyrepagella-italic.otf") })
}

/** `text` in lines no wider than `width`, at most `max` of them, the last cut with an ellipsis */
export function wrap(font: Font, text: string, size: number, width: number, max: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ""
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (font.getAdvanceWidth(next, size) <= width || !line) line = next
    else {
      lines.push(line)
      line = w
    }
  }
  if (line) lines.push(line)
  if (lines.length <= max) return lines
  const kept = lines.slice(0, max)
  let last = kept[max - 1]
  while (last && font.getAdvanceWidth(last + "…", size) > width) last = last.replace(/\s*\S+$/, "")
  kept[max - 1] = (last || kept[max - 1]) + "…"
  return kept
}

const colour = (v: string | undefined, fallback: string) => (v && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : fallback)

/** The card as SVG, its words as outlines. */
export function cardSvg(card: Card): string {
  const { bold, italic } = loadFonts()
  const c = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, colour(card.colors?.[k], v)])) as typeof PALETTE
  const width = WIDTH - 2 * PAD
  // the title as large as it fits in three lines
  let size = 76
  let title = wrap(bold, card.title, size, width, 3)
  for (const s of [68, 60, 54]) {
    if (title.length < 3 || !title[2].endsWith("…")) break
    size = s
    title = wrap(bold, card.title, size, width, 3)
  }
  const lead = Math.round(size * 1.12)
  const top = 250
  const paths: string[] = []
  const text = (font: Font, s: string, x: number, y: number, px: number, fill: string) =>
    paths.push(`<path fill="${fill}" d="${font.getPath(s, x, y, px).toPathData(1)}"/>`)
  // the mark and the site's title, as a label: italic, quiet
  const markSize = 44
  const mark = card.icon
    ? `<image x="${PAD - 4}" y="${PAD - 34}" width="${markSize}" height="${markSize}" href="${card.icon}"/>`
    : `<g transform="translate(${PAD - 4} ${PAD - 30}) scale(${markSize / 32})">` +
    depth.map((t) => `<path d="${B}" transform="${t}" fill="${c.light}" stroke="${c.secondary}" stroke-width="1.275" stroke-linejoin="round" paint-order="stroke"/>`).join("") +
    `<path d="${B}" fill="${c.light}" stroke="${c.secondary}" stroke-width="1.275" stroke-linejoin="round" paint-order="stroke"/></g>`
  text(italic, card.site, PAD + markSize + 14, PAD + 2, 32, c.gray)
  title.forEach((line, i) => text(bold, line, PAD, top + i * lead, size, c.dark))
  let y = top + (title.length - 1) * lead
  if (card.description) {
    const desc = wrap(italic, card.description, 34, width, 2)
    y += Math.round(size * 0.55) + 34
    desc.forEach((line, i) => text(italic, line, PAD, y + i * 46, 34, c.darkgray))
  }
  // below: a short rule in the accent, then where it is
  const foot = HEIGHT - PAD + 20
  if (card.where) text(italic, card.where, PAD, foot, 28, c.gray)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    `<rect width="100%" height="100%" fill="${c.light}"/>` +
    `<rect x="${PAD}" y="${foot - 58}" width="72" height="4" fill="${c.secondary}"/>` +
    mark +
    paths.join("") +
    `</svg>`
  )
}

type Sharp = (input: Buffer) => { png(o?: object): { toBuffer(): Promise<Buffer> } }
let sharp: Sharp | null | undefined
function loadSharp(): Sharp | null {
  if (sharp !== undefined) return sharp
  try {
    sharp = createRequire(path.resolve("package.json"))("sharp") as Sharp
  } catch {
    sharp = null
  }
  return sharp
}

/** Whether cards can be made here (sharp is installed). */
export function canDrawCards(): boolean {
  return loadSharp() !== null
}

/** The card as a PNG, from the site's cache when it's been made before (null without sharp). */
export async function cardPng(card: Card, cacheDir: string): Promise<Buffer | null> {
  const draw = loadSharp()
  if (!draw) return null
  const key = crypto.createHash("sha1").update(JSON.stringify(card) + "\0v2").digest("hex").slice(0, 16)
  const file = path.join(cacheDir, `${key}.png`)
  try {
    return fs.readFileSync(file)
  } catch {}
  // plain, not quantised: 20ms a card, against 40-95ms for a third less
  const png = await draw(Buffer.from(cardSvg(card))).png({ compressionLevel: 6 }).toBuffer()
  try {
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(file, png)
  } catch {}
  return png
}
