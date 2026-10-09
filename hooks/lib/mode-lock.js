"use strict";

// Which mode is in force for a working directory.
//
// A repository's record lives on the machine side, under modes/repos/<key>/,
// and never inside the repository. A record kept in the repository is
// repository content: a clone could ship one that unblocks tools or turns
// hooks off. Kept here, only the operator's own switch can write it.
//
// Nothing in this file writes, and nothing in it throws: every hook that gates
// a tool call reads through it, and a lookup that failed loudly would take the
// tool call down with it.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const repoAudit = require("./repo-audit");

const LOCK_NAME = "mode.lock";
const KEY_LENGTH = 16;

function realPath(directory) {
  try {
    return fs.realpathSync(directory);
  } catch {
    return path.resolve(String(directory));
  }
}

/** The repository a working directory sits in, or null when it sits in none. */
function repositoryRoot(workingDirectory) {
  try {
    const root = repoAudit.findRepositoryRoot(workingDirectory);
    return root === null ? null : realPath(root);
  } catch {
    return null;
  }
}

function repositoryKey(root) {
  return crypto
    .createHash("sha256")
    .update(realPath(root))
    .digest("hex")
    .slice(0, KEY_LENGTH);
}

function repoDirectory(configDir, root) {
  return path.join(configDir, "modes", "repos", repositoryKey(root));
}

function readRecord(file) {
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    return record !== null && typeof record === "object" ? record : null;
  } catch {
    return null;
  }
}

/**
 * The record in force: the repository's own, else the machine's, else none.
 *
 * A repository record counts only when the root it carries is the repository
 * asking. Two paths can share a sixteen-character key, and a record answering
 * for the wrong repository would apply one repository's tool gates to another.
 */
function resolveLock(configDir, workingDirectory) {
  const root = repositoryRoot(workingDirectory);
  if (root !== null) {
    const directory = repoDirectory(configDir, root);
    const lock = readRecord(path.join(directory, LOCK_NAME));
    if (lock !== null && lock.root === root)
      return { lock, scope: "repo", root, directory };
  }

  const lock = readRecord(path.join(configDir, LOCK_NAME));
  return {
    lock,
    scope: lock === null ? "none" : "machine",
    root,
    directory: configDir,
  };
}

/**
 * The lookup for a hook payload.
 *
 * Tool and prompt hooks carry `cwd`. The status line carries the same thing as
 * `workspace.current_dir` on some builds, so both are read before falling back
 * to the process, which a hook inherits from the session.
 */
function resolveForPayload(configDir, payload) {
  const named =
    (payload && payload.cwd) ||
    (payload && payload.workspace && payload.workspace.current_dir) ||
    undefined;
  return resolveLock(configDir, named);
}

/** The assembled rules of whichever scope answered. */
function rulesPath(resolution) {
  return resolution.scope === "repo"
    ? path.join(resolution.directory, "rules.md")
    : path.join(resolution.directory, "rules", "_active.md");
}

module.exports = {
  realPath,
  repositoryRoot,
  repositoryKey,
  repoDirectory,
  resolveLock,
  resolveForPayload,
  rulesPath,
};
