// Obsidian's markdown, ported from Quartz's ObsidianFlavoredMarkdown with the
// options Basalt ran it with (no youtube iframes, no embeds inside raw html,
// no checkbox toggles): wikilinks [[a]] [[a|b]] [[a#h]], embeds ![[x]],
// callouts, ==highlights==, #tags, block references ^id, %%comments%% and
// arrows. Its text pass (ofmText) runs before parsing; the rest are a remark
// and a rehype plugin.

import type { BlockContent, DefinitionContent, Html, Paragraph, PhrasingContent, Root } from "mdast"
import type { Element, Literal, Root as HtmlRoot } from "hast"
import { findAndReplace, type ReplaceFunction } from "mdast-util-find-and-replace"
import { toHast } from "mdast-util-to-hast"
import { toHtml } from "hast-util-to-html"
import { SKIP, visit } from "unist-util-visit"
import path from "node:path"
import type { VFile } from "vfile"
import { slugTag, slugifyFilePath, splitAnchor, type FilePath } from "../lib/path"
import { outsideCode } from "./code.ts"

const calloutMapping = {
  note: "note",
  abstract: "abstract",
  summary: "abstract",
  tldr: "abstract",
  info: "info",
  todo: "todo",
  tip: "tip",
  hint: "tip",
  important: "tip",
  success: "success",
  check: "success",
  done: "success",
  question: "question",
  help: "question",
  faq: "question",
  warning: "warning",
  attention: "warning",
  caution: "warning",
  failure: "failure",
  missing: "failure",
  fail: "failure",
  danger: "danger",
  error: "danger",
  bug: "bug",
  example: "example",
  quote: "quote",
  cite: "quote",
} as const

const arrowMapping: Record<string, string> = {
  "->": "&rarr;",
  "-->": "&rArr;",
  "=>": "&rArr;",
  "==>": "&rArr;",
  "<-": "&larr;",
  "<--": "&lArr;",
  "<=": "&lArr;",
  "<==": "&lArr;",
}

function canonicalizeCallout(name: string): string {
  const normalized = name.toLowerCase() as keyof typeof calloutMapping
  // an unknown callout is a custom one
  return calloutMapping[normalized] ?? name
}

const capitalize = (s: string) => s.substring(0, 1).toUpperCase() + s.substring(1)
const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;")

export const externalLinkRegex = /^https?:\/\//i
export const arrowRegex = /(-{1,2}>|={1,2}>|<-{1,2}|<={1,2})/g

