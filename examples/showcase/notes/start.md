---
title: Start a garden
---

> [!note] Basalt is young
> It publishes [Isaac Chacko's garden](https://isaacchacko.com) and this site, and it isn't packaged for anyone else yet. This is how it works today.

A garden is a folder. `basalt new` makes one:

```sh
basalt new my-garden --title "My garden"
basalt dev my-garden
```

and serves it at `http://localhost:4321`, live. Open it, then open `my-garden/notes/index.md` in your editor. Every save shows up in the page you have open, in place.

## What's in the folder

```
my-garden/
  basalt.json          its title, where it's published, where its notes are
  notes/               your markdown
  styles/custom.scss   your look, over Basalt's
  islands/             live components, if you want any
  components/          your own version of any part of the page
```

`basalt.json` holds the few things Basalt needs to know:

```json
{
  "title": "My garden",
  "baseUrl": "garden.example.com",
  "content": [{ "from": "notes" }, { "from": "../writing", "to": "blog" }],
  "theme": { "colors": { "lightMode": { "tertiary": "#c8482b" } } }
}
```

`content` can gather notes from several folders, such as an Obsidian vault and a folder of drafts, into one garden.

## What a page shows

A note opts into the side content's extras in its frontmatter: a table of contents with `toc: true`, the graph of its links with `graph: true`, and the notes that link to it with `backlinks: true`. A garden that wants them everywhere sets them in `basalt.json`'s `layout`. `draft: true` and `private: true` keep a note off the site.

## Publishing

`basalt build my-garden` writes the whole site, as plain files, to `my-garden/.basalt/astro/dist`. Any static host can serve it. `basalt check my-garden` builds it and lists any broken links, missing pictures and embeds, each with the note it's in.
