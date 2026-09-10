"use strict";

// PreCompact: write down what the summarizer is known to lose, so the pair
// hook can put it back.
//
// Compaction rewrites the transcript into a summary. Measured across seven
// model families, standing constraints survive that step about 17% of the
// time, and prohibited actions rise from 0% to 30% once they are gone
// (arXiv 2606.22528, 2608.11242). Nothing here tries to improve the summary.
// It copies the load-bearing lines out of the lossy path entirely.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");
const { cachePath } = require("./lib/session-cache");

// A cap, not a budget. An oversized handoff means something upstream is
// growing wrong, and truncating keeps that from flooding the restored context
// while leaving the overflow visible in the file itself.
const MAX_SECTION = 4000;

/** The active posture, read from the same lock the mode guard reads. */
function readMode() {
  try {
    const lock = JSON.parse(
      fs.readFileSync(path.join(io.configDir(), "mode.lock"), "utf8"),
    );
    const dials = lock.settings
      ? Object.entries(lock.settings)
          // A dial's value is a string or number in every case this file has
          // ever seen; a nested object has no readable one-line form, so it is
          // dropped rather than rendered as "[object Object]".
          .filter(([, value]) => value === null || typeof value !== "object")
          .map(([name, value]) => `${name}: ${value}`)
          .join(", ")
      : "";
    return [lock.mode, lock.codename, dials].filter(Boolean).join(" / ");
  } catch {
    return "";
  }
}

/** Constraints recorded during the session, copied verbatim (constraint-capture.js fills this). */
function readConstraints(sessionIdentifier) {
  try {
    const file = cachePath("constraints", sessionIdentifier);
    return fs.readFileSync(file, "utf8").slice(0, MAX_SECTION);
  } catch {
    return "";
  }
}

function render(payload) {
  const mode = readMode();
  const constraints = readConstraints(payload.session_id);
  return [
    "# Handoff across compaction",
    "",
    `Written at ${new Date().toISOString()} (trigger: ${payload.trigger || "unknown"}).`,
    "",
    "## Mode",
    "",
    mode || "No mode.lock could be read.",
    "",
    "## Possible standing constraints, captured by keyword",
    "",
    constraints.trim() ||
      "None captured this session: no prompt matched the keyword list.",
    "",
    "## Decisions",
    "",
    "Not populated. PreCompact receives transcript_path, which is what would " +
      "populate this from what was settled and what was ruled out; nothing " +
      "reads it yet.",
    "",
    "## Open threads",
    "",
    "Not populated. PreCompact receives transcript_path, which is what would " +
      "populate this from what was in progress when this fired; nothing reads " +
      "it yet.",
    "",
  ].join("\n");
}

io.run(() => {
  const payload = io.readPayload();
  const file = cachePath("handoff", payload.session_id, { create: true });
  fs.writeFileSync(file, render(payload), "utf8");
});
