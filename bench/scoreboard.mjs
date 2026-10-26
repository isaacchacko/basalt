#!/usr/bin/env node
// The scoreboard: Basalt against upstream Quartz v4 on the same content (the
// savethebees garden), measured, written to BENCHMARKS.md.
//
//   cd bench && npm install            # its own tools: puppeteer-core, lighthouse
//   node bench/scoreboard.mjs [--garden ~/Programs/savethebees/garden]
//                             [--quartz ~/bench/quartz-upstream]   a pristine clone of jackyzha0/quartz v4
//                             [--work ~/.cache/basalt-bench]       where both sites are staged and built
//                             [--runs 3] [--only build,weight,lighthouse,reload,deps,config]
//                             [--chrome /usr/bin/google-chrome-stable]
//
// Both sites are copies, so neither the garden nor the Quartz clone is touched.
// Quartz gets the garden's notes laid out the way basalt.json's `content` maps
// them, and only three changes to its stock config: the title, the base URL,
// and no analytics. Results go to bench/results.json (merged, so `--only`
// re-measures one section) and BENCHMARKS.md is written from it.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import http from "node:http"
import zlib from "node:zlib"
import { spawn, spawnSync, execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const basalt = path.dirname(here)
const require = createRequire(path.join(here, "package.json"))
const home = os.homedir()

const flags = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") ? true : (argv[++i] ?? true)
const expand = (p) => path.resolve(String(p).replace(/^~(?=$|\/)/, home))
const garden = expand(flags.garden ?? "~/Programs/savethebees/garden")
const quartzSrc = expand(flags.quartz ?? "~/bench/quartz-upstream")
const work = expand(flags.work ?? "~/.cache/basalt-bench")
const runs = Number(flags.runs ?? 3)
const chromePath = flags.chrome ?? ["/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p))
const sections = ["config", "deps", "build", "weight", "lighthouse", "reload"]
const only = flags.only ? String(flags.only).split(",") : sections
const resultsFile = path.join(here, "results.json")
const outFile = path.join(basalt, "BENCHMARKS.md")

const log = (...a) => console.error("[bench]", ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const git = (dir, ...args) => {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim()
  } catch {
    return "?"
  }
}

// ---------------------------------------------------------------- staging

const siteRoot = path.dirname(garden)
const stagedRoot = path.join(work, "site")
const stagedGarden = path.join(stagedRoot, path.basename(garden))
const quartzWork = path.join(work, "quartz")
const quartzContent = path.join(quartzWork, "content")
const quartzOut = path.join(quartzWork, "public")
const basaltOut = path.join(stagedGarden, ".basalt", "astro", "dist")
const skip = new Set([".basalt", "node_modules", ".git", ".next", ".quartz-cache"])
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, force: true, filter: (p) => !skip.has(path.basename(p)) })
const siteJson = JSON.parse(fs.readFileSync(path.join(garden, "basalt.json"), "utf8"))

function stage() {
  fs.rmSync(stagedRoot, { recursive: true, force: true })
  copy(garden, stagedGarden)
  for (const { from } of siteJson.content ?? [{ from: "notes" }]) {
    const abs = path.resolve(garden, from)
    if (!abs.startsWith(siteRoot + path.sep)) throw new Error(`${from} is outside ${siteRoot}`)
    if (!abs.startsWith(garden + path.sep)) copy(abs, path.join(stagedRoot, path.relative(siteRoot, abs)))
  }
  // Quartz: a copy of the clone with its packages linked, the stock config, and
  // the garden's files laid out as basalt.json maps them
  fs.rmSync(quartzWork, { recursive: true, force: true })
  copy(quartzSrc, quartzWork)
  fs.rmSync(quartzContent, { recursive: true, force: true })
  fs.rmSync(quartzOut, { recursive: true, force: true })
  fs.symlinkSync(path.join(quartzSrc, "node_modules"), path.join(quartzWork, "node_modules"))
  for (const { from, to = "" } of siteJson.content ?? [{ from: "notes" }]) copy(path.resolve(garden, from), path.join(quartzContent, to))
  const cfgFile = path.join(quartzWork, "quartz.config.ts")
  let cfg = fs.readFileSync(cfgFile, "utf8")
  cfg = cfg
    .replace(/pageTitle: "[^"]*"/, `pageTitle: ${JSON.stringify(siteJson.title ?? "Garden")}`)
    .replace(/baseUrl: "[^"]*"/, `baseUrl: ${JSON.stringify(siteJson.baseUrl ?? "example.com")}`)
    .replace(/analytics: \{[^}]*\}/, "analytics: null")
  fs.writeFileSync(cfgFile, cfg)
}

