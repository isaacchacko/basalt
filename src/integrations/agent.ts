// What an agent (or anyone) polls to know whether its change is live, while
// `astro dev` serves a Basalt site:
//
//   GET /__basalt/status   { pid, url, buildId, state, change, trigger, startedAt, at, ms,
//                            error, errors, warnings, restarts }
//   GET /__basalt/wait     answers with the first finished build that matches:
//       ?after=<buildId>     a build after that one (default: the build after now)
//       ?since=<ms>          one that took in a save made at or after that time
//                            (ms since the epoch, as a file's mtime)
//       ?file=<path>         one whose trigger includes that file
//       ?timeout=<s>         how long to wait (default 30, at most 600); on a
//                            timeout it answers 504 with { ...status, timedOut: true }
//
// and <site>/.basalt/astro/status.json, the same, for agents that read files.
//
// A build is what one save (or a burst of saves) sets off: the notes it
// re-renders, and what Vite sends the open pages. It finishes once, when
// both are done (with no page open, as soon as the work is), and only then
// do open pages get the change: one save, one buildId, one swap. "ready"
// means every open page has it. "error" means something in the site is
// broken: each problem has the file to edit, its line and column, and the
// message, and stays until it's fixed. A note that fails keeps its last good
// version up.
//
// `state` is one of starting, building, restarting, ready, error, stopped.
// `change` says how the pages got it: swap (in place), hot (css or island
// hot update), reload, restart (the server restarted: pages reload), none
// (no page needed anything), or error. `buildId` only goes up, across
// restarts of the server too.

import fs from "node:fs"
import path from "node:path"
import type { AstroIntegration } from "astro"
import type { ViteDevServer } from "vite"
import { loadSite, sourceDirs } from "../lib/site"
import { loadSiteMarkdown } from "../markdown/siteconfig"
import { bus, type Problem } from "./bus"

type State = "starting" | "building" | "restarting" | "ready" | "error" | "stopped"
type Change = "swap" | "hot" | "reload" | "restart" | "none" | "error"

export interface Status {
  pid: number
  /** where the site is served, e.g. http://localhost:4321 */
  url: string | null
  buildId: number
  state: State
  change: Change | null
  /** the files whose saves this build took in */
  trigger: string[]
  /** when the build began (its first save) */
  startedAt: string | null
  /** when it finished */
  at: string
  ms: number | null
  /** the first of errors */
  error: Problem | null
  errors: Problem[]
  warnings: Problem[]
  /** how many times this server has restarted (a markdown plugin changed, say) */
  restarts: number
}

interface Finished {
  status: Status
  /** when the last save it took in was made (ms) */
  touched: number
  files: Set<string>
}

interface Build {
  start: number
  touched: number
  files: Set<string>
  /** a note was saved: the loader renders, and the content store tells the pages */
  notes: boolean
  /** a file Vite has in its module graph was saved: Vite tells the pages */
  vite: boolean
  /** what Vite has sent the pages so far */
  seen: Change | null
  /** a page reload was asked for (held, and sent as one swap at the end) */
  reload: boolean
  /** when the loader last finished, while this build was open */
  loaderDone: number
  swapSent: boolean
  /** the loader rounds that must have finished before it can (the server's first) */
  rounds: number
  /** decisions still being made about it (whether a basalt.config.ts save restarts) */
  holds: number
}

interface Agent {
  status: Status
  history: Finished[]
  waiters: Set<() => void>
  /** a component, stylesheet or other code error, from Vite or a probe */
  codeError: Problem | null
  build: Build | null
  restarting: boolean
  /** the server has come back up since the restart began */
  restartedServer: boolean
  unsubscribe?: () => void
  exiting?: boolean
  /** the site's markdown plugins, as a string, to tell whether a basalt.config.ts save changed them */
  markdownSignature?: string
}

const KEY = Symbol.for("basalt.agent")
const HISTORY = 200

