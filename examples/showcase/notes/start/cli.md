---
title: The CLI
description: "Every basalt command, and what it's for."
aliases: [cli]
---

```sh
basalt new <dir> [--title "My garden"]   # start a garden
basalt dev [dir] [--port 4321]           # serve it, live, in the background
basalt build [dir]                       # build it into <dir>/.basalt/astro/dist
basalt check [dir] [--json]              # build it and list what's broken
basalt status [dir]                      # what the dev server is doing
basalt wait [dir]                        # wait until your newest save is live
basalt logs [dir] [--raw]                # the dev server's log
basalt stop [dir]
basalt help [topic]                      # the commands, or a part of the manual
```

`dir` is the garden's folder, the one with `basalt.json` in it; without one, it's the folder you're in. Several gardens can be served at once.

- `basalt dev` serves in the background and returns, so the terminal stays yours; `basalt stop` stops it, and `basalt logs` shows what it said.
- `basalt build` exits 1 when a note doesn't build, naming its file and line. The rest of the site is still built.
- `basalt check` builds, then lists notes that failed, broken links, missing embeds and unknown islands, each with its file and line, and notes nothing links to. `--json` gives the same as JSON.
- `basalt status` and `basalt wait` are for [[agents]], or anyone who wants to know a save has landed.
- `basalt help` lists the commands and the parts of [BASALT.md](https://github.com/isaacchacko/basalt/blob/main/BASALT.md), Basalt's manual; `basalt help history` prints the part on history.
