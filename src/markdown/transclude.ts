// Note transclusion: `![[note]]`, `![[note#heading]]` and `![[note#^block]]`
// filled in with the other note's content. Quartz did this when it wrote the
// page, with every note already rendered; here each note renders on its own,
// so the note embedded is rendered on the spot (see renderTarget, set by
// index.ts), and cached until its file changes.

import type { Element, ElementContent, Root } from "hast"
import { toHtml } from "hast-util-to-html"
import { visit, SKIP } from "unist-util-visit"
import type { VFile } from "vfile"
import type { FullSlug } from "../lib/path"
import { slugOf } from "./context.ts"

/** What transclusion needs of a note: its rendered tree, its blocks, its title. */
export interface Target {
  slug: FullSlug
  title?: string
  tree: Root
  blocks: Record<string, Element>
}

export type RenderTarget = (slug: FullSlug) => Promise<Target | undefined>

let renderTarget: RenderTarget = async () => undefined

export function useTargets(fn: RenderTarget) {
  renderTarget = fn
}

const headerRegex = /h[1-6]/

const linkToOriginal = (href: unknown): Element => ({
  type: "element",
  tagName: "a",
  properties: { href: href as string, class: ["internal", "transclude-src"] },
  children: [{ type: "text", value: "Link to original" }],
})

// an embed that points nowhere says so, instead of leaving a bare link
function transcludeMissing(what: string, href: unknown): Element {
  return {
    type: "element",
    tagName: "p",
    properties: { className: ["transclude-missing"] },
    children: [
      { type: "text", value: `nothing to embed: ${what} ` },
      {
        type: "element",
        tagName: "a",
        properties: { href: href as string, class: ["internal"] },
        children: [{ type: "text", value: "(go there)" }],
      },
    ],
  }
}

const copy = <T>(node: T): T => structuredClone(node)

/** What one embed of `target` shows, or undefined to leave it be. */
function contentOf(node: Element, target: Target | undefined, targetSlug: FullSlug, href: unknown) {
  if (!target) return [transcludeMissing(`no note called ${targetSlug}`, href)]
  const rawAlias = node.properties.dataEmbedAlias as string | undefined
  const alias = rawAlias && rawAlias !== "undefined" ? rawAlias : undefined
  let blockRef = node.properties.dataBlock as string | undefined

  if (blockRef?.startsWith("#^")) {
    blockRef = blockRef.slice("#^".length)
    let block = target.blocks[blockRef]
    if (!block) return [transcludeMissing(`no block ^${blockRef} in ${targetSlug}`, href)]
    if (block.tagName === "li") {
      block = { type: "element", tagName: "ul", properties: {}, children: [block] }
    }
    return [copy(block), linkToOriginal(href)]
  }

  if (blockRef?.startsWith("#")) {
    blockRef = blockRef.slice(1)
    let startIdx: number | undefined
    let startDepth: number | undefined
    let endIdx: number | undefined
    for (const [i, el] of target.tree.children.entries()) {
      if (!(el.type === "element" && el.tagName.match(headerRegex))) continue
      const depth = Number(el.tagName.substring(1))
      if (startIdx === undefined || startDepth === undefined) {
        if (el.properties?.id === blockRef) {
          startIdx = i
          startDepth = depth
        }
      } else if (depth <= startDepth) {
        // the next heading as high or higher ends it
        endIdx = i
        break
      }
    }
    if (startIdx === undefined) {
      return [transcludeMissing(`no heading #${blockRef} in ${targetSlug}`, href)]
    }
    return [
      ...(target.tree.children.slice(startIdx, endIdx) as ElementContent[]).map(copy),
      linkToOriginal(href),
    ]
  }

  // the whole note, titled by its alias if it was given one
  return [
    {
      type: "element",
      tagName: "h1",
      properties: {},
      children: [{ type: "text", value: alias ?? target.title ?? `Transclude of ${target.slug}` }],
    } as Element,
    ...(target.tree.children as ElementContent[]).map(copy),
    linkToOriginal(href),
  ]
}

/**
 * Fills in every embed of a note in `root`, and the embeds inside those, and
 * so on. `ancestors` is the chain of notes this tree is embedded through:
 * only a note embedding itself up that chain is circular, so the same note
 * can be embedded twice on one page. Returns the slugs embedded.
 */
export async function renderTranscludes(
  root: Root,
  slug: FullSlug,
  ancestors: Set<FullSlug>,
  found: Set<FullSlug> = new Set(),
): Promise<Set<FullSlug>> {
  const embeds: Element[] = []
  visit(root, "element", (node) => {
    if (node.tagName !== "blockquote") return
    const classNames = (node.properties?.className ?? []) as string[]
    if (!classNames.includes("transclude")) return
    embeds.push(node)
    return SKIP
  })

  for (const node of embeds) {
    const inner = node.children[0] as Element | undefined
    if (inner?.type !== "element") continue
    const targetSlug = (inner.properties["data-slug"] ?? inner.properties.dataSlug ?? slug) as FullSlug
    if (ancestors.has(targetSlug)) {
      console.warn(`basalt: skipping circular transclusion: ${slug} -> ${targetSlug}`)
      node.children = [
        {
          type: "element",
          tagName: "p",
          properties: { className: ["transclude-missing"] },
          children: [{ type: "text", value: `Circular transclusion detected: ${targetSlug}` }],
        },
      ]
      continue
    }
    const target = await renderTarget(targetSlug)
    if (target) found.add(targetSlug)
    node.children = contentOf(node, target, targetSlug, inner.properties?.href)
    // the embedded note's own embeds, with it on the chain
    await renderTranscludes({ type: "root", children: node.children }, slug, new Set([...ancestors, targetSlug]), found)
  }
  return found
}

/** Fills in the note's embeds: run once the note's own tree is done. */
export function rehypeTransclude() {
  return async (tree: Root, file: VFile) => {
    const slug = slugOf(file)
    const found = await renderTranscludes(tree, slug, new Set([slug]))
    if (file.data.frontmatter) file.data.frontmatter.transcludes = [...found]
  }
}

/**
 * Run last: what's embedded goes in as raw html, so the other note's headings
 * stay out of this one's table of contents (Astro collects headings from the
 * elements it's left with).
 */
export function rehypeSealTranscludes() {
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      const classNames = (node.properties?.className ?? []) as string[]
      if (node.tagName !== "blockquote" || !classNames.includes("transclude")) return
      node.children = [{ type: "raw", value: toHtml(node.children, { allowDangerousHtml: true }) } as never]
      return SKIP
    })
  }
}

/** Every table scrolls in a div of its own, as Quartz wrote them. */
export function rehypeTables() {
  return (tree: Root) => {
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "table" || !parent || index === undefined) return
      const parentClasses = parent.type === "element" ? ((parent.properties.className ?? []) as string[]) : []
      if (parentClasses.includes("table-container")) return SKIP
      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: { className: ["table-container"] },
        children: [node],
      }
      return SKIP
    })
  }
}
