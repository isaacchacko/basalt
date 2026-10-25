---
title: Basalt
description: Publish your notes as a site that reads like a good textbook.
---

**TL;DR:** Basalt turns plain markdown into a published website. It's an alternative to [Quartz](https://quartz.jzhao.xyz), set like a good math textbook, the Tufte way. It's better than Quartz at embedded media and hot reloading. It keeps remarks beside the text instead of at the bottom of the page. It lets an agent build pages and know when they're live. Its pages are a quarter of the weight.

Basalt turns a folder of markdown notes into a website that reads like a well-made book. Notes link to one another, and every remark sits in the side content, beside the line it's about. That's how [Edward Tufte](https://www.edwardtufte.com/) sets his books, and how a good math textbook keeps its asides.[^tufte]

> [!aside]
> ![[tufte.jpg|Edward Tufte]]
> Edward Tufte, presenting in Dallas, 2015. Photo by Keegan Peterzell, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0).

You write plain markdown, in Obsidian or any editor you like. Basalt does the rest: it links your notes, sets footnotes beside their lines, opens pictures full screen, gives PDFs their own reader, and draws diagrams you write as text.

## reading a page

This page is one. Each page has three parts:

- **The navbar** waits as a chevron in the left margin. Reach for it and it opens, with every note in the garden.
- **The main content** is the note itself, set to a comfortable measure of about sixty-five characters a line.
- **The side content** holds the note's remarks, each beside its line, and whatever you point at. Hover a link like [[margin]] and its opening appears there, without taking you anywhere.

Press ⌘F to search the whole garden. Press it again for the browser's own find.

## writing one

Write a footnote,

```md
Euclid proved there are infinitely many primes.[^elements]

[^elements]: In the _Elements_, Book IX, around 300 BC.
```

and it becomes a sentence with its note beside it:

> Euclid proved there are infinitely many primes.[^elements]

Save the file, and the page you have open changes in place in under a second. Your scroll position stays put, and so does anything you had open. You watch the page while you write it.

> [!aside] Why "Basalt"
> Basalt cools into columns: the hexagonal pillars of the Giant's Causeway, and of this site's mark. A garden of notes grows the same way, one column at a time.

## the tour

Each page shows one part of Basalt, and is written with it:

- [[margin]]: sidenotes, margin notes and figures, and previews of the notes you link to
- [[media]]: pictures, video, sound, and a reader for PDFs
- [[web]]: videos, posts and whole pages from elsewhere, set into a note
- [[diagrams]]: graphs, flowcharts and math, written as text
- [[files]]: code and data, shown from the files themselves
- [[islands]]: live components in a still page
- [[transclusion]]: one note inside another

## building with it

Basalt is built on [Astro](https://astro.build). A garden is a folder of notes and a short `basalt.json`, plus its own styles, components or interactive islands if it wants them. Any of Basalt's parts can be swapped for your own. It's also made to be built by an agent: the dev server says when a change has reached the page, and what broke if it didn't.

- [[start]]: start a garden
- [[agents]]: building pages with an agent

## made from

Basalt began as a fork of [Quartz](https://quartz.jzhao.xyz) by Jacky Zhao, and its markdown still comes from Quartz's plugins. Its side content follows [Tufte CSS](https://edwardtufte.github.io/tufte-css/). Its graphs are drawn by [graph](https://graph.isaacchacko.com), its PDFs by [pdf.js](https://mozilla.github.io/pdf.js/), and its math by [KaTeX](https://katex.org). It's made by [Isaac Chacko](https://isaacchacko.com) for his own garden.

[^tufte]: In _The Visual Display of Quantitative Information_ and the books after it, Tufte puts the notes beside the text, where the eye already is, instead of at the foot of the page.

[^elements]: In the _Elements_, Book IX, around 300 BC.
