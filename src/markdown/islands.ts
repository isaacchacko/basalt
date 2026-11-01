// Basalt's islands, in a note:
//
//   <island name="clock" tz="America/Los_Angeles"></island>
//     the island `clock` (the site's islands/clock.ts), with props { tz }.
//     What's inside the tag shows until it mounts (and stays, with no JS).
//       load="visible" | "idle" | "eager"   when to mount it (default visible)
//       ssr                                 render it at build time too
//       frame height="600"                  in an iframe of its own, for an
//                                           island that wants a whole viewport
//       props='{"json": true}'              props that aren't strings
//       data="cool.json"                    a json file from the site, as the
//                                           prop `data`
//
//   ```html live height=240
//   <button onclick="...">...</button>
//   ```
//     a widget written in the note itself, run in a sandboxed iframe that
//     takes the page's colours and grows to fit what's in it
//
// An island's module exports a preact component (default) or
// `mount(el, props)`. The browser finds it by name (src/client/islands.ts); `ssr`
// islands are rendered here, from a node bundle of the module.

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Element, ElementContent, Properties, Root as HtmlRoot } from "hast"
import type { Code, Html, Root as MdRoot } from "mdast"
import { fromHtml } from "hast-util-from-html"
import { visit } from "unist-util-visit"
import { visitParents } from "unist-util-visit-parents"
import type { VFile } from "vfile"
import { resolveFile } from "./embeds.ts"
import { reg, slugOf } from "./context.ts"
import { nativeImport } from "./siteconfig.ts"

/** where the browser finds each island's module and its frame page */
/** where an island in a frame is served alone (src/pages/basalt/island/[name].astro) */
export const ISLANDS = "/basalt/island"

const PHRASING = new Set([
  "p",
  "li",
  "a",
  "span",
  "em",
  "strong",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
])

// sandboxed, so the widget can't touch the page; it says how tall it is, and
// takes the page's theme colours as css variables when the page sends them
const LIVE_HTML_HEAD = `<meta charset="utf-8"><style>:root{color-scheme:light dark}body{margin:0;padding:8px;font-family:system-ui,sans-serif;background:var(--light,transparent);color:var(--darkgray,inherit)}</style>
<script>
addEventListener("message",e=>{const v=e.data&&e.data.basaltTheme;if(v)for(const k in v)document.documentElement.style.setProperty(k,v[k])});
addEventListener("load",()=>{const say=()=>parent.postMessage({basaltHeight:document.documentElement.scrollHeight},"*");new ResizeObserver(say).observe(document.body);say()});
</script>`

function liveHtml(code: Code): Html {
  const height = /height=(\d+)/.exec(code.meta ?? "")?.[1]
  const srcdoc = `<!doctype html><html><head>${LIVE_HTML_HEAD}</head><body>${code.value}</body></html>`
  const attr = srcdoc.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
  const style = height ? ` style="height:${height}px"` : ""
  return {
    type: "html",
    value: `<iframe class="island-html" sandbox="allow-scripts allow-popups allow-forms" loading="lazy" title="live html"${style} srcdoc="${attr}"></iframe>`,
  }
}

const RESERVED = new Set(["name", "load", "ssr", "frame", "height", "props", "data", "className", "class"])

/** Attribute values as props: "3" -> 3, "true" -> true, `props='{...}'` merged in. */
export function islandProps(properties: Properties): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(properties)) {
    if (RESERVED.has(key)) continue
    const value = Array.isArray(raw) ? raw.join(" ") : raw
    if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) props[key] = Number(value)
    else if (value === "true" || value === "false") props[key] = value === "true"
    else props[key] = value
  }
  if (typeof properties.props === "string") {
    try {
      Object.assign(props, JSON.parse(properties.props))
    } catch {
      throw new Error(`island "${properties.name}": props isn't json: ${properties.props}`)
    }
  }
  return props
}

const ENTRY = /^([a-z0-9][\w-]*)\.(tsx|ts|jsx|js)$/i

/** name -> the module it's built from */
export function findIslands(dir: string): Map<string, string> {
  const found = new Map<string, string>()
  if (!fs.existsSync(dir)) return found
  for (const file of fs.readdirSync(dir).sort()) {
    const m = ENTRY.exec(file)
    if (m && !file.includes(".test.")) found.set(m[1], path.join(dir, file))
  }
  return found
}

const ssrCache = new Map<string, Promise<(props: object) => string>>()

/**
 * The island's markup for these props. Its module is bundled for node (with
 * preact left to Basalt's own copy, so hooks and the renderer share one) and
 * cached until the module, or anything in its folder, changes.
 */
