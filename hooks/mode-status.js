"use strict";

// statusLine: keep the active mode visible at all times.
//
// The expensive mistake is working for an hour inside a mode you forgot you
// set, which looks from the inside like the model behaving strangely rather
// than like a posture you chose. One line, always on screen, costs nothing
// and rules that out.
//
// The line carries the glyph, the name, and nothing else. Everything a mode
// does is already one keystroke away in `/mode`, and a status line long
// enough to list the dials stops being read at all. The glyph comes first
// because a reader recognises a shape faster than a word.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");

// Resolved from this file so the status line paints the same hue as the switch
// banner and the rack. A status line always writes to a pipe, never a
// terminal, so the usual "is this a TTY?" test would strip the colour every
// time. NO_COLOR is the only thing that turns it off here.
const ink = require(path.join(__dirname, "..", "tools", "modes", "ink.js"));

function readLock() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(io.configDir(), "mode.lock"), "utf8"),
    );
  } catch {
    return null;
  }
}

/**
 * The glyph and hue to draw the line in: from the mode file where it can be
 * read, from the lock where it cannot.
 *
 * A status line that throws leaves the operator with no indicator at all, which
 * is worse than one drawn from a slightly stale cache, so every failure here
 * falls back rather than propagating.
 */
function modeLook(lock) {
  try {
    const { activeLook } = require(
      path.join(__dirname, "..", "tools", "modes", "command.js"),
    );
    return activeLook(io.configDir(), lock);
  } catch {
    return { icon: lock.icon, color: lock.color };
  }
}

/** Whether the mode on disk is only half in force in THIS session. */
function corruptionMark(sessionId) {
  try {
    // Resolved from this file, not from the config directory: the hook always
    // lives beside the tools it needs, and a config dir pointed elsewhere would
    // otherwise silently drop the mark.
    const { integrity } = require(
      path.join(__dirname, "..", "tools", "modes", "command.js"),
    );
    const state = integrity(io.configDir(), sessionId).state;
    return state === "corrupted" ? " ~CORRUPTED" : "";
  } catch {
    // A status line that throws leaves the operator with no indicator at all,
    // which is worse than one missing its corruption mark.
    return "";
  }
}

io.run(() => {
  // Claude Code names the session on stdin. Reading the environment instead
  // found nothing, because CLAUDE_SESSION_ID is not set for a status line, and
  // an unnamed session fell through to whichever chat had started most
  // recently, so one chat drew the other's verdict.
  const payload = io.readPayload();
  const sessionId = payload.session_id || process.env.CLAUDE_SESSION_ID || "";

  const lock = readLock();
  if (lock === null) {
    process.stdout.write("no mode");
    return;
  }
  const look = modeLook(lock);
  const paint = ink.painter(Boolean(process.env.NO_COLOR), look.color);
  const icon = look.icon || "■";
  const label = lock.codename || lock.mode;
  const mark = corruptionMark(sessionId);
  process.stdout.write(
    paint.accent(`${icon} ${label}`) + (mark === "" ? "" : paint.yellow(mark)),
  );
});
