---
title: building with an agent
---

Basalt is made to be built by an agent as well as by hand. An agent can write a note, save it, and know for certain whether its change reached the page or what broke.

## the loop

The dev server keeps a status, at `/__basalt/status` and in `.basalt/astro/status.json`:

```json
{ "buildId": 12, "state": "ready", "change": "swap", "trigger": ["notes/index.md"], "error": null }
```

and `/__basalt/wait?after=12` answers as soon as a later change has reached the open pages. So an agent saves a file, then waits:

```sh
basalt status my-garden        # note the buildId
# … save notes/index.md …
basalt wait my-garden --after 12
```

A saved note comes back in well under a second. A component or a stylesheet is swapped into the open page, and the scroll and state survive.

## when it breaks

A mistake doesn't take the server down. The last good page stays up, and the status says where the problem is, in the file the agent edits:

```json
{
  "state": "error",
  "error": { "file": "components/Footer.astro", "line": 12, "col": 4, "message": "CompilerError: Unexpected token" }
}
```

The next good save clears it.

## checking a whole garden

`basalt check my-garden --json` builds the site and lists what's wrong in every note: links to notes that don't exist, missing pictures, embeds and islands, and notes that nothing links to.

```json
[{ "kind": "broken link", "note": "notes/index.md", "detail": "a href=/no-such-note" }]
```

## making it its own

A garden can replace any part of the page with its own: put `Footer.astro` in its `components/` folder and it's used in place of Basalt's, and can still wrap the original. Islands, styles and markdown plugins are files in the garden too, so an agent never has to edit Basalt itself.
