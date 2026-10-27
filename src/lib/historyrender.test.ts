// A commit's changes marked on versions the real pipeline renders
// (markdown/rendernote.ts), on a repo scripted after a garden note's: a
// footnote put in before the note's others (which renumbers them), under a
// song card. Only what the commit wrote is marked.
import "../markdown/test-hooks.ts"
import test, { after, describe } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "basalt-history-render-")))
const dir = path.join(top, "garden")
fs.mkdirSync(path.join(dir, "notes"), { recursive: true })
fs.writeFileSync(path.join(dir, "basalt.json"), JSON.stringify({ title: "t", locale: "en-US", content: [{ from: "notes" }] }))
// the song as the site's cache has it: no fetch
fs.mkdirSync(path.join(dir, ".basalt", "astro", "cache"), { recursive: true })
fs.writeFileSync(path.join(dir, ".basalt", "astro", "cache", "spotify.json"), JSON.stringify({ "6QhMfzuzO4WxmiglCqFloz": { title: "A song", url: "https://open.spotify.com/track/6QhMfzuzO4WxmiglCqFloz", artist: "Someone" } }))
process.env.BASALT_SITE = dir
const command = process.env.BASALT_COMMAND
process.env.BASALT_COMMAND = "dev"
after(() => {
  if (command === undefined) delete process.env.BASALT_COMMAND
  else process.env.BASALT_COMMAND = command
  fs.rmSync(top, { recursive: true, force: true })
})

const { refreshRegistry } = await import("./registry.ts")
const { renderNote } = await import("../markdown/rendernote.ts")
const { versionAt } = await import("./history.ts")
const { forgetGitDates } = await import("./gitdates.ts")

let when = 0
const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: top,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: `@${1_700_000_000 + when}`, GIT_COMMITTER_DATE: `@${1_700_000_000 + ++when}`, GIT_AUTHOR_NAME: "A", GIT_AUTHOR_EMAIL: "a@a", GIT_COMMITTER_NAME: "A", GIT_COMMITTER_EMAIL: "a@a" },
  }).trim()
git("init", "-q")
const abs = path.join(dir, "notes", "friction.md")
const commit = (text: string) => {
  fs.writeFileSync(abs, text)
  git("add", ".")
  git("commit", "-qm", "c")
  return git("rev-parse", "HEAD")
}

const note = (have: string, garden: string, definitions: string) => `---
title: friction
---

[[spotify:https://open.spotify.com/track/6QhMfzuzO4WxmiglCqFloz?si=a9762c1cbc374fbe|good song, caught from a friend's now playing]]

i hate writing "have to" in notes but i do have to here, no pun intended.${have}

of the many things i want to be:

- intelligent
- creative

# intelligence

it comes from diving a level deeper, asking why.

# digital garden

${garden}

[^heated]: not heated

[^care]: interrupting realization: write down what you irrationally care about.

${definitions}i should be using this garden to publish.
`

commit(note("", "a one-sided rivalry[^heated] with a tool i irrationally care[^care] about.", ""))

async function marksAt(sha: string) {
  forgetGitDates()
  const site = refreshRegistry().site
  const v = await versionAt(site, abs, sha, renderNote)
  assert.ok(v)
  const html = v.html
  return {
    html,
    ins: [...html.matchAll(/<ins>(.*?)<\/ins>/g)].map((m) => m[1]),
    del: [...html.matchAll(/<del>(.*?)<\/del>/g)].map((m) => m[1]),
    added: [...html.matchAll(/<(\w+)[^>]*class="[^"]*history-added[^"]*"[^>]*>/g)].map((m) => `${m[1]}${/data-sidenote="([^"]+)"/.exec(m[0])?.[1] ?? /id="([^"]+)"/.exec(m[0])?.[1] ?? ""}`),
    removed: [...html.matchAll(/class="[^"]*history-removed/g)].length,
  }
}

describe("a footnote put in before the note's others", () => {
  test("its reference and its note marked, nothing else: the notes it renumbers, the song card, the headings and paragraphs after it are as they were", async () => {
    const sha = commit(note("[^123]\n\n[^123]: edit the day after: i didn't use it", "a one-sided rivalry[^heated] with a tool i irrationally care[^care] about.", ""))
    const got = await marksAt(sha)
    assert.deepStrictEqual(got.ins, ["1"])
    assert.deepStrictEqual(got.del, [])
    assert.strictEqual(got.removed, 0)
    // the note in the margin, and its definition in the footnotes at the bottom (shown where there's no margin)
    assert.deepStrictEqual(got.added, ["spanuser-content-fn-123", "liuser-content-fn-123"])
    // renumbered, not marked
    assert.match(got.html, /data-sidenote="user-content-fn-heated">2<\/a>/)
  })

  test("a word changed in a paragraph whose footnotes were renumbered, and a definition nothing refers to: only that word", async () => {
    const sha = commit(note("[^123]\n\n[^123]: edit the day after: i didn't use it", "a one-sided feud[^heated] with a tool i irrationally care[^care] about.", "[^new]: a fresh one\n\n"))
    const got = await marksAt(sha)
    assert.deepStrictEqual(got.ins, ["feud"])
    assert.deepStrictEqual(got.del, ["rivalry"])
    assert.strictEqual(got.removed, 0)
    // [^new] isn't referenced: no note, and not in the footnotes
    assert.deepStrictEqual(got.added, [])
  })

  test("a footnote's reference and definition taken out: its number struck, its note put back struck", async () => {
    const sha = commit(note("", "a one-sided feud with a tool i irrationally care[^care] about.", "[^new]: a fresh one\n\n").replace("[^heated]: not heated\n\n", ""))
    const got = await marksAt(sha)
    assert.deepStrictEqual(got.ins, [])
    assert.deepStrictEqual(got.del, ["1", "2"])
    assert.ok(got.removed >= 2)
  })
})