export async function renderIsland(dir: string, name: string, props: object): Promise<string> {
  const entry = findIslands(dir).get(name)
  if (!entry) throw new Error(`no island called "${name}" in ${dir}`)
  const stamp = fs
    .readdirSync(dir)
    .map((f) => fs.statSync(path.join(dir, f)).mtimeMs)
    .reduce((a, b) => Math.max(a, b), 0)
  const key = `${entry}:${stamp}`
  if (!ssrCache.has(key)) {
    ssrCache.set(
      key,
      (async () => {
        const { rolldown } = (await nativeImport("rolldown")) as typeof import("rolldown")
        const WRAPPER = "\0basalt-island"
        const bundle = await rolldown({
          input: WRAPPER,
          platform: "node",
          external: [/^preact(\/|$)/, /^preact-render-to-string(\/|$)/],
          transform: { jsx: { runtime: "automatic", importSource: "preact" } },
          logLevel: "silent",
          plugins: [
            {
              name: "basalt-island",
              resolveId: (id) => (id === WRAPPER ? id : null),
              load: (id) =>
                id === WRAPPER
                  ? `import * as island from ${JSON.stringify(entry)}
import { h } from "preact"
import { renderToString } from "preact-render-to-string"
export const ssr = (props) => island.default ? renderToString(h(island.default, props)) : ""`
                  : null,
            },
          ],
          // a component's css and pictures are the browser's business
          moduleTypes: { ".css": "empty", ".scss": "empty", ".png": "empty", ".svg": "empty", ".webp": "empty" },
        })
        // written inside Basalt, so preact resolves to Basalt's
        const out = path.resolve("node_modules/.basalt/islands", `${name}-${stamp}-${process.pid}.mjs`)
        await bundle.write({ file: out, format: "esm" })
        await bundle.close()
        const mod = await nativeImport(pathToFileURL(out).href)
        return mod.ssr as (props: object) => string
      })(),
    )
  }
  return (await ssrCache.get(key)!)(props)
}

/** `<island .../>`: html has no self-closing custom elements, and it would swallow the rest of the note. */
export function remarkIslands() {
  return (tree: MdRoot) => {
    visit(tree, (node, index, parent) => {
      if (node.type === "html") {
        node.value = node.value.replace(/<island\b([^>]*?)\s*\/>/g, "<island$1></island>")
      } else if (node.type === "code" && node.lang === "html" && /\blive\b/.test(node.meta ?? "")) {
        if (parent && index !== undefined) parent.children[index] = liveHtml(node)
      }
    })
  }
}

export function rehypeIslands() {
  return async (tree: HtmlRoot, file: VFile) => {
    const { site, files } = reg()
    const dir = path.join(site.dir, "islands")
    const jobs: Promise<void>[] = []
    visitParents(tree, "element", (node, ancestors) => {
      if (node.tagName !== "island") return
      let parent = ancestors.at(-1) as Element | HtmlRoot
      // alone on its line, an island is markdown's paragraph: it takes the paragraph's place
      const grandparent = ancestors.at(-2) as Element | HtmlRoot | undefined
      if (
        grandparent &&
        parent.type === "element" &&
        parent.tagName === "p" &&
        parent.children.every((c) => c === node || (c.type === "text" && !c.value.trim()))
      ) {
        grandparent.children[grandparent.children.indexOf(parent)] = node
        parent = grandparent
      }
      const p = node.properties
      const name = String(p.name ?? "")
      if (!name) {
        node.tagName = "span"
        node.properties = { className: ["embed-missing"] }
        node.children = [{ type: "text", value: "an <island> needs a name" }]
        return
      }
      const props = islandProps(p)
      // data="file.json": a json file from the site, read now
      if (typeof p.data === "string") {
        const found = resolveFile(
          files.map((f) => f.rel),
          p.data,
        )
        if (!found) throw new Error(`island "${name}" in ${slugOf(file)}: no file ${p.data}`)
        props.data = JSON.parse(fs.readFileSync(files.find((f) => f.rel === found)!.abs, "utf8"))
      }
      if (p.frame !== undefined) {
        const page = `${ISLANDS}/${name}#${encodeURIComponent(JSON.stringify(props))}`
        node.tagName = "figure"
        node.properties = {
          className: ["embed", "island-frame"],
          dataIsland: name,
          style: p.height ? `height: ${p.height}px` : undefined,
        }
        node.children = [
          {
            type: "element",
            tagName: "iframe",
            properties: { src: page, title: name, loading: "lazy", allow: "fullscreen" },
            children: [],
          },
          {
            type: "element",
            tagName: "figcaption",
            properties: {},
            children: [
              {
                type: "element",
                tagName: "a",
                properties: { href: page, className: ["embed-source"], target: "_blank", dataNoPopover: true },
                children: [{ type: "text", value: "open on its own" }],
              },
            ],
          },
        ]
        return
      }

      const inline = parent.type === "element" && PHRASING.has(parent.tagName)
      const fallback = node.children as ElementContent[]
      node.tagName = inline ? "span" : "div"
      node.properties = {
        className: ["island"],
        dataIsland: name,
        dataIslandLoad: String(p.load ?? "visible"),
        dataIslandProps: JSON.stringify(props),
      }
      if (p.ssr !== undefined) {
        node.properties.dataIslandSsr = "true"
        jobs.push(
          renderIsland(dir, name, props).then((html) => {
            node.children = fromHtml(html, { fragment: true }).children as ElementContent[]
          }),
        )
      } else {
        node.children = fallback
      }
    })
    await Promise.all(jobs)
  }
}
