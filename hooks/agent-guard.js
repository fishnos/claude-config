"use strict";

// PreToolUse(every tool): keep a worker out of the records that judge it.
//
// The finish gates compare what a worker claims against two files it never
// wrote: the evidence log (cache/evidence/, tool calls that really happened)
// and the run record (cache/crew/, what the dispatch asked for and what the
// worker touched). If a worker can write either one, both gates are theatre.
//
// A tool allowlist cannot deliver that on its own. The `implementer` role
// carries Bash and Write, so a redirect, a heredoc or a node one-liner reaches
// those directories however the allowlist is drawn. This hook keys on
// `agent_id` instead, which the 2026-09-15 spike measured arriving in a
// worker's PreToolUse payload and which the main session's payloads do not
// carry. The main session is therefore untouched: it still writes both files,
// because the logger and the dispatch hook run there.
//
// Reads stay open, deliberately. The survey's mechanism 4 keeps writes out and
// leaves reads in, because a worker that cannot read the record cannot be told
// what it was refused for.

const path = require("path");
const io = require("./lib/hook-io");
const record = require("./lib/crew-record");

const EVENT = "PreToolUse";

// Tools that cannot change a file. Everything else is treated as a write,
// including a tool this list has never heard of: a new file-touching tool
// should arrive denied and be added here on purpose, rather than arrive
// allowed and be noticed after it has written the record once.
const READ_ONLY_TOOLS = ["Read", "Grep", "Glob", "NotebookRead", "LS"];

/**
 * The shell half of the guard, and it is the weaker half. It matches the
 * command text rather than resolving what the shell would actually open, so
 * `cd cache && echo x > evidence/s1.jsonl` slips through it and a harmless
 * `grep -r cache/crew` is refused. It is still worth having: it costs one
 * string search and it closes the three routes a worker with Bash reaches for
 * first, which the allowlist cannot close at all. The file-path check is the
 * one to trust.
 */
const SHELL_FRAGMENTS = [
  path.join("cache", "evidence"),
  path.join("cache", "crew"),
];

/** Absolute directories no worker may write into. */
function protectedDirectories() {
  return [path.resolve(io.evidenceDir()), path.resolve(record.recordDir())];
}

/** Every file path a tool call names, however the tool spells it. */
function targetPaths(input) {
  const namedPaths = [input.file_path, input.notebook_path, input.path];
  for (const edit of Array.isArray(input.edits) ? input.edits : [])
    if (edit && typeof edit.file_path === "string")
      namedPaths.push(edit.file_path);
  return namedPaths.filter(
    (entry) => typeof entry === "string" && entry !== "",
  );
}

function insideDirectory(target, directory) {
  const relative = path.relative(directory, target);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

const DENIAL =
  "This call targets a record your work is judged against, and a worker may " +
  "not write one. The evidence log (cache/evidence/) is written by a hook from " +
  "tool calls that really ran, and the run record (cache/crew/) is written by " +
  "the dispatch and trace hooks. A claim checked against a file the claimant " +
  "wrote proves nothing, which is why this is refused rather than reviewed. " +
  "Reading either file is allowed: use Read if you need to see what was " +
  "recorded. Report what you did in your own report instead.";

io.run(() => {
  const payload = io.readPayload();

  // No agent id means the main session, which owns both records.
  if (!payload.agent_id) return;

  const toolName = payload.tool_name || "";
  if (READ_ONLY_TOOLS.includes(toolName)) return;

  const directories = protectedDirectories();
  const workingDirectory = payload.cwd || process.cwd();
  const input = payload.tool_input || {};

  for (const target of targetPaths(input)) {
    const absolute = path.resolve(workingDirectory, target);
    if (directories.some((directory) => insideDirectory(absolute, directory)))
      io.deny(EVENT, DENIAL);
  }

  if (toolName !== "Bash") return;
  const command = typeof input.command === "string" ? input.command : "";
  const commandFragments = [...directories, ...SHELL_FRAGMENTS];
  if (commandFragments.some((fragment) => command.includes(fragment)))
    io.deny(EVENT, DENIAL);
});
