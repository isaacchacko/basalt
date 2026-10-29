---
title: The folder
description: "What's in a garden: its settings, its notes, and the parts of the page you can make your own."
aliases: [folder]
---

A garden is a folder. `basalt new` makes this one:

```tree title="my-garden"
my-garden/
  basalt.json          # [[settings|its settings]]: title, host, where its notes are
  basalt.config.ts     # optional: markdown plugins and layout, in code
  notes/
    index.md           # the home page
    a note.md          # /a-note
    blog/
      index.md         # /blog, above a list of what's in it
      first post.md    # /blog/first-post
  styles/
    custom.scss        # [[look|your look]], over Basalt's
  islands/             # [[islands|live components]], if you want any
  components/          # your own version of any part of the page
```

A note's address is its path, in lower case with dashes for spaces. A folder's page is its `index.md` above a list of the notes in it, each with the line of `description:` from its frontmatter, so a folder reads as a guide. Pictures, PDFs and code files sit among the notes, wherever you like, and are found by name.

## Notes from elsewhere

`content` in `basalt.json` gathers notes from several folders into one garden, such as an Obsidian vault and a folder of drafts:

```json
{ "content": [{ "from": "notes" }, { "from": "../vault/writing", "to": "blog" }] }
```

`draft: true` or `private: true` in a note's frontmatter keeps it off the site.

## Where Basalt writes

Only under `my-garden/.basalt/astro`: its cache, and the built site in `dist/`. Keep `.basalt/` out of git. A garden behind a [[password]] is also written to `.vercel/output`.
