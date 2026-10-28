// What publishing a built site's draft commits when the explorer has changed
// its files (files.ts, lib/fileops.ts): every op, the links taken along, and
// the notes' drafts, as one commit over the branch as it is (github.ts's
// commitTree). A note that moved keeps its blob; only a text that changed
// is sent again. Nothing here touches the page, so it's tested on its own.

import { after, applyOps, repoPathOf, relink, treePathOf, within, type FileOp, type Root } from "../lib/fileops.ts"
import { slugifyFilePath, type FilePath } from "../lib/path.ts"
import { draftStore, draftsOf, draftsUnder, filesStore, publishedKey } from "./draft.ts"
import type { Head, TreeChange } from "./github.ts"

export interface Planned {
  /** each op, and why it can't be done (when it can't: it's not committed then) */
  ops: { op: FileOp; why?: string }[]
  /** the notes whose links go along: where each is once it's committed, and how many */
  links: { path: string; links: number }[]
  /** the commit's changes to the branch's tree */
  changes: TreeChange[]
  /** where each drafted note is once it's committed (its tree path, null when it's gone), by the path it was drafted at */
  placed: Map<string, string | null>
}

export interface Planning {
  /** the branch as it is now */
  head: Head
  /** where the site's folders of notes are in the repository */
  roots: Root[]
  ops: FileOp[]
  /** the notes as they're drafted, by the path each was drafted at: a note's on the branch, or a new one's, where it was made */
  drafts: Map<string, string>
  /** a file's text on the branch, by its blob's sha */
  read(sha: string): Promise<string>
  /** the notes (as they are on the branch) that may link to the files given, which move; all of them when it's undefined */
  linking?(moved: string[]): Set<string> | undefined
}

/** The commit that publishes the draft, over the branch as it is. */
export async function plan(p: Planning): Promise<Planned> {
  // the branch's files, as the tree has them
  const onBranch = new Map<string, { sha: string; mode: string; repo: string }>()
  for (const f of p.head.files) {
    const tree = treePathOf(p.roots, f.path)
    if (tree !== undefined) onBranch.set(tree, { ...f, repo: f.path })
  }
  const done = applyOps(onBranch.keys(), p.ops)
  const failed = new Map(done.errors.map((e) => [e.at, e.why]))
  // only what can be done is committed: the ops that can, done again without the rest
  const ops = p.ops.filter((_, i) => !failed.has(i))
  const applied = failed.size ? applyOps(onBranch.keys(), ops) : done

  const moved = new Map<string, string>()
  for (const [now, was] of applied.from) if (now !== was && applied.relinked.has(was)) moved.set(was, now)
  const linking = moved.size ? p.linking?.([...moved.keys()]) : new Set<string>()

  const made = new Map(ops.flatMap((o) => (o.op === "create" ? [[o.path, o.text ?? ""] as const] : [])))
  const changes: TreeChange[] = []
  const links: Planned["links"] = []
  const placed = new Map<string, string | null>([...p.drafts.keys()].map((k) => [k, null]))
  const kept = new Set<string>()
  for (const now of applied.files) {
    const repo = repoPathOf(p.roots, now)
    if (repo === undefined) continue
    kept.add(repo)
    const madeAt = applied.made.get(now)
    const was = applied.from.get(now)
    const before = was !== undefined ? onBranch.get(was)! : undefined
    // a new note's draft is the one at the path it was made at; else the one at the path it was
    const key = madeAt ?? was!
    const drafted = p.drafts.get(key)
    if (drafted !== undefined) placed.set(key, now)
    let text = drafted ?? (madeAt !== undefined ? (made.get(madeAt) ?? "") : undefined)
    if (now.endsWith(".md") && moved.size && (drafted !== undefined || linking === undefined || (was !== undefined && linking.has(was)))) {
      const out = relink(text ?? (await p.read(before!.sha)), { was: was ?? now, now }, onBranch.keys(), applied.files, moved)
      if (out.links) {
        links.push({ path: now, links: out.links })
        text = out.text
      }
    }
    if (text !== undefined) changes.push({ path: repo, text, ...(before ? { mode: before.mode } : {}) })
    else if (before && before.repo !== repo) changes.push({ path: repo, sha: before.sha, mode: before.mode })
  }
  for (const [, f] of onBranch) if (!kept.has(f.repo)) changes.push({ path: f.repo, gone: true })
  links.sort((a, b) => a.path.localeCompare(b.path))
  return { ops: p.ops.map((op, i) => ({ op, ...(failed.has(i) ? { why: failed.get(i) } : {}) })), links, changes, placed }
}

// ---------- the draft's ops, for the publish dialog (publish.ts) ----------

type GH = Pick<ReturnType<typeof import("./github.ts").gitHub>, "head" | "commitTree" | "blob">

