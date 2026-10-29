---
title: Links and embeds
description: "Links between notes, their previews in the margin, and one note set inside another."
aliases: [transclusion, links, examples/markdown/transclusion]
toc: true
---

## Links

`[[gardens]]` links to a note by its name, [[gardens]], wherever it is in the garden. `[[gardens|why a garden]]` gives it other words, [[gardens|why a garden]], and `[[gardens#what to plant]]` goes to a heading in it, [[gardens#what to plant]]. Point at one: its opening shows in the margin, beside the line, so a reader can see where it goes without leaving.

`basalt check` lists any link to a note that isn't there. A note can show the notes that link to it with `backlinks: true` in its frontmatter, and a graph of its links with `graph: true`.

## Embedded notes

`![[note]]` puts one note inside another, so something you've written once can appear wherever it's needed. Edit the original and every page that embeds it changes too. All of these come from [[gardens|why a garden]].

### A whole note

`![[gardens|why a garden, embedded whole]]`

![[gardens|why a garden, embedded whole]]

### A section

`![[gardens#what to plant]]` brings a heading and everything under it:

![[gardens#what to plant]]

### A paragraph, or a list item

Mark a block with `^name` at its end, then embed it: `![[gardens#^unfinished]]` and `![[gardens#^pictures]]`.

![[gardens#^unfinished]]

![[gardens#^pictures]]

### When there's nothing to embed

An embed of something that isn't there says what's missing:

![[gardens#a heading that isn't there]]
