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
  /** editing a page in place (client/editor.ts): the pencil, and the status in the corner */
  edit: "Edit this page",
  editing: "Editing",
  editSaving: "Saving…",
  editPublishing: "Publishing…",
  editDeploying: "Deploying… {s}s",
  editLive: "Live",
  editFailed: "Couldn't save: {error}",
  editSlowDeploy: "Published, but the deploy hasn't come back yet",
  /** a built site's: connecting to GitHub, once */
  editConnect: "Connect to GitHub",
  editTokenHelp: "Edits are committed to {repo} with a fine-grained token that can read and write its contents. It's kept in this browser.",
  editToken: "Token",
  editMakeToken: "Make a token",
  editCancel: "Cancel",
  editConnectButton: "Connect",
  editTokenWrong: "That token can't write to {repo}.",
  /** the commit message of an edit (the publish dialog's, to begin with) */
  editCommit: "Edit {path}",
  /** a built site's draft, unpublished (client/publish.ts): the count in the corner, and the dialog */
  editDraft: "{n} unpublished change|{n} unpublished changes",
  editDraftElsewhere: "Unpublished changes on {title}|Unpublished changes on {n} pages",
  editRestored: "Your unpublished changes are back",
  editKept: "Your unpublished changes are kept in this browser",
  editNothing: "Nothing to publish",
  editDiscarded: "Discarded",
  editPublishTitle: "Publish your changes",
  editPublishTo: "Commits {path} to {branch} of {repo}.",
  editPublishMoved: "{path} was committed to since you began. Those changes are kept, and yours go in around them.",
  editReading: "Reading the note on GitHub…",
  editChanges: "Your changes",
  editMessage: "Commit message",
  editPublish: "Publish",
  editKeepEditing: "Keep editing",
  editDiscard: "Discard",
  editDiscardSure: "Discard your unpublished changes? They're kept nowhere else.",
  editDiscardNo: "Keep them",
  editDiscardYes: "Discard them",
  /** the explorer's file ops, in editing view (client/files.ts): its menu, and what it asks */
  editFileNewNote: "New note",
  editFileNewFolder: "New folder",
  editFileNewIn: "New note in {name}",
  editFileMore: "More for {name}",
  editFileRename: "Rename",
  editFileMove: "Move to…",
  editFileDelete: "Delete",
  editFileName: "Name",
  editFileBad: "A name can't be empty, start with a dot, or have \\ / : * ? \" < > | # ^ [ or ]",
  editFileTaken: "There's a {name} there already",
  editFileMoveTitle: "Move {name} to…",
  editFileMoveFind: "Find a folder",
  editFileTop: "The top of the site",
  editFileDeleteTitle: "Delete {name}?",
  editFileDeleteFolder: "Everything in it goes too.",
  editFileDeleteDev: "It's deleted from the disk.",
  editFileDeleteGitHub: "It's deleted from the repository once you publish.",
  editFileLinksTitle: "Update links?",
  editFileLinks: "{n} link to {name} would point to nothing. Update it to where it's going?|{n} links to {name} would point to nothing. Update them to where it's going?",
  editFileLinksIn: "{path}: {n} link|{path}: {n} links",
  editFileLinksYes: "Update",
  editFileLinksNo: "Don't update",
  editFileCreated: "New, unpublished",
  editFileWas: "Unpublished: was {path}",
  editFileGone: "Unpublished: deleted",
  editFileDeploying: "Published: it's on the site once it's deployed",
  editFileFailed: "Couldn't: {error}",
  /** the explorer's file ops in the publish dialog, above the note's changes */
  editPublishFiles: "Commits these to {branch} of {repo}, in one commit:",
  editFileOpCreate: "Created {path}",
  editFileOpRename: "Renamed {from} to {to}",
  editFileOpMove: "Moved {from} to {to}",
  editFileOpDelete: "Deleted {path}",
  editFileOpLinks: "{n} link updated in {path}|{n} links updated in {path}",
  editFileOpCant: "Can't now: {why}",
  editFileWhyExists: "there's one there on GitHub already",
  editFileWhyMissing: "it isn't on GitHub any more",
  editFileWhyPath: "that's not a path in the site",
  editFileCommitMore: "{what}, and {n} more change|{what}, and {n} more changes",
  editReadingFiles: "Reading the branch on GitHub…",
  /** beside a block a built site can't draw till it's published (a song it hasn't looked up, say) */
  editUndrawn: "drawn once it's published",
  /** a note's history (client/history.ts): its button, and its timeline */
  history: "Show this page's history",
  historyTitle: "History",
  historyNow: "Now",
  historyClose: "Close the history",
  historyPlain: "Plain",
  historyEverywhere: "Every page",
  historyPartial: "Older history isn't in this build",
  historyNone: "No commits yet",
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
