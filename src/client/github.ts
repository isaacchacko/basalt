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
//   deployed   the page, fetched till it's the one built from a commit

/** a version of a file, by its sha (git's) */
export interface Version {
  text: string
  sha: string
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
