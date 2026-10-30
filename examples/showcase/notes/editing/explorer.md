---
title: Managing notes
description: "In editing view, the explorer makes, renames, moves and deletes notes, the way Obsidian's does, and takes links along."
---

In editing view, the explorer in the navbar manages the garden's notes, as Obsidian's file explorer does. A reader never sees any of it.

## New notes and folders

The two buttons at the explorer's top make a note or a folder in the folder of the page you're on; a folder's + makes a note in it. Name it where it'll be, press Enter, and a new note opens in the editor at once. A new folder comes with its `index.md`, so it has a page of its own.

## Rename, move, delete

A right click on a note or folder (a long press, on a phone), or its ⋯, has **Rename**, **Move to…** and **Delete**. Drag a note onto a folder to move it there. By keyboard, F2 renames and Delete deletes.

## Links go along

A rename or a move asks whether to update the links that would otherwise point to nothing, listing the notes they're in. Every `[[link]]` and `![[embed]]` is rewritten the way it was written, its heading and alias kept.

## Where it lands

[[local|While serving]], each is done to the files at once. [[github|On a built site]], each joins the draft: the explorer shows it marked unpublished, and the publish dialog commits it, with the note's changes, as one commit.
