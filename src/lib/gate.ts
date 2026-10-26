// The password in front of a built site (a top-level "password": true in
// basalt.json): Vercel middleware, run before every file is served, that lets
// a request through only with the cookie the login page sets.
//
//   no cookie, or a bad one    401, the login page (whatever was asked for: a page, an asset, the search index)
//   POST /__basalt/login       the password right: the cookie, and back to where the reader was going
//   /__basalt/logout           the cookie cleared
//
// The password is the BASALT_PASSWORD env var, read on each request, never
// built in. Without it every request is refused. The cookie is an expiry and
// its HMAC under the password, so changing the password logs everyone out.
//
// It runs alone on Vercel's edge (src/integrations/password.ts strips its
// types and writes it out as is): Web APIs only, and no imports.

export const COOKIE = "basalt-session"
export const LOGIN = "/__basalt/login"
export const LOGOUT = "/__basalt/logout"
const DAYS = 30

export interface GateOptions {
  password: string | undefined
  /** the login page, with {{message}} and {{next}} to fill */
  page: string
  /** what the page says to a wrong password */
  wrong: string
  /** now, in ms (for tests) */
  now?: number
}

const encoder = new TextEncoder()

async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, encoder.encode(data)))
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** equal, in a time that doesn't say where they differ */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** a session cookie's value: when it expires, and its signature */
export async function session(password: string, expires: number): Promise<string> {
  return `${expires}.${await hmac(password, `${COOKIE}:${expires}`)}`
}

async function signedIn(request: Request, password: string, now: number): Promise<boolean> {
  const cookies = request.headers.get("cookie") ?? ""
  const value = cookies
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1)
  const [expires, sig] = (value ?? "").split(".")
  if (!sig || !/^\d+$/.test(expires) || Number(expires) <= now) return false
  return same(sig, await hmac(password, `${COOKIE}:${expires}`))
}

/** where to go after logging in: a path on this site, never another site */
function onSite(next: unknown): string {
  return typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : "/"
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function loginPage(opts: GateOptions, next: string, message: string, status: number): Response {
  // as functions, so a "$" in the path isn't read as a replacement pattern
  const html = opts.page
    .replace("{{message}}", () => (message ? `<p class="message">${esc(message)}</p>` : ""))
    .replace("{{next}}", () => esc(next))
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  })
}

function cookie(value: string, maxAge: number, secure: boolean): string {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`
}

/** What Vercel does with a request: a Response to send, or one with x-middleware-next to serve the file. */
export async function gate(request: Request, opts: GateOptions): Promise<Response> {
  const url = new URL(request.url)
  const now = opts.now ?? Date.now()
  const secure = url.protocol === "https:"
  const { password } = opts
  if (!password) return loginPage(opts, "/", "This site's password isn't set (BASALT_PASSWORD), so it lets no one in.", 503)

  if (url.pathname === LOGOUT)
    return new Response(null, { status: 303, headers: { location: "/", "set-cookie": cookie("", 0, secure), "cache-control": "no-store" } })

  if (url.pathname === LOGIN && request.method === "POST") {
    const form = await request.formData().catch(() => null)
    const given = form?.get("password")
    const next = onSite(form?.get("next"))
    // compared as digests, so the time taken says nothing about the password
    if (typeof given === "string" && same(await hmac(COOKIE, given), await hmac(COOKIE, password))) {
      const expires = now + DAYS * 864e5
      return new Response(null, {
        status: 303,
        headers: { location: next, "set-cookie": cookie(await session(password, expires), DAYS * 86400, secure), "cache-control": "no-store" },
      })
    }
    return loginPage(opts, next, opts.wrong, 401)
  }

  if (await signedIn(request, password, now)) return new Response(null, { headers: { "x-middleware-next": "1" } })
  return loginPage(opts, url.pathname === LOGIN ? "/" : url.pathname + url.search, "", 401)
}
