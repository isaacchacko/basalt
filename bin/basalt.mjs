#!/usr/bin/env node
// basalt: build and serve a Basalt site.
//
//   basalt new <dir> [--title "My garden"]   start a site
//   basalt dev [dir] [--port 4321]           serve it, live (in the background; `basalt stop` ends it)
//   basalt build [dir]                       build it into <dir>/.basalt/astro/dist (exit 1 if a note failed)
//   basalt check [dir] [--json]              build it and list what's broken, with files and lines
//   basalt status [dir]                      what the dev server is doing (JSON)
//   basalt wait [dir] [--file <path>] [--since <ms>] [--after <buildId>] [--timeout <s>]
//                                            block until a build with your save in it is done
//   basalt stop [dir] | logs [dir] [--raw]
//   basalt help [topic]                      BASALT.md, or its section on a topic ("agents", "writing", ...)
//
// <dir> defaults to the current folder. Every site gets its own Astro root
// (<dir>/.basalt/astro), so several sites can be served at once from one Basalt.

import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

const basalt = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/**
 * The node_modules Basalt's packages are in: its own, in a checkout, or the
 * one it was installed into (npm puts them beside it), wherever astro is.
 */
function packages() {
  const astro = createRequire(path.join(basalt, "package.json")).resolve("astro/package.json")
  return path.dirname(path.dirname(astro))
}
const [command = "help", ...rest] = process.argv.slice(2)
const flags = {}
const positional = []
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[i + 1] === undefined || rest[i + 1].startsWith("--") ? true : rest[++i]
  else positional.push(rest[i])
}
const dir = path.resolve(command === "help" ? "." : (positional[0] ?? "."))
const work = path.join(dir, ".basalt", "astro")
const named = positional[0] ?? "."

/**
 * The site's own Astro root: links to Basalt's config, source and packages,
 * so Astro and Vite see an ordinary project, with the site's own lock file
 * and content store in <dir>/.basalt/astro/.astro.
 */
function prepare() {
  if (!fs.existsSync(dir)) fail(`${dir}: no such folder`)
  fs.mkdirSync(work, { recursive: true })
  for (const name of ["astro.config.ts", "package.json", "tsconfig.json", "src", "node_modules"]) {
    const link = path.join(work, name)
    const target = name === "node_modules" ? packages() : path.join(basalt, name)
    if (fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() && fs.readlinkSync(link) === target) continue
    fs.rmSync(link, { recursive: true, force: true })
    fs.symlinkSync(target, link)
  }
}

function run(args, stdio) {
  prepare()
  const result = spawnSync(process.execPath, [path.join(packages(), "astro", "bin", "astro.mjs"), ...args], {
    cwd: work,
    stdio,
    encoding: "utf8",
    // Astro's telemetry posts to the network on every build: off, unless asked for
    env: { ASTRO_TELEMETRY_DISABLED: "1", ...process.env, BASALT_SITE: dir },
  })
  return result
}

/**
 * One of Basalt's own src/lib modules, for the CLI to use directly: node won't
 * strip types from a file under node_modules (where Basalt is when installed),
 * so it and the src/lib modules it imports are stripped here, into the site's
 * Astro root, whose node_modules link finds their packages.
 */
