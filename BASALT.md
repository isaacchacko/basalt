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

- **Saves land in place.** A note, a component or server code is swapped into the open page, keeping its scroll and state. A stylesheet or an island is hot-swapped. Client code reloads the page.
- **It says when your change is live.** `GET /__basalt/status` returns `{pid, buildId, state, change, trigger, error}`. `GET /__basalt/wait?after=<buildId>` answers once a later update has reached the pages. `<site>/.basalt/astro/status.json` has the same.
- **Errors keep the last page up.** `status.error` gives `{file, line, col, message}` for the file you edit.
- **`basalt check`** lists broken links, missing embeds and orphans, each naming its note's file. `--json` gives machine-readable output.

## Inside

- `src/loader.ts`: the notes, as one Astro collection.
- `src/markdown/`: the markdown pipeline (ported Quartz plugins plus Basalt's own).
- `src/layouts/`, `src/components/`, `src/pages/`: the page and its routes.
- `src/client/`: the browser side (margin, previews, viewer, pdf, islands, search, nav).
- `src/integrations/agent.ts`: the agent API and hot swap.
- `bin/basalt.mjs`: the CLI.
