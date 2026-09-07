"use strict";

// Probe descriptors: load them, and refuse the ones that cannot produce an
// answer.
//
// Validation is strict about the two fields a reader needs months later --
// `question` and `why`. A probe whose stakes nobody remembers is the first thing
// deleted when it gets slow, and the assumption it was guarding goes with it.

const fs = require("fs");
const path = require("path");

const KINDS = ["oracle", "live", "model"];

function validate(probe) {
  if (probe === null || typeof probe !== "object")
    return { error: "probe is not an object" };
  const name = typeof probe.name === "string" ? probe.name : "(unnamed)";
  if (typeof probe.name !== "string" || probe.name === "")
    return { error: "probe has no name" };
  if (!KINDS.includes(probe.kind))
    return { error: `${name}: unknown kind '${probe.kind}'` };
  if (typeof probe.question !== "string" || probe.question === "")
    return { error: `${name}: no question` };
  if (typeof probe.why !== "string" || probe.why === "")
    return { error: `${name}: no why` };

  if (probe.kind === "oracle" || probe.kind === "live") {
    if (typeof probe.run !== "function")
      return { error: `${name}: oracle and live probes need a run function` };
    return { probe };
  }

  if (typeof probe.grade !== "function")
    return { error: `${name}: model probes need a grade function` };
  if (
    probe.fixtures === undefined ||
    typeof probe.fixtures.clean !== "string" ||
    typeof probe.fixtures.violating !== "string"
  )
    return {
      error: `${name}: model probes need fixtures.clean and fixtures.violating`,
    };
  if (probe.arms === undefined || Object.keys(probe.arms).length < 2)
    return { error: `${name}: model probes need at least two arms` };
  if (!Array.isArray(probe.tasks) || probe.tasks.length === 0)
    return { error: `${name}: model probes need at least one task` };

  return { probe };
}

function loadAll(directory) {
  const loaded = [];
  const errors = [];

  let entries;
  try {
    entries = fs.readdirSync(directory).sort();
  } catch {
    return { probes: loaded, errors };
  }

  for (const entry of entries) {
    if (!entry.endsWith(".js")) continue;
    const file = path.join(directory, entry);
    let descriptor;
    try {
      descriptor = require(file);
    } catch (error) {
      errors.push(`${entry}: ${error.message}`);
      continue;
    }
    const checked = validate(descriptor);
    if (checked.error !== undefined) {
      errors.push(checked.error);
      continue;
    }
    loaded.push({ ...checked.probe, file });
  }

  return { probes: loaded, errors };
}

module.exports = { KINDS, validate, loadAll };
