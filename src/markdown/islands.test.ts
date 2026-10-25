import "./test-hooks.ts"
import test, { describe } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
const { findIslands, islandProps, renderIsland } = await import("./islands.ts")

function islandsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-islands-"))
  fs.writeFileSync(
    path.join(dir, "counter.tsx"),
    `import { useState } from "preact/hooks"
import "./counter.css"
export default function Counter({ start = 0 }: { start?: number }) {
  const [n] = useState(start)
  return <button>clicked {n}</button>
}`,
  )
  fs.writeFileSync(path.join(dir, "counter.css"), "button { color: red }")
  fs.writeFileSync(path.join(dir, "clock.ts"), "export function mount(el: HTMLElement) { el.textContent = 'tick' }")
  fs.writeFileSync(path.join(dir, "_helper.ts"), "export const x = 1")
  return dir
}

describe("islands", () => {
  test("attributes become props: numbers, booleans and json", () => {
    assert.deepStrictEqual(
      islandProps({ name: "x", ssr: "", start: "3", on: "true", tz: "UTC", props: '{"list":[1]}' }),
      { start: 3, on: true, tz: "UTC", list: [1] },
    )
  })

  test("finds island modules, but not helpers", () => {
    assert.deepStrictEqual([...findIslands(islandsDir()).keys()], ["clock", "counter"])
  })

  test("renders an island at build time with its props", async () => {
    const html = await renderIsland(islandsDir(), "counter", { start: 7 })
    assert.strictEqual(html, "<button>clicked 7</button>")
  })

  test("a mount-only island renders nothing at build time", async () => {
    assert.strictEqual(await renderIsland(islandsDir(), "clock", {}), "")
  })
})
