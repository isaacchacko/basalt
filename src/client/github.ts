// GitHub, for a built site whose pages edit in place (editor.ts): just the
// calls editing makes to its REST API, with the editor's token. Nothing here
// touches the page, so a script makes the very same calls (the edit proof
// does, against a mock of the API and against GitHub).
//
//   canPush    whether the token may commit to the repo (connecting)
//   read       the note as it is on the branch
//   write      a commit of the note over the version it was read at; a conflict
//              (it was committed to since) gives back the note as it is now
//   blob       the note as the page was built from it, by its sha
//   head       the branch's last commit, its tree, and every file in it
//   commitTree many files changed in one commit (git's own objects: blobs, a
//              tree, a commit, the branch moved to it); a conflict (it was
//              committed to since) when the branch isn't where it was read
//   deployed   the page, fetched till it's the one built from a commit

import { filing } from "./commit.ts"

/** a version of a file, by its sha (git's) */
export interface Version {
  text: string
  sha: string
}

/** a file in a commit's tree */
export interface TreeFile {
  path: string
  mode: string
  sha: string
}

/** a change to a tree: a file's new text, a file's blob (moved, as it was) at a path, or a path gone */
export type TreeChange = { path: string; text: string; mode?: string } | { path: string; sha: string; mode: string } | { path: string; gone: true }

/** a branch, as it is: its commit, that commit's tree, and every file in it */
export interface Head {
  commit: string
  tree: string
  files: TreeFile[]
}

export const API = "https://api.github.com"

export class GitHubError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const base64 = {
  encode(s: string) {
    const bytes = new TextEncoder().encode(s)
    let bin = ""
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(bin)
  },
  decode: (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), (c) => c.charCodeAt(0))),
}