// ---------------------------------------------------------------- builds

function sh(cmd, args, cwd, opts = {}) {
  const t0 = performance.now()
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...opts.env }, maxBuffer: 1 << 28 })
  const ms = performance.now() - t0
  if (r.status !== 0 && !opts.ok) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}\n${(r.stdout ?? "").slice(-3000)}\n${(r.stderr ?? "").slice(-3000)}`)
  return { ms, out: (r.stdout ?? "") + (r.stderr ?? "") }
}
const basaltCli = path.join(basalt, "bin", "basalt.mjs")
const quartzCli = path.join(quartzWork, "quartz", "bootstrap-cli.mjs")
const sites = {
  basalt: {
    build: () => sh(process.execPath, [basaltCli, "build", stagedGarden], stagedRoot),
    clean: () => fs.rmSync(path.join(stagedGarden, ".basalt"), { recursive: true, force: true }),
    out: basaltOut,
  },
  quartz: {
    build: () => sh(process.execPath, [quartzCli, "build", "-d", "content", "-o", "public"], quartzWork),
    clean: () => {
      fs.rmSync(path.join(quartzWork, ".quartz-cache"), { recursive: true, force: true })
      fs.rmSync(quartzOut, { recursive: true, force: true })
    },
    out: quartzOut,
  },
}

function measureBuilds() {
  const res = {}
  for (const [name, s] of Object.entries(sites)) {
    const cold = []
    const warm = []
    for (let i = 0; i < runs; i++) {
      s.clean()
      cold.push(s.build().ms)
      warm.push(s.build().ms)
      log(name, "cold", cold.at(-1).toFixed(0), "warm", warm.at(-1).toFixed(0))
    }
    res[name] = { cold: median(cold), warm: median(warm), pages: htmlPages(s.out).length }
  }
  return res
}

function htmlPages(dir) {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".html")) out.push(path.relative(dir, p))
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return out
}
/** "/a/b" for a/b.html (Quartz) or a/b/index.html (Basalt) */
const routeOf = (rel) => "/" + rel.replace(/\\/g, "/").replace(/(^|\/)index\.html$/, "").replace(/\.html$/, "")

// ---------------------------------------------------------------- serving built sites

/** a static server like a host's: clean URLs, gzip, a 404 page */
function serve(root) {
  const gz = new Map()
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff", ".xml": "application/xml", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".pdf": "application/pdf", ".wasm": "application/wasm", ".ico": "image/x-icon", ".txt": "text/plain" }
  const compressible = /\.(html|js|mjs|css|json|svg|xml|txt|wasm)$/
  const resolve = (url) => {
    let p = decodeURIComponent(url.split(/[?#]/)[0])
    const abs = path.join(root, p)
    if (!abs.startsWith(root)) return null
    for (const c of [abs, abs + ".html", path.join(abs, "index.html")]) if (fs.statSync(c, { throwIfNoEntry: false })?.isFile()) return c
    return null
  }
  const server = http.createServer((req, res) => {
    let file = resolve(req.url)
    let status = 200
    if (!file) {
      status = 404
      file = path.join(root, "404.html")
      if (!fs.existsSync(file)) return res.writeHead(404).end()
    }
    const type = types[path.extname(file)] ?? "application/octet-stream"
    let body = fs.readFileSync(file)
    const headers = { "content-type": type, "cache-control": "no-cache" }
    // byte ranges, as any host answers them: without, a video's metadata costs the whole video
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "")
    if (range && status === 200 && !compressible.test(file)) {
      const size = body.length
      const start = range[1] ? Number(range[1]) : size - Number(range[2])
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start >= size || start > end) return res.writeHead(416, { "content-range": `bytes */${size}` }).end()
      return res
        .writeHead(206, { ...headers, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 })
        .end(body.subarray(start, end + 1))
    }
    if (!compressible.test(file)) headers["accept-ranges"] = "bytes"
    if (compressible.test(file) && /gzip/.test(req.headers["accept-encoding"] ?? "")) {
      if (!gz.has(file)) gz.set(file, zlib.gzipSync(body, { level: 9 }))
      body = gz.get(file)
      headers["content-encoding"] = "gzip"
    }
    res.writeHead(status, headers).end(body)
  })
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })))
}

// ---------------------------------------------------------------- page weight

async function browser() {
  const puppeteer = require("puppeteer-core")
  return puppeteer.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--hide-scrollbars"] })
}

/** what a visit to the page loads, by kind, in bytes over the wire (gzip) */
async function weigh(b, url, blocked = []) {
  const page = await b.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const cdp = await page.createCDPSession()
  await cdp.send("Network.enable")
  if (blocked.length) await cdp.send("Network.setBlockedURLs", { urls: blocked })
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
  const reqs = new Map()
  cdp.on("Network.responseReceived", (e) => reqs.set(e.requestId, { url: e.response.url, type: e.type, bytes: 0 }))
  cdp.on("Network.loadingFinished", (e) => {
    const r = reqs.get(e.requestId)
    if (r) r.bytes = e.encodedDataLength
  })
  await page.goto(url, { waitUntil: "load", timeout: 60000 })
  // a page that streams (a video) never goes fully quiet: wait for quiet, up to 10s
  const quiet = await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).then(() => true, () => false)
  await page.close()
  const by = { document: 0, script: 0, stylesheet: 0, font: 0, image: 0, media: 0, other: 0, requests: 0, thirdParty: 0 }
  const origin = new URL(url).origin
  for (const r of reqs.values()) {
    if (r.url.startsWith("data:")) continue
    const k = { Document: "document", Script: "script", Stylesheet: "stylesheet", Font: "font", Image: "image", Media: "media" }[r.type] ?? "other"
    by[k] += r.bytes
    by.requests++
    if (!r.url.startsWith(origin)) by.thirdParty += r.bytes
  }
  by.quiet = quiet
  // the page, apart from the site's own video and sound (savethebees plays a backdrop video, which Quartz has no way to)
  by.page = by.document + by.script + by.stylesheet + by.font + by.image + by.other
  by.total = by.page + by.media
  return by
}

/** the routes both builds have, the 404 page left out */
function sharedRoutes() {
  const q = new Set(htmlPages(quartzOut).map(routeOf))
  return htmlPages(basaltOut).map(routeOf).filter((r) => q.has(r) && !/404/.test(r)).sort()
}

async function measureWeight() {
  const routes = sharedRoutes()
  const b = await browser()
  // Basalt as Quartz sees the garden: its islands (which Quartz can't run) blocked; and as shipped
  const res = { routes, blocked: islandPatterns(), basalt: {}, basaltShipped: {}, quartz: {} }
  for (const [name, site, blocked] of [["basalt", "basalt", res.blocked], ["basaltShipped", "basalt", []], ["quartz", "quartz", []]]) {
    const srv = await serve(sites[site].out)
    for (const r of routes) res[name][r] = await weigh(b, srv.url + r, blocked)
    srv.close()
    log(name, "weighed", routes.length, "pages")
  }
  await b.close()
  return res
}

// ---------------------------------------------------------------- lighthouse

const lhRoutes = (routes) => ["/", "/about", routes.find((r) => r.startsWith("/blog/") && r !== "/blog")].filter((r) => r && routes.includes(r))

/**
 * The garden's own islands (its backdrop, its music shelf): Quartz can't run
 * them, so Basalt is scored with their scripts blocked too ("bare"), and as
 * shipped apart.
 */
function islandPatterns() {
  const dir = path.join(garden, "islands")
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => /\.(tsx?|jsx?|mjs)$/.test(f)).map((f) => `*/_astro/${f.replace(/\.\w+$/, "")}.*`)
}

async function measureLighthouse(routes) {
  const { default: lighthouse } = await import(require.resolve("lighthouse"))
  const chromeLauncher = await import(require.resolve("chrome-launcher"))
  const chrome = await chromeLauncher.launch({ chromePath, chromeFlags: ["--headless=new", "--no-sandbox"] })
  const res = { routes: lhRoutes(routes), blocked: islandPatterns(), basalt: {}, basaltShipped: {}, quartz: {} }
  for (const [name, site, blocked] of [["basalt", "basalt", res.blocked], ["basaltShipped", "basalt", []], ["quartz", "quartz", []]]) {
    const srv = await serve(sites[site].out)
    for (const r of res.routes) {
      const scores = []
      for (let i = 0; i < runs; i++) {
        const { lhr } = await lighthouse(srv.url + r, { port: chrome.port, output: "json", logLevel: "error", blockedUrlPatterns: blocked, onlyCategories: ["performance", "accessibility", "best-practices", "seo"] })
        scores.push({
          performance: lhr.categories.performance.score * 100,
          accessibility: lhr.categories.accessibility.score * 100,
          bestPractices: lhr.categories["best-practices"].score * 100,
          seo: lhr.categories.seo.score * 100,
          fcp: lhr.audits["first-contentful-paint"].numericValue,
          lcp: lhr.audits["largest-contentful-paint"].numericValue,
          tbt: lhr.audits["total-blocking-time"].numericValue,
          cls: lhr.audits["cumulative-layout-shift"].numericValue,
          a11yFails: Object.values(lhr.audits)
            .filter((a) => lhr.categories.accessibility.auditRefs.some((ref) => ref.id === a.id && ref.weight > 0) && a.score === 0)
            .map((a) => a.id),
        })
      }
      const m = {}
      for (const k of Object.keys(scores[0])) m[k] = k === "a11yFails" ? scores[0][k] : median(scores.map((s) => s[k]))
      res[name][r] = m
      log(name, r, "perf", m.performance, "a11y", m.accessibility)
    }
    srv.close()
  }
  await chrome.kill()
  return res
}

// ---------------------------------------------------------------- dev server: start and hot reload

async function until(fn, ms = 60000, every = 50) {
  const end = Date.now() + ms
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch {}
    if (Date.now() > end) return null
    await sleep(every)
  }
}
const ok = async (url) => (await fetch(url)).status === 200

/** the note a reload is timed on, and its route: the garden's /now page, else its first */
function editTarget() {
  for (const { from, to = "" } of siteJson.content ?? []) {
    const abs = path.resolve(garden, from)
    if (fs.existsSync(path.join(abs, "now.md"))) return { rel: path.join(path.relative(siteRoot, abs), "now.md"), qrel: path.join(to, "now.md"), route: "/" + path.posix.join(to, "now") }
  }
  throw new Error("no now.md to edit")
}

/** save the note with a new line, time until an open page shows it, and whether the page kept its scroll */
async function timeReloads(page, file, label) {
  const original = fs.readFileSync(file, "utf8")
  const out = []
  try {
    for (let i = 0; i < Math.max(runs, 5); i++) {
      await page.evaluate(() => window.scrollTo(0, Math.floor((document.documentElement.scrollHeight - innerHeight) / 2)))
      await sleep(300)
      const before = await page.evaluate(() => scrollY)
      const token = `benchtoken${Date.now()}x${i}`
      const t0 = performance.now()
      fs.writeFileSync(file, original + `\n\n${token}\n`)
      const seen = await until(() => page.evaluate((t) => document.body?.innerText.includes(t), token), 30000, 10)
      const ms = performance.now() - t0
      await sleep(400)
      const after = await page.evaluate(() => scrollY).catch(() => -1)
      out.push({ ms: seen ? ms : null, kept: Math.abs(after - before) < 4, before, after })
      log(label, "reload", seen ? ms.toFixed(0) : "timeout", "scroll", before, "->", after)
      fs.writeFileSync(file, original)
      await sleep(1500)
    }
  } finally {
    fs.writeFileSync(file, original)
  }
  const times = out.map((o) => o.ms).filter((x) => x !== null)
  return { reload: times.length ? median(times) : null, misses: out.length - times.length, scrollKept: out.filter((o) => o.kept).length, tries: out.length, samples: out.map((o) => o.ms && Math.round(o.ms)) }
}

/** load a page, and let it settle (a page that streams a video never goes fully quiet) */
async function open(page, url) {
  await page.goto(url, { waitUntil: "load", timeout: 120000 })
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {})
  await sleep(1000)
}

async function measureReload() {
  const target = editTarget()
  const b = await browser()
  const res = {}
  // Basalt
  {
    sites.basalt.clean()
    const port = 4471
    const t0 = performance.now()
    sh(process.execPath, [basaltCli, "dev", stagedGarden, "--port", String(port)], stagedRoot)
    try {
      const url = `http://localhost:${port}${target.route}`
      await until(() => ok(url), 120000, 100)
      const start = performance.now() - t0
      const page = await b.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      await open(page, url)
      res.basalt = { start, ...(await timeReloads(page, path.join(stagedRoot, target.rel), "basalt")) }
      await page.close()
    } finally {
      sh(process.execPath, [basaltCli, "stop", stagedGarden], stagedRoot, { ok: true })
    }
  }
  // Quartz
  {
    sites.quartz.clean()
    const port = 8471
    const t0 = performance.now()
    const child = spawn(process.execPath, [quartzCli, "build", "--serve", "-d", "content", "-o", "public", "--port", String(port), "--wsPort", "3471"], { cwd: quartzWork, stdio: "ignore", detached: true })
    try {
      const url = `http://localhost:${port}${target.route}`
      await until(() => ok(url), 120000, 100)
      const start = performance.now() - t0
      const page = await b.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      await open(page, url)
      res.quartz = { start, ...(await timeReloads(page, path.join(quartzContent, target.qrel), "quartz")) }
      await page.close()
    } finally {
      process.kill(-child.pid, "SIGTERM")
    }
  }
  await b.close()
  res.route = target.route
  return res
}

