---
title: Start
description: "Install Basalt, make a garden, and see it live in a minute."
---

<island name="born">Basalt is young.</island> It publishes [Isaac Chacko's garden](https://isaacchacko.com) and this site. It needs [Node](https://nodejs.org) 22.18 or later.

## A garden in three commands

```sh
npm install --global @isaacchacko/basalt
basalt new my-garden --title "My garden"
basalt dev my-garden
```

`basalt new` makes the folder, and `basalt dev` serves it at `http://localhost:4321`, live. Open that, then open `my-garden/notes/index.md` in your editor. Every save shows up in the page you have open, in place, in under a second, without losing your scroll.

## Then

Write notes in `notes/`, link them with `[[their names]]`, and see [[writing]] for everything a note can hold. When it's ready, `basalt build my-garden` makes the site, for any host: see [[publishing]].

To work on Basalt itself, clone [it](https://github.com/isaacchacko/basalt), `npm install`, and run `node bin/basalt.mjs` in place of `basalt`.
