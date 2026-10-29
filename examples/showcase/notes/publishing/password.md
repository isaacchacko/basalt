---
title: Password
description: "A built site that only people with its password can read, on Vercel."
aliases: [password]
---

```json
{ "password": true }
```

in `basalt.json` puts the whole built site behind a password: pages, pictures, the search index, scripts. A reader without it gets a login page in the site's own colours and type. The right password lets them in for 30 days and goes on to the page they asked for.

## The password itself

It's the `BASALT_PASSWORD` environment variable, set in the Vercel project, and never a file: a password written into `basalt.json` fails the build. Without the variable, the site lets no one in. Changing it logs everyone out, and `/__basalt/logout` logs you out.

## What changes

`basalt build` also writes the site as Vercel's [Build Output API](https://vercel.com/docs/build-output-api), in `.vercel/output` (keep `.vercel/` out of git), with the gate in front of every request. The sitemap, the feeds and the social cards aren't built, since they'd show the notes to anyone. `basalt dev` stays open.

To deploy, point a Vercel project at the garden's folder, with the **Other** preset and `npx @isaacchacko/basalt build` as its build command, and set `BASALT_PASSWORD`. The login page's words are `password`, `enter` and `wrongPassword` in `strings`.
