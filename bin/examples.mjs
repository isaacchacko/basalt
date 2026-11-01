// What `basalt example` prints: how to write each thing a note can hold, and
// how to put it where it goes.
//
//   basalt example                    what there is
//   basalt example <component>        its markdown, in the main content
//   basalt example <component> <place>  its markdown, in that place (either order)
//   basalt example <place>            how that place works
//
// A component is the markdown that makes it; a place is what's put around
// that markdown. Any component goes in any place, so a new one of either is
// one entry here (and examples.test.ts renders every pair).

/** a component's markdown, in the margin: an aside holds anything a note can */
const aside = (md) => ["> [!aside]", ...md.split("\n").map((l) => (l ? `> ${l}` : ">"))].join("\n")

export const places = {
  main: {
    label: "the main content",
    about: "where the argument runs",
    place: (md) => md,
    notes: ["A note's markdown goes in the main content as it's written."],
  },
  margin: {
    label: "the margin",
    about: "beside the paragraph it's about",
    place: aside,
    notes: [
      "Put it after the paragraph it's about: it sits level with that paragraph's first line.",
      "`> [!aside] A title` gives it a title. An aside with a picture in it is a margin figure.",
      "A footnote is a numbered sidenote, beside the line that cites it: `a claim.[^why]`, then `[^why]: the reason.` anywhere in the note.",
      "On a phone there's no room beside the text: an aside goes under its paragraph, and a sidenote opens under its line when its number is tapped.",
    ],
  },
}

export const components = {
  graph: {
    about: "a graph in graph's language (graph.isaacchacko.com): one line per link",
    markdown: '```graph title="what a garden is made of"\ngarden {tomato 2} -> notes, links, pictures\nnotes -> sidenotes, asides\npictures -> diagrams, images\n```',
    notes: ["`{colour size}` after a node styles it. `zoom` after `graph` lets the wheel and a pinch zoom it; full screen, any graph zooms.", "It's laid out when the site is built, so without JavaScript it's still a picture."],
  },
  flowchart: {
    about: "a Graphviz diagram, drawn when the site is built",
    markdown: '```dot title="how a note becomes a page"\ndigraph {\n  rankdir=LR\n  node [shape=box, style=rounded]\n  "your note" -> "its links, resolved" -> "its page"\n}\n```',
    notes: ["Plain html in the page, with no script to wait for; its ink follows the theme."],
  },
  mermaid: {
    about: "a Mermaid diagram, drawn in the browser",
    markdown: "```mermaid\nsequenceDiagram\n  you->>Basalt: save the note\n  Basalt-->>you: the page, swapped in\n```",
    notes: ["Mermaid is fetched only by a page with a mermaid block; offline, the block shows its source."],
  },
  svg: {
    about: "an svg, drawn as it's written",
    markdown: '```svg\n<svg viewBox="0 0 120 40" width="240" xmlns="http://www.w3.org/2000/svg">\n  <rect x="2" y="2" width="116" height="36" rx="8" fill="none" stroke="currentColor"/>\n</svg>\n```',
    notes: ["`currentColor` follows the theme."],
  },
  math: {
    about: "math, set by KaTeX when the site is built",
    markdown: "Inline, $e^{i\\pi} + 1 = 0$, between single dollars. On its own lines:\n\n$$\n\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}\n$$",
    notes: ["GitHub's ```` ```math ```` blocks work too."],
  },
  code: {
    about: "a code block, with its controls (wrap, raw, copy, full screen) in its bar",
    markdown: '```ts title="primes.ts"\nexport const square = (n: number) => n * n\n```',
    notes: ["`title=` gives it a bar with its name. A file of code is `![[sieve.py]]`, and some of its lines `![[sieve.py#L7-L11]]`."],
  },
  diff: {
    about: "a change, the way a code review shows it",
    markdown: '```diff title="basalt.json" lang=json\n {\n-  "theme": { "bullets": "circle" }\n+  "theme": { "bullets": "hexagon" }\n }\n```',
    notes: ["Paste `git diff`'s output as it is for line numbers and the file's name; plain `+`/`-`/space lines need `lang=` and `title=`. A `.diff` or `.patch` file embeds too."],
  },
  tree: {
    about: "a folder, drawn: folders that fold, an icon for each kind of file",
    markdown: '```tree title="my-garden"\nmy-garden/\n  basalt.json      # the site\'s settings\n  notes/\n    + index.md     # added\n    ~ ideas.md     # changed\n  assets/…\n```',
    notes: ["`# ` after a name is its note. `+` added, `-` removed, `~` changed, `!` highlighted. `folder/…` starts folded. `tree`'s own output pastes as it is."],
  },
  table: {
    about: "a table, from a csv file",
    markdown: "![[euclid.csv]]",
    notes: ["A markdown table (`| a | b |`) works too."],
  },
  callout: {
    about: "a callout: a titled box, of any of Obsidian's kinds",
    markdown: "> [!tip] A title\n> The lines under it, each starting `>`.",
    notes: ["note, tip, warning, question, example, quote and the rest. `> [!example]-` starts it folded, `+` open but foldable."],
  },
  tabs: {
    about: "tabs: callouts in a row that take turns",
    markdown: "> [!tab] Python\n> ```py\n> print(2 ** 10)\n> ```\n\n> [!tab] In words\n> Two, doubled ten times.",
    notes: ["Only a blank line between them. A tab holds any markdown. In Obsidian, on GitHub and without the script, they read one after another."],
  },
  picture: {
    about: "a picture, which opens full screen",
    markdown: '![[photo.png|320]]\n\n![a caption\'s alt text](/assets/photo.png "the caption")',
    notes: ["`|320` sets its width; a title in the markdown is its caption. Save `photo.dark.png` beside `photo.png` and the page shows whichever matches its theme.", "`[[photo.png|a word]]`, a link instead of an embed, shows it beside the word while it's pointed at."],
  },
  video: {
    about: "a video, fetched only when it's played",
    markdown: "![[clip.mp4|a caption]]\n\n![[clip.mp4|plays like a gif|gif|480]]",
    notes: ["`|gif` plays it muted and looping, without controls. A YouTube or Vimeo link, `![a caption](https://www.youtube.com/watch?v=…)`, is a player too."],
  },
  sound: {
    about: "a sound: a player, or a word that plays a clip",
    markdown: '![[a440.m4a|A440]]\n\n<sound src="/assets/a440.m4a" title="A440" artist="a tuning fork">the A</sound> an orchestra tunes to.',
    notes: ["A `<sound>` is the word with a ♪ after it. `spotify=\"https://open.spotify.com/track/…\"` gives it its song's card while it plays."],
  },
  song: {
    about: "a song or an album, as a card: its cover, name, artist and album",
    markdown: "[[spotify:https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC|playing while I wrote this]]",
    notes: ["A share link or a Spotify URI. It's looked up when the site is built and kept in its cache."],
  },
  pdf: {
    about: "a pdf, in Basalt's own reader",
    markdown: "![[paper.pdf#page=2|560]]",
    notes: ["`#page=` opens it at that page, `|560` sets its height."],
  },
  embed: {
    about: "another note, or a part of one, written once and shown wherever it's needed",
    markdown: "![[gardens#what to plant]]",
    notes: ["`![[gardens]]` is the whole note, `#heading` a section, `#^name` a block marked `^name` at its end."],
  },
  frame: {
    about: "a page from anywhere, in a frame",
    markdown: "![iframe|800x420](https://graph.isaacchacko.com)",
    notes: ["The alt text `iframe`, and a size if you like. Its expand button opens it full screen."],
  },
  island: {
    about: "a component of your own (Preact, React or plain JavaScript), alive in the page",
    markdown: '<island name="counter" start="3" ssr></island>',
    notes: ["It's `islands/counter.tsx` in the site. `ssr` draws it when the site is built; `frame` puts it alone in a frame. Its other attributes are its props."],
  },
  html: {
    about: "html written in the note, run in a sandboxed frame in the page's colours",
    markdown: '```html live\n<input type="color" value="#d4572a" />\n```',
    notes: ["The frame grows to fit what's in it."],
  },
  copy: {
    about: "text that's copied with a click",
    markdown: '<copy>you@example.com</copy>, or <copy value="npm i @isaacchacko/basalt">install it</copy>',
    notes: ["`value=` copies something other than what it shows."],
  },
  "note-list": {
    about: "a folder's newest notes, listed: \"recent writing\"",
    markdown: '## Recent writing\n\n<note-list folder="blog" limit="4" more="all of it"></note-list>',
    notes: ["Each entry is its date, then its title. With more notes than `limit`, `more=` labels a link to the folder's page (else \"see N more\")."],
  },
  text: {
    about: "marks in the text: highlights, tags, comments, links",
    markdown: "==a highlight==, a #tag, [[gardens|a link to a note]] and a %%comment that never reaches the page%%.",
    notes: ["`[[note#heading]]` links to a heading."],
  },
}