const STYLE = /\.(css|scss|sass|less|styl|pcss)$/
const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
// eslint-disable-next-line no-control-regex
const plain = (s: string) => decode(s).replace(/\u001b\[[0-9;]*m/g, "")

function agent(work: string): Agent {
  const g = globalThis as { [KEY]?: Agent }
  if (g[KEY]) return g[KEY]
  // a new server carries on from the last one's buildId, so wait?after=<id> keeps its meaning
  let buildId = 0
  try {
    const last = JSON.parse(fs.readFileSync(path.join(work, "status.json"), "utf8"))
    if (Number.isInteger(last.buildId)) buildId = last.buildId
  } catch {}
  g[KEY] = {
    status: {
      pid: process.pid,
      url: null,
      buildId,
      state: "starting",
      change: null,
      trigger: [],
      startedAt: new Date().toISOString(),
      at: new Date().toISOString(),
      ms: null,
      error: null,
      errors: [],
      warnings: [],
      restarts: 0,
    },
    history: [],
    waiters: new Set(),
    codeError: null,
    build: null,
    restarting: false,
    restartedServer: false,
  }
  return g[KEY]
}

/** A string that changes when a site's markdown plugins do (functions by their source). */
function signature(value: unknown, seen = new Set<unknown>()): string {
  if (typeof value === "function") return `fn:${value.toString()}`
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "undefined"
  if (seen.has(value)) return "[circular]"
  seen.add(value)
  if (Array.isArray(value)) return `[${value.map((v) => signature(v, seen)).join(",")}]`
  return `{${Object.entries(value)
    .map(([k, v]) => `${k}:${signature(v, seen)}`)
    .join(",")}}`
}

export function agentApi(): AstroIntegration {
  return {
    name: "basalt-agent",
    hooks: {
      // `basalt build` and `basalt check` read what the notes loader found wrong from here
      "astro:build:done": () => {
        const site = loadSite()
        const b = bus()
        const problems = {
          errors: [...b.noteErrors.values()],
          warnings: [...b.noteWarnings.values()].flat(),
        }
        try {
          fs.writeFileSync(path.join(site.work, "problems.json"), JSON.stringify(problems, null, 2))
        } catch {}
      },
      "astro:server:setup": ({ server }) => setup(server as unknown as ViteDevServer),
    },
  }
}

function setup(server: ViteDevServer) {
  const site = loadSite()
  const a = agent(site.work)
  const status = a.status
  const statusFile = path.join(site.work, "status.json")
  const ownConfig = path.join(site.work, "astro.config.ts")
  const basaltSrc = fs.realpathSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."))
  const siteConfigs = ["basalt.config.ts", "basalt.config.js", "basalt.config.mjs"].map((f) => path.join(site.dir, f))
  const notesDirs = sourceDirs(site)
  // what Basalt writes into its own root mustn't count as a save (Astro, in an
  // error state, reloads every page on any change it sees: a status.json
  // written on each build made that a loop)
  for (const own of [statusFile, path.join(site.work, "problems.json"), path.join(site.work, "dist")]) {
    server.watcher.unwatch(own)
  }

  const shown = (abs: string) => {
    const real = demangle(abs)
    return real.startsWith(site.dir + path.sep) ? path.relative(site.dir, real) : real
  }
  /** Astro and Vite sometimes join the site's root and an absolute path: undo that */
  function demangle(file: string): string {
    const prefix = site.work + path.sep
    if (file.startsWith(prefix)) {
      const rest = file.slice(prefix.length - 1)
      if (rest.startsWith(path.sep) && fs.existsSync(rest) && !fs.existsSync(file)) return rest
      // <work>/src/... is Basalt's src, through the root's link
      if (file.startsWith(prefix + "src" + path.sep)) {
        try {
          return fs.realpathSync(file)
        } catch {}
      }
    }
    return file
  }

  const write = () => {
    try {
      fs.mkdirSync(site.work, { recursive: true })
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2))
    } catch {}
    for (const wake of [...a.waiters]) wake()
  }

  const problems = () => {
    const b = bus()
    const errors = [...(a.codeError ? [a.codeError] : []), ...[...b.noteErrors.values()].sort((x, y) => String(x.file).localeCompare(String(y.file)))]
    const warnings = [...b.noteWarnings.values()].flat()
    return { errors, warnings }
  }

  const send = server.ws.send.bind(server.ws) as (...args: unknown[]) => void
  /** when the last build finished, and when the latest page that failed (500) was asked for */
  let lastFinish = 0
  let failedSince = 0

  /** Ends the open build (or records an error that turned up with no save). */
  const finish = (change: Change) => {
    const build = a.build
    const hadErrors = status.errors.length > 0
    const { errors, warnings } = problems()
    const now = Date.now()
    Object.assign(status, {
      buildId: status.buildId + 1,
      state: errors.length ? "error" : "ready",
      change: change === "none" && errors.length ? "error" : change,
      trigger: build ? [...build.files] : [],
      startedAt: new Date(build?.start ?? now).toISOString(),
      at: new Date(now).toISOString(),
      ms: build ? now - build.start : null,
      error: errors[0] ?? null,
      errors,
      warnings,
    } satisfies Partial<Status>)
    a.history.push({ status: structuredClone(status), touched: build?.touched ?? now, files: new Set(build?.files ?? []) })
    if (a.history.length > HISTORY) a.history.shift()
    a.build = null
    lastFinish = now
    bus().stored = false
    clearTimeout(fallback)
    // a page that's showing Astro's error page (it has no hot swap) reloads
    // now it's fixed; pages that kept their last good page ignore this
    // (src/client/hotswap.ts)
    if (hadErrors && !errors.length) send({ type: "full-reload", path: "*", basaltRecover: true })
    write()
  }

  // ---- a save starts a build... ----
  const ignored = (p: string) => {
    if (p === ownConfig || p.endsWith(`${path.sep}status.json`)) return true
    if (p.includes(`${path.sep}node_modules${path.sep}`) || p.includes(`${path.sep}.git${path.sep}`)) return true
    const inWork = p.startsWith(site.work + path.sep)
    // Basalt's own src, through the root's link, counts; the rest of the root is Basalt's
    if (inWork) return !p.startsWith(path.join(site.work, "src") + path.sep)
    return p.includes(`${path.sep}.basalt${path.sep}`) || p.includes(`${path.sep}.astro${path.sep}`)
  }
  const hasModules = (p: string) =>
    Object.values(server.environments).some((env) => {
      const mods = env.moduleGraph.getModulesByFile(p)
      return !!mods && mods.size > 0
    })
  const isNote = (p: string) => p.endsWith(".md") && notesDirs.some((d) => p.startsWith(d + path.sep))
  const ownComponent = (p: string) => p.startsWith(path.join(site.dir, "components") + path.sep) && p.endsWith(".astro")
  const customStyles = path.join(site.dir, "styles", "custom.scss")
  const siteJson = path.join(site.dir, "basalt.json")

  const touched = (event: "change" | "add" | "unlink") => (raw: string) => {
    if (ignored(raw)) return
    const p = demangle(raw)
    const build = open()
    build.touched = Date.now()
    build.files.add(p)
    if (isNote(p)) build.notes = true
    else if (
      hasModules(p) ||
      p === siteJson ||
      siteConfigs.includes(p) ||
      (event !== "change" && (ownComponent(p) || p === customStyles))
    ) {
      // (vite.ts reloads the pages for basalt.json, basalt.config.ts, and a
      // component or stylesheet added or removed)
      build.vite = true
    }
    if (status.state !== "restarting") status.state = "building"
    status.change = null
    write()
    later()
  }

  function open(): Build {
    if (!a.build) {
      a.build = { start: Date.now(), touched: Date.now(), files: new Set(), notes: false, vite: false, seen: null, reload: false, loaderDone: 0, swapSent: false, rounds: 0, holds: 0 }
      bus().stored = false
    }
    return a.build
  }

  // ---- ...which finishes when the loader and Vite are both done ----
  let fallback: ReturnType<typeof setTimeout> | undefined
  /** look again once this turn's other watchers (the loader's) have had the event */
  const later = (ms = 0) => setTimeout(check, ms)
  let settling = false
  const check = () => {
    const build = a.build
    if (!build || settling || a.restarting || build.holds > 0) return
    const b = bus()
    if (b.busy > 0 || b.rounds < build.rounds) return
    const now = Date.now()
    // the content store tells the pages after the loader stores a note
    // (not the server's first round: no page is open to be told)
    if (b.stored && !build.reload && build.seen !== "reload" && !build.rounds) {
      const wait = 800 - (now - build.loaderDone)
      if (build.loaderDone && wait > 0) return void armFallback(wait)
      if (!build.loaderDone) return void armFallback(800)
    }
    // Vite's answer to a file it knows: an update, a reload or an error
    if (build.vite && !build.seen && !build.reload) {
      const wait = 1500 - (now - build.touched)
      if (wait > 0) return void armFallback(wait)
    }
    void settle(build)
  }
  const armFallback = (ms: number) => {
    clearTimeout(fallback)
    fallback = setTimeout(() => {
      const build = a.build
      if (!build) return
      // nothing more is coming: finish with what there is
      if (bus().stored && build.seen !== "reload") build.reload = true
      if (build.vite && !build.seen) build.seen = "none"
      check()
    }, ms)
  }

  const settle = async (build: Build) => {
    settling = true
    try {
      const change: Change =
        build.seen === "restart" || build.seen === "reload" ? build.seen : build.reload ? "swap" : (build.seen ?? "none")
      if (build.reload && !build.swapSent && change === "swap") {
        build.swapSent = true
        send({ type: "custom", event: "basalt:swap", data: { files: [...build.files] } })
      }
      // Astro renders a page when it's asked for, so a broken component or
      // stylesheet shows only then: after anything but a note (or while
      // something's broken), Basalt asks for the page last seen itself
      const code = [...build.files].some((f) => !isNote(f))
      if (build.seen !== "error" && (code || a.codeError)) await probe()
      if (a.build !== build) return
      finish(change)
    } finally {
      settling = false
      // a save made while this one settled
      if (a.build) later()
    }
  }

  // ---- the probe ----
  let lastPage = "/"
  /** while probing: the error Astro sends for the probe's page, once it does */
  let probing: { error: Problem | null } | null = null
  const probe = async () => {
    probing = { error: null }
    const address = server.httpServer?.address()
    const port = typeof address === "object" && address ? address.port : 4321
    // what Astro logs while rendering it names the error and its place
    const logged: string[] = []
    const streams = [process.stdout, process.stderr]
    const writes = streams.map((st) => st.write.bind(st))
    streams.forEach((st, i) => {
      st.write = ((chunk: unknown, ...rest: unknown[]) => {
        logged.push(String(chunk))
        return (writes[i] as (...args: unknown[]) => boolean)(chunk, ...rest)
      }) as typeof st.write
    })
    let res: Response
    let body: string
    try {
      res = await fetch(`http://localhost:${port}${lastPage}`, { headers: { "x-basalt-probe": "1", accept: "text/html" } })
      body = await res.text()
    } catch {
      return // the server isn't answering (restarting): nothing learned
    } finally {
      streams.forEach((st, i) => (st.write = writes[i] as typeof st.write))
    }
    if (res.status < 500) {
      probing = null
      a.codeError = null
      return
    }
    // Astro tells the pages what went wrong 200ms after the page's answer, with its place
    for (let i = 0; i < 20 && !probing?.error; i++) await new Promise((r) => setTimeout(r, 25))
    const told = probing?.error
    probing = null
    if (told?.file) return void (a.codeError = told)
    // else what it logged: the first place in the stack that's the site's or Basalt's
    const log = plain(logged.join("").replace(/\\n/g, "\n"))
    const where = [...log.matchAll(/at (\/[^\s:()]+):(\d+):(\d+)/g)].find((m) => !m[1].includes(`${path.sep}node_modules${path.sep}`))
    const what = /\[(\w*Error)\] ([^\n"(]+)/.exec(log)
    const title = plain(/<title>([^<]*)<\/title>/.exec(body)?.[1] ?? "error")
    a.codeError = where
      ? {
          file: shown(where[1]),
          line: Number(where[2]),
          col: Number(where[3]),
          message: what ? `${what[1]}: ${what[2].trim()}` : (told?.message ?? title),
          kind: kindOf(where[1]),
        }
      : (told ?? a.codeError ?? { file: null, line: null, col: null, message: title, kind: "render" })
  }

  const kindOf = (file: string) =>
    file.endsWith(".astro") ? "component" : STYLE.test(file) ? "stylesheet" : file.endsWith(".md") ? "markdown" : "code"

  /** an error Vite or Astro sends the pages, as a problem */
  const problemOf = (err: { name?: string; message?: string; loc?: { file?: string; line?: number; column?: number }; id?: string; plugin?: string }): Problem => {
    const file = err.loc?.file ?? err.id?.split("?")[0] ?? null
    const said = plain(String(err.message ?? "error"))
      .split("\n")[0]
      .replace(/\s*\(The stacktrace appears to be already rewritten[^)]*\)\s*/, "")
      .trim()
    const message = err.name && err.name !== "Error" && !said.startsWith(err.name) ? `${err.name}: ${said}` : said
    return {
      file: file ? shown(file) : null,
      line: err.loc?.line ?? null,
      col: err.loc?.column ?? null,
      message,
      kind: file ? kindOf(file) : "code",
    }
  }
  const same = (x: Problem | null, y: Problem) => !!x && x.file === y.file && x.line === y.line && x.col === y.col

  // ---- what Vite sends the pages ----
  // A note, a component or server code gets a swap in place instead of a
  // reload (src/client/hotswap.ts): only client code reloads. The swap waits
  // for the build to finish, so a burst of reloads is one swap.
  const swappable = (f: string) =>
    /\.(md|astro|json)$/.test(f) ||
    (/\.(ts|tsx|js|mjs)$/.test(f) && !f.includes(`${path.sep}client${path.sep}`) && !f.includes(`${path.sep}islands${path.sep}`))
  // an island is hot-updated in place (islands.ts); the notes that render it
  // at build time (ssr) come back from the content store as a reload: a swap
  const islandsDir = path.join(site.dir, "islands") + path.sep
  const kind = (files: Set<string>) => {
    const list = [...files]
    if (list.some((f) => !swappable(f) && !STYLE.test(f) && !f.startsWith(islandsDir))) return "client"
    if (list.length && list.every((f) => STYLE.test(f))) return "style"
    return "swap"
  }
  const wrapped = (...args: unknown[]) => {
    const payload = args[0] as { type?: string; err?: Parameters<typeof problemOf>[0]; basaltRecover?: boolean } | undefined
    const build = a.build
    if (!payload || typeof payload !== "object" || payload.basaltRecover) return send(...args)
    if (payload.type === "error" && payload.err) {
      const problem = problemOf(payload.err)
      // Astro sends a page's render error 200ms after the page: one asked for
      // before the fix landed is old news, and isn't shown or counted
      const render = (payload as { __isEnhancedAstroErrorPayload?: boolean }).__isEnhancedAstroErrorPayload
      if (render && failedSince < (build ? build.start : lastFinish)) return
      if (probing) {
        probing.error ??= problem
      } else if (a.restarting) {
        // the restart failed: Astro carries on with the config it had
        a.restarting = false
        status.state = "building"
        a.codeError = problem
        if (build) build.seen = "error"
        later()
      } else if (build) {
        a.codeError = problem
        build.seen = "error"
        later()
      } else if (!same(a.codeError, problem)) {
        // with no save (a page asked for turned it up): one build for it, not one per request
        if (a.codeError && (a.codeError.file === null || a.codeError.file === problem.file)) {
          // the same error, told better
          a.codeError = { ...problem, line: problem.line ?? a.codeError.line, col: problem.col ?? a.codeError.col }
          Object.assign(status, problems(), { error: problems().errors[0] ?? null })
          write()
        } else if (!build) {
          a.codeError = problem
          finish("error")
        }
      }
      return send(...args)
    }
    if (!build) return send(...args)
    if (payload.type === "update") {
      if (build.seen !== "reload") build.seen = "hot"
      later()
      return send(...args)
    }
    if (payload.type === "full-reload") {
      const k = kind(build.files)
      later()
      if (k === "swap") {
        build.reload = true
        return
      }
      if (k === "style") {
        // Astro's reload after an error: css is hot-updated, so only an error page wants it
        if (!build.seen) build.seen = "hot"
        return send({ ...(payload as object), basaltRecover: true })
      }
      build.seen = "reload"
      return send(...args)
    }
    return send(...args)
  }
  ;(server.ws as { send: (...args: unknown[]) => void }).send = wrapped

  // the loader's rounds: each one ending may finish the build
  a.unsubscribe?.()
  const onBus = () => {
    if (a.build) a.build.loaderDone = Date.now()
    if (a.restarting && a.restartedServer) {
      // the content layer has synced again after a restart: pages reload on their own
      // when they reconnect (Vite's client does that)
      a.restarting = false
      a.restartedServer = false
      status.restarts++
      open().seen = "restart"
    }
    later()
  }
  bus().listeners.add(onBus)
  a.unsubscribe = () => bus().listeners.delete(onBus)

  // ---- restarts ----
  // Basalt's build-time code (markdown plugins, site and config loading) and
  // a site's markdown plugins (in basalt.config.ts) are loaded with Astro's
  // config, outside Vite's reach. A change to one restarts this server (and
  // only this one): Astro restarts on a change it sees to its config file.
  // Basalt's code that runs as the site is built, not in the page: a change to
  // it restarts the server. As real paths, so a site outside Basalt's checkout
  // (whose src is a link to it) sees them too.
  const realSrc = (() => {
    try {
      return fs.realpathSync(basaltSrc)
    } catch {
      return basaltSrc
    }
  })()
  const buildTime = [path.join(realSrc, "markdown"), path.join(realSrc, "lib"), path.join(realSrc, "integrations")]
  const buildTimeFiles = [path.join(realSrc, "loader.ts")]
  const markdownOf = async () => signature(await loadSiteMarkdown(site.dir, path.dirname(basaltSrc)))
  if (a.markdownSignature === undefined) void markdownOf().then((s) => (a.markdownSignature ??= s)).catch(() => {})
  server.watcher.add([...buildTime, ...buildTimeFiles, ...siteConfigs])
  const restart = () => {
    a.restarting = true
    a.restartedServer = false
    open()
    status.state = "restarting"
    write()
    // Astro listens to its watcher for its own config: tell it this one changed
    server.watcher.emit("change", ownConfig)
  }
  server.watcher.on("change", (raw) => {
    if (raw.endsWith(".test.ts") || a.restarting) return
    const p = demangle(raw)
    if (siteConfigs.includes(p)) {
      // layout and theme are read as each page renders: only new markdown plugins need a restart
      const build = open()
      build.holds++
      void markdownOf()
        .then(
          (next) => {
            if (a.codeError?.kind === "config") a.codeError = null
            if (next === a.markdownSignature) return
            a.markdownSignature = next
            restart()
          },
          (err: Error) => {
            a.codeError = { file: shown(p), line: null, col: null, message: plain(err.message).split("\n")[0], kind: "config" }
            build.seen = "error"
          },
        )
        .finally(() => {
          build.holds--
          later()
        })
      return
    }
    let real = p
    try {
      real = fs.realpathSync(p)
    } catch {}
    if (buildTime.some((d) => real.startsWith(d + path.sep)) || buildTimeFiles.includes(real)) restart()
  })

  // first, before Vite's own listeners (and Basalt's in vite.ts) send the pages anything for it
  server.watcher.prependListener("change", touched("change"))
  server.watcher.prependListener("add", touched("add"))
  server.watcher.prependListener("unlink", touched("unlink"))

  // ---- the API ----
  server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://basalt")
    if (url.pathname !== "/__basalt/status" && url.pathname !== "/__basalt/wait") {
      const asked = Date.now()
      res.on("finish", () => {
        if (res.statusCode >= 500) failedSince = Math.max(failedSince, asked)
      })
      const page = req.headers.accept?.includes("text/html") && !req.headers["x-basalt-probe"]
      if (page && !url.pathname.startsWith("/@") && !url.pathname.startsWith("/_")) lastPage = url.pathname + url.search
      return next()
    }
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Cache-Control", "no-store")
    if (url.pathname === "/__basalt/status") return res.end(JSON.stringify(status))

    const num = (k: string) => {
      const v = url.searchParams.get(k)
      return v === null || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v)
    }
    let after = num("after")
    const since = num("since")
    const fileParam = url.searchParams.get("file")
    const file = fileParam ? demangle(path.resolve(site.dir, fileParam)) : undefined
    if (after === undefined && since === undefined && !file) after = status.buildId
    const timeout = Math.min(num("timeout") ?? 30, 600) * 1000
    const matches = (f: Finished) =>
      (after === undefined || f.status.buildId > after) &&
      (since === undefined || f.touched >= since) &&
      (!file || f.files.has(file))
    const found = () => a.history.find(matches)
    let hit = found()
    if (!hit) {
      hit = await new Promise<Finished | undefined>((resolve) => {
        const wake = () => {
          const f = found()
          if (f) done(f)
        }
        const timer = setTimeout(() => done(undefined), timeout)
        const done = (f: Finished | undefined) => {
          clearTimeout(timer)
          a.waiters.delete(wake)
          resolve(f)
        }
        a.waiters.add(wake)
        req.on("close", () => done(undefined))
      })
    }
    if (!hit) {
      res.statusCode = 504
      return res.end(JSON.stringify({ ...status, timedOut: true }))
    }
    res.end(JSON.stringify({ ...hit.status, timedOut: false }))
  })

  // the first server in this process: its first build is the loader's first round
  if (status.state === "starting") {
    open().rounds = 1
    later()
  } else if (a.restarting || status.state === "stopped") {
    // back after a restart (ours, or Astro's for its own config): done once the notes are synced again
    a.restarting = true
    a.restartedServer = true
    open()
    status.state = "restarting"
  }
  write()
  server.httpServer?.once("listening", () => {
    const address = server.httpServer?.address()
    if (typeof address === "object" && address) status.url = `http://localhost:${address.port}`
    write()
  })

  const stop = () => {
    status.state = "stopped"
    write()
  }
  server.httpServer?.on("close", () => {
    if (!a.restarting) stop()
  })
  if (!a.exiting) {
    a.exiting = true
    process.once("SIGTERM", () => {
      stop()
      process.exit(143)
    })
  }
}
