#!/usr/bin/env node
// basalt: build and serve a Basalt site.
//
//   basalt new <dir> [--title "My garden"]   start a site
//   basalt dev [dir] [--port 4321]           serve it, live (in the background; `basalt stop` ends it)
//   basalt build [dir]                       build it into <dir>/.basalt/astro/dist
//   basalt check [dir] [--json]              build it and list broken links, missing embeds, orphans
//   basalt status [dir]                      what the dev server is doing (JSON)
//   basalt wait [dir] [--after <buildId>]    block until the next update reaches the pages
//   basalt stop [dir] | logs [dir]
//
// <dir> defaults to the current folder. Every site gets its own Astro root
// (<dir>/.basalt/astro), so several sites can be served at once from one Basalt.

import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const basalt = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const [command = "help", ...rest] = process.argv.slice(2)
const flags = {}
const positional = []
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[i + 1]?.startsWith("--") ? true : (rest[++i] ?? true)
  else positional.push(rest[i])
}
const dir = path.resolve(positional[0] ?? ".")
const work = path.join(dir, ".basalt", "astro")

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
    const target = path.join(basalt, name)
    if (fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() && fs.readlinkSync(link) === target) continue
    fs.rmSync(link, { recursive: true, force: true })
    fs.symlinkSync(target, link)
  }
}

function astro(...args) {
  process.exit(run(args, "inherit"))
}

function run(args, stdio) {
  prepare()
  const result = spawnSync(path.join(basalt, "node_modules", ".bin", "astro"), args, {
    cwd: work,
    stdio,
    env: { ...process.env, BASALT_SITE: dir },
  })
  return result.status ?? 1
}

/** a path as short as it can be while still pointing at the file */
function shown(abs) {
  const rel = path.relative(process.cwd(), abs)
  return rel.startsWith("..") ? abs : rel
}

function fail(message) {
  console.error(`basalt: ${message}`)
  process.exit(1)
}

function port() {
  try {
    return JSON.parse(fs.readFileSync(path.join(work, ".astro", "dev.json"), "utf8")).port
  } catch {
    return null
  }
}

async function api(route) {
  const p = port()
  if (!p) fail(`no dev server for ${dir} (start one with: basalt dev ${positional[0] ?? ""})`)
  const res = await fetch(`http://localhost:${p}${route}`).catch(() => fail(`the dev server on :${p} isn't answering`))
  console.log(JSON.stringify(await res.json(), null, 2))
}

function scaffold() {
  if (fs.existsSync(path.join(dir, "basalt.json"))) fail(`${dir} is already a Basalt site`)
  const title = typeof flags.title === "string" ? flags.title : path.basename(dir)
  const files = {
    "basalt.json": JSON.stringify({ title, content: [{ from: "notes" }] }, null, 2) + "\n",
    "notes/index.md": `---\ntitle: ${title}\n---\n\nWelcome. Notes go in \`notes/\`; link them with [[wikilinks]].[^margin]\n\n[^margin]: A footnote becomes a note in the margin.\n`,
    "styles/custom.scss": "// your look, on top of Basalt's\n",
    "islands/.gitkeep": "",
    "components/README.md":
      "A file here named like one of Basalt's components (src/components/*.astro) replaces it.\n",
    ".gitignore": ".basalt/\n",
  }
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  console.log(`made a Basalt site in ${dir}\nserve it with: basalt dev ${positional[0] ?? "."}`)
}

switch (command) {
  case "new":
    scaffold()
    break
  case "dev":
    astro("dev", ...(flags.port ? ["--port", String(flags.port)] : []))
    break
  case "build":
    astro("build")
    break
  case "check": {
    if (run(["build"], flags.json ? "ignore" : ["ignore", "ignore", "inherit"]) !== 0) fail("the build failed")
    const { check, report } = await import("./check.mjs")
    // a note's slug -> the file it's in, from Basalt's own walk of the site
    process.env.BASALT_SITE = dir
    const { loadSite, walkSite } = await import("../src/lib/site.ts")
    const notes = new Map(walkSite(loadSite(dir)).filter((f) => f.isNote).map((f) => [f.slug.replace(/\/index$/, ""), shown(f.abs)]))
    const problems = check(path.join(work, "dist"), notes)
    report(problems, flags.json)
    process.exit(problems.some((p) => !p.warning) ? 1 : 0)
  }
  case "stop":
    astro("dev", "stop")
    break
  case "logs":
    astro("dev", "logs")
    break
  case "status":
    await api("/__basalt/status")
    break
  case "wait":
    await api(`/__basalt/wait${flags.after ? `?after=${flags.after}` : ""}`)
    break
  default:
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 14).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"))
}
