---
title: Basalt
description: Markdown in, a website that reads like a good math textbook out, and edits in place like Obsidian.
---

**Basalt turns a folder of markdown into a website that reads like a good textbook, and edits in place, like Obsidian.**[^this] Your notes, links and pictures as they are, published with their remarks in the margin.

**[[start|Start →]]** &nbsp; or <copy value="npm install --global @isaacchacko/basalt">copy the install command</copy>

## Remarks beside their lines

A footnote is a numbered sidenote, beside the line that cites it, the way [Edward Tufte](https://www.edwardtufte.com/) sets his books. An `> [!aside]` is a margin note. Point at a link, like [[diagrams]], and its opening shows in the margin too. [[margin|Margin notes →]]

> [!aside]
> ![[tufte.jpg|Edward Tufte]]
> Edward Tufte, Dallas, 2015. Photo by Keegan Peterzell, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0).

## Pictures written as text

A code block of links is a graph you can drag; graphviz, mermaid, math and SVG work the same way, and stay text in your note. [[diagrams|Diagrams →]]

```graph
garden {tomato 2} -> notes, links, pictures
notes -> sidenotes, asides
pictures -> diagrams, pdfs
```

## Folders and changes, drawn

A folder sketched in a ` ```tree ` block, and a `git diff` pasted into a ` ```diff ` one, read the way a code review shows them. [[trees|Trees →]] [[diffs|Diffs →]]

```tree
my-garden/
  basalt.json        # its settings
  notes/
    + index.md       # the home page
```

```diff title="notes/index.md"
-Basalt is not yet on npm.
+Basalt is on npm: npm install --global @isaacchacko/basalt
```

## One viewer for every picture

Click a picture, a diagram or a page and it grows to fill the screen, to zoom, pan and swipe through. Save `shot.dark.png` beside `shot.png` and the page shows whichever matches its theme: toggle it and watch this one change. PDFs get a reader of their own. [[media|Media →]]

![the margin notes page](/assets/margin-page.png "the margin page, in this page's theme")

## Live components in a still page

A Preact, React or plain JavaScript component, placed in a note with a tag, and swapped in as you edit its file, keeping its state. [[islands|Islands →]]

<island name="counter" start="3" ssr></island>

## Edit the page you're reading

⌘E turns a page into its note, to write in where it is: the block with the cursor shows its markdown, and every other block stays drawn. Locally it saves to the file; on a built site it commits to GitHub when you publish. The explorer makes, renames and moves notes, links and all. [[editing|Editing →]]

## Every version of a note

The clock in the navbar shows a note's history: each commit that touched it, on a timeline, and the page as it was, with what changed marked. Try it on this page. [[history|History →]]

## Built for agents

A save lands in the open page in well under a second, keeping your scroll. The dev server says when a change is live, and what broke, in the file it's in, so an agent can write a garden and know. [[agents|For agents →]]

```sh
basalt wait my-garden   # 0 once it's live, 1 if it broke
```

## Light

Pages about a third of [Quartz](https://quartz.jzhao.xyz)'s weight, [measured against it](https://github.com/isaacchacko/basalt/blob/main/BENCHMARKS.md) on a real site. Plain files, for any host. [[publishing|Publishing →]]

> [!aside] Why "Basalt"
> Basalt cools into hexagonal columns, like the Giant's Causeway.

## Made from

[Astro](https://astro.build), with markdown from [Quartz](https://quartz.jzhao.xyz)'s plugins and margins after [Tufte CSS](https://edwardtufte.github.io/tufte-css/). Set in [Palatino](https://en.wikipedia.org/wiki/Palatino), Hermann Zapf's book face. Graphs by [graph](https://graph.isaacchacko.com), PDFs by [pdf.js](https://mozilla.github.io/pdf.js/), math by [KaTeX](https://katex.org). Made by [Isaac Chacko](https://isaacchacko.com) for his own garden. [[start|Start →]]

[^this]: Like this remark: beside its line, not at the foot of the page.