// ---------------------------------------------------------------- dependencies

function lockPackages(dir) {
  const lock = JSON.parse(fs.readFileSync(path.join(dir, "package-lock.json"), "utf8"))
  const all = Object.entries(lock.packages).filter(([k]) => k)
  return { prod: all.filter(([, v]) => !v.dev).length, all: all.length }
}
function duBytes(dir) {
  return Number(execFileSync("du", ["-sb", dir], { encoding: "utf8" }).split("\t")[0])
}
function measureDeps() {
  const res = {}
  for (const [name, dir] of [["basalt", basalt], ["quartz", quartzSrc]]) {
    const at = path.join(work, "install", name)
    fs.rmSync(at, { recursive: true, force: true })
    fs.mkdirSync(at, { recursive: true })
    for (const f of ["package.json", "package-lock.json"]) fs.copyFileSync(path.join(dir, f), path.join(at, f))
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
    const { ms } = sh("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], at)
    res[name] = { direct: Object.keys(pkg.dependencies ?? {}).length, ...lockPackages(dir), bytes: duBytes(path.join(at, "node_modules")), installMs: ms }
    log(name, "deps", res[name])
  }
  return res
}

// ---------------------------------------------------------------- config

/** lines that say something: not blank, not a comment */
function configLines(file) {
  if (!fs.existsSync(file)) return 0
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trim()
      return t && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*") && !t.startsWith("*/")
    }).length
}
function measureConfig() {
  // a working site from scratch: `basalt new`'s basalt.json, against the two files Quartz ships and you edit
  const scratch = path.join(work, "scratch")
  fs.rmSync(scratch, { recursive: true, force: true })
  sh(process.execPath, [basaltCli, "new", scratch, "--title", "My garden"], work)
  return {
    basalt: { scratch: configLines(path.join(scratch, "basalt.json")), files: ["basalt.json"], garden: configLines(path.join(garden, "basalt.json")) + configLines(path.join(garden, "basalt.config.ts")) },
    quartz: { scratch: configLines(path.join(quartzSrc, "quartz.config.ts")) + configLines(path.join(quartzSrc, "quartz.layout.ts")), files: ["quartz.config.ts", "quartz.layout.ts"] },
  }
}

