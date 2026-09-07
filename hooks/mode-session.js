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
// mid-session and the rules re-order immediately while the skill list does
// not: the banner says NETRUNNER, the status line says NETRUNNER, and forty
// skills the mode meant to hide are still sitting in the listing. Nothing
// about the session looks wrong. Recording the fingerprint here is what makes
// it visible, under the name CORRUPTED.
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

/** The hard state of a session running under no mode at all. */
function baselineHash() {
  try {
    const glitch = require(
      path.join(__dirname, "..", "tools", "modes", "glitch.js"),
    );
    const settings = JSON.parse(
      fs.readFileSync(path.join(io.configDir(), "settings.json"), "utf8"),
    );
    return glitch.hardHash(glitch.parseGlitch(undefined, "none"), {
      model: settings.model,
      effortLevel: settings.effortLevel,
    });
  } catch {
    // Without a baseline the session cannot tell a half-applied mode from a
    // whole one. Recording nothing is the honest answer; `ccfg mode` reports
    // that as "unknown" rather than guessing either way.
    return null;
  }
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
    //
    // A session with no mode applied is not a session with no hard state: it
    // runs with a model, an effort level and every skill visible. Recording
    // that as null made the first switch of any session compare a real
    // fingerprint against nothing and always report CORRUPTED, which taught
    // the operator to ignore the one warning that matters.
    hardHash: lock === null ? baselineHash() : lock.hardHash || null,
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
    gated > 0 ? `${gated} tool${gated === 1 ? "" : "s"} gated` : null,
    hidden > 0 ? `${hidden} skill${hidden === 1 ? "" : "s"} hidden` : null,
    lock.subagents === "none" ? "no subagents" : null,
    (lock.installedCommands || []).length > 0
      ? `carries ${lock.installedCommands.map((name) => `/${name}`).join(" ")}`
      : null,
  ].filter(Boolean);

  // The operator's half: one line, the glyph first, and only what this mode
  // took away. Written as a system message rather than context because context
  // is delivered to the model and shown to nobody, which made a session that
  // had loaded its mode correctly look like one where nothing had happened.
  const icon = lock.icon || "■";
  const visible =
    `${icon} ${label}` + (detail.length > 0 ? `  ${detail.join(" · ")}` : "");

  io.announce(
    EVENT,
    `Mode ${label} is in force for this session` +
      (detail.length > 0 ? ` (${detail.join(", ")})` : "") +
      `. Switching modes now changes the rules immediately, but the skill ` +
      `list, model and effort are fixed until the next session; ` +
      `\`ccfg mode\` reports that state as CORRUPTED.`,
    visible,
  );
});
