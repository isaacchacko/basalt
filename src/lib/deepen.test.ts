import test, { describe, beforeEach, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { deepen, forgetDepth, sourcesOf } from "./deepen.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  }).trim();

const made: string[] = [];
const tmp = (prefix: string) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
after(() =>
  made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })),
);

/** a repository with `n` commits to notes/a.md on main, and `branch` commits more on a branch "feature" */
function origin(n: number, branch = 0): string {
  const dir = tmp("basalt-deepen-");
  git(dir, "init", "-q", "-b", "main");
  fs.mkdirSync(path.join(dir, "notes"));
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(path.join(dir, "notes", "a.md"), `version ${i}\n`);
    git(dir, "add", ".");
    git(dir, "commit", "-qm", `main ${i}`);
  }
  if (branch) {
    git(dir, "switch", "-q", "-c", "feature");
    for (let i = 0; i < branch; i++) {
      fs.writeFileSync(path.join(dir, "notes", "b.md"), `b ${i}\n`);
      git(dir, "add", ".");
      git(dir, "commit", "-qm", `feature ${i}`);
    }
    git(dir, "switch", "-q", "main");
  }
  return dir;
}

/** a clone of `from` the way Vercel makes one: shallow, and with no remote */
function vercelClone(from: string, depth: number, branch = "main"): string {
  const dir = tmp("basalt-deepen-clone-");
  git(
    dir,
    "clone",
    "-q",
    "--depth",
    String(depth),
    "--branch",
    branch,
    `file://${from}`,
    ".",
  );
  git(dir, "remote", "remove", "origin");
  return dir;
}

const warnings: string[] = [];
const warn = console.warn;
beforeEach(() => {
  forgetDepth();
  warnings.length = 0;
  console.warn = (msg: string) => void warnings.push(msg);
});
process.on("exit", () => (console.warn = warn));

describe("deepen", () => {
  test("a whole clone: nothing to do", () => {
    const dir = origin(3);
    assert.deepStrictEqual(deepen(dir, {}), {
      complete: true,
      boundary: new Set(),
    });
    assert.deepStrictEqual(warnings, []);
  });

  test("a shallow clone with no remote is fetched whole from the repository it was built from", () => {
    const from = origin(12);
    const dir = vercelClone(from, 10);
    assert.strictEqual(git(dir, "rev-list", "--count", "HEAD"), "10");
    const got = deepen(dir, {}, [[`file://${from}`, "HEAD"]]);
    assert.deepStrictEqual(got, { complete: true, boundary: new Set() });
    assert.strictEqual(
      git(dir, "rev-parse", "--is-shallow-repository"),
      "false",
    );
    assert.strictEqual(git(dir, "rev-list", "--count", "HEAD"), "12");
    assert.strictEqual(
      git(dir, "log", "--format=%s", "--", "notes/a.md").split("\n").at(-1),
      "main 0",
    );
  });

  test("a branch more than the clone's depth past main is made whole too", () => {
    const from = origin(5, 12);
    const dir = vercelClone(from, 10, "feature");
    const got = deepen(dir, {}, [[`file://${from}`, "HEAD"]]);
    assert.strictEqual(got.complete, true);
    assert.strictEqual(git(dir, "rev-list", "--count", "HEAD"), "17");
  });

  test("one that can't be fetched stays as it is: incomplete, where it starts, said once", () => {
    const from = origin(4);
    const dir = vercelClone(from, 2);
    const oldest = git(dir, "rev-list", "--max-parents=0", "HEAD");
    const got = deepen(dir, {}, [
      [path.join(os.tmpdir(), "basalt-deepen-nowhere"), "HEAD"],
    ]);
    assert.strictEqual(got.complete, false);
    assert.deepStrictEqual(got.boundary, new Set([oldest]));
    assert.match(
      got.note!,
      /last 2 commits only, and the rest couldn't be fetched/,
    );
    assert.deepStrictEqual(deepen(dir, {}), got);
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(git(dir, "rev-list", "--count", "HEAD"), "2");
  });

  test("while serving, a shallow clone isn't fetched, only said to be shallow", () => {
    const from = origin(4);
    const dir = vercelClone(from, 2);
    const got = deepen(dir, { BASALT_COMMAND: "dev" }, [
      [`file://${from}`, "HEAD"],
    ]);
    assert.strictEqual(got.complete, false);
    assert.strictEqual(git(dir, "rev-list", "--count", "HEAD"), "2");
    assert.match(got.note!, /last 2 commits only, so/);
  });

  test("not a repository: nothing", () => {
    const dir = tmp("basalt-deepen-none-");
    assert.deepStrictEqual(deepen(dir, {}), {
      complete: true,
      boundary: new Set(),
    });
  });

  test("sources: the clone's remotes, then the repository Vercel built", () => {
    const from = origin(1);
    git(from, "remote", "add", "origin", "https://example.com/x.git");
    assert.deepStrictEqual(sourcesOf(from, {}), [["origin"]]);
    assert.deepStrictEqual(
      sourcesOf(from, {
        VERCEL_GIT_PROVIDER: "github",
        VERCEL_GIT_REPO_OWNER: "isaacchacko",
        VERCEL_GIT_REPO_SLUG: "basalt",
        VERCEL_GIT_COMMIT_REF: "edit-proof",
      }),
      [["origin"], ["https://github.com/isaacchacko/basalt.git", "HEAD"]],
    );
    assert.deepStrictEqual(
      sourcesOf(from, {
        VERCEL_GIT_PROVIDER: "gitlab",
        VERCEL_GIT_REPO_OWNER: "o",
        VERCEL_GIT_REPO_SLUG: "r",
      })[1],
      ["https://gitlab.com/o/r.git", "HEAD"],
    );
    assert.deepStrictEqual(
      sourcesOf(from, {
        VERCEL_GIT_PROVIDER: "elsewhere",
        VERCEL_GIT_REPO_OWNER: "o",
        VERCEL_GIT_REPO_SLUG: "r",
      }),
      [["origin"]],
    );
  });
});
