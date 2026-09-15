"use strict";

// The context-size zones, and the per-session record the gauge keeps for the
// clear gate.
//
// The three numbers are starting guesses from the 2026-09-11 transcript
// measurement; the depth run of the state-carryover probe sets them.

const fs = require("fs");
const path = require("path");

const { sanitizeSessionIdentifier } = require("./session-cache");

const AMBER_TOKENS = 120000;
const RED_TOKENS = 200000;
const STALE_TURNS = 8;

function zoneOf(tokens) {
  if (tokens >= RED_TOKENS) return "red";
  if (tokens >= AMBER_TOKENS) return "amber";
  return "green";
}

function gaugeStatePath(configDir, sessionIdentifier) {
  return path.join(
    configDir,
    "cache",
    "context-gauge",
    `${sanitizeSessionIdentifier(sessionIdentifier)}.json`,
  );
}

function readGaugeState(configDir, sessionIdentifier) {
  try {
    return JSON.parse(
      fs.readFileSync(gaugeStatePath(configDir, sessionIdentifier), "utf8"),
    );
  } catch {
    return null;
  }
}

/**
 * Write the record, reporting whether it landed.
 *
 * The clear gate needs the answer: a hold it could not record would be made
 * again on the next stop, so it holds only when the write succeeded.
 */
function writeGaugeState(configDir, sessionIdentifier, record) {
  const file = gaugeStatePath(configDir, sessionIdentifier);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(record)}\n`);
    return true;
  } catch {
    // A lost record costs one missed staleness line and lets one clear
    // suggestion through ungated; neither is worth failing a prompt over.
    return false;
  }
}

module.exports = {
  AMBER_TOKENS,
  RED_TOKENS,
  STALE_TURNS,
  zoneOf,
  readGaugeState,
  writeGaugeState,
};
