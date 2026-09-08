"use strict";

// UserPromptSubmit: put the new mode's rules in front of the model at the moment
// the mode changes, and at no other time.
//
// Two measurements decided this shape, and they point opposite ways.
//
// Re-stating the same rule every turn buys nothing: buried behind ~6,600 tokens
// of history a naming rule was followed 0 times in 36, and re-stating it at the
// freshest position was also 0 in 36. So a hook that repeats the active rules on
// every message is token cost with no benefit.
//
// Injecting a rule that *contradicts* what came before works completely: in 12
// of 12 cells a register rule delivered on the user's message overrode the
// opposite rule sitting in the system prompt above the same burial. The
// difference is new information, not freshness.
//
// The hook therefore stays silent while the mode holds, and sends the full
// rules the moment the mode changes. A session that starts with a mode already
// applied needs nothing either, because the harness loads the generated rules
// file from rules/ at startup, and injecting the same text again would only
// say it twice.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");

const EVENT = "UserPromptSubmit";

// A cap, not a budget. An oversized render means the corpus grew wrong, and
// truncating keeps that from flooding the context while still being visible.
const MAX_INJECTED = 8000;

/** Where this session's last-seen mode is remembered. */
function markerFile(sessionId) {
  const directory = path.join(io.configDir(), "cache", "mode-inject");
  try {
    fs.mkdirSync(directory, { recursive: true });
  } catch {
    return null;
  }
  return path.join(directory, String(sessionId || "unknown"));
}

function readLock() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(io.configDir(), "mode.lock"), "utf8"),
    );
  } catch {
    return null;
  }
}

function readActiveRules() {
  try {
    return fs.readFileSync(
      path.join(io.configDir(), "rules", "_active.md"),
      "utf8",
    );
  } catch {
    return null;
  }
}

io.run(() => {
  const payload = io.readPayload();
  const lock = readLock();
  if (lock === null) return;

  const marker = markerFile(payload.session_id);
  if (marker === null) return;

  // Identity is the mode plus when it was applied, so switching away and back
  // still counts as a change worth announcing.
  const current = `${lock.mode}@${lock.appliedAt || ""}`;
  let seen = null;
  try {
    seen = fs.readFileSync(marker, "utf8");
  } catch {
    seen = null;
  }

  try {
    fs.writeFileSync(marker, current);
  } catch {
    return;
  }

  // First message of a session: record and stay quiet. The rules file was
  // already loaded from rules/ at startup.
  if (seen === null) return;
  if (seen === current) return;

  const rendered = readActiveRules();
  if (rendered === null) return;

  const body =
    rendered.length > MAX_INJECTED
      ? rendered.slice(0, MAX_INJECTED) + "\n\n[rules truncated]"
      : rendered;

  io.warn(
    EVENT,
    `The active mode changed to ${lock.mode}. These rules are now in force ` +
      `and replace any earlier posture in this conversation.\n\n${body}`,
  );
});
