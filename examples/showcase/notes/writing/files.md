---
title: Code and data
description: "Code, a few of its lines, or a csv as a table, shown from the file itself."
aliases: [files, examples/markdown/files]
---

Embed a file that isn't a note, `![[sieve.py]]`, and it's shown from the file itself: change the code and the page changes with it.

## A code file

`![[sieve.py]]` is highlighted and titled with its name. Point at it, and its bar shows what you can do with it: wrap its lines, open the raw file, copy the code, or see it on the whole screen. It's the code that drew the sieve on [[margin]]. Its first line is wider than the page: point at it, and the code reaches into the side content to show the rest.

![[sieve.py]]

## Some of its lines

`![[sieve.py#L7-L11]]` shows just those lines, numbered from where they start:

![[sieve.py#L7-L11|the sieve itself]]

## A code block

Any code block has the same controls, inside it. A block with a title, ```` ```ts title="primes.ts" ````, has them in its bar; one without has them in its top right corner.

```ts title="primes.ts"
// the primes up to n, by crossing out the multiples of each one in turn (Eratosthenes, about 240 BC)
export function primes(n: number): number[] {
  const crossed = new Uint8Array(n + 1)
  const found: number[] = []
  for (let p = 2; p <= n; p++) {
    if (crossed[p]) continue
    found.push(p)
    for (let m = p * p; m <= n; m += p) crossed[m] = 1
  }
  return found
}

// Euclid's numbers: one more than the product of the first k primes
export const euclid = (k: number) => primes(100).slice(0, k).reduce((a, p) => a * p, 1) + 1
```

```sh
basalt dev my-garden
```

The same code in two languages can take turns, in [[text#tabs|tabs]].

## A table

A csv file, `![[euclid.csv]]`, becomes a table. These are the Euclid numbers from the proof on [[margin]], and the first six are prime:

![[euclid.csv]]

## A file that isn't there

A name that matches no file says so, instead of breaking the page:

![[nope.py]]
