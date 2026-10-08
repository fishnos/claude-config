"use strict";

const fs = require("fs");
const path = require("path");

// Bumped by hand. `npx prettier` with no version runs whatever was published
// last, on every edit, so one bad release would execute as this user.
const PINNED_VERSION = "3.9.9";

/** The prettier a repository installed for itself, nearest the file, or null. */
function installedPrettier(filePath) {
  const binary = process.platform === "win32" ? "prettier.cmd" : "prettier";
  let directory = path.dirname(path.resolve(filePath));
  for (;;) {
    const candidate = path.join(directory, "node_modules", ".bin", binary);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/**
 * The command that formats one file.
 *
 * A repository's own prettier wins, because its lockfile already fixed that
 * version and its config may depend on it. Anything else gets the pinned one.
 */
function prettierCommand(filePath) {
  const installed = installedPrettier(filePath);
  if (installed !== null) {
    return { command: installed, args: ["--write", filePath] };
  }
  // On Windows the npm shim is `npx.cmd`; `spawn` needs the exact name.
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return {
    command: npx,
    args: [`prettier@${PINNED_VERSION}`, "--write", filePath],
  };
}

module.exports = prettierCommand;