async function libModule(name) {
  const { stripTypeScriptTypes } = await import("node:module")
  const out = path.join(work, ".cli")
  fs.mkdirSync(out, { recursive: true })
  const done = new Set()
  const emit = (n) => {
    if (done.has(n)) return
    done.add(n)
    const ts = fs.readFileSync(path.join(basalt, "src", "lib", `${n}.ts`), "utf8")
    const js = stripTypeScriptTypes(ts).replace(/(from\s+["'])\.\/([\w-]+)\.ts(["'])/g, (_, a, dep, b) => {
      emit(dep)
      return `${a}./${dep}.mjs${b}`
    })
    fs.writeFileSync(path.join(out, `${n}.mjs`), js)
  }
  emit(name)
  return import(pathToFileURL(path.join(out, `${name}.mjs`)).href)
}

/** a path as short as it can be while still pointing at the file */
function shown(abs) {
  const rel = path.relative(process.cwd(), abs)
  return rel.startsWith("..") ? abs : rel
}

function fail(message, code = 1) {
  console.error(`basalt: ${message}`)
  process.exit(code)
}

function port() {
  try {
    return JSON.parse(fs.readFileSync(path.join(work, ".astro", "dev.json"), "utf8")).port
  } catch {
    return null
  }
}

/** GET a route of the dev server; a server that's restarting is waited for (up to `patience` ms) */
async function api(route, patience = 5000) {
  const p = port()
  if (!p) fail(`no dev server for ${dir} (start one with: basalt dev ${named})`)
  const until = Date.now() + patience
  for (;;) {
    try {
      const res = await fetch(`http://localhost:${p}${route}`)
      return { code: res.status, body: await res.json() }
    } catch {
      if (Date.now() > until) fail(`the dev server on :${p} isn't answering`)
      await new Promise((r) => setTimeout(r, 100))
    }
  }
}

/** what a build found wrong in the notes (written by the agent integration when a build is done) */
function buildProblems(since) {
  const file = path.join(work, "problems.json")
  try {
    if (fs.statSync(file).mtimeMs < since) return { errors: [], warnings: [] }
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return { errors: [], warnings: [] }
  }
}
const where = (p) => `${p.file ? shown(path.resolve(dir, p.file)) : "?"}${p.line ? `:${p.line}${p.col ? `:${p.col}` : ""}` : ""}`

/** the site's files a save to which starts a build: the newest one's mtime */
function newestSave() {
  let newest = 0
  const visit = (p) => {
    const st = fs.statSync(p, { throwIfNoEntry: false })
    if (!st) return
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p)) if (!e.startsWith(".") && e !== "node_modules") visit(path.join(p, e))
    } else newest = Math.max(newest, st.mtimeMs)
  }
  let content = [{ from: "notes" }]
  try {
    const json = JSON.parse(fs.readFileSync(path.join(dir, "basalt.json"), "utf8"))
    if (Array.isArray(json.content)) content = json.content
  } catch {}
  for (const { from } of content) visit(path.resolve(dir, from))
  for (const f of ["styles", "islands", "components", "basalt.json", "basalt.config.ts", "basalt.config.js", "basalt.config.mjs"]) visit(path.join(dir, f))
  return Math.floor(newest)
}

function scaffold() {
  if (fs.existsSync(path.join(dir, "basalt.json"))) fail(`${dir} is already a Basalt site`)
  const title = typeof flags.title === "string" ? flags.title : path.basename(dir)
  const files = {
    "basalt.json": JSON.stringify({ title, content: [{ from: "notes" }] }, null, 2) + "\n",
    "notes/about.md": `---\ntitle: About\n---\n\nA second note. [[index|Home]] links back.\n`,
    "notes/index.md": `---\ntitle: ${title}\n---\n\nWelcome. Notes go in \`notes/\`; link one by its name in double brackets, like [[about]].[^margin]\n\nA counter, from \`islands/counter.tsx\`: <island name="counter" start="0" ssr></island>\n\n[^margin]: A footnote becomes a note in the margin.\n`,
    "styles/custom.scss": "// your look, on top of Basalt's\n",
    "islands/counter.tsx": `// An island: <island name="counter" start="3"></island> in a note mounts this.\n// Its attributes are its props ("3" arrives as 3); \`ssr\` renders it at build time too.\nimport { useState } from "preact/hooks"\n\nexport default function Counter({ start = 0 }: { start?: number }) {\n  const [n, setN] = useState(start)\n  return <button type="button" onClick={() => setN(n + 1)}>counted {n}</button>\n}\n`,
    "basalt.config.ts": `// Optional. The site's layout and theme in code (over basalt.json's), and its own\n// markdown plugins. A change to \`markdown\` restarts the dev server; the rest\n// shows on the next page.\nexport default {\n  layout: {\n    // components: { breadcrumbs: false },\n    // footer: { links: { GitHub: "https://github.com/me" } },\n  },\n  // markdown: { remarkPlugins: [], rehypePlugins: [], textTransforms: [] },\n}\n`,
    "components/README.md":
      "A file here named like one of Basalt's components (src/components/*.astro) replaces it.\n",
    ".gitignore": ".basalt/\n.vercel/\n",
  }
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  console.log(`made a Basalt site in ${dir}\nserve it with: basalt dev ${named}`)
}