// !?                 -> optional embedding
// \[\[               -> open brace
// ([^\[\]\|\#]+)     -> one or more non-special characters ([,],|, or #) (name)
// (#[^\[\]\|\#]+)?   -> # then one or more non-special characters (heading link)
// (\\?\|[^\[\]\#]+)? -> optional escape \ then | then zero or more non-special characters (alias)
export const wikilinkRegex = /!?\[\[([^\[\]\|\#\\]+)?(#+[^\[\]\|\#\\]+)?(\\?\|[^\[\]\#]*)?\]\]/g

// a table: its header row, the separator, and the body rows
export const tableRegex = /^\|([^\n])+\|\n(\|)( ?:?-{3,}:? ?\|)+\n(\|([^\n])+\|\n?)+/gm
// any wikilink (or footnote), only used for escaping them inside tables
export const tableWikilinkRegex = /(!?\[\[[^\]]*?\]\]|\[\^[^\]]*?\])/g

const highlightRegex = /==([^=]+)==/g
const commentRegex = /%%[\s\S]*?%%/g
// from https://github.com/escwxyz/remark-obsidian-callout/blob/main/src/index.ts
const calloutRegex = /^\[\!([\w-]+)\|?(.+?)?\]([+-]?)/
const calloutLineRegex = /^> *\[\!\w+\|?.*?\][+-]?.*$/gm
// a tag starts the line or follows a space; segments of letters, digits, - and _, split by /
const tagRegex = /(?<=^| )#((?:[-_\p{L}\p{Emoji}\p{M}\d])+(?:\/[-_\p{L}\p{Emoji}\p{M}\d]+)*)/gu
const blockReferenceRegex = /\^([-_A-Za-z0-9]+)$/g
const videoExtensionRegex = /\.(mp4|webm|ogg|avi|mov|flv|wmv|mkv|mpg|mpeg|3gp|m4v)$/
const wikilinkImageEmbedRegex = /^(?<alt>(?!^\d*x?\d*$).*?)?(\|?\s*?(?<width>\d+)(x(?<height>\d+))?)?$/

/** The text pass: comments go, callout titles get their own line, wikilinks are made safe to parse. */
export function ofmText(src: string): string {
  src = src.replace(commentRegex, "")
  // force a newline after a callout's title
  src = src.replace(calloutLineRegex, (value) => value + "\n> ")

  // wikilinks inside a table: escape their aliases and headings
  src = src.replace(tableRegex, (value) =>
    value.replace(tableWikilinkRegex, (_value, raw) => {
      let escaped = raw ?? ""
      escaped = escaped.replace("#", "\\#")
      // escape pipes that aren't already
      escaped = escaped.replace(/((^|[^\\])(\\\\)*)\|/g, "$1\\|")
      return escaped
    }),
  )

  // every other wikilink (not inside code, which shows them as written)
  return outsideCode(src, (text) =>
    text.replace(wikilinkRegex, (value, ...capture) => {
      const [rawFp, rawHeader, rawAlias]: (string | undefined)[] = capture
      const [fp, anchor] = splitAnchor(`${rawFp ?? ""}${rawHeader ?? ""}`)
      const blockRef = rawHeader?.startsWith("#^") ? "^" : ""
      const displayAnchor = anchor ? `#${blockRef}${anchor.trim().replace(/^#+/, "")}` : ""
      const displayAlias = rawAlias ?? rawHeader?.replace("#", "|") ?? ""
      const embedDisplay = value.startsWith("!") ? "!" : ""
      // [[spotify:<link>|a caption]]: a song's card (spotify.ts)
      if (rawFp?.startsWith("spotify:")) {
        const caption = (rawAlias ?? "").replace(/^\\?\|/, "").trim()
        return `<spotify src="${escapeAttr(rawFp.slice("spotify:".length).trim())}">${caption.replace(/</g, "&lt;")}</spotify>`
      }
      if (rawFp?.match(externalLinkRegex)) {
        return `${embedDisplay}[${displayAlias.replace(/^\|/, "")}](${rawFp})`
      }
      return `${embedDisplay}[[${fp}${displayAnchor}${displayAlias}]]`
    }),
  )
}

const mdastToHtml = (ast: PhrasingContent | Paragraph) =>
  toHtml(toHast(ast, { allowDangerousHtml: true })!, { allowDangerousHtml: true })

function replacements(file: VFile): [RegExp, string | ReplaceFunction][] {
  const wikilink: ReplaceFunction = (value: string, ...capture: string[]) => {
    const [rawFp, rawHeader, rawAlias] = capture
    const fp = rawFp?.trim() ?? ""
    const anchor = rawHeader?.trim() ?? ""
    const alias: string | undefined = rawAlias?.slice(1).trim()

    if (value.startsWith("!")) {
      const ext = path.extname(fp).toLowerCase()
      const url = slugifyFilePath(fp as FilePath)
      if ([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".svg", ".webp"].includes(ext)) {
        const match = wikilinkImageEmbedRegex.exec(alias ?? "")
        return {
          type: "image",
          url,
          data: {
            hProperties: {
              width: match?.groups?.width ?? "auto",
              height: match?.groups?.height ?? "auto",
              alt: match?.groups?.alt ?? "",
            },
          },
        }
      }
      const embedAlias = escapeAttr(alias ?? "")
      if ([".mp4", ".webm", ".ogv", ".mov", ".mkv"].includes(ext)) {
        return {
          type: "html",
          value: `<video src="${url + anchor}" controls data-embed-alias="${embedAlias}"></video>`,
        }
      }
      if ([".mp3", ".webm", ".wav", ".m4a", ".ogg", ".3gp", ".flac"].includes(ext)) {
        return {
          type: "html",
          value: `<audio src="${url + anchor}" controls data-embed-alias="${embedAlias}"></audio>`,
        }
      }
      if (ext === ".pdf") {
        return {
          type: "html",
          value: `<iframe src="${url + anchor}" class="pdf" data-embed-alias="${embedAlias}"></iframe>`,
        }
      }
      // a note, or a file the embeds plugin makes something of
      return {
        type: "html",
        data: { hProperties: { transclude: true } },
        value: `<blockquote class="transclude" data-url="${url}" data-block="${anchor}" data-embed-alias="${alias}"><a href="${
          url + anchor
        }" class="transclude-inner">Transclude of ${url}${anchor}</a></blockquote>`,
      }
    }

    return { type: "link", url: fp + anchor, children: [{ type: "text", value: alias ?? fp }] }
  }

  const highlight: ReplaceFunction = (_value: string, inner: string) => ({
    type: "html",
    value: `<span class="text-highlight">${inner}</span>`,
  })

  const arrow: ReplaceFunction = (value: string) => {
    const maybeArrow = arrowMapping[value]
    if (maybeArrow === undefined) return false
    return { type: "html", value: `<span>${maybeArrow}</span>` }
  }

  const tag: ReplaceFunction = (_value: string, tag: string) => {
    // a tag of only numbers and slashes isn't one (#1, #2024/10)
    if (/^[\/\d]+$/.test(tag)) return false
    tag = slugTag(tag)
    const fm = file.data.frontmatter
    if (fm) fm.tags = [...new Set([...((fm.tags as string[]) ?? []), tag])]
    return {
      type: "link",
      url: `/tags/${tag}`,
      data: { hProperties: { className: ["tag-link"] } },
      children: [{ type: "text", value: tag }],
    }
  }

  return [
    [wikilinkRegex, wikilink],
    [highlightRegex, highlight],
    [arrowRegex, arrow],
    [tagRegex, tag],
  ]
}

function callouts(tree: Root) {
  visit(tree, "blockquote", (node) => {
    if (node.children.length === 0) return
    const [firstChild, ...calloutContent] = node.children
    if (firstChild.type !== "paragraph" || firstChild.children[0]?.type !== "text") return

    const text = firstChild.children[0].value
    const restOfTitle = firstChild.children.slice(1)
    const [firstLine, ...remainingLines] = text.split("\n")
    const remainingText = remainingLines.join("\n")

    const match = firstLine.match(calloutRegex)
    if (!match || !match.input) return
    const [calloutDirective, typeString, calloutMetaData, collapseChar] = match
    const calloutType = canonicalizeCallout(typeString.toLowerCase())
    const collapse = collapseChar === "+" || collapseChar === "-"
    const defaultState = collapseChar === "-" ? "collapsed" : "expanded"
    const titleContent = match.input.slice(calloutDirective.length).trim()
    const useDefaultTitle = titleContent === "" && restOfTitle.length === 0
    const titleNode: Paragraph = {
      type: "paragraph",
      children: [
        {
          type: "text",
          value: useDefaultTitle ? capitalize(typeString).replace(/-/g, " ") : titleContent + " ",
        },
        ...restOfTitle,
      ],
    }
    const title = mdastToHtml(titleNode)
    const toggleIcon = `<div class="fold-callout-icon"></div>`
    const titleHtml: Html = {
      type: "html",
      value: `<div
                  class="callout-title"
                >
                  <div class="callout-icon"></div>
                  <div class="callout-title-inner">${title}</div>
                  ${collapse ? toggleIcon : ""}
                </div>`,
    }

    const blockquoteContent: (BlockContent | DefinitionContent)[] = [titleHtml]
    if (remainingText.length > 0) {
      blockquoteContent.push({ type: "paragraph", children: [{ type: "text", value: remainingText }] })
    }

    // the rest of the callout goes in div.callout-content, for the fold's animation
    if (calloutContent.length > 0) {
      node.children = [
        node.children[0],
        {
          data: { hProperties: { className: ["callout-content"] }, hName: "div" },
          type: "blockquote",
          children: [...calloutContent],
        },
      ]
    }
    // the title, and the rest of its paragraph, take the first line's place
    node.children.splice(0, 1, ...blockquoteContent)

    const classNames = ["callout", calloutType]
    if (collapse) classNames.push("is-collapsible")
    if (defaultState === "collapsed") classNames.push("is-collapsed")
    node.data = {
      hProperties: {
        ...(node.data?.hProperties ?? {}),
        // as Quartz wrote it, one string, so the classes come out in this order
        className: classNames.join(" ") as unknown as string[],
        "data-callout": calloutType,
        "data-callout-fold": collapse,
        "data-callout-metadata": calloutMetaData,
      },
    }
  })
}

export function remarkOfm() {
  return (tree: Root, file: VFile) => {
    findAndReplace(tree, replacements(file))

    // ![](clip.mp4) is a video
    visit(tree, "image", (node, index, parent) => {
      if (parent && index != undefined && videoExtensionRegex.test(node.url)) {
        parent.children.splice(index, 1, {
          type: "html",
          value: `<video controls src="${node.url}" data-embed-alias="${escapeAttr(node.alt ?? "")}"></video>`,
        })
        return SKIP
      }
    })

    callouts(tree)

    visit(tree, "code", (node) => {
      if (node.lang === "mermaid") {
        file.data.hasMermaidDiagram = true
        node.data = {
          hProperties: { className: ["mermaid"], "data-clipboard": JSON.stringify(node.value) },
        }
      }
    })
  }
}

const inlineTagTypes = new Set(["p", "li"])
const blockTagTypes = new Set(["blockquote"])

/** `^id` at the end of a block names it, for ![[note#^id]]. */
function blockReferences(tree: HtmlRoot, file: VFile) {
  const blocks: Record<string, Element> = (file.data.blocks = {})
  visit(tree, "element", (node, index, parent) => {
    if (blockTagTypes.has(node.tagName)) {
      const nextChild = parent?.children.at(index! + 2) as Element
      if (nextChild && nextChild.tagName === "p") {
        const text = nextChild.children.at(0) as Literal
        if (text && text.value && text.type === "text") {
          const matches = text.value.match(blockReferenceRegex)
          if (matches && matches.length >= 1) {
            parent!.children.splice(index! + 2, 1)
            const block = matches[0].slice(1)
            if (!(block in blocks)) {
              node.properties = { ...node.properties, id: block }
              blocks[block] = node
            }
          }
        }
      }
    } else if (inlineTagTypes.has(node.tagName)) {
      const last = node.children.at(-1) as Literal
      if (last && last.value && typeof last.value === "string") {
        const matches = last.value.match(blockReferenceRegex)
        if (matches && matches.length >= 1) {
          last.value = last.value.slice(0, -matches[0].length)
          const block = matches[0].slice(1)
          if (last.value === "") {
            // an inline ref on its own: the block is the element before it
            let idx = (index ?? 1) - 1
            while (idx >= 0) {
              const element = parent?.children.at(idx)
              if (!element) break
              if (element.type !== "element") {
                idx -= 1
              } else {
                if (!(block in blocks)) {
                  element.properties = { ...element.properties, id: block }
                  blocks[block] = element
                }
                return
              }
            }
          } else if (!(block in blocks)) {
            node.properties = { ...node.properties, id: block }
            blocks[block] = node
          }
        }
      }
    }
  })
  file.data.htmlAst = tree
}

const EXPAND_PATH =
  "M3.72 3.72a.75.75 0 011.06 1.06L2.56 7h10.88l-2.22-2.22a.75.75 0 011.06-1.06l3.5 3.5a.75.75 0 010 1.06l-3.5 3.5a.75.75 0 11-1.06-1.06l2.22-2.22H2.56l2.22 2.22a.75.75 0 11-1.06 1.06l-3.5-3.5a.75.75 0 010-1.06l3.5-3.5z"

/** A mermaid block's <pre> gets its expand button and the dialog it opens. */
function mermaid(tree: HtmlRoot) {
  visit(tree, "element", (node: Element, _idx, parent) => {
    if (
      node.tagName !== "code" ||
      !((node.properties?.className ?? []) as string[]).includes("mermaid")
    )
      return
    const el = (tagName: string, properties: Element["properties"], children: Element["children"] = []): Element => ({
      type: "element",
      tagName,
      properties,
      children,
    })
    parent!.children = [
      el("button", { className: ["expand-button"], "aria-label": "Expand mermaid diagram", "data-view-component": true }, [
        el("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "currentColor" }, [
          el("path", { fillRule: "evenodd", d: EXPAND_PATH }),
        ]),
      ]),
      node,
      el("div", { id: "mermaid-container", role: "dialog" }, [
        el("div", { id: "mermaid-space" }, [el("div", { className: ["mermaid-content"] })]),
      ]),
    ]
  })
}

export function rehypeOfm() {
  return (tree: HtmlRoot, file: VFile) => {
    blockReferences(tree, file)
  }
}

/**
 * A mermaid block's button and dialog, before code is highlighted: a <pre>
 * with more than its <code> isn't one rehype-pretty-code highlights, so the
 * block keeps its source and its `mermaid` class for the browser to draw.
 */
export function rehypeMermaid() {
  return (tree: HtmlRoot, file: VFile) => {
    if (file.data.hasMermaidDiagram) mermaid(tree)
  }
}

declare module "vfile" {
  interface DataMap {
    blocks: Record<string, Element>
    htmlAst: HtmlRoot
    hasMermaidDiagram: boolean | undefined
  }
}
