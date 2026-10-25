import test, { describe } from "node:test"
import assert from "node:assert"
import "./test-hooks.ts"
import { toHtml } from "hast-util-to-html"
const { parseDiff, wordDiff, languageOf, diffOptions, renderDiff } = await import("./diff.ts")

const GIT = `diff --git a/src/add.ts b/src/add.ts
index 3b18e51..a2f4c1d 100644
--- a/src/add.ts
+++ b/src/add.ts
@@ -1,3 +1,4 @@ export function add
 export function add(a: number, b: number) {
-  return a + b
+  const sum = a + b
+  return sum
 }
@@ -10,2 +11,2 @@
-const x = 1
+const x = 2
 // end
\\ No newline at end of file`

describe("parseDiff", () => {
  test("a git diff: the file, its hunks, and each line's old and new number", () => {
    const [f, ...rest] = parseDiff(GIT)
    assert.strictEqual(rest.length, 0)
    assert.strictEqual(f.from, "src/add.ts")
    assert.strictEqual(f.to, "src/add.ts")
    const shape = f.lines.map((l) => `${l.kind}:${l.old ?? ""}:${l.new ?? ""}`)
    assert.deepStrictEqual(shape, [
      "hunk::",
      "ctx:1:1",
      "del:2:",
      "add::2",
      "add::3",
      "ctx:3:4",
      "hunk::",
      "del:10:",
      "add::11",
      "ctx:11:12",
      "note::",
    ])
    assert.strictEqual(f.lines[2].text, "  return a + b")
  })

  test("several files, a new one and a rename", () => {
    const files = parseDiff(`diff --git a/a.py b/a.py
new file mode 100644
--- /dev/null
+++ b/a.py
@@ -0,0 +1 @@
+print("hi")
diff --git a/old.md b/new.md
similarity index 100%
rename from old.md
rename to new.md`)
    assert.strictEqual(files.length, 2)
    assert.strictEqual(files[0].status, "new file")
    assert.strictEqual(files[0].from, undefined)
    assert.deepStrictEqual(files[0].lines.map((l) => l.kind), ["hunk", "add"])
    assert.strictEqual(files[1].status, "renamed")
    assert.deepStrictEqual([files[1].from, files[1].to], ["old.md", "new.md"])
  })

  test("a hunk's counts say where it ends, so a removed `-- comment` isn't a header", () => {
    const [f] = parseDiff("@@ -1,2 +1,2 @@\n--- a comment\n+++ another\n x")
    assert.deepStrictEqual(f.lines.map((l) => l.kind), ["hunk", "del", "add", "ctx"])
  })

  test("a hunk whose counts are off still ends at the next header", () => {
    const [f] = parseDiff("@@ -1,9 +1,9 @@\n-a\n+b\n@@ -20 +20 @@\n-c")
    assert.deepStrictEqual(f.lines.map((l) => `${l.kind}:${l.old ?? ""}`), ["hunk:", "del:1", "add:", "hunk:", "del:20"])
  })

  test("bare +/- lines: one file, no numbers", () => {
    const [f] = parseDiff("-a\n+b\n c\n")
    assert.deepStrictEqual(f.lines.map((l) => [l.kind, l.text, l.old, l.new]), [
      ["del", "a", undefined, undefined],
      ["add", "b", undefined, undefined],
      ["ctx", "c", undefined, undefined],
    ])
  })

  test("a commit's message before the first file is left out", () => {
    const files = parseDiff("From abc\nSubject: fix\n---\n a.ts | 2 +-\n\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b")
    assert.strictEqual(files.length, 1)
    assert.deepStrictEqual(files[0].lines.map((l) => l.kind), ["hunk", "del", "add"])
  })
})

describe("wordDiff", () => {
  test("marks only the words that changed", () => {
    const [a, b] = wordDiff("const x = 1", "const x = 2")!
    assert.deepStrictEqual(a, [[10, 11]])
    assert.deepStrictEqual(b, [[10, 11]])
  })

  test("two changed words a space apart are one mark", () => {
    const [, b] = wordDiff("return a + b", "return the sum")!
    assert.deepStrictEqual(b, [[7, 14]])
  })

  test("lines with little in common get no marks", () => {
    assert.strictEqual(wordDiff("return a + b", "const total = compute()"), null)
  })
})

test("languageOf: from the extension, or the file's name", () => {
  assert.strictEqual(languageOf("src/a.ts"), "ts")
  assert.strictEqual(languageOf("Makefile"), "makefile")
  assert.strictEqual(languageOf("notes.unknownext"), undefined)
  assert.strictEqual(languageOf(undefined), undefined)
})

test("diffOptions: lang and title from the fence", () => {
  assert.deepStrictEqual(diffOptions('lang=ts title="the fix"'), { lang: "ts", title: "the fix" })
  assert.deepStrictEqual(diffOptions(undefined), { lang: undefined, title: undefined })
})

describe("renderDiff", () => {
  test("a code block's markup: titled by its file, one [data-line] per line, the patch to copy", async () => {
    const html = toHtml(await renderDiff(GIT))
    assert.match(html, /^<figure data-rehype-pretty-code-figure="" class="diff" data-numbered="" style="--diff-digits: 2" data-copy="diff --git/)
    assert.match(html, /<figcaption data-rehype-pretty-code-title=""[^>]*>src\/add.ts<span class="diff-stat" role="img" aria-label="3 added, 2 removed" data-added="\+3" data-removed="−2"><\/span><\/figcaption>/)
    assert.strictEqual(html.match(/data-line=""/g)?.length, 11)
    assert.match(html, /data-diff="del"><span class="diff-gutter" aria-hidden="true" data-old="2" data-new=""><\/span><span class="diff-sign">-<\/span>/)
    // highlighted as typescript, both themes
    assert.match(html, /<span style="--shiki-light:#D73A49;--shiki-dark:#F97583">const<\/span>/)
    // 1 became 2
    assert.match(html, /<span class="diff-word"><span[^>]*>2<\/span><\/span>/)
  })

  test("lang= highlights bare lines; a title of its own leaves the file's row", async () => {
    const html = toHtml(await renderDiff("-let a = 1\n+let a = 2", { lang: "js", title: "t" }))
    assert.match(html, /<figcaption[^>]*>t</)
    assert.match(html, /--shiki-light/)
    assert.match(html, /data-added="\+1" data-removed="−1"/)
    assert.doesNotMatch(html, /data-numbered/)
  })

  test("the stat leaves out a side with nothing on it", async () => {
    const html = toHtml(await renderDiff("+a\n+b", { title: "t" }))
    assert.match(html, /aria-label="2 added, 0 removed" data-added="\+2"><\/span>/)
  })

  test("several files: each has its row", async () => {
    const html = toHtml(await renderDiff(GIT + "\n" + GIT.replaceAll("add.ts", "sub.ts")))
    assert.match(html, />2 files</)
    assert.strictEqual(html.match(/data-diff="file"/g)?.length, 2)
    // each with its own stat, and the title the sum
    assert.match(html, /<span class="diff-file-name">src\/sub.ts<\/span><span class="diff-stat" role="img" aria-label="3 added, 2 removed"/)
    assert.match(html, /aria-label="6 added, 4 removed"/)
  })
})
