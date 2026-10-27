// One text → another, as CodeMirror changes, line by line (the line diff of
// lib/linemap.ts): the editor takes in a save from elsewhere this way, over
// its own edits (editor.ts).

import { ChangeSet, type ChangeSpec } from "@codemirror/state"
import { commonLines } from "../lib/linemap.ts"

/** a text's lines, each with its newline (the last has none, or is "") */
const lines = (s: string) => s.split(/(?<=\n)/)

export function diff(a: string, b: string): ChangeSet {
  const A = lines(a)
  const B = lines(b)
  const at = (ls: string[]) => ls.reduce((out, l) => (out.push(out[out.length - 1] + l.length), out), [0])
  const sa = at(A)
  const changes: ChangeSpec[] = []
  let i = 0
  let j = 0
  for (const [ci, cj] of [...commonLines(A, B), [A.length, B.length] as [number, number]]) {
    if (ci > i || cj > j) changes.push({ from: sa[i], to: sa[ci], insert: B.slice(j, cj).join("") })
    i = ci + 1
    j = cj + 1
  }
  return ChangeSet.of(changes, a.length)
}
