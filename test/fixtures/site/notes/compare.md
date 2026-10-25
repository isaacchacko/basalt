---
title: compare
---

Two callouts in a row are one compare block.

> [!compare] Basalt
> One component:
>
> ```tsx title="music.tsx" ^markup=2 ^handlers=/onPointerMove/
> export default function Music() {
>   return <span class="music-tile" onPointerMove={lean} />
> }
> ```
>
> and a note puts it on the page. ^page

> [!compare] Quartz *v5*
> Two files:
>
> ```tsx title="Music.tsx" ^markup=/music-tile/
> const Music = () => <span class="music-tile" />
> ```
>
> ```ts title="music.inline.ts"
> tile.addEventListener("pointermove", lean)
> ```
> ^page

A lone one stays a callout:

> [!compare] Alone
> Just a callout.

Three untitled columns:

> [!compare]
> Untitled.

> [!compare]
> Also untitled.

> [!compare]
> Third.
