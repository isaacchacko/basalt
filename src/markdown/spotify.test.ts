// [[spotify:…]]: the tag it becomes, the song read from its page, and its card.
import "./test-hooks.ts"
import test from "node:test"
import assert from "node:assert"
import { toHtml } from "hast-util-to-html"

const { ofmText } = await import("./ofm.ts")
const { trackOf } = await import("./sound.ts")
const { spotifyCard, spotifyUrl } = await import("./spotify.ts")

const page = (title: string, description: string) =>
  `<meta property="og:title" content="${title}"/><meta property="og:description" content="${description}"/>`

test("the wikilink is a <spotify> tag, its caption inside", () => {
  assert.strictEqual(
    ofmText("[[spotify:https://open.spotify.com/track/abc?si=1|My song &amp; <this> note]]"),
    '<spotify src="https://open.spotify.com/track/abc?si=1">My song &amp; &lt;this> note</spotify>',
  )
  assert.strictEqual(ofmText("[[spotify:track:abc]]"), '<spotify src="track:abc"></spotify>')
})

test("a URI or a bare link is a url", () => {
  assert.strictEqual(spotifyUrl("track:abc"), "https://open.spotify.com/track/abc")
  assert.strictEqual(spotifyUrl("spotify:album:abc"), "https://open.spotify.com/album/abc")
  assert.strictEqual(spotifyUrl("open.spotify.com/track/abc"), "https://open.spotify.com/track/abc")
})

test("a song's page and an album's", () => {
  const url = "https://open.spotify.com/track/abc"
  assert.deepStrictEqual(trackOf("track", url, page("Never Gonna Give You Up", "Rick Astley · Whenever You Need Somebody · Song · 1987")), {
    title: "Never Gonna Give You Up",
    url,
    artist: "Rick Astley",
    album: "Whenever You Need Somebody",
    year: "1987",
  })
  assert.deepStrictEqual(
    trackOf("album", url, page("Listen to Emotion (Deluxe) - Album by Carly Rae Jepsen | Spotify", "Carly Rae Jepsen · album · 2015 · 15 songs")),
    { title: "Emotion (Deluxe)", url, artist: "Carly Rae Jepsen", year: "2015" },
  )
})

test("the card: cover, name, artist, album, and the caption under it", () => {
  const html = toHtml(
    spotifyCard("https://open.spotify.com/track/abc", [{ type: "text", value: "mine" }], {
      title: "Song",
      artist: "Artist",
      album: "Album",
      cover: "/basalt/cover/abc.jpg",
      url: "",
    }),
  )
  assert.match(html, /^<a href="https:\/\/open.spotify.com\/track\/abc" target="_blank" rel="noopener noreferrer" class="basalt-song-card">/)
  assert.match(html, /<img class="basalt-song-cover" src="\/basalt\/cover\/abc.jpg"/)
  assert.match(html, /<span class="basalt-song-name">Song<\/span><span class="basalt-song-artist">Artist<\/span><span class="basalt-song-album">Album<\/span>/)
  assert.match(html, /<span class="basalt-song-caption">mine<\/span>$/)
})

test("without the song, the caption links to it", () => {
  const html = toHtml(spotifyCard("https://example.com", [{ type: "text", value: "mine" }]))
  assert.strictEqual(html, '<a href="https://example.com" target="_blank" rel="noopener noreferrer" class="basalt-song-card basalt-song-bare"><span class="basalt-song-name">mine</span></a>')
})
