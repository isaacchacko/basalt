---
title: History
description: "Every commit that touched a note, on a timeline, and the note as it was at each."
aliases: [history]
---

A note's page shows its history. Click the clock in the navbar's tray: try it on this page. The explorer gives its place to a timeline, a date for each commit that touched the note, newest first, its message on hover.

## A version

A click on a date shows the note as it was at that commit, drawn as its page draws it, with what that commit added highlighted and what it took away struck through, word by word. "Plain" shows it without the marks. ↑ and ↓ (or j and k) step from commit to commit, Esc comes back to now, and `?at=<commit>` in the address opens that version. A note that was renamed or moved is followed back to the file it was.

## Where it's on

While serving, every note has its history, from git. A built site has it with `"history": true` in `basalt.json`, as this one does. A note's frontmatter `history: true` or `false` decides for that note either way.

A built site keeps each note's newest 100 commits. Hosts clone a repository shallow, so a build fetches the rest first, which works for a public repository. A private one's history starts where the clone does, unless the clone is whole: `VERCEL_DEEP_CLONE=true` on Vercel, `fetch-depth: 0` in a GitHub Action.
