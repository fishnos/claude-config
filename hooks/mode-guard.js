"use strict";

// PreToolUse: refuse the tools the active mode does not carry.
//
// This is the half of a glitched mode that works inside a running session. The
// skill list and the model are read once at startup and frozen, but this hook
// re-reads mode.lock on every tool call, so switching to a read-only posture
// takes hold on the very next action.
//
// Measured before it was written: with a gate like this in force, the model
// was refused a Write, did not create the file, and explicitly declined to
// route around the refusal with a shell command, saying "that would have
// defeated a guard that was deliberately put in place". A denial reads as a
// boundary here rather than a suggestion, and a boundary is what makes gating
// worth doing at all.
//
// The reason text matters as much as the refusal. It names the mode and says
// what to do instead, because a bare "denied" invites the model to try the same
// thing by another route, and that is worse than no gate.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");

const EVENT = "PreToolUse";

// Never gated, whatever a mode file asks for. A model that cannot read cannot
// discover it is in the wrong mode, and cannot report that to the operator.
// tools/modes/glitch.js refuses these at parse time; this is the backstop for a
// lock written by an older version or edited by hand.
const UNGATEABLE = ["Read", "Glob", "Grep", "TodoWrite"];

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
  const payload = io.readPayload();
  const tool = payload.tool_name || "";
  if (tool === "" || UNGATEABLE.includes(tool)) return;

  const lock = readLock();
  if (lock === null) return;

  const label = lock.codename || lock.mode || "this mode";

  if (lock.subagents === "none" && (tool === "Agent" || tool === "Task")) {
    io.deny(
      EVENT,
      `${label} runs alone: subagents are not available in this mode. ` +
        `Do the work in this session, or ask the operator to switch modes. ` +
        `Do not route around this by other means.`,
    );
  }

  const denied = Array.isArray(lock.deniedTools) ? lock.deniedTools : [];
  if (denied.includes(tool)) {
    io.deny(
      EVENT,
      `${label} does not carry ${tool}. ` +
        `Report what you would have done instead of doing it, or ask the ` +
        `operator to switch modes. Do not achieve the same effect through ` +
        `another tool. The gate is deliberate.`,
    );
  }
});
