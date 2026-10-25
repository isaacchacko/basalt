// Quartz's feed was index.xml: the same feed, for readers subscribed to it.
import type { APIRoute } from "astro"
import { feed } from "./rss.xml"

export const GET: APIRoute = async () =>
  new Response(await feed(), { headers: { "content-type": "application/rss+xml; charset=utf-8" } })
