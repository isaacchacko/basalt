// An editor's unsaved buffer (integrations/buffer.ts): shown in place of its
// note's file, which isn't touched, until it's dropped; and only from an editor.
import "../markdown/test-hooks.ts"
import test, { after, before, describe } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import type { AddressInfo } from "node:net"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-buffer-"))
fs.mkdirSync(path.join(dir, "notes"))
const note = path.join(dir, "notes", "a.md")
fs.writeFileSync(note, "saved\n")
fs.writeFileSync(path.join(dir, "notes", "picture.png"), "")
process.env.BASALT_SITE = dir
const { answerBuffer } = await import("./buffer.ts")
const { readNote, stampOf } = await import("../lib/buffers.ts")

const changed: string[] = []
let server: http.Server
let url: string
before(async () => {
  server = http.createServer((req, res) => void answerBuffer(req, res, (abs) => changed.push(abs)))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/__basalt/buffer`
})
after(() => {
  server.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const editor = { "content-type": "application/json", "x-basalt-buffer": "1" }
const send = (method: string, body: object, headers: Record<string, string> = editor) => fetch(url, { method, headers, body: JSON.stringify(body) })

describe("an editor's buffer", () => {
  test("is the note's text till it's dropped, and the file is as it was", async () => {
    const was = stampOf(note)
    assert.strictEqual((await send("PUT", { file: note, text: "typed\n" })).status, 200)
    assert.strictEqual(readNote(note), "typed\n")
    assert.notStrictEqual(stampOf(note), was)
    assert.strictEqual(fs.readFileSync(note, "utf8"), "saved\n")
    assert.deepStrictEqual(changed, [note])
    assert.strictEqual((await send("DELETE", { file: "notes/a.md" })).status, 200)
    assert.strictEqual(readNote(note), "saved\n")
    assert.strictEqual(stampOf(note), was)
    assert.deepStrictEqual(changed, [note, note])
  })

  test("the same text again, or a drop of none, changes nothing", async () => {
    await send("PUT", { file: note, text: "typed\n" })
    await send("PUT", { file: note, text: "typed\n" })
    await send("DELETE", { file: note })
    await send("DELETE", { file: note })
    assert.strictEqual(changed.length, 4)
  })

  test("only a note of the site's, and only from an editor", async () => {
    assert.strictEqual((await send("PUT", { file: path.join(dir, "notes", "picture.png"), text: "x" })).status, 404)
    assert.strictEqual((await send("PUT", { file: "/etc/hosts", text: "x" })).status, 404)
    assert.strictEqual((await send("PUT", { file: note, text: "x" }, { "content-type": "application/json" })).status, 403)
    assert.strictEqual((await send("PUT", { file: note, text: "x" }, { ...editor, origin: "https://elsewhere.example" })).status, 403)
    assert.strictEqual((await fetch(url)).status, 405)
    assert.strictEqual(readNote(note), "saved\n")
  })
})
