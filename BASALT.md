# Basalt

Basalt turns a folder of markdown into a hypertext garden: notes that link to one another, published as a site. Its pages are set the way Edward Tufte sets his books, with each remark in the margin beside the line it's about. It's built on [Astro](https://astro.build), and its markdown comes from the [Quartz](https://quartz.jzhao.xyz) v4 plugins, ported.

## A site

A site is a folder:

```
my-garden/
  basalt.json          title, host, where the notes come from, palette, layout
  basalt.config.ts     optional: markdown plugins, layout (in code)
  notes/               the markdown
  styles/custom.scss   the site's look, over Basalt's
  islands/             interactive components (Preact, React or vanilla)
  components/          .astro files that replace Basalt's own, by name
```

```json
{
  "title": "My garden",
  "baseUrl": "garden.example.com",
  "content": [{ "from": "notes" }, { "from": "../posts", "to": "blog" }],
  "theme": { "colors": { "lightMode": { "tertiary": "#c8482b" }, "darkMode": {} } },
  "layout": { "toc": false, "components": { "meta": "dated" }, "footer": { "links": { "GitHub": "https://github.com/me" } } }
}
```

Basalt writes only under `<site>/.basalt/astro`. That folder holds the site's own Astro root, which is links to Basalt's files plus its cache, its content store and its build (`dist/`).

## The CLI

```sh
basalt new <dir> [--title "My garden"]   # start a site
basalt dev [dir] [--port 4321]           # serve it, live, in the background
basalt build [dir]                       # build it into <dir>/.basalt/astro/dist
basalt check [dir] [--json]              # build it and list broken links, missing embeds, orphans
basalt status [dir]                      # what the dev server is doing (JSON)
basalt wait [dir] [--after <buildId>]    # block until the next update reaches the pages
basalt stop [dir] | basalt logs [dir]
```

Several sites can be served at once from one Basalt.

## Writing

Obsidian-flavoured markdown:

- **Links and embeds:** `[[wikilinks]]`, `[[note#heading]]`, and `![[embeds]]` of images (`|320` for a width), video, audio, pdfs, code files (`![[hello.py#L3-L9|fullscreen]]`), csv, other notes and their sections or blocks (`#^id`).
- **Text:** callouts (`> [!note]-` folds), `==highlights==`, `#tags`, `%%comments%%`.
- **The margin:** a footnote becomes a numbered **sidenote** beside its line. `> [!aside]` after a paragraph becomes an unnumbered **margin note**, and a margin note with an image is a **margin figure**.
- **Pictures that follow the theme:** save a dark version beside a picture or video (`shot.dark.png` next to `shot.png`) and embed `shot.png` as usual. The page shows whichever matches its theme, and swaps when the theme is toggled; the other loads only when it's needed.
- **Diagrams:** ```` ```graph ```` (isaacchacko/graph), ```` ```dot ````, ```` ```mermaid ````, ```` ```svg ````, and `$math$` / `$$math$$` / ```` ```math ````.
- **Islands:** `<island name="counter" start="3" ssr></island>` mounts `islands/counter.tsx`, rendered at build time with `ssr` and hydrated in the browser. `frame` puts it alone in a frame. Editing an island hot-swaps it and keeps its state.
- **Note lists:** `<note-list folder="blog" limit="4"></note-list>`.

A page opts into the margin's extras in its frontmatter: `toc: true`, `graph: true`, `backlinks: true`. A site can turn them on everywhere with `layout`. `draft: true` and `private: true` notes aren't published.

## The page

- **Three parts.** The navbar folds to a chevron in the left margin and opens on hover. ⌘F searches. The theme toggle is in its bottom tray. The note is set to a 34em measure. Its margin is right beside it and holds the sidenotes, margin notes and link previews, each level with its line, one hover at a time.
- **Media opens full screen** in one viewer: images, diagrams and frames, with zoom, pan, swipe, ←/→ and pinch.
- **PDFs** open in Basalt's own viewer, with a text layer, a page that fits the screen in full screen, and "open in the browser's viewer" at the current page.

## For agents: the edit loop

- **Save, then wait.** `basalt wait <dir>` blocks until the build that took in your newest save to the site is live in every open page, prints its status, and exits 0 when it's ready, 1 when the site has an error, 2 on a timeout (`--timeout <s>`, default 30). `--file <path>` waits for the build that has that file's save in it, `--since <ms>` for one with a save made at or after that time, `--after <buildId>` for any build after that one. No race: a save that's live before `wait` starts is found, not missed.
- **One save, one build.** A build is what a save (or a burst of them) sets off: the notes it renders again, and what the open pages are sent. It finishes once, when both are done, and only then do the pages get it, so `ready` means they have it. It finishes with no page open too. Nothing counts up while nothing is saved.
- **Saves land in place.** A note, a component, `basalt.json` or a layout change in `basalt.config.ts` is swapped into the open page, keeping its scroll and the state of its islands (an island with the same name and props keeps running). A stylesheet or an island is hot-swapped. Client code reloads the page. A change to a site's markdown plugins (`markdown` in `basalt.config.ts`) or to Basalt's own build-time code restarts that site's server, and only it: `state` is `restarting` meanwhile (open connections drop; `basalt wait` retries), `restarts` counts up, the pages reload, and `buildId` carries on.
- **The status.** `GET /__basalt/status`, `basalt status <dir>`, or `<site>/.basalt/astro/status.json`:

  ```json
  { "buildId": 42, "state": "error", "change": "swap", "trigger": ["/…/notes/a.md"],
    "startedAt": "…", "at": "…", "ms": 120, "restarts": 0,
    "error": { "file": "notes/creatures/anemones.md", "line": 4, "col": 8, "kind": "frontmatter",
               "message": "Implicit keys of flow sequence pairs need to be on a single line" },
    "errors": [ … ], "warnings": [ { "file": "notes/zonation.md", "line": 28, "kind": "unknown island",
               "message": "unknown island \"anemometer\" (have: tally, tideclock)" } ] }
  ```

  `state` is `starting`, `building`, `restarting`, `ready`, `error` or `stopped`. `change` is how the pages got it: `swap`, `hot`, `reload`, `restart`, `none` (no page needed anything) or `error`. Files are relative to the site's folder. `buildId` only goes up, across restarts.
- **`GET /__basalt/wait`** takes `after=<buildId>`, `since=<ms>`, `file=<path>` and `timeout=<s>` (at most 600). It answers with the first finished build that matches, with `timedOut: false`, or after the timeout with HTTP 504 and `timedOut: true`.
- **Errors keep the last good page up.** A note whose frontmatter or markdown doesn't parse keeps its last good version, and the rest of the site builds; notes that embed or list it still render. A broken component or stylesheet leaves the open page as it was, under the error overlay; the fix swaps the page back in and clears the error at once. Each problem stays in `errors` until it's fixed.
- **`basalt build`** exits 1 when a note failed, naming its file and line (the rest of the site is still built). **`basalt check`** builds, then lists notes that failed, broken links, missing embeds and unknown islands with their file and line (`notes/field-log.md:10  broken link: [[nudibranch]]: no such note`), and orphans as warnings. `--json` gives the same as JSON. It exits 1 when anything is broken.
- **`basalt logs <dir>`** prints the dev server's log as plain lines, with repeats collapsed (`--raw` for its JSON lines). `basalt help <topic>` prints a section of this file.

## Inside

- `src/loader.ts`: the notes, as one Astro collection.
- `src/markdown/`: the markdown pipeline (ported Quartz plugins plus Basalt's own).
- `src/layouts/`, `src/components/`, `src/pages/`: the page and its routes.
- `src/client/`: the browser side (margin, previews, viewer, pdf, islands, search, nav).
- `src/integrations/agent.ts`: the agent API and hot swap.
- `bin/basalt.mjs`: the CLI.