/** Astro prints a JSON line about the background server; say it plainly, with Basalt's commands */
function dev() {
  const result = run(["dev", ...(flags.port ? ["--port", String(flags.port)] : [])], ["ignore", "pipe", "inherit"])
  const said = []
  for (const line of (result.stdout ?? "").split("\n")) {
    if (!line.trim()) continue
    try {
      said.push(JSON.parse(line).message ?? line)
    } catch {
      said.push(line)
    }
  }
  const text = said.join("\n")
  const url = /https?:\/\/\S+/.exec(text)?.[0]
  const pid = /\(pid (\d+)\)/.exec(text)?.[1]
  if (url) {
    const again = /already running/i.test(text)
    console.log(`${again ? "Already serving" : "Serving"} ${shown(dir) || "."} at ${url.replace(/[).,]+$/, "")}${pid ? ` (pid ${pid})` : ""}`)
    console.log(`  basalt status ${named}   what it's doing\n  basalt wait ${named}     block until your last save is live\n  basalt logs ${named}     its log\n  basalt stop ${named}     stop it`)
  } else if (text) console.log(text.replace(/astro dev (stop|status|logs)/g, (_, c) => `basalt ${c} ${named}`))
  process.exit(result.status ?? 1)
}

/** the dev log (JSON lines), as plain lines, with repeats collapsed */
function logs() {
  const file = path.join(work, ".astro", "dev.log")
  if (!fs.existsSync(file)) fail(`no log for ${dir} (is it being served? basalt dev ${named})`)
  const raw = fs.readFileSync(file, "utf8")
  if (flags.raw) return process.stdout.write(raw)
  let last = null
  let times = 0
  const out = []
  const flush = () => {
    if (last !== null) out.push(times > 1 ? `${last}  (x${times})` : last)
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    let text = line
    try {
      const entry = JSON.parse(line)
      const label = entry.label && entry.label !== "SKIP_FORMAT" ? `[${entry.label}] ` : ""
      const level = entry.level === "error" ? "error: " : entry.level === "warn" ? "warn: " : ""
      text = `${level}${label}${String(entry.message ?? "").trimEnd()}`
    } catch {}
    // the noise of a restart: Vite's old runner, closed on purpose
    if (/Vite module runner has been closed|transport was disconnected, cannot call "fetchModule"/.test(text)) continue
    if (text === last) times++
    else {
      flush()
      last = text
      times = 1
    }
  }
  flush()
  console.log(out.join("\n"))
}

