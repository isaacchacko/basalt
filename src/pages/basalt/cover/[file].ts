// A song's cover, for <sound> (src/markdown/sound.ts): fetched from Spotify
// once, into the site's cache, and served from the site.
import fs from "node:fs"
import path from "node:path"
import type { APIRoute } from "astro"
import { registry } from "../../../lib/registry"

const dir = () => path.join(registry().site.work, "cache", "covers")

export function getStaticPaths() {
  return fs.existsSync(dir()) ? fs.readdirSync(dir()).filter((f) => f.endsWith(".jpg")).map((file) => ({ params: { file } })) : []
}

export const GET: APIRoute = ({ params }) => {
  const file = path.join(dir(), path.basename(String(params.file)))
  if (!fs.existsSync(file)) return new Response(null, { status: 404 })
  return new Response(fs.readFileSync(file), {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
  })
}
