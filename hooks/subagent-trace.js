"use strict";

// PostToolUse(Edit, Write, Bash): record which files a worker touched.
//
// The scope gate asks whether a worker stayed inside the files its dispatch
// declared. Answering that by diffing the checkout at finish time would be
// wrong whenever two workers run in one repository: each would inherit the
// other's changes and both would fail for work neither did. So attribution is
// per `agent_id`, the field the 2026-09-15 spike measured arriving inside a
// worker's payloads, and the record is appended one call at a time while the
// worker runs.
//
// A payload with no `agent_id` is the main session acting. Nothing is recorded
// for it: no gate reads those lines, and appending one per ordinary edit would
// bury a worker's handful of paths under thousands.
//
// `Bash` is matched and deliberately records nothing. What a command writes is
// not knowable from its text, and guessing would put paths in a worker's trace
// it never touched, which fails the scope gate for the wrong reason. A worker
// that edits through the shell therefore leaves no trace here; the evidence log
// still sees the call, and the gate runner still has the report to read.
//
// `MultiEdit` is not a tool on build 2.1.273 and is not matched.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");
const record = require("./lib/crew-record");

const TRACED_TOOLS = ["Edit", "Write"];

/**
 * The path as a dispatcher would have written it: relative to the repository
 * root, because that is the spelling a declared scope (`src/a.js`) uses. Falls
 * back to the absolute path outside a repository, so a write still reaches the
 * record rather than being dropped for want of a root to be relative to.
 */
function repositoryRelative(absolute, workingDirectory) {
  const toplevel = io
    .git(["rev-parse", "--show-toplevel"], workingDirectory)
    .trim();
  if (!toplevel) return absolute;

  // Two attempts, and both are needed. The plain one handles a file that does
  // not exist yet, which is every first Write. The resolved one handles a root
  // reached through a symbolic link: on macOS a checkout under
  // `/var/folders/...` is `/private/var/...` to git, and relativizing one
  // against the other yields a chain of `..` segments no scope pattern could
  // match.
  const plain = insideRoot(toplevel, absolute);
  if (plain) return plain;
  return insideRoot(realPath(toplevel), realPath(absolute)) || absolute;
}

/** The path relative to the root, or null when it lies outside it. */
function insideRoot(root, target) {
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative))
    return null;
  return relative;
}

/** The path with every symbolic link resolved, as far as it can be resolved. */
function realPath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    // The file may not exist yet, in which case an existing ancestor still
    // resolves and the segments below it need no resolving.
    const parent = path.dirname(target);
    if (parent === target) return target;
    return path.join(realPath(parent), path.basename(target));
  }
}

/**
 * True when the harness reported the call as failed. Conservative on purpose:
 * only an explicit failure counts, because a response shape this has never
 * seen must not silently drop a write from the record.
 */
function callFailed(response) {
  if (!response || typeof response !== "object") return false;
  if (response.success === false) return true;
  return typeof response.error === "string" && response.error !== "";
}

io.run(() => {
  const payload = io.readPayload();

  // No agent id means the main session, which this record does not cover.
  if (!payload.agent_id) return;
  if (!TRACED_TOOLS.includes(payload.tool_name || "")) return;

  // A write that failed changed nothing, and recording it would charge the
  // worker for a file it never touched.
  if (callFailed(payload.tool_response)) return;

  const target = (payload.tool_input || {}).file_path;
  if (typeof target !== "string" || target === "") return;

  const workingDirectory = payload.cwd || process.cwd();
  const absolute = path.resolve(workingDirectory, target);
  record.appendPath(
    payload.session_id,
    payload.agent_id,
    repositoryRelative(absolute, workingDirectory),
  );
});
