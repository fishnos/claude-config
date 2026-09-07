"use strict";

// SessionStart: record which posture this session actually loaded, and say so.
//
// Claude Code reads its configuration once and freezes it. So the skills, model
// and effort a session runs under are decided at this instant and cannot be
// changed again from inside it. This hook writes down the fingerprint of what
// was loaded, which is what later lets `ccfg mode` tell the difference between
// a mode that is fully in force and one that is only half applied.
//
// That half-applied state is the failure this exists to prevent. Switch modes
// mid-session and the rules re-order immediately while the skill list does not
// -- the banner says NETRUNNER, the status line says NETRUNNER, and forty
// skills the mode meant to hide are still sitting in the listing. Nothing about
// the session looks wrong. Recording the fingerprint here is what makes it
// visible, under the name CORRUPTED.
//
// The session is "finalised" the moment this runs: whatever is on disk now is
// what this session has, for its whole life.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");

const EVENT = "SessionStart";

function sessionFile(sessionId) {
  const directory = path.join(io.configDir(), "cache", "mode-session");
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

io.run(() => {
  const payload = io.readPayload();
  const lock = readLock();

  const loaded = {
    // The fingerprint of the frozen half, as it stood when this session began.
    hardHash: lock === null ? null : lock.hardHash || null,
    mode: lock === null ? null : lock.mode,
    startedAt: new Date().toISOString(),
  };

  const marker = sessionFile(payload.session_id);
  if (marker !== null) {
    try {
      fs.writeFileSync(marker, JSON.stringify(loaded));
    } catch {
      // A session that cannot record its own posture still runs; it just cannot
      // detect corruption later. Not worth blocking a session over.
    }
  }

  if (lock === null) return;

  const label = lock.codename || lock.mode;
  const gated = Array.isArray(lock.deniedTools) ? lock.deniedTools.length : 0;
  const hidden = typeof lock.skillsHidden === "number" ? lock.skillsHidden : 0;

  const detail = [
    gated > 0 ? `${gated} tools gated` : null,
    hidden > 0 ? `${hidden} skills hidden` : null,
    lock.subagents === "none" ? "no subagents" : null,
  ].filter(Boolean);

  io.warn(
    EVENT,
    `Mode ${label} is in force for this session` +
      (detail.length > 0 ? ` (${detail.join(", ")})` : "") +
      `. Switching modes now changes the rules immediately, but the skill ` +
      `list, model and effort are fixed until the next session -- ` +
      `\`ccfg mode\` reports that state as CORRUPTED.`,
  );
});
