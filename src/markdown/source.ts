// A note's own file, as it was written, highlighted the way its code blocks
// are: what the page shows in its place when the source toggle is on
// (SourceToggle.astro).

import rehypePrettyCode, { type Options } from "rehype-pretty-code"
import { h } from "hastscript"
import { toHtml } from "hast-util-to-html"
import { unified } from "unified"

/** how code is highlighted: a light and a dark theme, the page's own background */
export const prettyCode: Options = { theme: { light: "github-light", dark: "github-dark" }, keepBackground: false }

export async function highlightSource(raw: string): Promise<string> {
  const tree = h(null, [h("pre", [h("code", { className: ["language-md"] }, raw)])])
  return toHtml(await unified().use(rehypePrettyCode, prettyCode).run(tree))
}