/** the site's notes as its build has them (static/contentIndex.json): each note's links, by the note's path */
let linked: Promise<Map<string, Set<string>> | undefined> | undefined
export const linkIndex = () =>
  (linked ??= fetch("/static/contentIndex.json")
    .then((r) => r.json())
    .then((all: Record<string, { filePath?: string; links?: string[] }>) => {
      const out = new Map<string, Set<string>>()
      for (const n of Object.values(all)) if (n.filePath) out.set(n.filePath, new Set((n.links ?? []).map(simple)))
      return out
    })
    .catch(() => undefined))
const simple = (slug: string) => slug.replace(/(^|\/)index$/, "") || "index"

/** the notes of the build's index that link to any of `moved` (tree paths); undefined (all of them) without the index */
export function linkingFrom(all: Map<string, Set<string>> | undefined, moved: string[]): Set<string> | undefined {
  if (!all) return undefined
  const slugs = new Set(moved.map((p) => simple(slugifyFilePath(p as FilePath))))
  const out = new Set<string>()
  for (const [path, links] of all) if ([...links].some((l) => slugs.has(l))) out.add(path)
  return out
}

/** what publishing needs of the explorer's ops kept for a branch: none, when there are none */
export interface Filing {
  ops: FileOp[]
  /** the note being edited: its path in the tree */
  note: string
  /** git's name for a text */
  sha(text: string): Promise<string>
  /** the branch, as it is now */
  head(): Promise<Head>
  /** the note being edited, as it is on the branch: undefined when it isn't there (a new one) */
  noteOn(head: Head): { sha: string; read(): Promise<string> } | undefined
  /** the commit, over the branch as read, with the note being edited as `text` (null: as it's drafted, if it is) */
  plan(head: Head, text: string | null): Promise<Planned>
  commit(head: Head, planned: Planned, message: string): Promise<{ sha: string } | { conflict: true }>
  /** committed: the ops and the drafts that went with them are dropped; where the note being edited is now (null: gone) */
  published(planned: Planned): string | null
  /** the ops dropped, and the new notes' drafts with them */
  discard(): void
}

/** The ops kept for the branch, as publishing takes them; undefined when there are none. `path` is the note being edited's (in the repo). */
export function filing(o: { gh: GH; repo: string; branch: string; roots: Root[]; path: string; sha(text: string): Promise<string> }): Filing | undefined {
  const store = filesStore(o.repo, o.branch)
  const ops = store.get()
  if (!ops.length) return undefined
  const note = treePathOf(o.roots, o.path) ?? o.path
  /** the drafts (by tree path, and their keys) of notes the ops make, move or delete: they go in the same commit */
  const touched = () => {
    const out = new Map<string, { key: string; text: string }>()
    for (const d of draftsUnder(draftsOf(o.repo, o.branch), "")) {
      const p = treePathOf(o.roots, d.key.slice(draftsOf(o.repo, o.branch).length))
      if (p === undefined) continue
      const hit = ops.some((op) => (op.op === "create" ? op.path === p : within(p, op.op === "move" ? op.from : op.path)))
      if (hit) out.set(p, { key: d.key, text: d.text })
    }
    return out
  }
  return {
    ops,
    note,
    sha: o.sha,
    async head() {
      const [head] = await Promise.all([o.gh.head(o.branch), linkIndex()])
      return head
    },
    noteOn(head) {
      const f = head.files.find((f) => f.path === o.path)
      return f && { sha: f.sha, read: () => o.gh.blob(f.sha) }
    },
    async plan(head, text) {
      const drafts = new Map([...touched()].map(([p, d]) => [p, d.text]))
      if (text !== null) drafts.set(note, text)
      const all = await linkIndex()
      return plan({ head, roots: o.roots, ops, drafts, read: (sha) => o.gh.blob(sha), linking: (moved) => linkingFrom(all, moved) })
    },
    commit: (head, planned, message) => o.gh.commitTree(o.branch, head, planned.changes, message),
    published(planned) {
      for (const [, d] of touched()) draftStore(d.key).drop()
      store.drop()
      // drawn in the explorer till a page of the site as it's deployed with them comes (another tree)
      try {
        const tree = document.querySelector<HTMLElement>(".sidebar.left[data-tree]")?.dataset.tree
        localStorage.setItem(publishedKey(o.repo, o.branch), JSON.stringify({ ops: planned.ops.filter((o) => !o.why).map((o) => o.op), tree, at: Date.now() }))
      } catch {}
      return planned.ops.reduce<string | null>((p, { op, why }) => (p === null || why ? p : after(op, p)), note)
    },
    discard() {
      for (const [p, d] of touched()) if (ops.some((op) => op.op === "create" && op.path === p)) draftStore(d.key).drop()
      store.drop()
    },
  }
}
