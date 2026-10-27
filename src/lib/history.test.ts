import test, { describe } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { marked, commitsFor } from "./history.ts"
import { forgetGitDates } from "./gitdates.ts"
import type { Site } from "./site.ts"

/** a rendering: one block per [lines, html] */
const page = (...blocks: [string, string][]) => blocks.map(([lines, html]) => html.replace(/^<(\w+)/, `<$1 data-src="${lines}"`)).join("\n")
const ins = (html: string) => [...html.matchAll(/<ins>(.*?)<\/ins>/g)].map((m) => m[1])
const del = (html: string) => [...html.matchAll(/<del>(.*?)<\/del>/g)].map((m) => m[1])

describe("a commit's changes, marked", () => {
  test("a sentence edited: the words it lost struck, the words it gained marked, the rest as it was", () => {
    const was = "# A\n\nTomatoes like sun.\n\nHerbs.\n"
    const now = "# A\n\nTomatoes love full sun.\n\nHerbs.\n"
    const out = marked(was, page(["1-1", "<h1>A</h1>"], ["3-3", "<p>Tomatoes like sun.</p>"], ["5-5", "<p>Herbs.</p>"]), now, page(["1-1", "<h1>A</h1>"], ["3-3", "<p>Tomatoes love full sun.</p>"], ["5-5", "<p>Herbs.</p>"]))
    assert.deepStrictEqual(ins(out), ["love full"])
    assert.deepStrictEqual(del(out), ["like"])
    assert.match(out, /<p data-src="5-5">Herbs\.<\/p>/)
    assert.doesNotMatch(out, /history-(added|removed)/)
  })

  test("a paragraph added and one removed: whole blocks, in their places", () => {
    const was = "One.\n\nTwo.\n\nThree.\n"
    const now = "One.\n\nThree.\n\nFour.\n"
    const out = marked(was, page(["1-1", "<p>One.</p>"], ["3-3", "<p>Two.</p>"], ["5-5", "<p>Three.</p>"]), now, page(["1-1", "<p>One.</p>"], ["3-3", "<p>Three.</p>"], ["5-5", "<p>Four.</p>"]))
    assert.deepStrictEqual(
      [...out.matchAll(/<p([^>]*)>(.*?)<\/p>/g)].map((m) => `${m[2]}${/history-removed/.test(m[1]) ? "-" : /history-added/.test(m[1]) ? "+" : ""}`),
      ["One.", "Two.-", "Three.", "Four.+"],
    )
    // a removed block is the base's: not the version's lines
    assert.doesNotMatch(out, /data-src="3-3" class="history-removed"/)
    assert.deepStrictEqual([ins(out), del(out)], [[], []])
  })

  test("a list: an item added, one removed, one changed", () => {
    const was = "- basil\n- mint\n- thyme\n"
    const now = "- mint\n- lemon thyme\n- peppers\n"
    const out = marked(was, page(["1-3", "<ul>\n<li>basil</li>\n<li>mint</li>\n<li>thyme</li>\n</ul>"]), now, page(["1-3", "<ul>\n<li>mint</li>\n<li>lemon thyme</li>\n<li>peppers</li>\n</ul>"]))
    assert.match(out, /<li class="history-removed">basil<\/li>/)
    assert.match(out, /<li class="history-added">peppers<\/li>/)
    assert.deepStrictEqual(ins(out), ["lemon"])
    assert.match(out, /<li>mint<\/li>/)
  })

  test("an edit across two blocks: each block word by word", () => {
    const was = "Tomatoes grow tall by July.\n\nThe soil is clay.\n"
    const now = "Tomatoes grow tall by August.\n\nOur soil is clay.\n"
    const out = marked(was, page(["1-1", "<p>Tomatoes grow tall by July.</p>"], ["3-3", "<p>The soil is clay.</p>"]), now, page(["1-1", "<p>Tomatoes grow tall by August.</p>"], ["3-3", "<p>Our soil is clay.</p>"]))
    assert.deepStrictEqual(ins(out), ["August", "Our"])
    assert.deepStrictEqual(del(out), ["July", "The"])
  })

  test("text inside the block's own elements: marked where it is", () => {
    const was = "Read **the old** book.\n"
    const now = "Read **the new** book.\n"
    const out = marked(was, page(["1-1", "<p>Read <strong>the old</strong> book.</p>"]), now, page(["1-1", "<p>Read <strong>the new</strong> book.</p>"]))
    assert.match(out, /<strong>the <del>old<\/del><ins>new<\/ins><\/strong>/)
  })

  test("the first commit: everything added", () => {
    const out = marked("", "", "Hello.\n\n- a\n", page(["1-1", "<p>Hello.</p>"], ["3-3", "<ul>\n<li>a</li>\n</ul>"]))
    assert.match(out, /<p data-src="1-1" class="history-added">Hello\.<\/p>/)
    assert.match(out, /<ul data-src="3-3" class="history-added">/)
  })

  test("math changed: the block replaced whole, not word by word", () => {
    const was = "$$x$$\n"
    const now = "$$y$$\n"
    const out = marked(was, page(["1-1", '<div><span class="katex">x</span></div>']), now, page(["1-1", '<div><span class="katex">y</span></div>']))
    assert.match(out, /class="history-removed"/)
    assert.match(out, /class="history-added"/)
    assert.deepStrictEqual([ins(out), del(out)], [[], []])
  })
})

describe("a note's commits", () => {
  test("newest first, renames followed, other files' commits left out, with the path at each", () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "basalt-history-")))
    const g = (args: string[], when = 0) =>
      execFileSync("git", args, {
        cwd: dir,
        stdio: "ignore",
        env: { ...process.env, GIT_AUTHOR_DATE: `@${1_700_000_000 + when}`, GIT_COMMITTER_DATE: `@${1_700_000_000 + when}`, GIT_AUTHOR_NAME: "A", GIT_AUTHOR_EMAIL: "a@a", GIT_COMMITTER_NAME: "A", GIT_COMMITTER_EMAIL: "a@a" },
      })
    g(["init", "-q"])
    fs.mkdirSync(path.join(dir, "notes"))
    fs.writeFileSync(path.join(dir, "notes", "plants.md"), "one\n")
    g(["add", "."])
    g(["commit", "-qm", "start"], 1)
    fs.writeFileSync(path.join(dir, "notes", "other.md"), "x\n")
    g(["add", "."])
    g(["commit", "-qm", "other"], 2)
    fs.writeFileSync(path.join(dir, "notes", "plants.md"), "one\ntwo\n")
    g(["commit", "-qam", "more"], 3)
    g(["mv", "notes/plants.md", "notes/garden.md"])
    g(["commit", "-qm", "rename"], 4)
    forgetGitDates()
    const site = { dir, config: { title: "t", locale: "en-US", content: [{ from: "notes" }] }, work: dir } as Site
    const got = commitsFor(site, path.join(dir, "notes", "garden.md"), "garden")
    assert.deepStrictEqual(
      got.commits.map((c) => [c.subject, c.change, c.path, c.author, c.date]),
      [
        ["rename", "R", "notes/garden.md", "A", new Date((1_700_000_000 + 4) * 1000).toISOString()],
        ["more", "M", "notes/plants.md", "A", new Date((1_700_000_000 + 3) * 1000).toISOString()],
        ["start", "A", "notes/plants.md", "A", new Date((1_700_000_000 + 1) * 1000).toISOString()],
      ],
    )
    assert.strictEqual(got.complete, true)
    assert.strictEqual(commitsFor(site, path.join(dir, "notes", "garden.md"), "garden", 2).complete, false)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
