---
title: islands
---

An island is a component from the site's `islands/` folder, mounted into an otherwise static page.

## a preact island, rendered at build time

`<island name="counter" start="3" ssr></island>`: the button is in the html already; the script makes it count.

<island name="counter" start="3" ssr></island>

## a plain-js island, mounted when it scrolls into view

`<island name="clock" tz="America/Los_Angeles">...</island>`: what's inside the tag shows until it mounts. It's in San Francisco <island name="clock" tz="America/Los_Angeles">(a clock goes here)</island> right now.

## an island in a frame of its own

`<island name="counter" frame height="160"></island>`: an iframe with the island alone in it, for a component that wants the whole viewport or keeps its own css.

<island name="counter" frame height="160" start="10"></island>

## live html

A ` ```html live ` block runs in a sandboxed frame that takes the page's colours and grows to fit:

```html live
<p>Pick a colour:</p>
<input
  type="color"
  value="#284b63"
  oninput="document.getElementById('out').textContent = this.value"
/>
<code id="out">#284b63</code>
```
