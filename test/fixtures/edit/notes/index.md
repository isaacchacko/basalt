---
title: every kind of block
description: One of each block Basalt draws, for editing in place.
tags: [example]
---

A paragraph with ==a highlight==, a #tag, %%an inline comment%% and a [[blog/first|wikilink]].

%%
A comment over
several lines.
%%

## A heading

### A smaller one

- a list
- of items
  - one nested

1. ordered
2. list

- [ ] a task
- [x] a done task

> [!note] A titled callout
> Its body, with *emphasis*.

> [!warning]- A folded callout
> Hidden until opened.

> [!tip]+
> Open, untitled.

> A plain quote.

---

| a | table |
| --- | --- |
| [[blog/first\|piped]] | 2 |

```ts title="code with a title"
const x = 1
```

```diff
- old
+ new
```

```tree
site/
  notes/
    index.md   # this note
```

Some math, $a^2 + b^2 = c^2$, inline.

$$
\sum_{i=1}^n i
$$

![[card.png]]

Text to copy: <copy>you@example.com</copy>, and a <sound src="/assets/tone.m4a" title="a tone">sound</sound>.

<div class="raw">
  Raw <b>html</b>, a block of it.
</div>

<note-list folder="blog" limit="2"></note-list>

A sentence with a footnote.[^one] Then another.[^two]

> [!aside] An aside
> Beside the paragraph before it.

Last line, after %%a comment%% in it.

[^one]: The first footnote.

[^two]: The second,
    over two lines.
