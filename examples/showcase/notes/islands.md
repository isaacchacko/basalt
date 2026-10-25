---
title: live components
---

An island is a component, written in Preact, React or plain JavaScript, that comes alive in an otherwise still page. Put it in your site's `islands/` folder and place it in any note with a tag. Edit its file while the page is open and it's swapped in place, keeping its state.

## rendered ahead, then alive

`<island name="counter" start="3" ssr></island>`: with `ssr`, the button is drawn when the site is built, so it's on the page before any script runs. The script only makes it count.

<island name="counter" start="3" ssr></island>

## mounted when it's seen

`<island name="clock" tz="America/Los_Angeles">…</island>`: whatever's inside the tag shows until the island mounts, as it scrolls into view. It's <island name="clock" tz="America/Los_Angeles">(a clock goes here)</island> in San Francisco right now.

## in a frame of its own

`<island name="counter" frame height="160"></island>` puts the island alone in a frame, for a component that wants its own styles or the whole screen.

<island name="counter" frame height="160" start="10"></island>

## html, written in the note

A ` ```html live ` block runs in a sandboxed frame that takes the page's colours and grows to fit what's in it:

```html live
<p>Pick a colour:</p>
<input
  type="color"
  value="#d4572a"
  oninput="document.getElementById('out').textContent = this.value"
/>
<code id="out">#d4572a</code>
```
