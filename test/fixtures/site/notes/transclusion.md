---
title: transclusion
---

`![[note]]` puts one note inside another. Quartz does this already; Basalt fixes how it fails and lets an embed be titled.

## a whole note, titled by its alias

`![[garden-ideas|the garden note, embedded whole]]`

![[garden-ideas|the garden note, embedded whole]]

## a heading, and everything under it

`![[garden-ideas#what to plant]]`

![[garden-ideas#what to plant]]

## a block

`![[garden-ideas#^unfinished]]` and a list item, `![[garden-ideas#^pictures]]`:

![[garden-ideas#^unfinished]]

![[garden-ideas#^pictures]]

## the same note twice

Quartz kept one list of notes it had embedded on the whole page, so a second embed of the same note was reported as _circular_. Basalt only calls an embed circular when a note really embeds itself:

![[garden-ideas#^unfinished]]

## when there's nothing to embed

Each of these says what's missing, instead of leaving a bare "Transclude of" link:

![[no-such-note]]

![[garden-ideas#no such heading]]

![[garden-ideas#^nosuchblock]]
