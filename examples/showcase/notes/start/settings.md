---
title: basalt.json
description: "A garden's settings, part by part: its title, its notes, its layout, its words."
aliases: [settings, config]
toc: true
---

`basalt.json` holds what Basalt needs to know about a garden. Only `title` is needed; everything else has a default.

```json title="basalt.json"
{
  "title": "My garden",
  "description": "Notes on what I'm learning.",
  "baseUrl": "garden.example.com",
  "locale": "en-US",
  "icon": "assets/icon.svg",
  "content": [{ "from": "notes" }],
  "layout": { "explorer": { "order": ["start", "blog"] } }
}
```

## The garden

- `title`, `description`: the site's name and its line, in the tab, the feeds and the cards for where it's shared.
- `baseUrl`: the host it's published at, with no `https://`. Feeds, the sitemap and social cards need it.
- `locale`: how dates are written (`en-US` by default).
- `icon`: a file among the notes for the tab's icon; without it, the tab shows Basalt's mark.
- `content`: the folders its notes come from, and where each goes in the site (see [[folder]]).

## What a page shows

`layout.components` turns Basalt's parts on and off, for every page: `breadcrumbs`, `explorer`, `search`, `darkmode`, `source` (the `</>` toggle), `tags`, `footer`, each `true` or `false`, and `meta`, the date and reading time under a title: `true`, `false`, or `"dated"`, only on notes whose frontmatter gives a date.

A note opts into the margin's extras in its frontmatter: a table of contents with `toc: true`, the graph of its links with `graph: true`, the notes that link to it with `backlinks: true`. `"toc": true` (and the others) in `layout` turns one on for every page; a note's frontmatter still wins.

## The explorer and the footer

```json
{
  "layout": {
    "explorer": { "folderDefaultState": "open", "order": ["start", "blog"], "byDate": ["blog"] },
    "breadcrumbs": { "rootName": "Home" },
    "footer": { "links": { "GitHub": "https://github.com/me" } }
  }
}
```

`order` lists, by address, the entries that come first; the rest follow, folders first, by name. A folder `byDate` lists has its newest notes first. A folder's page lists what's in it in the same order. `folderDefaultState` is whether folders start open.

## The words on the page

Every word Basalt puts on a page (the explorer's title, "min read", the search box, the editor's) can be changed in `strings`:

```json
{ "strings": { "explorer": "the garden", "noTags": "no tags yet." } }
```

## The rest

- `theme`: colours, type and bullets: [[look]].
- `edit`, `history`: [[github|editing a built site]], and each note's [[history]].
- `password`: [[password|a site behind a password]].
- `analytics`, `layout.socialImages`, `layout.feed`: [[sharing|where it's shared]].

A `basalt.config.ts` beside it can say the same in code, and add markdown plugins. Saving either while `basalt dev` is serving swaps the change into the open page.
