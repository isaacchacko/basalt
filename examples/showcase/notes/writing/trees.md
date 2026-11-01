---
title: Trees
description: "A folder, written as you'd sketch it and drawn with folds and icons."
aliases: [trees, examples/trees]
toc: true
---

A folder is easier to show than to describe. Write it in a ` ```tree ` block, indented the way you'd sketch it, and Basalt draws it: folders that fold, an icon for each kind of file, and a quiet note beside any entry.

## A tree

```tree title="This site"
showcase/
  basalt.json            # the site's settings
  islands/
    counter.tsx          # an island, hydrated in the page
    clock.ts
  notes/
    index.md             # the home page
    [[start/index|start]]/        # a name can link to a note
    [[writing/index|writing]]/
      diagrams.md
      trees.md           # this page
      … 12 more
    publishing/…
    files/
      sieve.py
      euclid.csv
    assets/…             # pictures, left out
```

Each line is an entry. A name ending in `/` (or with entries under it) is a folder: click it, or tab to it and press enter, to fold it. `# ` after a name is its note, and a note can hold `code` and links: `[[start]]`.

## What changed

A sign before a name marks it: `+` added, `-` removed, `~` changed, `!` highlighted. Two marked trees, side by side, say what one has that the other hasn't.

```tree title="A pull request"
basalt/
  ! BASALT.md            # what to read first
  src/
    markdown/
      + tree.ts          # the block, drawn when the site is built
      ~ index.ts
    styles/
      + tree.scss
      - old.scss
```

## Pasted from `tree`

The output of the `tree` command works as it is, branches and all. A folder you'd rather not show in full can end in `/…`.

```tree
.
├── astro.config.ts
├── bin
│   └── basalt.mjs
├── package.json
└── src
    ├── client
    │   ├── embeds.ts
    │   └── viewer.ts
    └── markdown
        ├── diagrams.ts
        └── tree.ts

5 directories, 6 files
```
