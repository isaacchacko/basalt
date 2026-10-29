---
title: Sharing
description: "A card for every note, feeds, a sitemap, and counting readers."
aliases: [sharing]
---

## Cards

Each note gets its own picture for when a link to it is shared, in chats and on social sites: its title and description, in the site's colours and type. A note's frontmatter `image`, a file in the garden or a url, is its card instead. `"layout": { "socialImages": false }` makes none.

## Feeds and the sitemap

A built site has `rss.xml` and `index.xml`, with its newest notes (`layout.rssLimit`, 10 by default), and `sitemap.xml`, with every page and when it last changed. `"layout": { "feed": { "folders": ["blog"] } }` puts only those folders' notes in the feeds. Both need `baseUrl`.

## Counting readers

A top-level `analytics` counts readers on the built site, never while serving:

```json
{ "analytics": { "provider": "plausible" } }
```

`vercel`, `plausible`, `umami` (with `websiteId`), `goatcounter` (with `code`) or `google` (with `tagId`). Its script loads once and counts every page a reader goes to.
