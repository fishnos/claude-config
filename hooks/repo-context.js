"use strict";

// UserPromptSubmit: state the model would otherwise burn a tool call discovering.
//
// Branch, working-tree cleanliness, upstream drift and package manager, in one
// line. Emitted only when it changes -- repeating identical context every turn
// costs tokens and trains the model to skim past it.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");

const EVENT = "UserPromptSubmit";

const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lockb", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/** Marker directory keyed by session, so a new session always gets the context once. */
function markerFile(sessionId) {
  const directory = path.join(io.configDir(), "cache", "repo-context");
  try {
    fs.mkdirSync(directory, { recursive: true });
  } catch {
    return null;
  }
  return path.join(directory, String(sessionId || "unknown"));
}

function packageManager(root) {
  for (const [lockfile, name] of LOCKFILES) {
    if (fs.existsSync(path.join(root, lockfile))) return name;
  }
  return null;
}

/**
 * Nearest ancestor holding a lockfile, found without spawning anything.
 *
 * The walk stops at the repository root. Without that bound it escapes into the
 * home directory, where a stray package-lock.json would label every unrelated
 * repo "npm".
 */
function findPackageRoot(cwd) {
  let directory = path.resolve(cwd);
  for (let depth = 0; depth < 40; depth += 1) {
    for (const [lockfile] of LOCKFILES) {
      if (fs.existsSync(path.join(directory, lockfile))) return directory;
    }
    if (fs.existsSync(path.join(directory, ".git"))) return null;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
  return null;
}

/**
 * One `git status --porcelain=v2 --branch` carries branch, upstream drift and
 * every changed path. This hook runs on every prompt, so the five separate
 * plumbing calls this replaces were five process spawns per turn.
 */
function describe(cwd) {
  const status = io.git(
    ["status", "--porcelain=v2", "--branch", "--untracked-files=normal"],
    cwd,
  );
  if (!status) return null;

  let branch = null;
  let ahead = 0;
  let behind = 0;
  let hasUpstream = false;
  let changed = 0;

  for (const line of status.split("\n")) {
    if (!line) continue;
    if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length).trim();
      continue;
    }
    if (line.startsWith("# branch.upstream ")) {
      hasUpstream = true;
      continue;
    }
    if (line.startsWith("# branch.ab ")) {
      const counts = /\+(\d+)\s+-(\d+)/.exec(line);
      if (counts) {
        ahead = Number(counts[1]);
        behind = Number(counts[2]);
      }
      continue;
    }
    if (line.startsWith("#")) continue;
    changed += 1;
  }

  const parts = [`branch ${branch || "(detached)"}`];
  parts.push(changed === 0 ? "clean" : `${changed} uncommitted`);
  if (!hasUpstream) parts.push("no upstream");
  if (ahead > 0) parts.push(`${ahead} ahead`);
  if (behind > 0) parts.push(`${behind} behind`);

  const root = findPackageRoot(cwd);
  const manager = root ? packageManager(root) : null;
  if (manager) parts.push(manager);

  return { line: parts.join(" | "), root };
}

io.run(() => {
  const payload = io.readPayload();
  const cwd = payload.cwd || process.cwd();

  const described = describe(cwd);
  if (described === null) return;

  const marker = markerFile(payload.session_id);
  if (marker !== null) {
    let previous = null;
    try {
      previous = fs.readFileSync(marker, "utf8");
    } catch {
      previous = null;
    }
    if (previous === described.line) return;
    try {
      fs.writeFileSync(marker, described.line);
    } catch {
      // Losing the marker only costs a repeated line; never block the prompt.
    }
  }

  io.warn(EVENT, `Repo: ${described.line}`);
});
