---
title: Streaks
aliases: [streaks]
---

A `streak` block draws a year of days the way GitHub draws contributions: seven rows, Sunday on top, a column a week, ending this week, each day shaded by how much happened on it. Under it, the total, the streak still going and the longest. Point at a day to see its count. On a phone the grid scrolls sideways, starting at this week.

## GitHub

Name a user and the block is their contributions, from their profile, fetched when the site is built.

````md
```streak
github: isaacchacko
```
````

```streak
github: isaacchacko
```

## LeetCode

The same for a LeetCode user's submissions.

````md
```streak
leetcode: isaacchacko
```
````

```streak
leetcode: isaacchacko
```

## Your own

With no user, the days are the block's own, one a line: a date, a date and a count, or a range of dates, each day of it once. `title:` names it, and `weeks:` makes it longer or shorter than a year.

````md
```streak
title: Pushups
weeks: 26
2026-06-01..2026-06-14
2026-06-20: 3
2026-07-04..2026-07-30
2026-08-02: 2
2026-08-10..2026-09-12
2026-09-20: 4
2026-10-01..2026-10-27
```
````

```streak
title: Pushups
weeks: 26
2026-06-01..2026-06-14
2026-06-20: 3
2026-07-04..2026-07-30
2026-08-02: 2
2026-08-10..2026-09-12
2026-09-20: 4
2026-10-01..2026-10-27
```

In Obsidian, or on GitHub, it stays a code block, and reads as one.
