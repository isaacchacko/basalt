---
title: Your own look
description: "Your colours, your type, your bullets, and your own version of any part of the page."
aliases: [look, theme]
---

Basalt is set in Palatino, in black and blue on white, and the reverse in dark mode. A garden changes any of it in `basalt.json`'s `theme`, and anything else in its own stylesheet.

## Colours

```json
{
  "theme": {
    "colors": {
      "lightMode": { "light": "#f5eedd", "dark": "#16294e", "secondary": "#284d78", "tertiary": "#c8482b" },
      "darkMode": { "light": "#06182f", "dark": "#eef4fc", "secondary": "#8fb9de", "tertiary": "#e0552f" }
    }
  }
}
```

`light` is the page, `dark` the text, `secondary` links and titles, `tertiary` the accent; `lightgray`, `gray`, `darkgray`, `highlight` and `textHighlight` are the rest. Each mode takes any of them, over Basalt's.

## Type

```json
{
  "theme": {
    "fonts": {
      "title": "Fraunces, serif",
      "body": "'Instrument Sans', sans-serif",
      "load": ["https://fonts.googleapis.com/css2?family=Fraunces&family=Instrument+Sans&display=swap"]
    }
  }
}
```

`title` (titles and labels), `header` (headings), `body` and `code` are each a CSS font-family. `load` brings in fonts a reader may not have.

## Bullets

- Lists hang on round dots in the accent.
- `"theme": { "bullets": "hexagon" }` makes them hexagons, like basalt's columns seen from above, and `"none"` takes them away.
- Anything else is the `--basalt-bullet-*` properties, in your stylesheet.

## Your stylesheet

`styles/custom.scss` is loaded after Basalt's, so whatever it says wins. Save it while serving and it's swapped into the open page.

## Your own parts

Put a file named for one of Basalt's components in `components/`, `Footer.astro` say, and it's used in place of Basalt's, and can still wrap the original. `Mark.astro` is the mark in the navbar.
