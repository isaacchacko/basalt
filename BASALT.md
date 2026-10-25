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
  "theme": {
    "colors": { "lightMode": { "tertiary": "#c8482b" }, "darkMode": {} },
    "fonts": {
      "title": "Fraunces, serif", "body": "'Instrument Sans', sans-serif",
      "load": ["https://fonts.googleapis.com/css2?family=Fraunces&family=Instrument+Sans&display=swap"]
    }
  },
  "layout": { "toc": false, "components": { "meta": "dated" }, "footer": { "links": { "GitHub": "https://github.com/me" } } }
}
```

In `layout.explorer`, `order` lists the entries that come first, by slug, and `byDate` the folders whose entries list newest first (`"byDate": ["blog"]`), as their folder's page does. `icon` is a file in the site's tree for the tab's icon (`"icon": "assets/icon.svg"`); without it the tab shows Basalt's mark. A site's own mark in the navbar is a `components/Mark.astro`.

Basalt sets everything in Palatino (and code in JetBrains Mono). A site picks its own type with `theme.fonts`: `title` (titles and labels), `header` (headings), `body` and `code`, each a CSS font-family, and `load`, stylesheets that bring in fonts visitors may not have. `theme.colors` does the same for the palette. `theme.nowPlaying` is where a playing `<sound>`'s card sits: `"beside"` its word (Basalt's), or `"screen"`, at the foot of the screen in the side content for as long as it plays. `theme.bullets` is what lists hang on: `"circle"` (Basalt's round dot), `"hexagon"` or `"none"`; for anything else, set the `--basalt-bullet-shape` (a clip-path), `-color`, `-size`, `-height`, `-opacity` and `-hover-transform` properties in `styles/custom.scss`.

Basalt writes only under `<site>/.basalt/astro`. That folder holds the site's own Astro root, which is links to Basalt's files plus its cache, its content store and its build (`dist/`).

## The CLI

```sh
basalt new <dir> [--title "My garden"]   # start a site
basalt dev [dir] [--port 4321]           # serve it, live, in the background
basalt build [dir]                       # build it into <dir>/.basalt/astro/dist (exits 1 on a broken note)
basalt check [dir] [--json]              # build it and list what's broken, with files and lines
basalt status [dir]                      # what the dev server is doing (JSON)
basalt wait [dir]                        # block until your newest save is live (0 ready, 1 error, 2 timeout)
           [--file <path>] [--since <ms>] [--after <buildId>] [--timeout <s>]
