"use strict";

// The seven questions a mode answers, and the answers each one allows.
//
// Six of the seven are ordered, least to most, because a rule declares the point
// at which it becomes primary rather than a set of modes it belongs to. Ordering
// is what lets a new rule slot in without editing ten mode files. The seventh,
// `voice`, is a set of registers with no ladder between them, and says so.
//
// The words are the interface. No numeric levels: "prove-it" says what it means
// at a glance and "3" does not.

const SETTINGS = {
  verify: {
    question: "How much proof before I say it works?",
    values: ["none", "run-it", "prove-it"],
  },
  claims: {
    question: "How do I label what I claim?",
    values: ["loose", "labeled", "sourced"],
  },
  process: {
    question: "How many gates before code?",
    values: ["skip", "light", "full"],
  },
  // Ordered like every other setting: least of the thing, then most. The thing
  // being scaled is how much the operator is consulted, so "just-go" is the low
  // end and "ask-first" the high end. Ordered the other way round, the most
  // careful mode would sit at the bottom of the scale and the restraint rules
  // would be unreachable in exactly the mode that wants them.
  autonomy: {
    question: "How much do I check in before acting?",
    values: ["just-go", "check-in", "ask-first"],
  },
  code: {
    question: "How good does the code have to be?",
    values: ["rough", "decent", "polished"],
  },
  subagents: {
    question: "How many subagents?",
    values: ["none", "few", "many"],
  },
  // Categorical, not ordinal: three registers, no ladder. A rule belonging to
  // one register declares `only_at` rather than `primary_at`, because "normal or
  // more" is not a thing a register can mean.
  voice: {
    question: "How do I talk?",
    values: ["caveman", "normal", "prose"],
    categorical: true,
  },
};

// The posture in force when no mode is loaded. Deliberately the middle of every
// dial: a config with no mode selected should behave like the config did before
// modes existed, not like the most permissive mode.
const DEFAULTS = {
  verify: "run-it",
  claims: "labeled",
  process: "light",
  autonomy: "check-in",
  code: "decent",
  subagents: "few",
  voice: "caveman",
};

function isCategorical(setting) {
  return SETTINGS[setting] !== undefined && SETTINGS[setting].categorical === true;
}

function isValid(setting, value) {
  const known = SETTINGS[setting];
  return known !== undefined && known.values.includes(value);
}

/**
 * True when `actual` sits at or past `threshold` on the setting's own scale.
 *
 * Returns false for anything unrecognised rather than throwing: a malformed
 * rule should fail to reach the primary band, never take down the renderer and
 * leave the model with no rules at all.
 */
function atOrAbove(setting, actual, threshold) {
  if (!isValid(setting, actual) || !isValid(setting, threshold)) return false;
  const scale = SETTINGS[setting].values;
  return scale.indexOf(actual) >= scale.indexOf(threshold);
}

module.exports = { SETTINGS, DEFAULTS, isValid, isCategorical, atOrAbove };
