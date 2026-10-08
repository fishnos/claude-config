"use strict";

const fs = require("fs");
const path = require("path");
const io = require("./hook-io");

/**
 * Who a remote belongs to, as `host/owner` in lower case, or null.
 *
 * The host is part of the answer because an account name is only unique on one
 * host: `gitlab.com/someone` is not `github.com/someone`.
 */
function remoteOwner(url) {
  const match =
    /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[/:]([^/]+)\//i.exec(
      url.trim(),
    );
  return match === null ? null : `${match[1]}/${match[2]}`.toLowerCase();
}

function originOwner(directory) {
  return remoteOwner(io.git(["remote", "get-url", "origin"], directory));
}

/** Owners the operator added by hand, one `host/owner` a line, `#` for comments. */
function listedOwners() {
  const file = path.join(io.configDir(), "local", "trusted-owners.txt");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True when `directory` sits in a repository published under someone else.
 *
 * The operator is taken to be whoever this config repository's own `origin`
 * belongs to, so nothing here names a person. A repository with no `origin`
 * was made on this machine and counts as the operator's. When the config
 * repository has no `origin` either there is nobody to compare against, and
 * nothing is called foreign.
 */
function isForeignRepository(directory) {
  const owner = originOwner(directory);
  if (owner === null) return false;
  const operator = originOwner(io.configDir());
  if (operator === null) return false;
  return owner !== operator && !listedOwners().includes(owner);
}

module.exports = { isForeignRepository, remoteOwner };
