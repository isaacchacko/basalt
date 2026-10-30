---
title: Math
description: "Inline and display math, written in TeX and set when the site is built."
aliases: [math]
---

Inline, like $e^{i\pi} + 1 = 0$, between single dollars: `$e^{i\pi} + 1 = 0$`. On a line of its own, between `$$`:

$$
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
$$

GitHub's ` ```math ` blocks work too:

```math
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
```

It's set by [KaTeX](https://katex.org) when the site is built, so the page carries the math as html, with no script to wait for. [[margin|A proof]] can keep its remarks beside its lines.
