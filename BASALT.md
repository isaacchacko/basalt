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

In `layout.explorer`, `order` lists the entries that come first, by slug, and `byDate` the folders whose entries list newest first (`"byDate": ["blog"]`), as their folder's page does. `icon` is a file in the site's tree for the tab's icon (`"icon": "assets/icon.svg"`); without it the tab shows Basalt's mark. Behind a password, the login page carries it inline (an svg, png, jpeg, gif, webp or ico), since the file itself is behind the gate. A site's own mark in the navbar is a `components/Mark.astro`.

Basalt sets everything in Palatino (and code in JetBrains Mono). A site picks its own type with `theme.fonts`: `title` (titles and labels), `header` (headings), `body` and `code`, each a CSS font-family, and `load`, stylesheets that bring in fonts visitors may not have. `theme.colors` does the same for the palette. `theme.nowPlaying` is where a playing `<sound>`'s card sits: `"beside"` its word (Basalt's), or `"screen"`, at the foot of the screen in the side content for as long as it plays. `theme.bullets` is what lists hang on: `"circle"` (Basalt's round dot), `"hexagon"` or `"none"`; for anything else, set the `--basalt-bullet-shape` (a clip-path), `-color`, `-size`, `-height`, `-opacity` and `-hover-transform` properties in `styles/custom.scss`.

A top-level `analytics` counts readers in the built site (never while serving): `{ "provider": "vercel" }` (Web Analytics and Speed Insights; `"speedInsights": false` for only the first), `{ "provider": "plausible" }` (the `baseUrl`'s domain, or `domain`; `host` for your own), `{ "provider": "umami", "websiteId": "…" }`, `{ "provider": "goatcounter", "code": "…" }` or `{ "provider": "google", "tagId": "G-…" }`. Its script loads once and counts every page the reader goes to.

A top-level `"password": true` puts the built site behind a password, on Vercel. The password itself is the `BASALT_PASSWORD` env var in the Vercel project, never a file; a password written into `basalt.json` fails the build. `basalt build` then also writes the site as Vercel's [Build Output API](https://vercel.com/docs/build-output-api) in `<site>/.vercel/output` (keep `.vercel/` out of git), which Vercel deploys in place of a plain folder. Every request goes through middleware first, and without the cookie it answers 401 with a login page in the site's palette and type. That covers pages, pictures, the search index, scripts and the 404 page. The right password sets a signed cookie for 30 days and goes on to the page the reader asked for. `/__basalt/logout` clears it, and changing the password logs everyone out. Without `BASALT_PASSWORD` the site lets no one in. The sitemap, the feeds (`rss.xml`, `index.xml`) and the social cards aren't built, since they would show the notes to anyone. `basalt dev` stays open. To deploy, point a Vercel project at the site's folder with the "Other" framework preset, `npx @isaacchacko/basalt build` as its build command and `BASALT_PASSWORD` set. The words on the login page are `password`, `enter` and `wrongPassword` in `strings`.

Basalt writes only under `<site>/.basalt/astro`, and, for a site with a password, `<site>/.vercel/output`. That first folder holds the site's own Astro root, which is links to Basalt's files plus its cache, its content store and its build (`dist/`).

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
- **Diagrams:** ```` ```graph ```` (isaacchacko/graph), ```` ```dot ````, ```` ```mermaid ````, ```` ```svg ````, and `$math$` / `$$math$$` / ```` ```math ````. Mermaid is fetched from jsDelivr, pinned, only by a page with a mermaid block (as Quartz does); offline, the block shows its source. A graph in the page doesn't zoom, so the wheel scrolls the page past it; ```` ```graph zoom ```` (or `canZoom`) lets the wheel and a pinch zoom it. Full screen, any graph zooms.
- **Diffs:** a ```` ```diff ```` block (or an embedded `.diff` / `.patch` file) reads like a code review: removed lines on red, added on green, each with its old and new line number, `@@` hunks as quiet rules, the file's name as the title with `+3 −1` beside it, the code highlighted in its file's language, and the words that changed inside a changed line marked. Paste `git diff`'s output as it is; a diff of several files has a row for each. Plain `+`/`-`/space lines work too, unnumbered: ```` ```diff lang=yaml title="basalt.yaml" ```` gives them a language and a title. Copy gives the patch as written. The colours are `--basalt-added`, `--basalt-removed` and `--basalt-changed`, for a site to set in `styles/custom.scss`.
- **Directory trees:** a ```` ```tree ```` block draws a folder, one entry a line, indented (a markdown list of `- ` bullets works too), or `tree`'s output pasted as it is. A name ending in `/`, or with entries under it, is a folder, which folds (click it, or enter). `name   # a note` shows the note quietly beside it (`code` and `[[links]]` work there). A sign before a name marks it: `+` added, `-` removed, `~` changed, `!` highlighted. `[[note]]` or `[name](url)` as the name makes it a link. `folder/…` starts folded, or, with nothing under it, says its contents are left out. A line starting `…` (`… 18 more files`) is a quiet row standing in for what's left out. `title="…"` after the language gives it a header bar. Each file gets an icon for its kind.
- **Tabs:** `> [!tab] Basalt` then `> [!tab] Quartz`, callouts in a row with only a blank line between them, take turns: one shows, and ‹ › in the bar above it (or ←/→ there) step to the one before or after, going round. A tab holds any markdown: code, a code file, a tree, prose, a picture. Its title is its label; `> [!tab]` alone has none. In Obsidian, on GitHub and without the script, they read one after another, each under its label.
- **Islands:** `<island name="counter" start="3" ssr></island>` mounts `islands/counter.tsx`, rendered at build time with `ssr` and hydrated in the browser. `frame` puts it alone in a frame. Editing an island hot-swaps it and keeps its state.
- **Note lists:** `<note-list folder="blog" limit="4"></note-list>`.
- **Sounds:** `<sound src="/assets/clip.mp3" spotify="https://open.spotify.com/track/…">laufey</sound>` is the word with a ♪ after it: a click on it (or enter) plays the clip, and again stops it, one clip at a time on the whole site. Pointing at it shows its card in the side content, a ▶ row for each clip; while it plays, a card for its song (cover, title, artist, album, the clip's progress) stays there, level with the word, then held at the top as you read on; on a phone, a bar at the foot of the screen. The song comes from its Spotify page at build time (no key) and is kept with its cover in the site's cache. Not on Spotify: `title`, `artist`, `album`, `cover` (which also override it). `label` names the clip. Several clips on one word: comma-separated `src` and `spotify`, `|`-separated `label`, `title`… A `[data-secondary]` child (a photo) is its card instead, with the ▶ rows added.
- **Songs:** `[[spotify:<link>|a caption]]` is a card for a song or an album: its cover, name, artist and album, linking to Spotify, with the caption under it. The link is a share link or a Spotify URI (`spotify:track:…`); `<spotify src="…">a caption</spotify>` is the same. The song comes from its Spotify page at build time and is kept with its cover in the site's cache, as a sound's is. Offline, or for a link that isn't a song or an album, it's the caption, linking to it.
- **Text to copy:** `<copy>you@example.com</copy>` is that text in the page, underlined in dots, and a click on it (or enter, tabbed to) copies it, with "copied" beside it for a moment. `<copy value="npm i basalt">install it</copy>` copies something other than what it shows. An address or a url in it isn't made a link. Elsewhere it's just the text.

**Where it's shared:** each note gets a card, `/og/<slug>.png` (1200×630, its title and description in Palatino, in the site's palette, with its icon), as its `og:image`, so a link to it shows a large picture on social sites and in chats; a page without a note of its own shows the home page's. A note's frontmatter `image` (a file in the site, or a url) is its card instead; `layout.socialImages: false` makes none. Cards are drawn without fonts from the network and kept in the site's cache by what's on them.

A page opts into the margin's extras in its frontmatter: `toc: true`, `graph: true`, `backlinks: true`. A site can turn them on everywhere with `layout`. `draft: true` and `private: true` notes aren't published. A note's date is its frontmatter's `date` (or `created`), else the day git first saw it, following renames; when it last changed (the sitemap's `lastmod`) is its frontmatter's `modified`, else its last commit, else its last save. Outside git, or not yet committed, they're the file's own.

## The page

- **Three parts.** The navbar folds to a chevron in the left margin and opens on hover. ⌘F searches. The theme toggle is in its bottom tray. The note is set to a 34em measure. Its margin is right beside it and holds the sidenotes, margin notes and link previews, each level with its line, one hover at a time.
- **The source toggle,** `</>` beside the theme toggle, shows each page as the markdown it's made from, highlighted, where the page was; the navbar stays as it is. It stays on as you go from page to page. `layout.components.source: false` takes it away.
- **Search is ⌘F.** Type to search the whole garden. `#tag query` searches one tag. `@` lists the pages; `@page query` searches inside one page and `@here query` inside the page you're on, each result a passage: choose one and the page opens scrolled to it, marked for a moment.
- **⌘G** shows the whole garden as a graph, on the whole screen: every note and its links, and the files they use (pictures, sounds, videos, pdfs, code, data: anything a note embeds or points at, from markdown or raw html) as smaller nodes coloured by kind, the page you're on marked. Click a note to go there, a sound to play it, a picture or pdf to see it in the viewer; pointing at a file shows it in the corner, and "files" in the bar hides them. ⌘G again or escape closes it. The graph in the side content shows a note's files too.
- **Cards that open on a click.** A `[data-secondary]` child is its parent's card in the side content, shown on hover. Give it (or its parent) `data-secondary-open="click"` and it opens on a click instead (or enter, or space), and stays, links and ▶ rows and all, until its parent is clicked again, escape, or a click elsewhere; on a phone, as a sheet at the foot of the screen. Its parent gets `aria-expanded`.
- **Code blocks have their controls inside them.** Point at one (or tab into it) and its bar shows them: wrap lines (when they run past the edge), show raw, copy, and full screen. A block with a title (```` ```ts title="a.ts" ````) or a code file has them in its title bar, after the name; one without, in its top right corner. On a touch screen they're always there. Full screen shows that block alone.
- **Media opens full screen** in one viewer: images, diagrams and frames, with zoom, pan, swipe, ←/→ and pinch.
- **PDFs** open in Basalt's own viewer, with a text layer, a page that fits the screen in full screen, and "open in the browser's viewer" at the current page.

## Editing in place

A page edits its own note where it is, the way a note edits in Obsidian's Live Preview. The note becomes one document you write in, and every block the cursor isn't in is drawn exactly as the page draws it. The block the cursor's in shows its markdown, the lines it's written on, in the page's own type. Nothing moves when editing starts: each block is where it was on the page.

- **On and off.** ⌘E (Obsidian's key), or the pencil in the navbar's tray, or `?edit` in the url (for a phone). It stays on from page to page until it's turned off. A page without a note of its own (a tag's, a folder's without an `index.md`) has nothing to edit.
- **Writing.** Arrows, selection, undo and redo, copy and paste all run across the whole note.
  - ↑ ↓ go line by line into a block and through it, keeping their place across the line.
  - A click on a block puts the cursor at that word; a click on a link still follows it, and a click on a control (a tab, a button, a player) still works it.
  - Enter goes on with the list or quote you're in, and `[[` completes a link to a note.
  - ⌘F finds in the note (⌘K is still the site's search). ⌘S saves now (on a built site, it opens the publish dialog).
- **What's around the text.**
  - The title opens the note's frontmatter, and a click on a margin note or a sidenote in the margin opens its lines.
  - A `%%comment%%` is drawn as nothing, as on the page, until the cursor is in it.
  - The note's pieces keep running while you write: islands, tabs, players, diagrams and code's controls.
- **Every block.** Headings, lists and tasks, callouts (folded ones too), tabs, code, code files, diffs, trees, diagrams, math, tables, pictures and other embeds, embedded notes (an embed opens as its `![[…]]`), islands, note lists, sounds, copy, raw html and footnotes each open as the lines they came from. A file with Windows line endings keeps them.

**While serving** (`basalt dev`), the note saves to its file a moment after you stop typing, and the dev server renders what you typed with the site's own markdown (`POST /__basalt/render`), so a block you leave is drawn with your change straight away. The page isn't swapped in while you write; turning editing off swaps it in once. A file changed elsewhere meanwhile (in your editor, by an agent) isn't overwritten: their change goes into the note as you have it, around what you've typed. The dev server only takes writes from the site's own pages (`PUT /__basalt/source`, JSON, with the `x-basalt-edit` header, from its own origin), and only to the site's notes.

**A built site** edits through GitHub, with a top-level `"edit"`:

```json
{ "edit": true }
{ "edit": { "repo": "me/garden", "branch": "main" } }
```

`true` takes the repo and branch the site is built from:
- in a GitHub Action, `GITHUB_REPOSITORY` and `GITHUB_REF_NAME`;
- on Vercel, `VERCEL_GIT_REPO_OWNER`/`VERCEL_GIT_REPO_SLUG` and `VERCEL_GIT_COMMIT_REF`;
- otherwise, git's `origin` and the branch checked out (else `main`).

The site has to be built from a git checkout of that repo. Whatever deploys the site from the repo (a GitHub Action, Vercel, Netlify) deploys the edit.

- **Connecting, once.** The first ⌘E (or `?edit`) on a browser asks for a token, checks it against the repo, and keeps it in that browser's local storage, for that repo only. The pencil shows from then on. Readers never see the pencil, and never download the editor. A token that stops working (expired, revoked) is forgotten and asked for again.
  - Make it a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) for that one repository, with **Contents: read and write** and nothing else.
- **A draft, till you publish.** Nothing is committed on its own: not as you type, not when you leave a block, not when you reload. What you've written is a draft, kept in that browser's local storage for that repo, branch and note, with the version of the note it began over. The blocks you changed show their markdown; the rest are drawn from the page. The corner says how many changes are unpublished.
  - A reload, or coming back to the page, opens it editing again, the draft restored, and the corner says so. Going to another page keeps editing on, and the corner there links back to the page with the draft. Closing the tab keeps it too. Turning editing off keeps it for next time.
- **Publishing.** ⌘S, or a click on the count in the corner, opens a dialog: the note's changes, marked as the history marks a commit's (added highlighted, removed struck through, on the markdown as it's written), the commit's message (`Edit <path>` to begin with), and Publish, Keep editing (or Esc) and Discard, which asks once more and then drops the draft, the note back as it's committed.
  - Publish commits it. Until the deploy comes back, the blocks you changed show their markdown and the status in the corner counts the seconds. Once the page is deployed with your commit, they're drawn from it.
  - A commit made elsewhere since the draft began isn't overwritten: the dialog reads the note from GitHub first, puts theirs into the note around yours, and says so; what it marks is only yours. One that lands while the dialog's open is merged the same way when you publish, and shown again for another Publish.

The words are in `strings`: `edit`, `editing`, `editSaving`, `editPublishing`, `editDeploying`, `editLive`, `editFailed`, `editSlowDeploy`, `editConnect`, `editTokenHelp`, `editToken`, `editMakeToken`, `editCancel`, `editConnectButton`, `editTokenWrong`, `editCommit`, `editDraft`, `editDraftElsewhere`, `editRestored`, `editKept`, `editNothing`, `editDiscarded`, `editPublishTitle`, `editPublishTo`, `editPublishMoved`, `editReading`, `editChanges`, `editMessage`, `editPublish`, `editKeepEditing`, `editDiscard`, `editDiscardSure`, `editDiscardNo`, `editDiscardYes`.

## History

A note's page shows its history: every commit that touched its file, on a timeline, and the note as it was at each, with what that commit changed marked in the page itself.

- **On and off.** The clock beside the pencil in the navbar's tray. The navbar's explorer gives its place to the timeline, in the same column, the navbar held open while it's on: a dot and a date for each commit that touched the note (a rename followed back to the file it was), newest first, the commit's message on hover. Below desktop width, where the navbar is the bar across the top, the timeline takes the menu's place in that bar, its dates in a row that scrolls sideways. It's on for the page you turned it on for; "Every page" keeps it on from page to page. The browser remembers which.
- **A version.** A click on a date shows the note as it was at that commit, rendered as its page renders it, with what the commit added highlighted and what it took away struck through, word by word in a block that changed, whole for a block added or removed. A footnote is known by its name: one put in before others marks its reference and its note, and the others it renumbers are as they were. Its changes are against the commit before it that touched the note. "Plain" shows the version without them. ↑ and ↓ (or j and k; ← and → on a phone) step from commit to commit, Esc comes back to now, and `?at=<commit>` in the url opens that version. Margin notes follow the version shown. Editing is of the note as it is: ⌘E or the pencil comes back to now first.
- **Where.** While serving, every note has its history, unless `basalt.json` says `"history": false`. A built site has it with `"history": true`. A note's frontmatter `history: true` or `false` decides for that note either way.

**While serving**, the dev server reads it from git when it's asked (`GET /__basalt/history?slug=<slug>`, its commits; `&at=<sha>`, a version), so a commit you've just made shows the next time the timeline opens. **A built site** writes each note's history out (`/static/history/<slug>.json`, and a file per version, read when its date is clicked), its newest 100 commits. Hosts clone a repository shallow (Vercel the last 10 commits), so a build fetches the rest first, from the clone's own remote or, on Vercel, from the repository it built, which works for a public one. A private repository's history starts where the clone does, which the timeline says at its end; a full clone has it all (`VERCEL_DEEP_CLONE=true` on Vercel, `fetch-depth: 0` in a GitHub Action).

The words are in `strings`: `history`, `historyTitle`, `historyNow`, `historyClose`, `historyPlain`, `historyEverywhere`, `historyPartial`, `historyNone`.

## For agents: the edit loop

- **Save, then wait.** `basalt wait <dir>` blocks until the build that took in your newest save to the site is live in every open page, prints its status, and exits 0 when it's ready, 1 when the site has an error, 2 on a timeout (`--timeout <s>`, default 30). `--file <path>` waits for the build that has that file's save in it, `--since <ms>` for one with a save made at or after that time, `--after <buildId>` for any build after that one. No race: a save that's live before `wait` starts is found, not missed.
- **One save, one build.** A build is what a save (or a burst of them) sets off: the notes it renders again, and what the open pages are sent. It finishes once, when both are done, and only then do the pages get it, so `ready` means they have it. It finishes with no page open too. Nothing counts up while nothing is saved.
- **Saves land in place.** A note, a component, `basalt.json` or a layout change in `basalt.config.ts` is swapped into the open page, keeping its scroll and the state of its islands (an island with the same name and props keeps running). A stylesheet or an island is hot-swapped. Client code reloads the page. A change to a site's markdown plugins (`markdown` in `basalt.config.ts`, or a file of the site's own that it imports) or to Basalt's own build-time code restarts that site's server, and only it, and every note is rendered again: `state` is `restarting` meanwhile (open connections drop; `basalt wait` retries), `restarts` counts up, the pages reload, and `buildId` carries on.
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
- `src/markdown/lines.ts`, `src/lib/linemap.ts`: the lines each block is written on. `src/client/editor.ts` edits a note in place, as one CodeMirror document; `src/client/backend.ts` is where it saves and renders: the dev server (`src/integrations/edit.ts`), or GitHub for a built site (`src/client/github.ts`). `src/client/content.ts` starts a page's parts (islands, tabs, diagrams, players) in the page or in a block drawn anew.
- `src/lib/history.ts`: a note's history (its commits from `src/lib/gitdates.ts`'s one git log, a version rendered by `src/markdown/rendernote.ts` and its changes marked); `src/lib/deepen.ts` fetches a build's shallow clone whole; `src/integrations/history.ts` and `src/pages/static/history/` answer for it while serving and built; `src/client/history.ts` is the timeline.
- `src/integrations/password.ts`, `src/lib/gate.ts`: a site behind a password (Vercel's Build Output API, and the middleware in it).
- `bin/basalt.mjs`: the CLI.
