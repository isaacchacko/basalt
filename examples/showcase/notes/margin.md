---
title: notes in the margin
aliases: [secondary]
---

A Basalt page keeps its remarks in the side content, beside the line they belong to, the way Edward Tufte's books do and the [Tufte CSS](https://edwardtufte.github.io/tufte-css/) that brought them to the web. The argument runs down the main content and the remarks that help with it sit alongside, where your eye already is.

There are three kinds. A footnote becomes a numbered **sidenote**.[^how] An `> [!aside]` after a paragraph becomes an unnumbered **margin note** beside it. An aside with a picture in it is a **margin figure**.

## a proof, with its remarks

**Theorem.** There are infinitely many primes.

**Proof.** Suppose there were only finitely many, $p_1, p_2, \ldots, p_n$. Consider[^why-plus-one]

$$
N = p_1 p_2 \cdots p_n + 1.
$$

No $p_i$ divides $N$: each divides the product, so dividing $N$ by $p_i$ leaves a remainder of $1$. But every integer greater than $1$ has a prime factor,[^factor] so $N$ has one that isn't on our list, and the list wasn't all the primes. $\blacksquare$

> [!aside] Euclid
> This is the argument of the _Elements_, Book IX, Proposition 20, about 300 BC. Euclid doesn't argue by contradiction, though: he shows that any finite list of primes leaves one out.

The proof doesn't say $N$ itself is prime. $2 \cdot 3 \cdot 5 \cdot 7 \cdot 11 \cdot 13 + 1 = 30031 = 59 \cdot 509$, which isn't.[^primorial] It only promises a prime somewhere outside the list.

> [!aside]
> ![[primes.svg]]
> The primes below 100, as a sieve leaves them.

## when notes crowd

When notes would overlap, they're set one under the next. A sentence that cites several things at once[^one] keeps all of them[^two] beside it, in order.[^three] On a phone there's no room beside the text, so a number opens its note under the line when you tap it.

## pointing at things

The side content also shows what you're pointing at, one thing at a time. Hover a link to another note, like [[transclusion]] or the [[diagrams#graphviz|graphviz section]] of another page, and its opening appears beside the line. Move away and it goes. A link out of the garden, like [Quartz](https://quartz.jzhao.xyz), says where it leads.

Anything with a tooltip shows it there too, instead of in a small box under the pointer. <abbr title="Obsidian Flavored Markdown, the markdown Obsidian writes">OFM</abbr> is an abbreviation, and <span title="anything with a title shows it in the side content">this sentence has a title</span>.

[^how]: Like this one. It sits beside the line that cites it, not at the bottom of the page.

[^why-plus-one]: The $+1$ is the whole trick: it makes $N$ leave a remainder of $1$ when divided by any prime on the list.

[^factor]: Take the smallest divisor of $N$ greater than $1$. It must be prime, or it would have a smaller divisor itself.

[^primorial]: Numbers of the form $p_n\# + 1$ are the _Euclid numbers_. Whether infinitely many of them are prime is still an open question.

[^one]: The first of three notes on one sentence.

[^two]: The second, set under the first.

[^three]: And the third, under that.
