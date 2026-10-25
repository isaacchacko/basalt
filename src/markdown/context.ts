// What a markdown plugin knows about the note it's on and the site around it.
//
// The registry (src/lib/registry.ts) is handed in by index.ts rather than
// imported here, so these plugins can be tested without a site on disk: a
// test hands in a registry of its own with useRegistry().

import type { VFile } from "vfile"
import type { Registry } from "../lib/registry"
import type { SiteFile } from "../lib/site"
import type { FullSlug } from "../lib/path"

let source: (() => Registry) | undefined

export function useRegistry(fn: () => Registry) {
  source = fn
}

export function reg(): Registry {
  if (!source) throw new Error("basalt: markdown rendered before the site's registry was set")
  return source()
}

/** The site file a note being rendered came from (by its path), if it's one of the site's. */
export function noteOf(file: VFile): SiteFile | undefined {
  return file.path ? reg().byAbs.get(file.path) : undefined
}

/** The slug of the note being rendered: set by basaltFile, the first plugin. */
export function slugOf(file: VFile): FullSlug {
  return (file.data.slug ?? "index") as FullSlug
}

declare module "vfile" {
  interface DataMap {
    slug: FullSlug
    frontmatter: Record<string, unknown> & { title: string }
  }
}
