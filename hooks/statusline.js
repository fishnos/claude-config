"use strict";

// The status line: the active mode, then whatever the operator already had.
//
// Claude Code allows exactly one statusLine command, and this configuration
// already ran ccstatusline. Replacing it to show the mode would have traded one
// piece of information for another, so this composes instead: the mode segment
// is rendered here, the existing line is run underneath, and the two are joined.
//
// The mode goes first because it is the thing that changes what the model will
// do next. Everything else on the line describes the session; this describes the
// posture, and a posture you cannot see is the failure the mode system exists
// to prevent.
//
// Failure is always silent and always falls back to the wrapped line. A status
// line that errors leaves the operator with no indicator at all, which is worse
// than one missing its mode segment.

const { spawnSync } = require("child_process");
const path = require("path");

// The line this wraps. Kept here rather than in settings.json so that the
// composition is visible in one place, and so removing the mode system is a
// single edit to settings.json rather than an archaeology exercise.
const WRAPPED = ["npx", ["-y", "ccstatusline@2.2.27"]];

function readStdin() {
  try {
    return require("fs").readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function modeSegment(payload) {
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, "mode-status.js")],
      { input: payload, encoding: "utf8", timeout: 3000 },
    );
    const text = (result.stdout || "").trim();
    // "no mode" is the resting state and would be noise on every line.
    return text === "" || text === "no mode" ? "" : text;
  } catch {
    return "";
  }
}

function wrappedSegment(payload) {
  try {
    const result = spawnSync(WRAPPED[0], WRAPPED[1], {
      input: payload,
      encoding: "utf8",
      timeout: 8000,
    });
    return (result.stdout || "").replace(/\n+$/, "");
  } catch {
    return "";
  }
}

const payload = readStdin();
const parts = [modeSegment(payload), wrappedSegment(payload)].filter(
  (piece) => piece !== "",
);
process.stdout.write(parts.join("  "));
