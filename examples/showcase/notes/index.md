---
title: Basalt
description: Hypertext gardens that publish in a second and read like a good textbook.
---

Basalt turns a folder of markdown into a hypertext garden: notes that link to one another, published as a site. Its pages are set the way [Edward Tufte](https://www.edwardtufte.com/) sets his books, with the remarks in the margin beside the line they're about, the way a good math textbook keeps them.[^textbook] Pictures, players, pdfs, diagrams, code and live components sit in the text as figures, each with a fallback that still reads without JavaScript.

## writing in it

You write markdown the way you would in Obsidian: `[[wikilinks]]`, `![[embeds]]`, callouts and footnotes. A footnote becomes a note in the margin.

Save, and the page you have open updates in place in about a second. Your scroll position stays, and so does whatever you had open. Stylesheets and components are swapped in live too, so you can build a page by watching it. An agent can do the same: the dev server reports whether the last build is ready or failed at `/__basalt/status`.

> [!aside] Why "Basalt"
> Basalt cools into columns, the hexagonal pillars of the Giant's Causeway and of this site's mark. A garden of notes grows the same way, one column at a time.

## reading it

Every page has three parts. The navigation folds away to a chevron in the left margin until you reach for it. The note takes most of the width. The margin on the right holds the note's remarks, and whatever you're pointing at: a preview of another note, or a tooltip. It holds one thing at a time.

Pages move with some care. A title sets from light to full weight as you arrive, the note rises into place, and a picture grows out of the page when you open it.

## the tour

Each of these pages shows one part of Basalt:

- [[margin]]: footnotes and asides in the margin
- [[media]]: images, video, audio and Basalt's own pdf viewer
- [[web]]: YouTube, Spotify, tweets and any page in a frame
- [[diagrams]]: graphs, Graphviz, Mermaid and math, written as text
- [[files]]: code files and csv tables, embedded from the folder
- [[islands]]: interactive components in a static page
- [[transclusion]]: one note inside another
- [[secondary]]: the margin, and what it shows when you hover

## starting one

A Basalt site is a folder: notes, plus a few optional files that set it up.

```sh
my-garden/
  notes/              your markdown
  basalt.json         { "content": [{ "from": "notes" }] }
  styles/custom.scss  your look, on top of Basalt's
  islands/            interactive components, if you want them

cd basalt && npx quartz build --site ../my-garden --serve
```

## made from

Basalt is a fork of [Quartz](https://quartz.jzhao.xyz) by Jacky Zhao, which does most of the work. Its margins follow [Tufte CSS](https://edwardtufte.github.io/tufte-css/). Its graphs are drawn by [isaacchacko/graph](https://graph.isaacchacko.com), its pdfs by [pdf.js](https://mozilla.github.io/pdf.js/), and its math by [KaTeX](https://katex.org). It's made by [Isaac Chacko](https://isaacchacko.com) for his own garden.

[^textbook]: The argument runs down the middle of the page, and the side remarks that help with it sit alongside, where your eye already is.
