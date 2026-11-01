// The words Basalt itself puts on a page: its labels, counts and empty
// states. A site sets its own in basalt.json's top-level "strings" (or
// basalt.config.ts's), any of them, over these:
//
//   { "strings": { "explorer": "the garden", "noTags": "no tags yet." } }
//
// `{n}` (and `{tag}`) are filled in; a count that reads differently for one
// gives both forms, one first: "{n} tag in all|{n} tags in all".

export const strings = {
  /** the explorer's title, in the navbar */
  explorer: "Explorer",
  /** the phone's menu button, for a screen reader */
  menu: "Notes",
  search: "Search",
  searchPlaceholder: "Search for something",
  /** the tags page's title and breadcrumb */
  tags: "Tags",
  /** a tag's page's title */
  tag: "Tag: {tag}",
  tagCount: "{n} tag in all|{n} tags in all",
  taggedCount: "{n} item with this tag|{n} items with this tag",
  showingFirst: ", showing the first {n}",
  /** the tags page, when no note has a tag */
  noTags: "No tags yet.",
  folderCount: "{n} item under this folder|{n} items under this folder",
  notFound: "Not here",
  notFoundBody: "Either this page is private or it doesn't exist.",
  backToStart: "Back to the start.",
  /** the footer's credit: "Made with Basalt" */
  madeWith: "Made with",
  minRead: "{n} min read",
  contents: "Contents",
  graph: "Graph",
  backlinks: "Linked from",
  theme: "Switch theme",
  source: "Show the markdown",
  /** the feed's description, when the site gives none */
  feed: "The last {n} notes on {title}",
  /** the login page of a site with a password */
  password: "Password",
  enter: "Enter",
  wrongPassword: "That isn't the password.",
}

export type Strings = typeof strings
export type StringKey = keyof Strings

/** A string, its `{name}`s filled in, in the form for its count when it has two. */
export function say(all: Partial<Strings>, key: StringKey, vars: Record<string, string | number> = {}): string {
  const raw = all[key] ?? strings[key]
  const forms = raw.split("|")
  const one = vars.n === 1 || vars.n === "1"
  const form = forms.length > 1 ? (one ? forms[0] : forms[forms.length - 1]) : forms[0]
  return form.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole))
}
