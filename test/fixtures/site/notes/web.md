---
title: web embeds
---

A bare `![](url)` to a site Basalt knows becomes that site's player. Each comes with a caption linking back to the source, so the page still makes sense in an RSS reader or with frames blocked.

## youtube, as a facade

Just a thumbnail until it's clicked, so five videos on a page don't load five players. With JavaScript off it is a link to the video.

`![a video, starting 42 seconds in](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42)`

![a video, starting 42 seconds in](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42)

## vimeo

![](https://vimeo.com/22439234)

## spotify

![](https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT)

## a tweet

Until twitter's script loads (or if it never does), this is a quote with a link.

![](https://twitter.com/jack/status/20)

## codepen

![](https://codepen.io/chriscoyier/pen/gfdDu)

## any page, in a frame

`![iframe|800x420](https://example.com)`: a page Basalt doesn't know, opted into with the alt text `iframe`.

![iframe|800x420](https://example.com)

## an iframe written by hand

Gets `loading="lazy"` and a link out.

<iframe src="https://example.org" height="240"></iframe>
