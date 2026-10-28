// Publishing a built site's draft (draft.ts): nothing is committed till you
// say so here. ⌘S, or a click on the count of unpublished changes in the
// corner, opens a dialog with the note's changes marked as its history marks
// a commit's (lib/marks.ts), the commit's message, and Publish, Keep editing
// (Esc) and Discard (asked once more). The file as it is on GitHub is read
// first: a commit made since the draft began goes into it, around what's
// written, before it's shown, and the dialog says so. One that comes between
// that and Publish is merged the same way and shown again, not committed.
//
// With the explorer's file ops kept too (files.ts, commit.ts), the dialog lists
// them, and the links they take along, above the note's changes; and Publish
// commits them all, with the note, as one commit over the branch as it's read
// (the note merged into the same way). A branch committed to between that and
// Publish is read again and shown again, not committed over.

import type { Backend, Version } from "./backend"
import type { Filing } from "./commit"
import type { Head } from "./github"
import type { Planned } from "./commit"

/** what the editor tells publishing, and does for it */
export interface Drafting {
  /** the note as it's written now (as the file has it), the version it's over, and the sha its draft began over */
  now(): { text: string; saved: Version; began: string }
  /** a commit made since: theirs into the note, around what's written */
  merge(now: Version): void
  /** committed: the file is this now */
  published(v: Version): void
}

/** the note before and after, and whether a commit made since the draft began is in it */
export interface Review {
  before: string
  after: string
  moved: boolean
}

const reviewOf = (d: Drafting): Review => {
  const { text, saved, began } = d.now()
  return { before: saved.text, after: text, moved: began !== saved.sha }
}

/** The note's changes as they'd be committed, against the file as it is on GitHub now (merged into, if it's moved). */
export async function review(backend: Pick<Backend, "load">, d: Drafting): Promise<Review> {
  const remote = await backend.load()
  if (remote.sha !== d.now().saved.sha) d.merge(remote)
  return reviewOf(d)
}

/** Commits the note: the new sha; else (committed to since) theirs merged in, to be shown again. */
export async function publish(backend: Pick<Backend, "save">, d: Drafting, message: string): Promise<{ sha: string } | { review: Review }> {
  const { text, saved } = d.now()
  const res = await backend.save(text, saved.sha, message)
  if ("conflict" in res) {
    d.merge(res.conflict)
    return { review: reviewOf(d) }
  }
  d.published({ text, sha: res.sha })
  return res
}

/** the explorer's ops as they'd be committed, with the note's changes (null: it has none) */
export interface FilesReview {
  head: Head
  planned: Planned
  note: Review | null
}

/** The ops and the note as they'd be committed, over the branch as it is now (the note merged into, if it's moved). */
export async function reviewFiles(f: Filing, d: Drafting | null): Promise<FilesReview> {
  const head = await f.head()
  const on = d && f.noteOn(head)
  if (d && on && on.sha !== d.now().saved.sha && d.now().saved.sha) d.merge({ text: await on.read(), sha: on.sha })
  const note = d && reviewOf(d)
  const planned = await f.plan(head, note && note.after !== note.before ? note.after : null)
  return { head, planned, note: note && note.after !== note.before ? note : null }
}

/** Commits it all as one commit: where the note is now (null: gone); else (committed to since) read again, to be shown again. */
export async function publishFiles(f: Filing, d: Drafting | null, r: FilesReview, message: string): Promise<{ at: string | null } | { review: FilesReview }> {
  const res = await f.commit(r.head, r.planned, message)
  if ("conflict" in res) return { review: await reviewFiles(f, d) }
  if (d) {
    const { text } = d.now()
    d.published({ text, sha: await f.sha(text) })
  }
  return { at: f.published(r.planned) }
}

// ---------- the dialog ----------

type Say = (key: string, vars?: Record<string, string>) => string

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1']), a[href]"

/**
 * The dialog, till it's closed: "published", "kept" (Keep editing, Esc), or
 * "discarded" (once `discard` has dropped the draft).
 */
