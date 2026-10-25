---
title: margin notes
---

Basalt keeps its notes in the margin, beside the line they belong to, after Edward Tufte's books and the [Tufte CSS](https://edwardtufte.github.io/tufte-css/) that brought them to the web. It's how a good math textbook reads: the argument down the middle, the remarks that help with it alongside.

Write a footnote[^how] and it becomes a numbered **sidenote**. Write an `> [!aside]` after a paragraph and it becomes an unnumbered **margin note** beside it. Put an image in one and it's a **margin figure**.

## a proof, with its remarks

**Theorem.** There are infinitely many primes.

**Proof.** Suppose there were only finitely many, $p_1, p_2, \ldots, p_n$. Consider[^why-plus-one]

$$
N = p_1 p_2 \cdots p_n + 1.
$$

No $p_i$ divides $N$: each divides the product, so dividing $N$ by $p_i$ leaves a remainder of $1$. But every integer greater than $1$ has a prime factor,[^factor] so $N$ has one that isn't on our list, and the list wasn't all the primes. $\blacksquare$

> [!aside] Euclid
> This is the argument of the _Elements_, Book IX, Proposition 20, about 300 BC. Euclid doesn't argue by contradiction, though: he shows any finite list of primes leaves one out.

The proof doesn't say $N$ itself is prime. $2 \cdot 3 \cdot 5 \cdot 7 \cdot 11 \cdot 13 + 1 = 30031 = 59 \cdot 509$, which isn't.[^primorial] It only promises a prime somewhere outside the list.

> [!aside]
> ![[card.png]]
> A margin figure: an image in an aside.

## when notes crowd

Notes that would overlap are set one under the next, so a paragraph citing several things at once[^one] keeps all of them[^two] beside it, in order.[^three]

[^how]: Like this one. It's beside the line that cites it, not at the bottom of the page. On a phone, tap the number and it opens under the line.

[^why-plus-one]: The $+1$ is the whole trick: it makes $N$ leave a remainder of $1$ when divided by any prime on the list.

[^factor]: Take the smallest divisor of $N$ greater than $1$. It must be prime, or it would have a smaller divisor itself.

[^primorial]: Numbers of the form $p_n\# + 1$ are the _Euclid numbers_. Whether infinitely many of them are prime is still open.

[^one]: The first of three notes on one sentence.

[^two]: The second, set under the first.

[^three]: And the third, under that.