/** The repo ("owner/name") through the token; `api` is GitHub's, or a stand-in's. */
export function gitHub(repo: string, token: string, api = API) {
  const call = (url: string, init: RequestInit = {}) =>
    fetch(`${api}/repos/${repo}${url}`, {
      ...init,
      cache: "no-store",
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28", ...init.headers },
    })
  const fail = async (res: Response) =>
    new GitHubError(res.status, `GitHub ${res.status}${res.status === 401 ? "" : `: ${(await res.json().catch(() => ({}))).message ?? ""}`}`)
  const contents = (path: string) => `/contents/${path.split("/").map(encodeURIComponent).join("/")}`

  const gh = {
    async canPush(): Promise<boolean> {
      const res = await call("").catch(() => undefined)
      const body = res?.ok ? await res.json() : undefined
      return !!body?.permissions?.push
    },
    async read(path: string, branch: string): Promise<Version> {
      const res = await call(`${contents(path)}?ref=${encodeURIComponent(branch)}`)
      if (!res.ok) throw await fail(res)
      const body = await res.json()
      return { text: base64.decode(body.content), sha: body.sha }
    },
    /** commits `text` over the version `base` (its sha): the new sha, or the file as it is when it's no longer `base` */
    async write(path: string, branch: string, text: string, base: string, message: string): Promise<{ sha: string } | { conflict: Version }> {
      const res = await call(contents(path), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, content: base64.encode(text), sha: base, branch }),
      })
      if (res.status === 409 || res.status === 422) {
        const now = await gh.read(path, branch)
        if (now.sha !== base) return { conflict: now }
      }
      if (!res.ok) throw await fail(res)
      return { sha: (await res.json()).content.sha }
    },
    async blob(sha: string): Promise<string> {
      const res = await call(`/git/blobs/${sha}`)
      if (!res.ok) throw await fail(res)
      return base64.decode((await res.json()).content)
    },
    async head(branch: string): Promise<Head> {
      const ref = await call(`/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`)
      if (!ref.ok) throw await fail(ref)
      const commit: string = (await ref.json()).object.sha
      const c = await call(`/git/commits/${commit}`)
      if (!c.ok) throw await fail(c)
      const tree: string = (await c.json()).tree.sha
      const t = await call(`/git/trees/${tree}?recursive=1`)
      if (!t.ok) throw await fail(t)
      const all: { path: string; mode: string; type: string; sha: string }[] = (await t.json()).tree
      return { commit, tree, files: all.filter((f) => f.type === "blob").map(({ path, mode, sha }) => ({ path, mode, sha })) }
    },
    /**
     * One commit of `changes` over `head` (as head() read it), the branch moved
     * to it: the commit's sha; or, the branch moved on since, a conflict (nothing's changed).
     */
    async commitTree(branch: string, head: Head, changes: TreeChange[], message: string): Promise<{ sha: string } | { conflict: true }> {
      const post = async (url: string, body: unknown, method = "POST") => {
        const res = await call(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        if (!res.ok) throw await fail(res)
        return res.json()
      }
      const tree = []
      for (const c of changes) {
        if ("gone" in c) tree.push({ path: c.path, mode: "100644", type: "blob", sha: null })
        else if ("sha" in c) tree.push({ path: c.path, mode: c.mode, type: "blob", sha: c.sha })
        else {
          const blob = await post("/git/blobs", { content: base64.encode(c.text), encoding: "base64" })
          tree.push({ path: c.path, mode: c.mode ?? "100644", type: "blob", sha: blob.sha })
        }
      }
      const made = await post("/git/trees", { base_tree: head.tree, tree })
      const commit = await post("/git/commits", { message, tree: made.sha, parents: [head.commit] })
      // not forced: a branch committed to since isn't a fast-forward, and stays as it is
      const res = await call(`/git/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sha: commit.sha, force: false }),
      })
      if (res.status === 409 || res.status === 422) return { conflict: true }
      if (!res.ok) throw await fail(res)
      return { sha: commit.sha }
    },
  }
  return gh
}

/** the sha of the note a page's html was built from (its article's data-edit-sha) */
export const editShaOf = (html: string) => /<article\b[^>]*\bdata-edit-sha="([0-9a-f]{40})"/.exec(html)?.[1]

/**
 * Fetches the page (`page`) every `every` ms till it's built from the commit
 * `want()` is waiting for, and gives it back; "slow" when that's taken
 * `timeout` ms since it was made, and undefined once there's none to wait for.
 */
export async function deployed<P>(
  page: () => Promise<P | undefined>,
  shaOf: (page: P) => string | undefined,
  want: () => { sha: string; since: number } | null | undefined,
  { every = 4000, timeout = 20 * 60_000, tick = () => {} } = {},
): Promise<P | "slow" | undefined> {
  for (;;) {
    await new Promise((r) => setTimeout(r, every))
    const w = want()
    if (!w) return undefined
    tick()
    if (Date.now() - w.since > timeout) return "slow"
    const got = await page()
    // a newer commit may be waited for by now
    if (got !== undefined && shaOf(got) === want()?.sha) return got
  }
}

// ---------- the editor's backend for a built site (client/backend.ts) ----------

const tokenKey = (repo: string) => `basalt-github-token:${repo}`

/** git's name for a text (what the GitHub API calls a file's sha, and the page's data-edit-sha) */
export async function blobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text)
  const head = new TextEncoder().encode(`blob ${body.length}\0`)
  const all = new Uint8Array(head.length + body.length)
  all.set(head)
  all.set(body, head.length)
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", all))
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * The editor's backend for a built site with "edit" (article[data-edit=github]):
 * the note is read from and committed to its repo with the editor's token
 * (kept in this browser, else asked for once), and only when you publish:
 * till then it's a draft in this browser (draft.ts, publish.ts). GitHub can't
 * render a text, so a block that's new shows
 * its markdown till the deploy the commit sets off is live: render() waits for
 * the page to be built from that commit (its data-edit-sha) and gives back its
 * blocks. Null when there's no token (cancelled).
 */
export async function githubBackend(article: HTMLElement, hooks: import("./backend").EditorHooks): Promise<import("./backend").Backend | null> {
  const { editRepo: repo, editBranch: branch, editPath: path, editSha: pageSha } = article.dataset as Record<string, string>
  const words: Record<string, string> = JSON.parse(document.querySelector<HTMLElement>("[data-edit-words]")?.dataset.editWords ?? "{}")
  const say = (key: string, vars: Record<string, string> = {}) => (words[key] ?? key).replace(/\{(\w+)\}/g, (all, k) => vars[k] ?? all)
  const token = await tokenFor(repo, say)
  if (!token) return null
  const gh = gitHub(repo, token)
  const forgetting = (err: unknown): never => {
    if (err instanceof GitHubError && err.status === 401) {
      try {
        localStorage.removeItem(tokenKey(repo))
      } catch {}
      document.documentElement.removeAttribute("data-edit-connected")
    }
    throw err
  }
  /** the texts committed (and the one loaded), by sha: what a deploy can bring */
  const committed = new Set<string>()
  /** the last commit, and its deploy's page once it's in (one wait, for render() and close() alike) */
  let waiting: { sha: string; since: number; page: Promise<Document | "slow" | undefined> } | null = null
  let learnedPage = false
  const { fetchPage, swapIn } = await import("./swap")
  /** the deploy of the commit `sha`, waited for (a newer commit's takes its place) */
  const wait = (sha: string) => {
    if (waiting?.sha === sha) return waiting
    const w: NonNullable<typeof waiting> = { sha, since: Date.now(), page: Promise.resolve(undefined) }
    const want = () => (waiting === w ? w : null)
    w.page = deployed(fetchPage, (doc) => doc.querySelector<HTMLElement>("article[data-edit-slug]")?.dataset.editSha, want, {
      tick: () => {
        if (want()) hooks.status(say("editDeploying", { s: String(Math.round((Date.now() - w.since) / 1000)) }))
      },
    })
    void w.page.then((page) => {
      if (waiting !== w) return
      waiting = null
      hooks.status(say(page === "slow" ? "editSlowDeploy" : "editLive"))
    })
    waiting = w
    return w
  }

  return {
    saveOn: "publish",
    target: { repo, branch, path },
    async load() {
      // a note the explorer made, not yet published (files.ts): nothing on the branch to read, only what it was made with
      if (article.dataset.editNew !== undefined) return { text: article.dataset.editNew, sha: "" }
      const now = await gh.read(path, branch).catch(forgetting)
      committed.add(now.sha)
      // a page built from this very text: the editor takes its blocks in itself
      if (now.sha === pageSha) learnedPage = true
      return now
    },
    async save(text, base, message = say("editCommit", { path })) {
      hooks.status(say("editPublishing"))
      const res = await gh.write(path, branch, text, base, message).catch(forgetting)
      if ("sha" in res) {
        committed.add(res.sha)
        wait(res.sha)
      }
      return res
    },
    async render(text) {
      // the page as it was built, older than the note: its blocks are drawn wherever their text still is
      if (!learnedPage && pageSha) {
        learnedPage = true
        const old = await gh.blob(pageSha).catch(() => undefined)
        if (old !== undefined) hooks.learn(old, [...article.children].filter((c) => !c.matches("[data-edit-doc]")))
      }
      const sha = await blobSha(text)
      // a text that isn't committed has no deploy to wait for: its new blocks show their markdown
      if (!committed.has(sha)) return null
      const doc = await wait(sha).page
      if (!doc || doc === "slow") return null
      return doc.querySelector("article[data-edit-slug]")?.innerHTML ?? null
    },
    filing() {
      const roots = JSON.parse(document.querySelector<HTMLElement>(".explorer[data-edit-roots]")?.dataset.editRoots ?? "null")
      return roots ? filing({ gh, repo, branch, roots, path, sha: blobSha }) : undefined
    },
    deploying(sha) {
      delete article.dataset.editNew
      committed.add(sha)
      wait(sha)
    },
    async close() {
      // the page, as deployed now; and again once the last commit's deploy is in
      const doc = await fetchPage()
      if (doc) await swapIn(doc)
      const later = await waiting?.page
      if (later && later !== "slow") await swapIn(later)
    },
  }
}

/** the token for the repo: kept in this browser, else asked for */
async function tokenFor(repo: string, say: (key: string, vars?: Record<string, string>) => string): Promise<string | undefined> {
  let token: string | null = null
  try {
    token = localStorage.getItem(tokenKey(repo))
  } catch {}
  return (token ?? (await connect(repo, say))) || undefined
}

/** Asks for a token for the repo, once, in a dialog, and checks it can write there. */
function connect(repo: string, say: (key: string, vars?: Record<string, string>) => string): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog")
    dialog.className = "edit-connect"
    dialog.innerHTML = `<form method="dialog">
      <h2></h2><p class="edit-connect-help"></p>
      <label><span></span><input name="token" type="password" autocomplete="off" spellcheck="false" required></label>
      <p class="edit-connect-error" hidden></p>
      <menu><a target="_blank" rel="noopener"></a><button type="button"></button><button type="submit"></button></menu>
    </form>`
    dialog.querySelector("h2")!.textContent = say("editConnect")
    dialog.querySelector(".edit-connect-help")!.textContent = say("editTokenHelp", { repo })
    dialog.querySelector("label span")!.textContent = say("editToken")
    const link = dialog.querySelector("a")!
    link.textContent = say("editMakeToken")
    link.href = `https://github.com/settings/personal-access-tokens/new?name=${encodeURIComponent(`Basalt ${repo}`)}`
    const [cancel, ok] = dialog.querySelectorAll("button")
    cancel.textContent = say("editCancel")
    ok.textContent = say("editConnectButton")
    const input = dialog.querySelector("input")!
    const error = dialog.querySelector<HTMLElement>(".edit-connect-error")!
    const done = (token: string | null) => {
      dialog.close()
      dialog.remove()
      resolve(token)
    }
    cancel.addEventListener("click", () => done(null))
    dialog.addEventListener("cancel", () => done(null))
    dialog.querySelector("form")!.addEventListener("submit", async (e) => {
      e.preventDefault()
      const token = input.value.trim()
      if (!(await gitHub(repo, token).canPush())) {
        error.hidden = false
        error.textContent = say("editTokenWrong", { repo })
        return
      }
      try {
        localStorage.setItem(tokenKey(repo), token)
      } catch {}
      document.documentElement.setAttribute("data-edit-connected", "")
      done(token)
    })
    document.body.append(dialog)
    dialog.showModal()
  })
}
