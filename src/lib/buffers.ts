// What's typed in an editor and not saved yet: a note's text as its buffer has
// it, read in place of its file while serving, so the page shows it as you
// type. integrations/buffer.ts takes it from the editor (lua/basalt, for
// Neovim) and drops it when the buffer's written or closed; the file itself
// is never touched. The integration and the loader are loaded through
// different module graphs, so the buffers live on globalThis.

import fs from "node:fs"

const KEY = Symbol.for("basalt.buffers")
type Holder = { [KEY]?: Map<string, { text: string; stamp: number }> }

export function buffers() {
  const g = globalThis as Holder
  return (g[KEY] ??= new Map())
}

// a buffer's stamp counts down from -1, so it's never a file's mtime
let stamps = 0

export function setBuffer(abs: string, text: string) {
  buffers().set(abs, { text, stamp: --stamps })
}

/** A note's text: its buffer's, while it has one, else its file's. */
export const readNote = (abs: string): string => buffers().get(abs)?.text ?? fs.readFileSync(abs, "utf8")

/** What changes whenever readNote(abs) does: its buffer's stamp, else its file's mtime (0 when it's gone). */
export const stampOf = (abs: string): number => buffers().get(abs)?.stamp ?? fs.statSync(abs, { throwIfNoEntry: false })?.mtimeMs ?? 0
