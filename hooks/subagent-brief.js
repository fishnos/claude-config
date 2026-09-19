"use strict";

// SubagentStart: give a worker the rules the mode makes primary right now.
//
// A worker's agent file in agents/ is written when a mode is applied, so a
// worker dispatched after a later switch would read the posture that was in
// force at render time. This hook renders the same band at spawn instead, from
// the corpus and the lock as they stand, which is the one thing a generated
// file cannot carry.
//
// It sends the rules and nothing else. The contract (the run token, the finish
// block, the scope line) is already stapled onto the dispatch prompt by
// hooks/agent-dispatch.js, and that is the only place it can be: the token is
// minted per dispatch and this event never sees it. Saying the rest of the
// contract a second time would spend a worker's attention on text it already
// has, against the same measurement that caps the band at five rules.
//
// Built-in agent types (Explore, general-purpose, code-simplifier) cannot be
// given an agent file at all, so for them this injection is the only rule text
// they ever see. They are briefed here regardless of type, by the operator's
// decision of 2026-09-15.

// The three modules below come from this repository, beside the hook; the rules
// and the lock they act on come from whichever directory CLAUDE_CONFIG_DIR
// names. Keeping code and data on separate roots is what lets a test point the
// hook at a throwaway corpus without a copy of the tooling in it.
const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");
const rules = require("../tools/modes/rules.js");
const render = require("../tools/modes/render.js");
const crew = require("../tools/modes/crew.js");

const EVENT = "SubagentStart";

// A cap, not a budget, and the same 8000 as hooks/mode-inject.js for the same
// reason: an oversized render means the corpus grew wrong, and truncating keeps
// that from flooding a worker's context while leaving the fault visible.
const MAX_INJECTED = 8000;
const TRUNCATED = "\n\n[rules truncated]";

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

  // No mode applied means no posture to brief from, and the corpus alone cannot
  // say which rules lead. Staying silent matches hooks/mode-inject.js.
  const lock = readLock();
  if (lock === null) return;

  const corpus = rules.loadCorpus(path.join(io.configDir(), "modes", "rules"));
  const resolvedSettings = lock.settings || {};
  const band = crew.briefBand(
    render.band(corpus.rules, resolvedSettings).primary,
  );
  // An empty band injects nothing rather than a heading with no rules under it,
  // which would read to a worker as a posture that asks for nothing.
  if (band.trim().length === 0) return;

  const modeName = lock.codename || lock.mode || "unnamed";
  const posture = Object.entries(resolvedSettings)
    .map(([setting, value]) => `${setting}: ${value}`)
    .join(", ");
  const runningAs = payload.agent_type
    ? `as ${payload.agent_type}`
    : "as a worker";

  const text =
    `You are running ${runningAs} under mode ${modeName} (${posture}). These ` +
    `rules are in force for this run and replace any contrary habit.\n\n${band}`;

  io.warn(
    EVENT,
    text.length > MAX_INJECTED
      ? text.slice(0, MAX_INJECTED - TRUNCATED.length) + TRUNCATED
      : text,
  );
});
