---
title: Editing
description: "A page edits its own note where it is, the way a note edits in Obsidian's Live Preview."
---

Press ⌘E on a page and it becomes its note, to write in where it is. Every block the cursor isn't in is drawn as the page draws it; the block it's in shows its markdown, in the page's own type. Nothing moves when editing starts.

![the margin notes page, editing: the paragraph with the cursor in it shows its markdown, the rest is drawn](/assets/editing.png "Editing a page: the block with the cursor shows its markdown, and everything else stays drawn")

## Turning it on

⌘E (Obsidian's key), the pencil in the navbar's tray, or `?edit` at the end of the address, on a phone. It stays on from page to page until it's turned off.

## Writing

- Arrows, selection, undo, copy and paste run across the whole note, and ↑ ↓ go into a block and through it, line by line.
- A click on a block puts the cursor at that word. A click on a link still follows it, and a click on a tab, a button or a player still works it.
- Enter goes on with the list or quote you're in, and `[[` completes a link to a note.
- ⌘F finds in the note. ⌘S saves now.
- The title opens the note's frontmatter, and a click on a margin note or sidenote opens its lines.
- Islands, tabs, players and diagrams keep running while you write around them.

Where it saves depends on where the page is served from: to the file, [[local|while serving]], or to GitHub, [[github|on a built site]].
