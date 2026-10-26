import test, { describe } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { parseLog, gitDates, datesOf, forgetGitDates } from "./gitdates.ts"

const day = (n: number) => 1_700_000_000 + n * 86400

describe("git dates", () => {
  test("newest and oldest commit, renames followed, a deleted file's past left behind", () => {
    const log = [
      `\0${day(5)}`, "", "M\tnotes/b.md",
      `\0${day(4)}`, "", "R100\told/a.md\tnotes/a.md",
      `\0${day(3)}`, "", "A\tnotes/b.md", "M\told/a.md", "D\tnotes/gone.md",
      `\0${day(2)}`, "", "D\tnotes/b.md",
      `\0${day(1)}`, "", "A\told/a.md", "A\tnotes/b.md", "A\tnotes/gone.md",
    ].join("\n")
    const got = parseLog(log)
    assert.deepStrictEqual(got.get("notes/a.md"), { created: day(1) * 1000, modified: day(4) * 1000 })
    // b was deleted at day 2 and written again at day 3: that's when this one was
    assert.deepStrictEqual(got.get("notes/b.md"), { created: day(3) * 1000, modified: day(5) * 1000 })
    assert.strictEqual(got.has("notes/gone.md"), false)
    assert.strictEqual(got.has("old/a.md"), false)
  })

  test("a repository's dates, by absolute path; uncommitted changes and new files from the file system", () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "basalt-gitdates-")))
    const g = (args: string[], when: number) =>
      execFileSync("git", args, {
        cwd: dir,
        stdio: "ignore",
        env: { ...process.env, GIT_AUTHOR_DATE: `@${when}`, GIT_COMMITTER_DATE: `@${when}`, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
      })
    g(["init", "-q"], day(0))
    fs.mkdirSync(path.join(dir, "posts"))
    fs.writeFileSync(path.join(dir, "posts", "a.md"), "a")
    g(["add", "."], day(1))
    g(["commit", "-qm", "a"], day(1))
    fs.mkdirSync(path.join(dir, "notes"))
    g(["mv", "posts/a.md", "notes/a.md"], day(2))
    g(["commit", "-qm", "move"], day(2))
    fs.writeFileSync(path.join(dir, "notes", "a.md"), "a, again")
    fs.writeFileSync(path.join(dir, "notes", "new.md"), "new")
    forgetGitDates()
    const dates = gitDates([path.join(dir, "notes")])
    const a = dates.get(path.join(dir, "notes", "a.md"))!
    // moved in from posts/ at day 2: written at day 1
    assert.strictEqual(a.created.getTime(), day(1) * 1000)
    // changed and not committed: modified is the save
    assert.ok(a.modified.getTime() > day(2) * 1000)
    const fresh = datesOf(path.join(dir, "notes", "new.md"), [path.join(dir, "notes")])
    assert.ok(Math.abs(fresh.modified.getTime() - Date.now()) < 60_000)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("outside a repository: nothing from git", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-nogit-"))
    forgetGitDates()
    assert.strictEqual(gitDates([dir]).size, 0)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
