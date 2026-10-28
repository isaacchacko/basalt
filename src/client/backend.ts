// Where a note being edited in place is read from, saved to and rendered by
// (editor.ts). The editor knows only this; each kind of site has its own:
//
//   dev     while serving: the dev server's /__basalt/source and /__basalt/render
//   github  a built site with "edit": the repo, and the page as it's deployed (github.ts)
//
// A rendering is the note's html as its page has it: its top-level blocks,
// each with the lines of the text it came from (data-src, markdown/lines.ts).
// The editor draws a block from the rendering that has its text.

/** a version of the note's file, by its sha (git's) */
export interface Version {
  text: string
  sha: string
}

export interface Backend {
  /**
   * when the editor saves: a moment after typing stops (idle); or only once
   * you've published what it keeps meanwhile, a draft in this browser
   * (publish: draft.ts, publish.ts)
   */
  saveOn: "idle" | "publish"
  /** publish: where the note's committed (the dialog says), and so its draft's key */
  target?: { repo: string; branch: string; path: string }
  /** the note's file as it is now */
  load(): Promise<Version>
  /** writes `text` over the version `base` (its sha), as `message` (a commit's); else, the file changed since, the file as it is now */
  save(text: string, base: string, message?: string): Promise<{ sha: string } | { conflict: Version }>
  /** the note rendered with `text`, or null when it can't be (a built site: its blocks show their markdown till it's deployed, hooks.learn) */
  render(text: string): Promise<string | null>
  /** editing's over, after its last save: whatever the page does next (dev: the page swapped in once) */
  close?(): Promise<void>
  /** a built site's: the explorer's file ops kept for the branch, as publishing takes them (none: undefined) */
  filing?(): import("./commit").Filing | undefined
  /** a built site's: the note committed as `sha` some other way (with the file ops): its deploy waited for, as a save's is */
  deploying?(sha: string): void
}

/** What a backend may tell the editor of its own accord. */
export interface EditorHooks {
  /** a rendering of `text` came (a deploy, the page as it was built): its blocks are drawn wherever the note, as it is now, has their text */
  learn(text: string, html: string | Element[]): void
  /** a word for the status in the corner */
  status(message?: string): void
}

const json = { "content-type": "application/json", "x-basalt-edit": "1" }

/** While serving: the dev server (integrations/edit.ts). */
export function devBackend(slug: string): Backend {
  return {
    saveOn: "idle",
    async load() {
      const res = await fetch(`/__basalt/source?slug=${encodeURIComponent(slug)}`, { cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    },
    async save(text, base) {
      const res = await fetch("/__basalt/source", { method: "PUT", headers: json, body: JSON.stringify({ slug, text, base }) })
      if (res.status === 409) return { conflict: await res.json() }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? String(res.status))
      return res.json()
    },
    async render(text) {
      const res = await fetch("/__basalt/render", { method: "POST", headers: json, body: JSON.stringify({ slug, text }) }).catch(() => undefined)
      return res?.ok ? (await res.json()).html : null
    },
    async close() {
      const { fetchPage, swapIn } = await import("./swap")
      const doc = await fetchPage()
      if (doc) await swapIn(doc)
    },
  }
}
