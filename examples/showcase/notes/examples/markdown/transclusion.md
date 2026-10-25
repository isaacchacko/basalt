---
title: Embedded notes
aliases: [transclusion]
---

`![[note]]` puts one note inside another, so something you've written once can appear wherever it's needed. Edit the original and every page that embeds it changes too. All of these come from [[gardens|why a garden]].

## A whole note

`![[gardens|why a garden, embedded whole]]`

![[gardens|why a garden, embedded whole]]

## A section

`![[gardens#what to plant]]` brings a heading and everything under it:

![[gardens#what to plant]]

## A paragraph, or a list item

Mark a block with `^name` at its end, then embed it: `![[gardens#^unfinished]]` and `![[gardens#^pictures]]`.

![[gardens#^unfinished]]

![[gardens#^pictures]]

## When there's nothing to embed

An embed of something that isn't there says what's missing:

![[gardens#a heading that isn't there]]
