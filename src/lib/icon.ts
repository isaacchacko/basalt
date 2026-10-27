// The tab's icon: the site's own (basalt.json "icon", a file in its tree), or
// Basalt's mark. A page links to the file where it's served; what can't fetch
// from the site (the login page in front of it, a card drawn at build) carries
// it inline.

import fs from "node:fs"
import path from "node:path"
import { markSvg } from "./mark.ts"
import { slugifyFilePath, type FilePath } from "./path.ts"
import type { SiteFile } from "./site.ts"

export const MARK = "data:image/svg+xml," + encodeURIComponent(markSvg())

const TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
}

/** the icon for a page's <link rel="icon">: the file at its slug, or the mark */
export function iconHref(icon: string | undefined): string {
  return icon ? "/" + encodeURI(slugifyFilePath(icon.replace(/^\/+/, "") as FilePath)) : MARK
}

/** the icon's file in the site's tree, as a data url; undefined without one, or for a file that isn't an image */
export function iconData(icon: string | undefined, files: SiteFile[]): string | undefined {
  const rel = icon?.replace(/^\/+/, "")
  const file = rel ? files.find((f) => f.rel === rel) : undefined
  const type = file && TYPES[path.extname(file.abs).toLowerCase()]
  return file && type ? `data:${type};base64,${fs.readFileSync(file.abs).toString("base64")}` : undefined
}
