---
title: On a built site
description: "A published site edits through GitHub: a draft as you write, then one commit when you publish."
toc: true
---

A built site can edit its notes too, committing to the GitHub repository it's built from. Turn it on in `basalt.json`:

```json
{ "edit": true }
```

`true` takes the repository and branch the site is built from: in a GitHub Action, on Vercel, or from git's `origin`. `{ "edit": { "repo": "me/garden", "branch": "main" } }` names them. Whatever deploys the site from the repository deploys each edit.

## Connecting, once

The first ⌘E (or `?edit`) on a browser asks for a token, checks it against the repository, and keeps it in that browser, for that repository only. The pencil shows from then on. Readers never see it, and never download the editor.

Make the token a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) for that one repository, with **Contents: read and write** and nothing else.

## A draft, till you publish

Nothing is committed as you type. What you write is a draft, kept in the browser, and the corner says how many changes are unpublished. A reload, another page, or closing the tab keeps it; coming back opens it editing again, the draft restored. The blocks you leave are drawn with your change straight away, by Basalt's markdown running in the browser.

## The publish dialog

⌘S, or a click on the count in the corner, opens it: the note's changes, marked the way [[history]] marks a commit's, added highlighted and removed struck through; the commit's message; and **Publish**, **Keep editing** and **Discard**.

Publish commits it, and the corner counts the seconds till the deploy comes back. A commit made elsewhere since your draft began isn't overwritten: the dialog reads the note from GitHub first, puts their change around yours, and says so.
