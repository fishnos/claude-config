"use strict";

// PostToolUse(Bash): record what was actually executed, as ground truth.
//
// The failure this exists to prevent: an unmeasured claim gets stated, repeated,
// summarised into a compaction, and read back afterwards as established fact --
// carrying the asserter's framing rather than any evidence. A prose summary
// cannot be audited. A list of commands that really ran can be.
//
// It stores no command output. A log of everything printed would eventually hold
// whatever a command printed, credentials included; the provenance question
// ("is there a command behind this claim?") does not need the bytes to answer.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");

const MAX_LOG_BYTES = 512 * 1024;
const MAX_COMMAND_LENGTH = 400;

function logFile(sessionId) {
  return path.join(io.evidenceDir(), `${sessionId || "unknown"}.jsonl`);
}

/**
 * Exit status, if the harness reports one.
 *
 * Observed shape as of 2026-08: {stdout, stderr, interrupted, isImage,
 * noOutputExpected} -- no exit code in it, so this returns null on the harness
 * this config runs on. The spellings are kept because the shape is undocumented
 * and has changed before; a reader should know the null is the harness's doing,
 * not a bug here. Anything consuming this must render null as "unknown", never
 * as success.
 */
function exitStatus(response) {
  if (!response || typeof response !== "object") return null;
  for (const key of ["exit_code", "exitCode", "code", "status", "returnCode"]) {
    if (typeof response[key] === "number") return response[key];
  }
  return null;
}

function outputLength(response) {
  if (typeof response === "string") return response.length;
  if (!response || typeof response !== "object") return null;
  let total = 0;
  let found = false;
  for (const key of ["stdout", "stderr", "output", "content"]) {
    if (typeof response[key] === "string") {
      total += response[key].length;
      found = true;
    }
  }
  return found ? total : null;
}

function appendEntry(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  // Bounded by size rather than entry count: this runs after every command, so
  // reading the file back to count lines would cost O(n) per command and O(n^2)
  // over a session. stat is constant-time and the cap only needs to be roughly
  // right -- it exists to stop unbounded growth, not to hit an exact number.
  try {
    if (fs.statSync(file).size >= MAX_LOG_BYTES) return;
  } catch {
    // No file yet, which is the normal first-command case.
  }

  fs.appendFileSync(file, JSON.stringify(entry) + "\n");
}

io.run(() => {
  const payload = io.readPayload();
  if (payload.tool_name !== "Bash") return;

  const command = (payload.tool_input && payload.tool_input.command) || "";
  if (!command) return;

  const response = payload.tool_response;
  appendEntry(logFile(payload.session_id), {
    command: command.slice(0, MAX_COMMAND_LENGTH),
    truncated: command.length > MAX_COMMAND_LENGTH,
    exit: exitStatus(response),
    // The one failure signal this harness does report.
    interrupted: Boolean(response && response.interrupted),
    outputLength: outputLength(response),
    // Recorded so the first real invocation reveals the response shape instead
    // of leaving it guessed at. Cheap, and it makes the guesses above testable.
    responseKeys:
      response && typeof response === "object"
        ? Object.keys(response).slice(0, 12)
        : typeof response,
    cwd: payload.cwd || null,
  });
});