export function openPublish(o: {
  backend: Pick<Backend, "load" | "save">
  drafting: Drafting
  say: Say
  path: string
  repo: string
  branch: string
  discard(): void
  /** the explorer's ops, when it has some: they're published with the note */
  filing?: Filing
  /** the ops committed: where the note being edited is now (null: it's gone) */
  filed?(at: string | null): void
}): Promise<"published" | "kept" | "discarded"> {
  const { say } = o
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog")
    dialog.className = "edit-connect edit-publish"
    dialog.setAttribute("aria-labelledby", "edit-publish-title")
    dialog.innerHTML = `<form method="dialog">
      <h2 id="edit-publish-title"></h2>
      <p class="edit-publish-to"></p>
      <p class="edit-publish-moved" role="note" hidden></p>
      <ul class="edit-publish-files" hidden></ul>
      <div class="edit-publish-diff" role="region" tabindex="0" aria-busy="true"></div>
      <label><span></span><input name="message" type="text" autocomplete="off" required></label>
      <p class="edit-connect-error" role="alert" hidden></p>
      <menu class="edit-publish-actions"><button type="button" class="edit-publish-discard"></button><button type="button" class="edit-publish-keep"></button><button type="submit" disabled></button></menu>
      <div class="edit-publish-sure" hidden><p></p><menu><button type="button" class="edit-publish-no"></button><button type="button" class="edit-publish-yes"></button></menu></div>
    </form>`
    const $ = <E extends Element>(sel: string) => dialog.querySelector<E>(sel)!
    $("h2").textContent = say("editPublishTitle")
    const f = o.filing
    $(".edit-publish-to").textContent = f ? say("editPublishFiles", { repo: o.repo, branch: o.branch }) : say("editPublishTo", { path: o.path, repo: o.repo, branch: o.branch })
    const diff = $<HTMLElement>(".edit-publish-diff")
    diff.setAttribute("aria-label", say("editChanges"))
    diff.textContent = say(f ? "editReadingFiles" : "editReading")
    const files = $<HTMLUListElement>(".edit-publish-files")
    $("label span").textContent = say("editMessage")
    const input = $<HTMLInputElement>("input")
    input.value = say("editCommit", { path: o.path })
    const error = $<HTMLElement>(".edit-connect-error")
    const moved = $<HTMLElement>(".edit-publish-moved")
    const actions = $<HTMLElement>(".edit-publish-actions")
    const sure = $<HTMLElement>(".edit-publish-sure")
    const discard = $<HTMLButtonElement>(".edit-publish-discard")
    const keep = $<HTMLButtonElement>(".edit-publish-keep")
    const ok = $<HTMLButtonElement>("button[type=submit]")
    const no = $<HTMLButtonElement>(".edit-publish-no")
    const yes = $<HTMLButtonElement>(".edit-publish-yes")
    discard.textContent = say("editDiscard")
    keep.textContent = say("editKeepEditing")
    ok.textContent = say("editPublish")
    $(".edit-publish-sure p").textContent = say("editDiscardSure")
    no.textContent = say("editDiscardNo")
    yes.textContent = say("editDiscardYes")

    let busy = false
    const done = (how: "published" | "kept" | "discarded") => {
      dialog.close()
      dialog.remove()
      resolve(how)
    }
    const failed = (err: unknown) => {
      error.hidden = false
      error.textContent = say("editFailed", { error: (err as Error).message })
    }
    const show = async (r: Review) => {
      const { textMarked } = await import("../lib/marks")
      const html = textMarked(r.before, r.after)
      diff.removeAttribute("aria-busy")
      if (html) diff.innerHTML = html
      else diff.textContent = say("editNothing")
      moved.hidden = !r.moved
      moved.textContent = say("editPublishMoved", { path: o.path })
      ok.disabled = !html
    }

    /** the ops listed, the links they take along, the note's changes below (none: no box) */
    let filed: FilesReview | null = null
    const showFiles = async (r: FilesReview) => {
      filed = r
      const ops = r.planned.ops.map(({ op, why }) => {
        const li = document.createElement("li")
        li.dataset.op = op.op
        const name = (p: string) => p.slice(p.lastIndexOf("/") + 1)
        const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")))
        li.textContent =
          op.op === "create"
            ? say("editFileOpCreate", { path: op.path })
            : op.op === "delete"
              ? say("editFileOpDelete", { path: op.path })
              : say(dirOf(op.from) === dirOf(op.to) && name(op.from) !== name(op.to) ? "editFileOpRename" : "editFileOpMove", { from: op.from, to: op.to })
        if (why) {
          li.dataset.cant = ""
          const em = document.createElement("em")
          em.textContent = say("editFileOpCant", { why: say(`editFileWhy${why[0].toUpperCase()}${why.slice(1)}`) })
          li.append(" ", em)
        }
        return li
      })
      const links = r.planned.links.map(({ path, links }) => {
        const li = document.createElement("li")
        li.dataset.op = "links"
        li.textContent = say("editFileOpLinks", { path, n: String(links) })
        return li
      })
      files.replaceChildren(...ops, ...links)
      files.hidden = false
      diff.hidden = !r.note
      if (r.note) await show(r.note)
      else {
        diff.removeAttribute("aria-busy")
        moved.hidden = true
      }
      // what can't be done now isn't published: the dialog says why, and waits to be discarded
      ok.disabled = r.planned.ops.some((o) => o.why)
      if (!messaged) input.value = commitMessage(r.planned)
    }
    let messaged = false
    input.addEventListener("input", () => (messaged = true))
    const commitMessage = (p: Planned) => {
      const [first] = files.querySelectorAll("li")
      const what = first?.firstChild?.textContent ?? ""
      const more = p.ops.length - 1 + (o.drafting.now().text !== o.drafting.now().saved.text ? 1 : 0)
      return more > 0 ? say("editFileCommitMore", { what, n: String(more) }) : what
    }

    keep.addEventListener("click", () => done("kept"))
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault()
      if (!busy) done("kept")
    })
    const ask = (on: boolean) => {
      sure.hidden = !on
      actions.hidden = on
      ;(on ? no : discard).focus()
    }
    discard.addEventListener("click", () => ask(true))
    no.addEventListener("click", () => ask(false))
    yes.addEventListener("click", () => {
      o.discard()
      f?.discard()
      done("discarded")
    })
    $("form").addEventListener("submit", async (e) => {
      e.preventDefault()
      if (busy || ok.disabled) return
      busy = true
      error.hidden = true
      for (const b of dialog.querySelectorAll("button")) b.disabled = true
      ok.textContent = say("editPublishing")
      try {
        if (f && filed) {
          const res = await publishFiles(f, filed.note ? o.drafting : null, filed, input.value.trim() || commitMessage(filed.planned))
          if ("at" in res) {
            o.filed?.(res.at)
            return done("published")
          }
          // the branch committed to meanwhile: read again, shown again, for Publish again
          await showFiles(res.review)
        } else {
          const res = await publish(o.backend, o.drafting, input.value.trim() || say("editCommit", { path: o.path }))
          if ("sha" in res) return done("published")
          // committed to meanwhile: theirs is in now, shown, for Publish again
          await show(res.review)
        }
      } catch (err) {
        failed(err)
      } finally {
        busy = false
        for (const b of dialog.querySelectorAll("button")) b.disabled = false
        ok.textContent = say("editPublish")
      }
      if (dialog.open) ok.disabled = filed ? filed.planned.ops.some((o) => o.why) : !diff.querySelector("p")
    })
    // Tab and ⇧Tab go round the dialog's own controls
    dialog.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return
      const all = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.checkVisibility())
      if (!all.length) return
      const i = all.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (i <= 0 ? all.length - 1 : i - 1) : i === all.length - 1 ? 0 : i + 1
      e.preventDefault()
      all[next].focus()
    })

    document.body.append(dialog)
    dialog.showModal()
    input.focus()
    ;(f ? reviewFiles(f, o.drafting).then(showFiles) : review(o.backend, o.drafting).then(show)).catch((err) => {
      diff.removeAttribute("aria-busy")
      diff.textContent = ""
      failed(err)
    })
  })
}
