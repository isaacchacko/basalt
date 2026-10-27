// What a note's drawn block is found by (editor.ts): its text, and which of
// the blocks with that text it is, counting in the note's order. The same
// text is the same nodes (an island running, a diagram drawn, wherever the
// edits move it), but two blocks with the same text (an embed written twice)
// are two blocks, each with its own.

const SEP = "\u0000"

/** Each text's key: the text itself the first time it comes, then the text and how many came before. */
export function keysOf(texts: string[]): string[] {
  const seen = new Map<string, number>()
  return texts.map((text) => {
    const n = seen.get(text) ?? 0
    seen.set(text, n + 1)
    return n ? `${text}${SEP}${n}` : text
  })
}

/** a key's text */
export const textOf = (key: string) => key.split(SEP)[0]
