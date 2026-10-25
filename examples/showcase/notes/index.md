---
title: Basalt
description: Markdown in, a website that reads like a good math textbook out.
---

**TL;DR:** Basalt turns markdown into a website that reads like a good math textbook. Think Quartz, with remarks in the margin, better media, and hot reloading that keeps your place.

## A quiet page

The argument runs down the middle, and each remark sits beside the line it's about.[^this] Prose keeps to about sixty-five characters a line. Names are set in [Fraunces](https://fonts.google.com/specimen/Fraunces) and reading text in [Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans). Nothing moves without a reason: a title settles as you arrive, and a picture grows out of the page when you open it.

## After Tufte

Basalt is set the way [Edward Tufte](https://www.edwardtufte.com/) sets his books, and the way a good math textbook keeps its asides: beside the text, where the eye already is, not at the foot of the page.

> [!aside]
> ![[tufte.jpg|Edward Tufte]]
> Edward Tufte, Dallas, 2015. Photo by Keegan Peterzell, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0).

> [!aside] Why "Basalt"
> Basalt cools into hexagonal columns, like the Giant's Causeway, or this site's mark.

## What's different

- **One margin.** Notes, previews of the notes you link to, and tooltips all sit in the side content, level with their lines. See [[margin]].
- **Media, done properly.** Pictures open full screen. PDFs get their own reader. Video, sound, code and whole web pages sit in the text. See [[media]], [[web]] and [[files]].
- **Pictures written as text.** Graphs, flowcharts, sequences and math. See [[diagrams]].
- **Saves land in place,** in under a second, without losing your scroll. See [[start]].
- **Built for agents too.** The dev server says when a change is live, and exactly what broke if it isn't. See [[agents]].
- **Light pages,** about a quarter of Quartz's weight.

## Made from

[Astro](https://astro.build), with markdown from [Quartz](https://quartz.jzhao.xyz)'s plugins and margins after [Tufte CSS](https://edwardtufte.github.io/tufte-css/). Graphs by [graph](https://graph.isaacchacko.com), PDFs by [pdf.js](https://mozilla.github.io/pdf.js/), math by [KaTeX](https://katex.org). Made by [Isaac Chacko](https://isaacchacko.com) for his own garden.

[^this]: Like this one.
