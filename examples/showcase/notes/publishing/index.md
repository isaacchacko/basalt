---
title: Publishing
description: "Build the garden into plain files, check it for broken links, and put it anywhere."
---

```sh
basalt build my-garden
```

writes the whole site, as plain files, to `my-garden/.basalt/astro/dist`. Any static host can serve that folder: there's no server to run.

## Before it goes out

```sh
basalt check my-garden
```

builds it and lists anything broken, each with the note and line it's in:

```
notes/field-log.md:10  broken link: [[nudibranch]]: no such note
```

links to notes that don't exist, missing pictures and embeds, unknown islands, and, as warnings, notes nothing links to. It exits 1 when anything is broken, so it can stop a deploy.

## A note that doesn't build

A note whose frontmatter or markdown doesn't parse makes `basalt build` exit 1, naming its file and line. The rest of the site is still built.
