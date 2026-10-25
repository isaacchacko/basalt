---
title: the web, embedded
---

Paste a link to a video or a post as an image, `![](url)`, and Basalt sets it into the note as a player. Each one keeps a caption linking back to where it came from, so the note still makes sense in a feed reader or with embeds blocked.

## a video

A video is just its picture until you press play, so a page with five of them doesn't load five players. Without JavaScript it's a link to the video.

`![The Mother of All Demos](https://www.youtube.com/watch?v=yJDv-zdhzMY)`

![The Mother of All Demos, Douglas Engelbart, 1968: the first hypertext, shown live](https://www.youtube.com/watch?v=yJDv-zdhzMY)

Vimeo, Spotify and CodePen links work the same way.

## a post

Until the post's own script loads, or if it never does, this is a quotation with a link.

![](https://twitter.com/jack/status/20)

## any page

A site Basalt doesn't know can still come in, in a frame: give the image the alt text `iframe`, and a size if you like.

`![iframe|800x420](https://graph.isaacchacko.com)`

![iframe|800x420](https://graph.isaacchacko.com)

The frame's expand button opens the page full screen.
