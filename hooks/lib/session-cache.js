"use strict";

// One place to build the <configDir>/cache/<kind>/<session-id>.md path, so a
// session id carrying a path separator cannot escape the cache directory.

const fs = require("fs");
const path = require("path");
const io = require("./hook-io");

// Anything outside this set is replaced with "-", which also neutralises a
// session id carrying a path separator or a "../" segment.
const UNSAFE_CHARACTER = /[^A-Za-z0-9._-]/g;

function sanitizeSessionIdentifier(sessionIdentifier) {
  const cleaned = String(sessionIdentifier || "").replace(
    UNSAFE_CHARACTER,
    "-",
  );
  if (cleaned === "" || cleaned === "." || cleaned === "..") return "unknown";
  return cleaned;
}

/**
 * Build the cache file path for one session under `<configDir>/cache/<kind>/`.
 *
 * `create` defaults to false so a reader never creates the directory it is
 * only trying to read from; a writer passes `create: true`.
 */
function cachePath(kind, sessionIdentifier, { create = false } = {}) {
  const directory = path.join(io.configDir(), "cache", kind);
  if (create) fs.mkdirSync(directory, { recursive: true });
  return path.join(
    directory,
    sanitizeSessionIdentifier(sessionIdentifier) + ".md",
  );
}

module.exports = { cachePath, sanitizeSessionIdentifier };
