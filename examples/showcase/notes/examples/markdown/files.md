---
title: Files
aliases: [files]
---

Embed a file that isn't a note, `![[sieve.py]]`, and it's shown from the file itself: change the code and the page changes with it.

## A code file

`![[sieve.py|fullscreen]]` is highlighted and titled with its name. Its bar opens the raw file and copies the code, and because this one asked for `fullscreen`, it has a button for that too. It's the code that drew the sieve on [[margin]].

![[sieve.py|fullscreen]]

## Some of its lines

`![[sieve.py#L7-L11]]` shows just those lines, numbered from where they start:

![[sieve.py#L7-L11|the sieve itself]]

## A table

A csv file, `![[euclid.csv]]`, becomes a table. These are the Euclid numbers from the proof on [[margin]], and the first six are prime:

![[euclid.csv]]

## A file that isn't there

A name that matches no file says so, instead of breaking the page:

![[nope.py]]
