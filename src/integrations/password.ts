// A site behind a password: a top-level "password": true in basalt.json (or
// basalt.config.ts), and the password itself in the BASALT_PASSWORD env var
// where the site is served, never in a file.
//
// `basalt build` then writes the site as Vercel's Build Output API, in
// <site>/.vercel/output, which Vercel deploys in place of a plain folder:
//
//   static/                         the built site (dist/)
//   functions/_middleware.func/     src/lib/gate.ts, run before every file is served
//   config.json                     every path through the gate, then the files, then 404.html
//
// so nothing, not a page, a picture, the search index or the 404 page, is
// served without the cookie the login page sets. The login page is drawn here,
// in the site's palette and type, and carried in the gate, since the site's
// own stylesheets are behind it. What would show the notes to someone without
// the password isn't built at all: the sitemap, the feeds and the cards
// (og:image) a shared link shows. Only in a built site; `basalt dev` is open.

import fs from "node:fs"
import path from "node:path"
import { stripTypeScriptTypes } from "node:module"
import { fileURLToPath } from "node:url"
import type { AstroIntegration } from "astro"
import { layout, paletteCss, type LayoutConfig } from "../lib/config"
import { loadSite } from "../lib/site"
import { markSvg } from "../lib/mark"
import { say } from "../lib/strings"

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
/** what a reader without the password could learn the notes from */
const UNBUILT = ["sitemap.xml", "rss.xml", "index.xml", "og"]

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** Basalt's own palette and type (its two :root blocks in styles/basalt.scss), as css */
function basaltPalette(): string {
  const scss = fs.readFileSync(path.join(src, "styles", "basalt.scss"), "utf8").replace(/\/\/.*$/gm, "")
  return [/^:root \{[^}]*\}/m, /^:root\[saved-theme="dark"\] \{[^}]*\}/m].map((re) => re.exec(scss)?.[0] ?? "").join("\n")
}

/** The login page, with {{message}} and {{next}} for the gate to fill. */
export function loginPage(cfg: LayoutConfig, site: { title: string; locale?: string }): string {
  const fonts = (cfg.theme.fonts?.load ?? []).map((href) => `<link rel="stylesheet" href="${esc(href)}">`).join("")
  const icon = "data:image/svg+xml," + encodeURIComponent(markSvg())
  const css = `${basaltPalette()}
${paletteCss(cfg)}
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--light); color: var(--darkgray); font-family: var(--bodyFont); }
form { width: min(20rem, calc(100vw - 2rem)); display: grid; gap: 0.6rem; }
h1 { margin: 0 0 0.6rem; font-family: var(--titleFont); font-weight: normal; color: var(--dark); }
label { font-family: var(--titleFont); font-style: italic; color: var(--gray); }
input, button { font: inherit; padding: 0.5rem 0.7rem; border-radius: 6px; border: 1px solid var(--lightgray); background: var(--light); color: var(--dark); }
input:focus { outline: 2px solid var(--secondary); outline-offset: 1px; }
button { cursor: pointer; background: var(--secondary); border-color: var(--secondary); color: var(--light); }
.message { margin: 0; color: var(--tertiary); }`
  return `<!doctype html>
<html lang="${esc(site.locale ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(site.title)}</title>
<link rel="icon" href="${icon}">
${fonts}
<script>(() => { let t; try { t = localStorage.getItem("theme") } catch {} document.documentElement.setAttribute("saved-theme", t ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) })()</script>
<style>${css}</style>
</head>
<body>
<main>
<form method="post" action="/__basalt/login">
<h1>${esc(site.title)}</h1>
{{message}}
<label for="password">${esc(say(cfg.strings, "password"))}</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<input type="hidden" name="next" value="{{next}}">
<button type="submit">${esc(say(cfg.strings, "enter"))}</button>
</form>
</main>
</body>
</html>
`
}

/** The gate as Vercel runs it: gate.ts without its types, given the page and the env var. */
export function middleware(page: string, wrong: string): string {
  const gate = stripTypeScriptTypes(fs.readFileSync(path.join(src, "lib", "gate.ts"), "utf8"))
  return `${gate}
const page = ${JSON.stringify(page)}
const wrong = ${JSON.stringify(wrong)}
export default (request) => gate(request, { password: process.env.BASALT_PASSWORD, page, wrong })
`
}

/** The built site, as Vercel's Build Output API with the gate in front: <site>/.vercel/output. */
export function writeVercelOutput(siteDir: string, dist: string, cfg: LayoutConfig, site: { title: string; locale?: string }): string {
  for (const f of UNBUILT) fs.rmSync(path.join(dist, f), { recursive: true, force: true })
  const out = path.join(siteDir, ".vercel", "output")
  fs.rmSync(out, { recursive: true, force: true })
  fs.cpSync(dist, path.join(out, "static"), { recursive: true })
  const fn = path.join(out, "functions", "_middleware.func")
  fs.mkdirSync(fn, { recursive: true })
  fs.writeFileSync(path.join(fn, ".vc-config.json"), JSON.stringify({ runtime: "edge", entrypoint: "index.js" }, null, 2))
  fs.writeFileSync(path.join(fn, "index.js"), middleware(loginPage(cfg, site), say(cfg.strings, "wrongPassword")))
  const routes = [
    { src: "/(.*)", middlewarePath: "_middleware", continue: true },
    { handle: "filesystem" },
    { src: "/(.*)", status: 404, dest: "/404.html" },
  ]
  fs.writeFileSync(path.join(out, "config.json"), JSON.stringify({ version: 3, routes }, null, 2))
  return out
}

/** A password written into basalt.json would be published with it: refused. */
export function checkPassword(value: unknown): void {
  if (value === undefined || typeof value === "boolean") return
  throw new Error(
    'basalt.json: "password" is true or false. The password itself goes in the BASALT_PASSWORD env var where the site is served, never in a file.',
  )
}

export function passwordGate(): AstroIntegration {
  return {
    name: "basalt-password",
    hooks: {
      "astro:build:start": async () => {
        const { password } = await layout()
        checkPassword(password)
        if (password && !process.env.BASALT_PASSWORD)
          console.warn("basalt: the site has a password, but BASALT_PASSWORD isn't set here: where it's served without it, it lets no one in")
      },
      "astro:build:done": async ({ dir }) => {
        const cfg = await layout()
        if (cfg.password !== true) return
        const site = loadSite()
        const out = writeVercelOutput(site.dir, fileURLToPath(dir), cfg, site.config)
        console.log(`basalt: the site behind its password, for Vercel: ${out}`)
      },
    },
  }
}
