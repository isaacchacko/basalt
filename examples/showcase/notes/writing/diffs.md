---
title: Diffs
description: "A change, shown the way a code review shows it."
aliases: [diffs, examples/markdown/diffs]
---

A change, shown the way a code review shows it: paste a git diff into a ```` ```diff ```` block, or embed a `.diff` or `.patch` file, and each removed line is on red and each added one on green, with its old and new line numbers. The code inside is highlighted in its own language, and inside a changed line, the words that changed are marked.

## A git diff

The file's name, from the diff's header, is the block's title, and its language (here TypeScript, from `.ts`) is how the code is highlighted. Each `@@` line starts a hunk: a quiet rule saying which lines follow, and in what.

```diff
diff --git a/src/lib/greet.ts b/src/lib/greet.ts
index 3b18e51..a2f4c1d 100644
--- a/src/lib/greet.ts
+++ b/src/lib/greet.ts
@@ -1,7 +1,8 @@ import { names } from "./names"
 import { names } from "./names"
 
-export function greet(name: string) {
-  return "Hello, " + name + "!"
+export function greet(name: string, polite = false) {
+  const hello = polite ? "Good evening" : "Hello"
+  return `${hello}, ${name}!`
 }
 
 export const everyone = () => names.map((n) => greet(n))
@@ -21,4 +22,4 @@ export function farewell(name: string) {
 export function farewell(name: string) {
-  return "Goodbye, " + name
+  return "Goodbye, " + name + ". See you soon, and thanks for reading all the way to the end of a very long line"
 }
```

## A few lines, without the headers

Plain `+`, `-` and space lines work too, with `lang=` for the language and `title=` for a title. With no `@@` line there are no line numbers, since nothing says where the lines are:

```diff title="basalt.json" lang=json
 {
   "title": "My garden",
-  "theme": { "bullets": "circle" }
+  "theme": { "bullets": "hexagon" },
+  "layout": { "explorer": { "byDate": true } }
 }
```

## A patch file

`![[sieve.patch]]` shows a patch from the site's files, titled with its name, here the change to the sieve on [[files]]:

![[sieve.patch]]

## Several files

A diff of several files has a row for each, saying which file follows, and whether it's new, deleted or renamed:

```diff
diff --git a/notes/todo.md b/notes/todo.md
--- a/notes/todo.md
+++ b/notes/todo.md
@@ -1,3 +1,3 @@
 # To do
-- [ ] water the garden
+- [x] water the garden
 - [ ] write about basalt
diff --git a/notes/hello.md b/notes/hello.md
new file mode 100644
--- /dev/null
+++ b/notes/hello.md
@@ -0,0 +1,2 @@
+# Hello
+A new note.
diff --git a/drafts/old.md b/notes/published.md
similarity index 100%
rename from drafts/old.md
rename to notes/published.md
diff --git a/assets/card.png b/assets/card.png
Binary files a/assets/card.png and b/assets/card.png differ
```