function help() {
  const doc = fs.readFileSync(path.join(basalt, "BASALT.md"), "utf8")
  const topic = positional[0]
  if (!topic) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 16).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"))
    const sections = [...doc.matchAll(/^## (.+)$/gm)].map((m) => m[1])
    return console.log(`\nbasalt help <topic>, from BASALT.md: ${sections.map((s) => s.toLowerCase()).join(", ")}`)
  }
  const parts = doc.split(/^(?=## )/m)
  const hit = parts.find((p) => p.startsWith("## ") && p.slice(3, p.indexOf("\n")).toLowerCase().includes(topic.toLowerCase()))
  if (!hit) fail(`no section of BASALT.md on "${topic}"`)
  console.log(hit.trimEnd())
}

switch (command) {
  case "new":
    scaffold()
    break
  case "dev":
    dev()
    break
  case "build": {
    const started = Date.now()
    const result = run(["build"], "inherit")
    const { errors } = buildProblems(started)
    for (const p of errors) console.error(`basalt: ${where(p)}  ${p.kind ?? "error"}: ${p.message}`)
    if (errors.length) fail(`${errors.length} note${errors.length > 1 ? "s" : ""} failed to build (the rest of the site is in ${shown(path.join(work, "dist"))})`)
    process.exit(result.status ?? 1)
  }
  case "check": {
    const started = Date.now()
    const result = run(["build"], flags.json ? "pipe" : ["ignore", "ignore", "inherit"])
    if (result.status !== 0) {
      if (flags.json && result.stderr) process.stderr.write(result.stderr)
      fail("the build failed")
    }
    const { check, report, islandNames } = await import("./check.mjs")
    // a note's slug -> the file it's in, from Basalt's own walk of the site
    process.env.BASALT_SITE = dir
    const { loadSite, walkSite } = await libModule("site")
    const notes = new Map(
      walkSite(loadSite(dir))
        .filter((f) => f.isNote)
        .map((f) => [f.slug.replace(/\/index$/, ""), { file: shown(f.abs), abs: f.abs }]),
    )
    // notes that failed to render come first: they're missing (or stale), and
    // their absence shows as broken links elsewhere
    const failed = buildProblems(started).errors.map((p) => ({
      kind: p.kind ?? "error",
      note: p.file ? shown(path.resolve(dir, p.file)) : "?",
      line: p.line,
      col: p.col,
      detail: p.message,
    }))
    // what the site's navigation links: its explorer's order, its footer's own pages
    const reached = (() => {
      try {
        const layout = JSON.parse(fs.readFileSync(path.join(dir, "basalt.json"), "utf8")).layout ?? {}
        const order = Array.isArray(layout.explorer?.order) ? layout.explorer.order : []
        const footer = Object.values(layout.footer?.links ?? {}).filter((u) => typeof u === "string" && u.startsWith("/"))
        return [...order, ...footer].map(String)
      } catch {
        return []
      }
    })()
    const problems = [...failed, ...check(path.join(work, "dist"), notes, { islands: islandNames(dir), reached })]
    // without a host, nothing that must be absolute can be: say so once
    if (!loadSite(dir).config.baseUrl)
      problems.push({ kind: "no baseUrl", note: shown(path.join(dir, "basalt.json")), line: null, detail: 'set "baseUrl" (e.g. "garden.example.com"): the sitemap, the feed, canonical links and social cards need the site\'s address', warning: true })
    report(problems, flags.json)
    process.exit(problems.some((p) => !p.warning) ? 1 : 0)
  }
  case "stop":
    process.exit(run(["dev", "stop"], "inherit").status ?? 1)
  case "logs":
    logs()
    break
  case "status": {
    const { body } = await api("/__basalt/status")
    console.log(JSON.stringify(body, null, 2))
    break
  }
  case "wait": {
    // the build that has your save in it: by default, your newest save to the site
    const q = new URLSearchParams()
    const file = typeof flags.file === "string" ? path.resolve(flags.file) : null
    if (file) q.set("file", file)
    if (flags.since !== undefined) q.set("since", String(flags.since))
    else if (file && fs.existsSync(file)) q.set("since", String(Math.floor(fs.statSync(file).mtimeMs)))
    if (flags.after !== undefined) q.set("after", String(flags.after))
    if (!q.has("since") && !q.has("after") && !file) q.set("since", String(newestSave()))
    const timeout = Number(flags.timeout ?? 30)
    q.set("timeout", String(timeout))
    const { code, body } = await api(`/__basalt/wait?${q}`, timeout * 1000)
    console.log(JSON.stringify(body, null, 2))
    // 0: live; 1: built, with errors; 2: timed out
    process.exit(code === 504 || body.timedOut ? 2 : body.state === "ready" ? 0 : 1)
  }
  case "help":
    help()
    break
  default:
    fail(`no command "${command}" (basalt help)`)
}
