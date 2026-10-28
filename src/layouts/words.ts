// The words Basalt puts on a page, as the site set them (src/lib/strings.ts):
//   const t = await words(); t("minRead", { n: 3 })
// and t.raw("minRead"), as it's written, for a script to fill in itself.
import { layout } from "../lib/config"
import { say, strings as basalt, type StringKey, type Strings } from "../lib/strings"

export async function words() {
  const { strings = {} } = (await layout()) as { strings?: Partial<Strings> }
  const t = (key: StringKey, vars?: Record<string, string | number>) => say(strings, key, vars)
  /** its {name}s, and both its forms when it has two ("one|many"), as written */
  t.raw = (key: StringKey) => strings[key] ?? basalt[key]
  return t
}
