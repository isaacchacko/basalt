// A built site's unpublished edits: a draft of the note, kept in this browser
// (local storage) till it's published or discarded (publish.ts). It's per
// repo, branch and note, and holds the version of the file it's written over,
// and the one it began over: a commit made since it began is merged into it
// before it's published, and the dialog says so. The page's own script reads
// it too (edit.ts: a reload with a draft goes on editing), so nothing heavy
// is imported here.

import type { Version } from "./backend"

export interface Draft {
  /** the note as it's written */
  text: string
  /** the file's version it's written over (its changes are against this) */
  base: Version
  /** the sha it began over: not base's when a commit made since was merged in */
  began: string
  /** the page it's on, and its title: for the corner of another page */
  url: string
  title: string
  /** when it was last written to (ms) */
  at: number
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">

const PREFIX = "basalt-draft:"

/** the drafts of a repo's branch: each key, this prefix and the note's path */
export const draftsOf = (repo: string, branch: string) => `${PREFIX}${repo}@${branch}:`
export const draftKey = (repo: string, branch: string, path: string) => draftsOf(repo, branch) + path

const storage = (): Store | undefined => {
  try {
    return localStorage
  } catch {
    return undefined
  }
}

const isVersion = (v: unknown): v is Version => !!v && typeof (v as Version).text === "string" && typeof (v as Version).sha === "string"
const isDraft = (d: unknown): d is Draft =>
  !!d && typeof (d as Draft).text === "string" && isVersion((d as Draft).base) && typeof (d as Draft).began === "string" && typeof (d as Draft).at === "number"

function read(store: Store | undefined, key: string): Draft | null {
  try {
    const d = JSON.parse(store?.getItem(key) ?? "null")
    return isDraft(d) ? { ...d, url: d.url ?? "", title: d.title ?? "" } : null
  } catch {
    return null
  }
}

/** The draft kept at `key`: what's kept (or null), keep one (false when the browser won't), and drop it. */
export function draftStore(key: string, store: Store | undefined = storage()) {
  return {
    get: () => read(store, key),
    put(d: Draft): boolean {
      try {
        store!.setItem(key, JSON.stringify(d))
        return true
      } catch {
        return false
      }
    },
    drop() {
      try {
        store?.removeItem(key)
      } catch {}
    },
  }
}
export type DraftStore = ReturnType<typeof draftStore>

/** Every draft kept under `prefix` (draftsOf) but `except`'s, newest first. */
export function draftsUnder(prefix: string, except: string, store: Store | undefined = storage()): (Draft & { key: string })[] {
  const out: (Draft & { key: string })[] = []
  try {
    for (let i = 0; i < (store?.length ?? 0); i++) {
      const key = store!.key(i)
      if (!key?.startsWith(prefix) || key === except) continue
      const d = read(store, key)
      if (d) out.push({ ...d, key })
    }
  } catch {}
  return out.sort((a, b) => b.at - a.at)
}