// ---------------------------------------------------------------- the report

const kb = (n) => (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB"
const mb = (n) => (n / 1048576).toFixed(1) + " MB"
const s = (ms) => (ms / 1000).toFixed(2) + " s"
const msf = (ms) => (ms == null ? "n/a" : Math.round(ms) + " ms")
/** who wins a row, and by how much */
function verdict(b, q, lower = true) {
  if (b == null || q == null) return "?"
  if (b === q) return "tie"
  const basaltWins = lower ? b < q : b > q
  const [hi, lo] = b > q ? [b, q] : [q, b]
  const by = lo > 0 ? `${(hi / lo).toFixed(hi / lo < 10 ? 1 : 0)}×` : "∞"
  return basaltWins ? `**Basalt**, ${lower ? by + " less" : "+" + round(hi - lo)}` : `Quartz, ${lower ? by + " less" : "+" + round(hi - lo)}`
}
const round = (x) => Math.round(x * 10) / 10

function report(R) {
  const rows = [] // [section, measure, basalt, quartz, verdict, basaltWins]
  const add = (measure, b, q, fmt, lower = true) => {
    const v = verdict(b, q, lower)
    rows.push([measure, fmt(b), fmt(q), v])
  }
  const L = []
  L.push("# Benchmarks: Basalt against Quartz", "")
  L.push("Generated by `node bench/scoreboard.mjs`; don't edit by hand. Both build the same content, the [savethebees](https://github.com/isaacchacko/savethebees) garden, laid out for Quartz the way its `basalt.json` maps it. Quartz is upstream v4 with its stock config (title, base URL and no analytics changed). Every time is a median.", "")
  const m = R.meta
  L.push(`Measured ${m.at} on ${m.cpu} (${m.cores} threads, ${m.mem} GB), Node ${m.node}, Chrome ${m.chrome}. Basalt \`${m.basalt}\`, Quartz \`${m.quartz}\` (${m.quartzVersion}), savethebees \`${m.garden}\`. ${m.runs} runs each.`, "")
  const table = (title, intro, body) => {
    L.push(`## ${title}`, "")
    if (intro) L.push(intro, "")
    L.push("| measure | Basalt | Quartz | better |", "|---|---|---|---|")
    const start = rows.length
    body()
    for (const r of rows.slice(start)) L.push(`| ${r.join(" | ")} |`)
    L.push("")
  }
  if (R.build) {
    table("Build", `Cold: caches removed first. Warm: built again straight after. Pages: HTML files written.`, () => {
      add("cold build", R.build.basalt.cold, R.build.quartz.cold, s)
      add("warm build", R.build.basalt.warm, R.build.quartz.warm, s)
      rows.push(["pages", String(R.build.basalt.pages), String(R.build.quartz.pages), ""])
    })
  }
  if (R.weight) {
    const sum = (name, k, agg) => agg(R.weight.routes.map((r) => R.weight[name][r][k]))
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
    table(
      "Page weight",
      `What a visit loads before the network goes quiet, over the wire (gzip and byte ranges, as a host serves it), cache off, at 1440×900, on the ${R.weight.routes.length} pages both builds have. Median page, then the heaviest.`,
      () => {
        for (const [k, label] of [["script", "JS"], ["stylesheet", "CSS"], ["document", "HTML"], ["font", "fonts"], ["image", "images"], ["other", "other (data, icons)"], ["page", "page, without video and sound"], ["media", "video and sound"]]) {
          add(`${label}, median page`, sum("basalt", k, median), sum("quartz", k, median), kb)
        }
        const heaviest = (name, k) => R.weight.routes.reduce((a, r) => (R.weight[name][r][k] > R.weight[name][a][k] ? r : a))
        add(`page, heaviest (Basalt \`${heaviest("basalt", "page")}\`, Quartz \`${heaviest("quartz", "page")}\`)`, sum("basalt", "page", (x) => Math.max(...x)), sum("quartz", "page", (x) => Math.max(...x)), kb)
        add("everything, heaviest page", sum("basalt", "total", (x) => Math.max(...x)), sum("quartz", "total", (x) => Math.max(...x)), kb)
        add("requests, median page", sum("basalt", "requests", median), sum("quartz", "requests", median), String)
        add("third-party bytes, median page", sum("basalt", "thirdParty", median), sum("quartz", "thirdParty", median), kb)
      },
    )
    if (Object.keys(R.weight.basaltShipped ?? {}).length) {
      const ship = (k, agg) => agg(R.weight.routes.map((r) => R.weight.basaltShipped[r][k]))
      L.push(
        `Basalt above has the garden's own islands blocked, as for Lighthouse. As shipped, with them (its backdrop video, its music shelf's covers): median page ${kb(ship("total", median))}, heaviest ${kb(ship("total", (x) => Math.max(...x)))}, ${ship("requests", median)} requests on the median page.`,
        "",
      )
    }
    L.push("<details><summary>Every page</summary>", "", "| page | Basalt JS | Quartz JS | Basalt CSS | Quartz CSS | Basalt page | Quartz page | Basalt video and sound | Quartz video and sound |", "|---|---|---|---|---|---|---|---|---|")
    for (const r of R.weight.routes) {
      const b = R.weight.basalt[r], q = R.weight.quartz[r]
      L.push(`| ${r} | ${kb(b.script)} | ${kb(q.script)} | ${kb(b.stylesheet)} | ${kb(q.stylesheet)} | ${kb(b.page)} | ${kb(q.page)} | ${kb(b.media)} | ${kb(q.media)} |`)
    }
    L.push("", "</details>", "")
  }
  if (R.lighthouse) {
    table("Lighthouse", `Lighthouse ${R.meta.lighthouse}, mobile, simulated throttling, median of ${R.meta.runs}, on ${R.lighthouse.routes.map((r) => "`" + r + "`").join(", ")}.`, () => {
      for (const r of R.lighthouse.routes) {
        const b = R.lighthouse.basalt[r], q = R.lighthouse.quartz[r]
        add(`\`${r}\` performance`, b.performance, q.performance, String, false)
        add(`\`${r}\` accessibility`, b.accessibility, q.accessibility, String, false)
        add(`\`${r}\` largest paint`, b.lcp, q.lcp, msf)
        add(`\`${r}\` blocking time`, b.tbt, q.tbt, msf)
      }
    })
    if (Object.keys(R.lighthouse.basaltShipped ?? {}).length) {
      L.push(`Basalt above has the garden's own islands blocked (${R.lighthouse.blocked.map((b) => "`" + b + "`").join(", ")}), since Quartz can't run them. As shipped, with them:`, "")
      L.push("| page | performance | blocking time | largest paint |", "|---|---|---|---|")
      for (const r of R.lighthouse.routes) {
        const x = R.lighthouse.basaltShipped[r]
        L.push(`| \`${r}\` | ${x.performance} | ${msf(x.tbt)} | ${msf(x.lcp)} |`)
      }
      L.push("", "Nearly all of that blocking time is the backdrop's WebGL surf, drawn every frame on headless Chrome's software GPU.", "")
    }
    const fails = (name) => [...new Set(R.lighthouse.routes.flatMap((r) => R.lighthouse[name][r].a11yFails))]
    L.push(`Accessibility audits failed: Basalt ${fails("basalt").map((f) => "`" + f + "`").join(", ") || "none"}; Quartz ${fails("quartz").map((f) => "`" + f + "`").join(", ") || "none"}.`, "")
  }
  if (R.reload) {
    const b = R.reload.basalt, q = R.reload.quartz
    table("Dev server", `\`basalt dev\` against \`quartz build --serve\`. Start: from the command to \`${R.reload.route}\` answering. Reload: from saving \`${R.reload.route}\`'s note with a new line to the open page showing it, ${b.tries} saves, the page scrolled halfway down first.`, () => {
      add("start to first page", b.start, q.start, s)
      add("save to visible in the page", b.reload, q.reload, msf)
      rows.push(["scroll kept through the reload", `${b.scrollKept}/${b.tries}`, `${q.scrollKept}/${q.tries}`, verdict(b.scrollKept, q.scrollKept, false)])
    })
  }
  if (R.deps) {
    table("Install", "Production dependencies, from each lock file; size and time of `npm ci --omit=dev` into an empty folder.", () => {
      add("direct dependencies", R.deps.basalt.direct, R.deps.quartz.direct, String)
      add("packages installed", R.deps.basalt.prod, R.deps.quartz.prod, String)
      add("install size", R.deps.basalt.bytes, R.deps.quartz.bytes, mb)
      add("install time", R.deps.basalt.installMs, R.deps.quartz.installMs, s)
    })
  }
  if (R.config) {
    table("Config", "Lines that say something (not blank, not a comment) in the config a new site needs: `basalt new`'s files against the two Quartz ships for you to edit.", () => {
      add("lines to a working site", R.config.basalt.scratch, R.config.quartz.scratch, String)
      rows.push(["files", R.config.basalt.files.join(", "), R.config.quartz.files.join(", "), ""])
    })
    L.push(`savethebees itself takes ${R.config.basalt.garden} lines (\`basalt.json\` and \`basalt.config.ts\`).`, "")
  }
  const scored = rows.filter((r) => r[3] && r[3] !== "?")
  const wins = scored.filter((r) => r[3].startsWith("**Basalt")).length
  const losses = scored.filter((r) => r[3].startsWith("Quartz"))
  L.splice(4, 0, `**Basalt wins ${wins} of ${scored.length} measures.**${losses.length ? " It loses: " + losses.map((r) => r[0]).join("; ") + "." : ""}`, "")
  return L.join("\n")
}

// ---------------------------------------------------------------- main

const R = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, "utf8")) : {}
const chromeVersion = (() => {
  try {
    return execFileSync(chromePath, ["--version"], { encoding: "utf8" }).trim().replace(/^\D+/, "")
  } catch {
    return "?"
  }
})()
R.meta = {
  at: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
  cpu: os.cpus()[0].model.replace(/\s+/g, " ").trim(),
  cores: os.cpus().length,
  mem: Math.round(os.totalmem() / 2 ** 30),
  node: process.versions.node,
  chrome: chromeVersion,
  basalt: git(basalt, "rev-parse", "--short", "HEAD") + (git(basalt, "status", "--porcelain", "--", "src", "bin", "astro.config.ts") ? "+dirty" : ""),
  quartz: git(quartzSrc, "rev-parse", "--short", "HEAD"),
  quartzVersion: JSON.parse(fs.readFileSync(path.join(quartzSrc, "package.json"), "utf8")).version,
  garden: git(garden, "rev-parse", "--short", "HEAD"),
  lighthouse: JSON.parse(fs.readFileSync(require.resolve("lighthouse/package.json"), "utf8")).version,
  runs,
}
fs.mkdirSync(work, { recursive: true })
log("staging into", work)
stage()
const needBuild = only.some((x) => ["build", "weight", "lighthouse"].includes(x))
const save = () => {
  fs.writeFileSync(resultsFile, JSON.stringify(R, null, 2) + "\n")
  fs.writeFileSync(outFile, report(R) + "\n")
}
if (only.includes("config")) R.config = measureConfig()
if (only.includes("deps")) { R.deps = measureDeps(); save() }
if (only.includes("build")) { R.build = measureBuilds(); save() }
else if (needBuild) for (const s of Object.values(sites)) s.build()
if (only.includes("weight")) { R.weight = await measureWeight(); save() }
if (only.includes("lighthouse")) { R.lighthouse = await measureLighthouse(sharedRoutes()); save() }
if (only.includes("reload")) { R.reload = await measureReload(); save() }
save()
log("wrote", path.relative(process.cwd(), outFile))
