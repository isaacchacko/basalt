---
title: Hosting
description: "Vercel, GitHub Pages, or any host that serves a folder."
aliases: [vercel]
---

The built site is a folder of files, so any static host serves it. A host that builds from your repository needs two things: the command, and where it writes.

| | |
|---|---|
| build command | `npx @isaacchacko/basalt build` |
| output folder | `.basalt/astro/dist` |

Both are from the garden's folder, the one with `basalt.json`. Node 22.18 or later.

## Vercel

Point a project at the repository, with the garden's folder as its root directory and the **Other** framework preset. Set the build command and output folder above. Each push deploys.

A garden [[password|behind a password]] writes Vercel's own output instead, and needs no output folder set.

## GitHub Pages

An Action that builds the garden and hands the folder to Pages, for a repository that is the garden (for one inside it, build `path/to/garden` and upload its `.basalt/astro/dist`):

```yaml title=".github/workflows/pages.yml"
on: { push: { branches: [main] } }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx @isaacchacko/basalt build
      - uses: actions/upload-pages-artifact@v3
        with: { path: .basalt/astro/dist }
      - uses: actions/deploy-pages@v4
```

`fetch-depth: 0` gives the build the whole of git, for each note's dates.
