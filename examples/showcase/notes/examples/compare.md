---
title: Compare
aliases: [compare]
toc: true
---

Some things are easier to understand next to each other: two versions of the same code, the same idea in two languages, a before and an after. Put two `> [!compare]` callouts in a row, and Basalt sets them side by side, each under its title. In Obsidian or on GitHub they read one after the other, as two quotes.

## Two columns

Anything goes in a column: prose, lists, code, pictures. Leave a blank line between the callouts, and nothing else.

> [!compare] Basalt
> One component. The handlers sit on the tiles they belong to, and the page runs it in the browser.
>
> ```tsx title="islands/music.tsx" ^markup=/music-tile/ ^handlers=/onPointerMove/
> export default function Music({ data }) {
>   return (
>     <div class="music-grid">
>       {data.albums.map((a) => (
>         <span
>           class="music-tile"
>           role="link"
>           tabIndex={0}
>           data-href={a.spotify}
>           onPointerMove={lean}
>           onPointerLeave={rest}
>           onClick={open}
>           onKeyDown={open}
>         >
>           <img src={a.cover} alt="" />
>         </span>
>       ))}
>     </div>
>   )
> }
> ```
>
> A note puts it on the page:
>
> ```md title="collections/music.md"
> <island name="music" data="music.json" ssr></island>
> ```

> [!compare] Quartz v5
> Two files. The markup runs once, when the site is built, so an `onClick` here would never reach the browser.
>
> ```tsx title="Music.tsx" ^markup=/music-tile/
> import albums from "./music.json"
> // @ts-expect-error: imported as a string
> import script from "./scripts/music.inline"
>
> export default (() => {
>   const Music: QuartzComponent = () => (
>     <div class="music-grid">
>       {albums.map((a) => (
>         <span
>           class="music-tile"
>           role="link"
>           tabIndex={0}
>           data-href={a.spotify}
>         >
>           <img src={a.cover} alt="" />
>         </span>
>       ))}
>     </div>
>   )
>   Music.afterDOMLoaded = script
>   return Music
> }) satisfies QuartzComponentConstructor
> ```
>
> Everything that moves goes in a second file, run after every page change:
>
> ```ts title="scripts/music.inline.ts" ^handlers=/"pointermove"/
> document.addEventListener("nav", () => {
>   const tiles = document.querySelectorAll(".music-tile")
>   for (const tile of tiles) {
>     tile.addEventListener("pointermove", lean)
>     tile.addEventListener("pointerleave", rest)
>     tile.addEventListener("click", open)
>     tile.addEventListener("keydown", open)
>     // undone before the next page change
>     window.addCleanup(() => {
>       tile.removeEventListener("pointermove", lean)
>       tile.removeEventListener("pointerleave", rest)
>       tile.removeEventListener("click", open)
>       tile.removeEventListener("keydown", open)
>     })
>   }
> })
> ```

Point at a paragraph with a partner, and both light up. The full-screen control in the block's corner opens it in the reader, where each column scrolls on its own and the other keeps level with it.

## Anchors

Columns are rarely the same length, so the matching parts drift apart. An anchor pins them: give two blocks the same name, one in each column, and they start level.

- `^name` at the end of a paragraph, or on its own line after a code block, a table or a picture. It's Obsidian's block id, so Obsidian hides it.
- `^name=7` in a code block's first line, after the language, names its 7th line; `^name=/text/` names the first line with *text* in it. The code stays as it was, so it copies clean anywhere.

In the page, blocks line up: the column that's ahead waits for the other, with space. Lines inside code line up in the reader, where each column scrolls: what's level with an anchor in one column is level with its partner in the other, and between anchors they move in step.

````md
> [!compare] Before
> ```ts ^setup=1 ^loop=/for/
> …
> ```
> The result. ^result

> [!compare] After
> …
````

Here the steps start level with the code that takes them:

> [!compare] In words
> Euclid's algorithm finds the greatest common divisor of two numbers.
>
> Replace the larger by its remainder when divided by the smaller, and keep going until the smaller is zero: the larger is the answer. ^loop
>
> It always ends, because the remainder is smaller each time. ^ends

> [!compare] In code
> ```py
> def gcd(a, b):
>     while b:
>         a, b = b, a % b
>     return a
> ```
> ^loop
>
> ```py
> assert gcd(48, 18) == 6
> ```
> ^ends

Two trees line up by folder on their own: the same folder in both starts level, with no anchors to write.

> [!compare] Quartz
> ```tree
> quartz-site/
>   quartz/
>     components/
>     plugins/
>     styles/
>     build.ts
>   content/
>     index.md
>   quartz.config.ts
>   quartz.layout.ts
>   package.json
> ```

> [!compare] Basalt
> ```tree
> my-site/
>   content/
>     index.md
>   basalt.json
>   package.json
> ```

## On a phone

With no room for two columns they stack, each under its title, the way they read in Obsidian. In the reader, one column shows at a time, with a switch between them; switching keeps your place.
