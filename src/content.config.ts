import { defineCollection } from "astro:content"
import { basaltLoader } from "./loader"

export const collections = {
  notes: defineCollection({ loader: basaltLoader() }),
}
