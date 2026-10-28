// Publishing a built site's draft (draft.ts): nothing is committed till you
// say so here. ⌘S, or a click on the count of unpublished changes in the
// corner, opens a dialog with the note's changes marked as its history marks
// a commit's (lib/marks.ts), the commit's message, and Publish, Keep editing
// (Esc) and Discard (asked once more). The file as it is on GitHub is read
// first: a commit made since the draft began goes into it, around what's
// written, before it's shown, and the dialog says so. One that comes between
// that and Publish is merged the same way and shown again, not committed.

import type { Backend, Version } from "./backend"

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

// ---------- the dialog ----------

type Say = (key: string, vars?: Record<string, string>) => string

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1']), a[href]"

/**
 * The dialog, till it's closed: "published", "kept" (Keep editing, Esc), or
 * "discarded" (once `discard` has dropped the draft).
 */
export function openPublish(o: { backend: Pick<Backend, "load" | "save">; drafting: Drafting; say: Say; path: string; repo: string; branch: string; discard(): void }): Promise<"published" | "kept" | "discarded"> {
  const { say } = o
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog")
    dialog.className = "edit-connect edit-publish"
    dialog.setAttribute("aria-labelledby", "edit-publish-title")
    dialog.innerHTML = `<form method="dialog">
      <h2 id="edit-publish-title"></h2>
      <p class="edit-publish-to"></p>
      <p class="edit-publish-moved" role="note" hidden></p>
      <div class="edit-publish-diff" role="region" tabindex="0" aria-busy="true"></div>
      <label><span></span><input name="message" type="text" autocomplete="off" required></label>
      <p class="edit-connect-error" role="alert" hidden></p>
      <menu class="edit-publish-actions"><button type="button" class="edit-publish-discard"></button><button type="button" class="edit-publish-keep"></button><button type="submit" disabled></button></menu>
      <div class="edit-publish-sure" hidden><p></p><menu><button type="button" class="edit-publish-no"></button><button type="button" class="edit-publish-yes"></button></menu></div>
    </form>`
    const $ = <E extends Element>(sel: string) => dialog.querySelector<E>(sel)!
    $("h2").textContent = say("editPublishTitle")
    $(".edit-publish-to").textContent = say("editPublishTo", { path: o.path, repo: o.repo, branch: o.branch })
    const diff = $<HTMLElement>(".edit-publish-diff")
    diff.setAttribute("aria-label", say("editChanges"))
    diff.textContent = say("editReading")
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
        const res = await publish(o.backend, o.drafting, input.value.trim() || say("editCommit", { path: o.path }))
        if ("sha" in res) return done("published")
        // committed to meanwhile: theirs is in now, shown, for Publish again
        await show(res.review)
      } catch (err) {
        failed(err)
      } finally {
        busy = false
        for (const b of dialog.querySelectorAll("button")) b.disabled = false
        ok.textContent = say("editPublish")
      }
      if (dialog.open) ok.disabled = !diff.querySelector("p")
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
    review(o.backend, o.drafting).then(show, (err) => {
      diff.removeAttribute("aria-busy")
      diff.textContent = ""
      failed(err)
    })
  })
}
