// What an agent (or anyone) polls to know whether its change is live, while
// `astro dev` serves a Basalt site:
//
//   GET /__basalt/status            { pid, buildId, state, change, trigger, at, error }
//   GET /__basalt/wait?after=<id>   answers once an update after buildId <id> has
//                                   gone out to pages (or timeout=<s> passes)
//
// and <site>/.basalt/astro/status.json, the same, for agents that read files. An
// update is whatever Vite sends open pages: a hot swap, a reload, or an error
// (with its file, line and column), so "ready" means the pages have it.

import fs from "node:fs"
import path from "node:path"
import type { AstroIntegration } from "astro"
import { loadSite } from "../lib/site"

type State = "starting" | "building" | "ready" | "error" | "stopped"
interface Status {
  pid: number
  buildId: number
  state: State
  change: string | null
  trigger: string[]
  at: string
  ms: number | null
  error: { file: string | null; line: number | null; col: number | null; message: string } | null
}

export function agentApi(): AstroIntegration {
  return {
    name: "basalt-agent",
    hooks: {
      "astro:server:setup": ({ server }) => {
        const site = loadSite()
        const file = path.join(site.work, "status.json")
        const status: Status = {
          pid: process.pid,
          buildId: 0,
          state: "ready",
          change: null,
          trigger: [],
          at: new Date().toISOString(),
          ms: null,
          error: null,
        }
        let startedAt = 0
        const waiters = new Set<{ after: number; resolve: () => void }>()
        const write = () => {
          try {
            fs.mkdirSync(site.work, { recursive: true })
            fs.writeFileSync(file, JSON.stringify(status, null, 2))
          } catch {}
          if (status.state === "building") return
          for (const w of [...waiters]) if (status.buildId > w.after) w.resolve()
        }
        const finish = (next: Partial<Status>) => {
          Object.assign(status, next, {
            buildId: status.buildId + 1,
            at: new Date().toISOString(),
            ms: startedAt ? Date.now() - startedAt : null,
          })
          startedAt = 0
          write()
        }
        // Astro renders a page when it's asked for, so a broken component or
        // layout shows only then: after a change to anything but a note, Basalt
        // asks for the page last seen itself, and reports what that turns up
        let lastPage = "/"
        let probing = false
        const settle = async (next: Partial<Status>) => {
          const code = status.trigger.some((t) => !t.endsWith(".md"))
          if (next.state !== "ready" || !code || probing) return finish(next)
          probing = true
          caught = null
          try {
            const address = server.httpServer?.address()
            const port = typeof address === "object" && address ? address.port : 4321
            // what Astro logs while rendering it names the error and its place
            const logged: string[] = []
            const streams = [process.stdout, process.stderr]
            const writes = streams.map((st) => st.write.bind(st))
            streams.forEach((st, i) => {
              st.write = ((chunk: unknown, ...rest: unknown[]) => {
                logged.push(String(chunk))
                return (writes[i] as (...a: unknown[]) => boolean)(chunk, ...rest)
              }) as typeof st.write
            })
            let res: Response
            let body: string
            try {
              res = await fetch(`http://localhost:${port}${lastPage}`, {
                headers: { "x-basalt-probe": "1" },
              })
              body = await res.text()
            } finally {
              streams.forEach((st, i) => (st.write = writes[i] as typeof st.write))
            }
            const log = logged.join("").replace(/\\n/g, "\n")
            const where = /at (\/[^\s:()]+):(\d+):(\d+)/.exec(log)
            const what = /\[(\w*Error)\] ([^\n"(]+)/.exec(log)
            if (!caught && where) {
              caught = {
                file: where[1],
                line: Number(where[2]),
                col: Number(where[3]),
                message: what ? `${what[1]}: ${what[2].trim()}` : "error",
              }
            }
            if (res.status >= 500) {
              const title = /<title>([^<]*)<\/title>/.exec(body)?.[1] ?? "error"
              return finish({
                state: "error",
                change: "error",
                error: caught ?? { file: null, line: null, col: null, message: title },
              })
            }
            finish(next)
          } catch {
            finish(next)
          } finally {
            probing = false
          }
        }
        let caught: Status["error"] = null
        write()

        // a save starts a build...
        const touched = (p: string) => {
          if (p.includes(`${path.sep}.basalt${path.sep}`) || p.includes(`${path.sep}.astro${path.sep}`)) return
          if (status.state !== "building") {
            startedAt = Date.now()
            status.trigger = []
          }
          status.state = "building"
          status.change = null
          if (!status.trigger.includes(p)) status.trigger.push(p)
          write()
        }
        server.watcher.on("change", touched)
        server.watcher.on("add", touched)
        server.watcher.on("unlink", touched)

        // ...which ends when Vite tells the pages
        const send = server.hot.send.bind(server.hot) as (...args: unknown[]) => void
        ;(server.hot as { send: (...args: unknown[]) => void }).send = (...args: unknown[]) => {
          const payload = args[0] as { type?: string; err?: { message: string; loc?: { file?: string; line?: number; column?: number }; id?: string } }
          if (payload && typeof payload === "object") {
            if (payload.type === "update") void settle({ state: "ready", change: "hot", error: null })
            else if (payload.type === "full-reload") void settle({ state: "ready", change: "reload", error: null })
            else if (payload.type === "error" && payload.err) {
              const { err } = payload
              const error = {
                file: err.loc?.file ?? err.id ?? null,
                line: err.loc?.line ?? null,
                col: err.loc?.column ?? null,
                message: err.message.split("\n")[0],
              }
              if (probing) caught = error
              else finish({ state: "error", change: "error", error })
            }
          }
          return send(...args)
        }

        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url ?? "/", "http://basalt")
          if (url.pathname !== "/__basalt/status" && url.pathname !== "/__basalt/wait") {
            const page = req.headers.accept?.includes("text/html") && !req.headers["x-basalt-probe"]
            if (page && !url.pathname.startsWith("/@") && !url.pathname.startsWith("/_")) lastPage = url.pathname
            return next()
          }
          if (url.pathname === "/__basalt/wait") {
            const after = Number(url.searchParams.get("after") ?? status.buildId)
            const timeout = Math.min(Number(url.searchParams.get("timeout") ?? 30), 120) * 1000
            if (status.buildId <= after || status.state === "building") {
              await new Promise<void>((resolve) => {
                const w = { after, resolve }
                waiters.add(w)
                setTimeout(resolve, timeout)
              }).finally(() => {
                for (const w of waiters) if (w.after === after) waiters.delete(w)
              })
            }
          }
          res.setHeader("Content-Type", "application/json")
          res.setHeader("Cache-Control", "no-store")
          res.end(JSON.stringify(status))
        })

        const stop = () => {
          status.state = "stopped"
          write()
        }
        server.httpServer?.on("close", stop)
        process.once("SIGTERM", () => {
          stop()
          process.exit(143)
        })
      },
    },
  }
}
