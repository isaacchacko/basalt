// A build's clone with all its history, so the day a note was written
// (gitdates.ts) goes back to its first commit. Hosts
// clone shallow: Vercel the last 10 commits, with no remote to fetch more
// from; a GitHub Action the last one. So a shallow clone is fetched whole,
// from its own remote if it has one, else from the repository Vercel says it
// built (VERCEL_GIT_PROVIDER/OWNER/SLUG), which works without a token when
// the repository is public. A private one stays shallow, its histories cut
// where the clone starts (a full clone fixes that: VERCEL_DEEP_CLONE=true on
// Vercel, fetch-depth: 0 in an Action). While serving, it's only said.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export interface Depth {
  /** every commit is here */
  complete: boolean;
  /** the commits a shallow clone starts at: a file that's in one and wasn't added by it has older history, not here */
  boundary: Set<string>;
  /** why it isn't complete, said once */
  note?: string;
}

const HOSTS: Record<string, string> = {
  github: "github.com",
  gitlab: "gitlab.com",
  bitbucket: "bitbucket.org",
};

const git = (cwd: string, args: string[], timeout?: number) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout,
    // a private repository fails at once instead of asking for a password
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();

const shallow = (top: string) =>
  git(top, ["rev-parse", "--is-shallow-repository"]) === "true";

/**
 * where a shallow clone's history can be fetched from, as `git fetch`'s
 * arguments: its remotes, then the repository Vercel built (any ref will do:
 * --unshallow fetches everything behind where the clone starts)
 */
export function sourcesOf(
  top: string,
  env: NodeJS.ProcessEnv = process.env,
): string[][] {
  const out = git(top, ["remote"])
    .split("\n")
    .filter(Boolean)
    .map((remote) => [remote]);
  const host = HOSTS[env.VERCEL_GIT_PROVIDER ?? ""];
  if (host && env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG)
    out.push([
      `https://${host}/${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}.git`,
      "HEAD",
    ]);
  return out;
}

const cache = new Map<string, Depth>();

/** The repository at `top` made whole if it's a shallow clone and can be; what it has, either way (cached per top). */
export function deepen(
  top: string,
  env: NodeJS.ProcessEnv = process.env,
  sources?: string[][],
): Depth {
  const hit = cache.get(top);
  if (hit) return hit;
  let depth: Depth = { complete: true, boundary: new Set() };
  try {
    if (shallow(top)) {
      // serving, it isn't fetched: only said
      const fetching = env.BASALT_COMMAND !== "dev";
      if (fetching) {
        sources ??= sourcesOf(top, env);
        for (const from of sources) {
          try {
            git(
              top,
              ["fetch", "--quiet", "--no-tags", "--unshallow", ...from],
              120_000,
            );
          } catch {}
          if (!shallow(top)) break;
        }
      }
      if (shallow(top)) {
        const file = git(top, ["rev-parse", "--git-path", "shallow"]);
        const boundary = new Set(
          fs
            .readFileSync(path.resolve(top, file), "utf8")
            .split("\n")
            .filter(Boolean),
        );
        const count = git(top, ["rev-list", "--count", "HEAD"]);
        const why = !fetching
          ? ""
          : sources!.length
            ? ", and the rest couldn't be fetched (a private repository?)"
            : ", with nowhere to fetch the rest from";
        const note = `basalt: this clone has its last ${count} commits only${why}, so notes' histories start there. A full clone has them all (on Vercel, VERCEL_DEEP_CLONE=true; in a GitHub Action, fetch-depth: 0)`;
        console.warn(note);
        depth = { complete: false, boundary, note };
      }
    }
  } catch {
    // not a repository, or no git: nothing to deepen
  }
  cache.set(top, depth);
  return depth;
}

/** forget what was found (tests) */
export function forgetDepth(): void {
  cache.clear();
}
