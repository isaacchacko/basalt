// fenced code blocks and `inline code`
const codeRegex = /(^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\2[^\n]*$|`+[^`\n]+`+)/gm

/** Applies `fn` to the parts of `src` that aren't code. */
export function outsideCode(src: string, fn: (text: string) => string): string {
  let out = ""
  let last = 0
  for (const m of src.matchAll(codeRegex)) {
    out += fn(src.slice(last, m.index)) + m[0]
    last = m.index! + m[0].length
  }
  return out + fn(src.slice(last))
}
