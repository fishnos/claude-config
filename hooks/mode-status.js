"use strict";

// statusLine: keep the active mode visible at all times.
//
// A posture you cannot see is the failure this whole design is trying to avoid.
// The expensive mistake is not switching to the wrong mode -- it is working for
// an hour inside a mode you forgot you set, which looks exactly like the model
// behaving strangely. One line, always on screen, costs nothing and removes the
// entire class.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");

// The three settings whose effect is most visible in a reply, so the line says
// something useful rather than merely naming the mode. Spelled out rather than
// abbreviated: this is read at a glance, and "prove-it" needs no decoding.
const SHOWN = ["verify", "autonomy", "voice"];

function readLock() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(io.configDir(), "mode.lock"), "utf8"),
    );
  } catch {
    return null;
  }
}

io.run(() => {
  const lock = readLock();
  if (lock === null) {
    process.stdout.write("no mode");
    return;
  }

  const posture = SHOWN.filter((name) => lock.settings && lock.settings[name])
    .map((name) => lock.settings[name])
    .join(" | ");

  const overridden = Object.keys(lock.adhoc || {}).length;

  // Only what changes a decision: how many tools are refused, how many skills
  // are hidden, and whether the mode is only half in force. A status line that
  // lists everything gets skimmed past, which defeats the point of having one.
  const marks = [
    (lock.deniedTools || []).length > 0
      ? `${lock.deniedTools.length} gated`
      : null,
    lock.skillsHidden > 0 ? `${lock.skillsHidden} hidden` : null,
    lock.subagents === "none" ? "solo" : null,
    overridden > 0 ? `+${overridden} adhoc` : null,
  ].filter(Boolean);

  let state = "";
  try {
    // Resolved from this file, not from the config directory: the hook always
    // lives beside the tools it needs, and a config dir pointed elsewhere
    // would otherwise silently drop the corruption flag.
    const { integrity } = require(
      path.join(__dirname, "..", "tools", "modes", "command.js"),
    );
    if (integrity(io.configDir(), process.env.CLAUDE_SESSION_ID).state === "corrupted")
      state = " ~CORRUPTED";
  } catch {
    // A status line that throws leaves the operator with no indicator at all,
    // which is worse than one missing its corruption flag.
  }

  const label = lock.codename || lock.mode;
  process.stdout.write(
    `\u2589 ${label}${state} \u2589 ${posture}` +
      (marks.length > 0 ? `  [${marks.join(" ")}]` : ""),
  );
});