basalt stop [dir]
basalt logs [dir] [--raw]                # the dev server's log, as plain lines
basalt help [topic]                      # a section of this file
```

Several sites can be served at once from one Basalt.

## Writing

Obsidian-flavoured markdown:

- **Links and embeds:** `[[wikilinks]]`, `[[note#heading]]`, and `![[embeds]]` of images (`|320` for a width), video, audio, pdfs, code files (`![[hello.py#L3-L9]]`), diffs (`![[fix.patch]]`), csv, other notes and their sections or blocks (`#^id`).
- **Text:** callouts (`> [!note]-` folds), `==highlights==`, `#tags`, `%%comments%%`.
- **The margin:** a footnote becomes a numbered **sidenote** beside its line. `> [!aside]` after a paragraph becomes an unnumbered **margin note**, and a margin note with an image is a **margin figure**.
- **Pictures that follow the theme:** save a dark version beside a picture or video (`shot.dark.png` next to `shot.png`) and embed `shot.png` as usual. The page shows whichever matches its theme, and swaps when the theme is toggled; the other loads only when it's needed.
- **Diagrams:** ```` ```graph ```` (isaacchacko/graph), ```` ```dot ````, ```` ```mermaid ````, ```` ```svg ````, and `$math$` / `$$math$$` / ```` ```math ````. A graph in the page doesn't zoom, so the wheel scrolls the page past it; ```` ```graph zoom ```` (or `canZoom`) lets the wheel and a pinch zoom it. Full screen, any graph zooms.
- **Diffs:** a ```` ```diff ```` block (or an embedded `.diff` / `.patch` file) reads like a code review: removed lines on red, added on green, each with its old and new line number, `@@` hunks as quiet rules, the file's name as the title with `+3 −1` beside it, the code highlighted in its file's language, and the words that changed inside a changed line marked. Paste `git diff`'s output as it is; a diff of several files has a row for each. Plain `+`/`-`/space lines work too, unnumbered: ```` ```diff lang=yaml title="basalt.yaml" ```` gives them a language and a title. ```` ```diff split ```` puts the old file and the new one side by side, a removed line beside the line that replaced it, as a compare block: stacked on a phone, and full screen in the compare reader. Copy gives the patch as written. The colours are `--basalt-added`, `--basalt-removed` and `--basalt-changed`, for a site to set in `styles/custom.scss`.
- **Directory trees:** a ```` ```tree ```` block draws a folder, one entry a line, indented, or `tree`'s output pasted as it is. A name ending in `/`, or with entries under it, is a folder, which folds (click it, or enter). `name   # a note` shows the note quietly beside it (`code` and `[[links]]` work there). A sign before a name marks it: `+` added, `-` removed, `~` changed, `!` highlighted. `[[note]]` or `[name](url)` as the name makes it a link. `folder/…` starts folded, or, with nothing under it, says its contents are left out. `title="…"` after the language gives it a header bar. Each file gets an icon for its kind. Two trees in a compare block line up by folder, even when their top folders are named differently.
- **Compare blocks:** two `> [!compare] Label` callouts in a row (a blank line between, nothing else) are one block: side by side, each under its label, stacked when there isn't room. Any markdown goes in a column. Beside the side content the block takes its width too. Anchors line the columns up: `^name` at the end of a paragraph, or on its own line after a code block, table or picture (Obsidian's block id), and `^name=7` or `^name=/text/` after a code block's language, for its 7th line or the first line with *text* in it. The same name in two columns starts level, in the order written (a pair that crosses another is ignored); inline, blocks line up, and lines in code line up in the reader. Pointing at one of a pair lights both. The full-screen control in its corner opens the reader: each column scrolls, and the other follows so partners pass level; on a phone, one column at a time, with a switch that keeps your place. In Obsidian and on GitHub the columns read one after the other.
- **Islands:** `<island name="counter" start="3" ssr></island>` mounts `islands/counter.tsx`, rendered at build time with `ssr` and hydrated in the browser. `frame` puts it alone in a frame. Editing an island hot-swaps it and keeps its state.
- **Note lists:** `<note-list folder="blog" limit="4"></note-list>`.
- **Sounds:** `<sound src="/assets/clip.mp3" spotify="https://open.spotify.com/track/…">laufey</sound>` is the word with a ♪ after it: a click on it (or enter) plays the clip, and again stops it, one clip at a time on the whole site. Pointing at it shows its card in the side content, a ▶ row for each clip; while it plays, a card for its song (cover, title, artist, album, the clip's progress) stays there, level with the word, then held at the top as you read on; on a phone, a bar at the foot of the screen. The song comes from its Spotify page at build time (no key) and is kept with its cover in the site's cache. Not on Spotify: `title`, `artist`, `album`, `cover` (which also override it). `label` names the clip. Several clips on one word: comma-separated `src` and `spotify`, `|`-separated `label`, `title`… A `[data-secondary]` child (a photo) is its card instead, with the ▶ rows added.
- **Text to copy:** `<copy>you@example.com</copy>` is that text in the page, underlined in dots, and a click on it (or enter, tabbed to) copies it, with "copied" beside it for a moment. `<copy value="npm i basalt">install it</copy>` copies something other than what it shows. An address or a url in it isn't made a link. Elsewhere it's just the text.

A page opts into the margin's extras in its frontmatter: `toc: true`, `graph: true`, `backlinks: true`. A site can turn them on everywhere with `layout`. `draft: true` and `private: true` notes aren't published.

## The page

- **Three parts.** The navbar folds to a chevron in the left margin and opens on hover. ⌘F searches. The theme toggle is in its bottom tray. The note is set to a 34em measure. Its margin is right beside it and holds the sidenotes, margin notes and link previews, each level with its line, one hover at a time.
- **The source toggle,** `</>` beside the theme toggle, shows each page as the markdown it's made from, highlighted, where the page was; the navbar stays as it is. It stays on as you go from page to page. `layout.components.source: false` takes it away.
- **Search is ⌘F.** Type to search the whole garden. `#tag query` searches one tag. `@` lists the pages; `@page query` searches inside one page and `@here query` inside the page you're on, each result a passage: choose one and the page opens scrolled to it, marked for a moment.
- **⌘G** shows the whole garden as a graph, on the whole screen: every note and its links, and the files they use (pictures, sounds, videos, pdfs, code, data: anything a note embeds or points at, from markdown or raw html) as smaller nodes coloured by kind, the page you're on marked. Click a note to go there, a sound to play it, a picture or pdf to see it in the viewer; pointing at a file shows it in the corner, and "files" in the bar hides them. ⌘G again or escape closes it. The graph in the side content shows a note's files too.
- **Cards that open on a click.** A `[data-secondary]` child is its parent's card in the side content, shown on hover. Give it (or its parent) `data-secondary-open="click"` and it opens on a click instead (or enter, or space), and stays, links and ▶ rows and all, until its parent is clicked again, escape, or a click elsewhere; on a phone, as a sheet at the foot of the screen. Its parent gets `aria-expanded`.
- **Code blocks have their controls inside them.** Point at one (or tab into it) and its bar shows them: wrap lines (when they run past the edge), show raw, copy, and full screen. A block with a title (```` ```ts title="a.ts" ````) or a code file has them in its title bar, after the name; one without, in its top right corner. On a touch screen they're always there. Full screen shows that block alone.
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
