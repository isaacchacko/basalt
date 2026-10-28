// What the explorer does to the site's files while editing (client/files.ts),
// the way Obsidian's file explorer does: a new note (a new folder is one with
// its index.md), a note or a folder renamed or moved, deleted. A rename or a
// move can take the links to it along: every [[wikilink]] and ![[embed]] that
// pointed at it is written again to point where it's gone. While serving, the
// dev server does each at once (integrations/edit.ts); a built site keeps them
// in its draft till they're published, in one commit (client/commit.ts).
//
// Paths are the tree's, as the site's notes are laid out ("blog/a post.md"),
// a folder's without its slash. Nothing here touches a disk or the network,
// so the page and the server share it.

import { slugifyFilePath, splitAnchor, transformLink, stripSlashes, type FilePath, type FullSlug } from "./path.ts"

export type FileOp =
  /** a note, empty or with `text`: a new folder is the folder's index.md, its title the folder's name */
  | { op: "create"; path: string; text?: string }
  /** a note or a folder (with everything in it) gone to `to`: renamed, or moved to another folder; `relink` its links taken along */
  | { op: "move"; from: string; to: string; folder?: boolean; relink?: boolean }
  /** a note, or a folder and everything in it */
  | { op: "delete"; path: string; folder?: boolean }

/** the characters a note's or folder's name can't have: the path's, and the ones a [[link]] would read as its own */
const FORBIDDEN = /[\\/:*?"<>|#^[\]\u0000-\u001f]/

/** Why `name` can't be a note's or folder's name, else undefined. */
export function badName(name: string): string | undefined {
  const n = name.trim()
  if (!n || n === "." || n === "..") return "empty"
  if (n.startsWith(".")) return "dot"
  if (FORBIDDEN.test(n)) return "character"
  return undefined
}

/** Why `p` can't be a path in the tree (one that climbs out, is hidden, or a private note's), else undefined. */
export function badPath(p: string): string | undefined {
  if (!p || p.startsWith("/") || p.endsWith("/")) return "path"
  for (const part of p.split("/")) {
    if (part === "" || part === "." || part === "..") return "path"
    if (badName(part)) return badName(part)
  }
  if (/(^|\/)(node_modules|private)(\/|$)/.test(p)) return "path"
  return undefined
}

export const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "")
export const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1)
export const join = (dir: string, name: string) => (dir && name ? `${dir}/${name}` : dir || name)
/** where a note's page is served ("blog/a post.md" is /blog/a-post, "blog/index.md" /blog; a folder's, its index's) */
export const pageOf = (p: string) => "/" + slugifyFilePath((p.endsWith(".md") ? p : join(p, "index.md")) as FilePath).replace(/(^|\/)index$/, "")
/** a path inside the folder `dir` (itself too) */
export const within = (p: string, dir: string) => p === dir || p.startsWith(dir + "/")

/** where `p` is once `op` is done: elsewhere if it moved, null if it's gone, else itself */
export function after(op: FileOp, p: string): string | null {
  if (op.op === "move") {
    if (op.folder ? within(p, op.from) : p === op.from) return op.to + p.slice(op.from.length)
    return p
  }
  if (op.op === "delete") return (op.folder ? within(p, op.path) : p === op.path) ? null : p
  return p
}

export interface Applied {
  /** every file, once the ops are done */
  files: Set<string>
  /** a file that was there, by where it is now (one that moved, or is just where it was) */
  from: Map<string, string>
  /** a note that's new, by where it is now: the path it was made at */
  made: Map<string, string>
  /** the files that were there and moved with their links taken along (by an op with `relink`), as they were */
  relinked: Set<string>
  /** what couldn't be done, and why: an op's index */
  errors: { at: number; why: string }[]
}

/**
 * The tree's files once `ops` are done, in order, over `files`: a note made
 * where one is, a move onto a file or out of nothing, is an error, and not done.
 */
export function applyOps(files: Iterable<string>, ops: FileOp[]): Applied {
  // each file by where it is now: where it was, or (a new one, marked) where it was made
  const NEW = "\u0000"
  let now = new Map<string, string>([...files].map((f) => [f, f]))
  const relinked = new Set<string>()
  const errors: Applied["errors"] = []
  const dirs = () => new Set([...now.keys()].flatMap((f) => f.split("/").slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join("/"))))
  ops.forEach((op, at) => {
    if (op.op === "create") {
      if (badPath(op.path)) return errors.push({ at, why: "path" })
      if (now.has(op.path) || dirs().has(op.path)) return errors.push({ at, why: "exists" })
      now.set(op.path, NEW + op.path)
      return
    }
    const path = op.op === "move" ? op.from : op.path
    const hit = [...now.keys()].filter((f) => (op.folder ? within(f, path) : f === path))
    if (!hit.length) return errors.push({ at, why: "missing" })
    if (op.op === "move") {
      if (badPath(op.to) || (op.folder && within(op.to, op.from) && op.to !== op.from)) return errors.push({ at, why: "path" })
      const taken = dirs()
      if (hit.some((f) => after(op, f) !== f && (now.has(after(op, f)!) || taken.has(after(op, f)!)))) return errors.push({ at, why: "exists" })
      if (op.relink) for (const f of hit) if (!now.get(f)!.startsWith(NEW)) relinked.add(now.get(f)!)
    }
    const next = new Map<string, string>()
    for (const [f, was] of now) {
      const to = after(op, f)
      if (to !== null) next.set(to, was)
    }
    now = next
  })
  const from = new Map<string, string>()
  const made = new Map<string, string>()
  for (const [f, was] of now) {
    if (was.startsWith(NEW)) made.set(f, was.slice(NEW.length))
    else from.set(f, was)
  }
  return { files: new Set(now.keys()), from, made, relinked, errors }
}

