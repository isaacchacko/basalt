// The words Basalt puts on a page, as the site set them (src/lib/strings.ts):
//   const t = await words(); t("minRead", { n: 3 })
import { layout } from "../lib/config"
import { say, type StringKey, type Strings } from "../lib/strings"

export async function words() {
  const { strings = {} } = (await layout()) as { strings?: Partial<Strings> }
  return (key: StringKey, vars?: Record<string, string | number>) => say(strings, key, vars)
}
