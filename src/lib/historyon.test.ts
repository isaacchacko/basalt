// Which notes show their history, and the commits and versions a note has,
// past what history.test.ts covers: the settings, a shallow clone, each
// version's base and path (lib/history.ts).
import test, { afterEach, describe } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { commitsFor, historyOn, versionAt } from "./history.ts"
import { forgetGitDates } from "./gitdates.ts"
import type { Site } from "./site.ts"

const command = process.env.BASALT_COMMAND
afterEach(() => {
  if (command === undefined) delete process.env.BASALT_COMMAND
  else process.env.BASALT_COMMAND = command
})

const siteWith = (history: boolean | undefined, dir = "/nowhere") => ({ dir, work: dir, config: { title: "t", locale: "en-US", content: [{ from: "notes" }], history } }) as unknown as Site

describe("historyOn", () => {
  test("while serving: on unless the site says false; a note's frontmatter over that", () => {
    process.env.BASALT_COMMAND = "dev"
    assert.strictEqual(historyOn(siteWith(undefined), {}), true)
    assert.strictEqual(historyOn(siteWith(true), {}), true)
    assert.strictEqual(historyOn(siteWith(false), {}), false)
    assert.strictEqual(historyOn(siteWith(undefined), { history: false }), false)
    assert.strictEqual(historyOn(siteWith(false), { history: true }), true)
  })

  test("built: only with the site's history: true; a note's frontmatter over that", () => {
    process.env.BASALT_COMMAND = "build"
    assert.strictEqual(historyOn(siteWith(undefined), {}), false)
    assert.strictEqual(historyOn(siteWith(true), {}), true)
    assert.strictEqual(historyOn(siteWith(false), {}), false)
    assert.strictEqual(historyOn(siteWith(true), { history: false }), false)
    assert.strictEqual(historyOn(siteWith(undefined), { history: true }), true)
  })

  test("a frontmatter history that isn't true or false is the site's", () => {
    process.env.BASALT_COMMAND = "build"
    assert.strictEqual(historyOn(siteWith(true), { history: "yes" }), true)
    assert.strictEqual(historyOn(siteWith(undefined), { history: 1 }), false)
    assert.strictEqual(historyOn(siteWith(true), undefined), true)
  })
})

/** a repo: plants.md made, another file, plants.md edited, renamed garden.md, edited again */
function repo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "basalt-historyon-")))
  const g = (args: string[], when = 0) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_AUTHOR_DATE: `@${1_700_000_000 + when}`, GIT_COMMITTER_DATE: `@${1_700_000_000 + when}`, GIT_AUTHOR_NAME: "A", GIT_AUTHOR_EMAIL: "a@a", GIT_COMMITTER_NAME: "A", GIT_COMMITTER_EMAIL: "a@a" },
    }).trim()
  g(["init", "-q", "-b", "main"])
  fs.mkdirSync(path.join(dir, "notes"))
  fs.writeFileSync(path.join(dir, "notes", "plants.md"), "Tomatoes like sun.\n")
  g(["add", "."])
  g(["commit", "-qm", "start"], 1)
  fs.writeFileSync(path.join(dir, "notes", "other.md"), "x\n")
  g(["add", "."])
  g(["commit", "-qm", "other"], 2)
  fs.writeFileSync(path.join(dir, "notes", "plants.md"), "Tomatoes like sun.\n\nThe soil is clay.\n")
  g(["commit", "-qam", "soil"], 3)
  g(["mv", "notes/plants.md", "notes/garden.md"])
  g(["commit", "-qm", "rename"], 4)
  fs.writeFileSync(path.join(dir, "notes", "garden.md"), "Tomatoes love sun.\n\nThe soil is clay.\n")
  g(["commit", "-qam", "love"], 5)
  const shas = Object.fromEntries(g(["log", "--format=%s %H"]).split("\n").map((l) => l.split(" ")))
  forgetGitDates()
  return { dir, shas, site: siteWith(true, dir), abs: path.join(dir, "notes", "garden.md") }
}

/** a stand-in for the pipeline: each paragraph a <p> with the lines it came from */
async function render(_abs: string, text: string): Promise<string> {
  const out: string[] = []
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    let j = i
    while (j + 1 < lines.length && lines[j + 1].trim()) j++
    out.push(`<p data-src="${i + 1}-${j + 1}">${lines.slice(i, j + 1).join(" ")}</p>`)
    i = j
  }
  return out.join("\n")
}

describe("a note's commits and versions", () => {
  test("a shallow clone's history isn't complete", () => {
    const { dir } = repo()
    const shallow = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "basalt-shallow-")))
    execFileSync("git", ["clone", "-q", "--depth", "2", `file://${dir}`, shallow], { stdio: "ignore" })
    forgetGitDates()
    const got = commitsFor(siteWith(true, shallow), path.join(shallow, "notes", "garden.md"), "garden")
    assert.strictEqual(got.complete, false)
    assert.deepStrictEqual(
      got.commits.map((c) => c.subject),
      ["love", "rename"],
    )
    fs.rmSync(shallow, { recursive: true, force: true })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("a version's base is the commit before it that touched the note, not git's parent; its path the file's name then", async () => {
    const { dir, shas, site, abs } = repo()
    const soil = await versionAt(site, abs, shas.soil, render)
    assert.ok(soil)
    // "other" is soil's git parent, but didn't touch the note
    assert.strictEqual(soil.base, shas.start)
    assert.strictEqual(soil.path, "notes/plants.md")
    assert.match(soil.html, /<p[^>]*class="history-added"[^>]*>The soil is clay\.<\/p>/)
    assert.strictEqual(soil.plain, await render(abs, "Tomatoes like sun.\n\nThe soil is clay.\n"))
    const love = await versionAt(site, abs, shas.love, render)
    assert.strictEqual(love?.base, shas.rename)
    assert.strictEqual(love?.path, "notes/garden.md")
    assert.match(love!.html, /<del>like<\/del>/)
    assert.match(love!.html, /<ins>love<\/ins>/)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("the rename changed nothing: nothing marked", async () => {
    const { dir, shas, site, abs } = repo()
    const v = await versionAt(site, abs, shas.rename, render)
    assert.ok(v)
    assert.strictEqual(v.base, shas.soil)
    assert.doesNotMatch(v.html, /<ins>|<del>|history-added|history-removed/)
    assert.strictEqual(v.html, v.plain)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("the first version: no base, all of it added", async () => {
    const { dir, shas, site, abs } = repo()
    const v = await versionAt(site, abs, shas.start, render)
    assert.strictEqual(v?.base, null)
    assert.strictEqual(v?.path, "notes/plants.md")
    assert.match(v!.html, /class="history-added"/)
    assert.doesNotMatch(v!.html, /<del>|history-removed/)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("a commit that didn't touch the note, or isn't there: no version", async () => {
    const { dir, shas, site, abs } = repo()
    assert.strictEqual(await versionAt(site, abs, shas.other, render), undefined)
    assert.strictEqual(await versionAt(site, abs, "0".repeat(40), render), undefined)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
