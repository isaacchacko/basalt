---
title: While serving
description: "Under basalt dev, the page saves to its note's file a moment after you stop typing."
---

```sh
basalt dev my-garden
```

Open `http://localhost:4321`, press ⌘E, and write. The note saves to its file a moment after you stop typing, and the block you leave is drawn with your change at once, by the site's own markdown.

## With your editor open too

A file changed elsewhere while you write, in your editor or by an [[agents|agent]], isn't overwritten: their change goes into the note as you have it, around what you've typed. Turning editing off swaps the saved page in.

## Only the site's own pages

The dev server takes writes only from its own pages, and only to the garden's notes. Nothing else on your machine can be written through it.
