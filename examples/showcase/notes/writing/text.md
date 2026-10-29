---
title: Callouts and tabs
description: "Callouts that fold, tabs that take turns, highlights, comments, and text that copies on a click."
aliases: [text, callouts, tabs]
toc: true
---

> [!tip] A callout
> `> [!tip] A callout`, then the lines under it, each starting `>`. Any of Obsidian's kinds work: note, tip, warning, question, example, quote and the rest.

> [!example]- One that folds
> A `-` after the kind, `> [!example]- One that folds`, starts it folded. Click its title to open it; `+` starts it open but foldable.

## Tabs

Callouts in a row, `> [!tab] Python` then `> [!tab] TypeScript`, with only a blank line between them, take turns: one shows, and ‹ › above it step to the next. A tab holds anything a note can: code, a code file, prose, a table. In Obsidian and on GitHub they read one after another.

> [!tab] Python
> ![[sieve.py#L7-L11|the sieve itself]]

> [!tab] TypeScript
> ```ts title="primes.ts"
> for (let p = 2; p <= n; p++) {
>   if (crossed[p]) continue
>   found.push(p)
>   for (let m = p * p; m <= n; m += p) crossed[m] = 1
> }
> ```

> [!tab] In words
> Write out the numbers from 2 to n. The first one not crossed out is a prime: keep it, and cross out every multiple of it, starting from its square. Do that again until there are none left.

## Marks in the text

`==a highlight==` is ==a highlight==. `#gardens` is a tag: it's drawn as a link to the page of every note with it. `%%a comment%%` is a note to yourself that never reaches the page:%%like this one%% it's there in the markdown, and only there.

## Text to copy

Text meant to be copied, like an address or a command, is copied by clicking it: `<copy>hello@basalt.isaacchacko.com</copy>` gives <copy>hello@basalt.isaacchacko.com</copy>, and `<copy value="npx basalt dev">the dev server</copy>` copies <copy value="npx basalt dev">the dev server</copy>'s command without showing it.
