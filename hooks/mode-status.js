"use strict";

// statusLine: keep the active mode visible at all times.
//
// A posture you cannot see is the failure this whole design is trying to avoid.
// The expensive mistake is not switching to the wrong mode -- it is working for
// an hour inside a mode you forgot you set, which looks exactly like the model
// behaving strangely. One line, always on screen, costs nothing and removes the
// entire class.
//
// The line carries the glyph, the name, and nothing else. Everything a mode
// does is already one keystroke away in `/mode`, and a status line that lists
// the dials gets skimmed past -- which defeats the only job it has. The glyph
// comes first because a shape is recognised before a word is read.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");

function readLock() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(io.configDir(), "mode.lock"), "utf8"),
    );
  } catch {
    return null;
  }
}

/** Whether the mode on disk is only half in force in this session. */
function corruptionMark() {
  try {
    // Resolved from this file, not from the config directory: the hook always
    // lives beside the tools it needs, and a config dir pointed elsewhere would
    // otherwise silently drop the mark.
    const { integrity } = require(
      path.join(__dirname, "..", "tools", "modes", "command.js"),
    );
    const state = integrity(io.configDir(), process.env.CLAUDE_SESSION_ID).state;
    return state === "corrupted" ? " ~CORRUPTED" : "";
  } catch {
    // A status line that throws leaves the operator with no indicator at all,
    // which is worse than one missing its corruption mark.
    return "";
  }
}

io.run(() => {
  const lock = readLock();
  if (lock === null) {
    process.stdout.write("no mode");
    return;
  }
  const icon = lock.icon || "■";
  const label = lock.codename || lock.mode;
  process.stdout.write(`${icon} ${label}${corruptionMark()}`);
});