// ---------- printing ----------

const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s)
const bold = paint("1")
const dim = paint("2")
const rule = dim("─".repeat(48))

const names = (o) => Object.keys(o).join(", ")

/** what's printed for `basalt example <words…>` */
export function example(words) {
  const component = words.find((w) => w in components)
  const place = words.find((w) => w in places)
  const unknown = words.find((w) => !(w in components) && !(w in places))
  if (unknown) return { error: `no example "${unknown}": components are ${names(components)}; places are ${names(places)}` }

  if (!component && !place) {
    const width = Math.max(...Object.keys(components).map((n) => n.length))
    return {
      text: [
        `${bold("basalt example <component> [place]")}: how to write it, and where it goes`,
        "",
        ...Object.entries(components).map(([name, c]) => `  ${name.padEnd(width)}  ${dim(c.about)}`),
        "",
        `places: ${Object.entries(places).map(([name, p]) => `${bold(name)} (${p.label}, ${p.about})`).join("; ")}`,
        `e.g. basalt example graph margin`,
      ].join("\n"),
    }
  }

  if (!component) {
    const p = places[place]
    return {
      text: [
        `${bold(p.label)}  ${dim(p.about)}`,
        rule,
        p.place("Anything a note can hold."),
        rule,
        ...p.notes.map((n) => `${dim("·")} ${n}`),
        `${dim("·")} any component goes here: basalt example <component> ${place}`,
      ].join("\n"),
    }
  }

  const c = components[component]
  const where = place ?? "main"
  const others = Object.keys(places).filter((p) => p !== where)
  return {
    text: [
      `${bold(component)}, in ${places[where].label}  ${dim(c.about)}`,
      rule,
      places[where].place(c.markdown),
      rule,
      ...c.notes.map((n) => `${dim("·")} ${n}`),
      ...(where === "main" ? [] : [`${dim("·")} ${places[where].notes[0]}`]),
      ...others.map((p) => `${dim("·")} in ${places[p].label}: basalt example ${component}${p === "main" ? "" : ` ${p}`}`),
    ].join("\n"),
  }
}
