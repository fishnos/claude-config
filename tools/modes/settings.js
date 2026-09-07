"use strict";

// The seven questions a mode answers, and the answers each one allows.
//
// Six of the seven are ordered, least to most, because a rule declares the point
// at which it becomes primary rather than a set of modes it belongs to. Ordering
// is what lets a new rule slot in without editing ten mode files. The seventh,
// `voice`, is a set of registers with no ladder between them, and says so.
//
// The words are the interface. No numeric levels: "proven" says what it means
// at a glance and "3" does not. Every value names a state the work is in
// rather than an order to follow. "tested" is true of what was done, where
// the "run-it" it replaced read as an instruction and said nothing about
// whether anyone had run anything.

const SETTINGS = {
  verify: {
    question: "how much proof before I say it works",
    values: ["none", "tested", "proven"],
  },
  claims: {
    question: "how I label what I claim",
    values: ["loose", "labeled", "sourced"],
  },
  process: {
    question: "how many gates before code",
    values: ["skip", "light", "full"],
  },
  // Named for the thing it scales, which is how often the operator is asked.
  //
  // It was called `autonomy` while the scale ran from least asking to most, so a
  // full gauge on a dial named for independence meant the least of it, and
  // `autonomy: ask-first` sat at the top. Reversing the scale instead would have
  // put the most careful mode at the bottom, where the restraint rules are
  // unreachable, so the dial was renamed to match the direction it already
  // ran in.
  asking: {
    question: "how often I stop and ask",
    values: ["never", "sometimes", "always"],
  },
  code: {
    question: "how good the code has to be",
    values: ["rough", "decent", "polished"],
  },
  subagents: {
    question: "how many subagents",
    values: ["none", "few", "many"],
  },
  // Categorical, not ordinal: three registers, no ladder. A rule belonging to
  // one register declares `only_at` rather than `primary_at`, because "normal or
  // more" is not a thing a register can mean.
  voice: {
    question: "how I talk",
    values: ["caveman", "normal", "prose"],
    categorical: true,
  },
};

// The posture in force when no mode is loaded. Deliberately the middle of every
// dial: a config with no mode selected should behave like the config did before
// modes existed, not like the most permissive mode.
const DEFAULTS = {
  verify: "tested",
  claims: "labeled",
  process: "light",
  asking: "sometimes",
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