// ---------- links taken along ----------

// the one in markdown/ofm.ts: [[a]] [[a#h]] [[a|b]] ![[a]]
const wikilink = /!?\[\[([^[\]|#\\]+)?(#+[^[\]|#\\]+)?(\\?\|[^[\]#]*)?\]\]/g
// fenced code and `inline code`, as markdown/code.ts finds them: links there are only text
const code = /(^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\2[^\n]*$|`+[^`\n]+`+)/gm

const slugOf = (p: string) => slugifyFilePath(p as FilePath)

/** what `target`, written in the note at `src`, points at: one of `paths`, or undefined (markdown/links.ts's resolveLink) */
function resolve(src: string, target: string, slugs: Map<string, string>): string | undefined {
  const from = slugOf(src)
  const rel = transformLink(from, target, { strategy: "shortest", allSlugs: [...slugs.keys()] as FullSlug[] })
  const url = new URL(rel, "https://base.com/" + stripSlashes(from.replace(/(^|\/)index$/, ""), true))
  let [canonical] = splitAnchor(url.pathname)
  if (canonical.endsWith("/")) canonical += "index"
  const slug = decodeURIComponent(stripSlashes(canonical, true))
  // a folder's name is its index note
  return slugs.get(slug) ?? slugs.get(slug + "/index")
}

const slugsOf = (paths: Iterable<string>) => new Map([...paths].map((p) => [slugOf(p), p]))

/**
 * The note at `src` (now; `was` before), its links to files that moved
 * written again to where they are: `before` the files as they were, `now` as
 * they are, `moved` where each that moved went. A link that still gets there
 * as it's written stays as it is; one that doesn't is written the way it was
 * (a name alone where that's still enough, else the path), its heading and
 * its alias kept. Links in code are left alone.
 */
export function relink(text: string, src: { was: string; now: string }, before: Iterable<string>, now: Iterable<string>, moved: Map<string, string>): { text: string; links: number } {
  const was = slugsOf(before)
  const is = slugsOf(now)
  const names = new Map<string, number>()
  for (const s of is.keys()) names.set(nameOf(s), (names.get(nameOf(s)) ?? 0) + 1)
  let links = 0
  const rewrite = (part: string) =>
    part.replace(wikilink, (value, rawFp: string | undefined) => {
      const fp = rawFp?.trim()
      if (!fp || /^[a-z][a-z0-9+.-]*:/i.test(fp)) return value
      const target = resolve(src.was, fp, was)
      const to = target !== undefined ? moved.get(target) : undefined
      if (to === undefined || resolve(src.now, fp, is) === to) return value
      // as it was written: with .md or without, a folder by its name, a name alone if that's still enough
      const md = /\.md$/i.test(fp)
      let written = to.endsWith("/index.md") && !/(^|\/)index(\.md)?$/i.test(fp) ? dirOf(to) : md ? to : to.replace(/\.md$/, "")
      if (!fp.includes("/") && names.get(nameOf(slugOf(written))) === 1 && resolve(src.now, nameOf(written), is) === to) written = nameOf(written)
      links++
      const at = value.indexOf("[[") + 2
      const lead = rawFp!.match(/^\s*/)![0]
      return value.slice(0, at) + lead + written + rawFp!.slice(lead.length + fp.length) + value.slice(at + rawFp!.length)
    })
  let out = ""
  let last = 0
  for (const m of text.matchAll(code)) {
    out += rewrite(text.slice(last, m.index)) + m[0]
    last = m.index! + m[0].length
  }
  out += rewrite(text.slice(last))
  return { text: out, links }
}

/** Every move in `ops` as from → to, file by file, over `files` (what each file was, by where it ends up). */
export function movesOf(files: Iterable<string>, ops: FileOp[]): Map<string, string> {
  const { from } = applyOps(files, ops)
  const moved = new Map<string, string>()
  for (const [now, was] of from) if (now !== was) moved.set(was, now)
  return moved
}

// ---------- where the tree's files are in a repository ----------

/** a folder of the site's notes and where it is in its repository: `content`'s { from, to } (lib/site.ts) */
export interface Root {
  /** its path in the tree ("" the top) */
  to: string
  /** its path in the repository */
  repo: string
}

/** the root a tree path is under: the deepest */
const rootOf = (roots: Root[], p: string) =>
  roots.filter((r) => !r.to || within(p, r.to)).sort((a, b) => b.to.length - a.to.length)[0]

/** A tree path's path in the repository, or undefined when no folder of notes holds it. */
export function repoPathOf(roots: Root[], p: string): string | undefined {
  const r = rootOf(roots, p)
  return r && join(r.repo, stripSlashes(p.slice(r.to.length)))
}

/** A path in the repository as the tree has it, or undefined when it isn't in a folder of notes. */
export function treePathOf(roots: Root[], repoPath: string): string | undefined {
  const r = roots.filter((r) => !r.repo || within(repoPath, r.repo)).sort((a, b) => b.repo.length - a.repo.length)[0]
  if (!r) return undefined
  const p = join(r.to, stripSlashes(repoPath.slice(r.repo.length)))
  return rootOf(roots, p) === r ? p : undefined
}
