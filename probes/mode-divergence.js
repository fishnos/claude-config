"use strict";

// Do two modes actually produce different work on the same task?
//
// The whole system assumes they do. The measured evidence says rule *position*
// moves adherence; it says nothing about whether these particular ten postures
// diverge. If spike and ship -- the two extremes -- come out the same, the modes
// are decoration over a working renderer.
//
// The observable chosen is whether tests come back with the code. `ship` sets
// code: polished, which makes all four code rules primary, including "logic
// ships with its tests". `spike` sets code: rough, which makes none of them
// primary. If the corpus does anything, it should show up here.

const fs = require("fs");
const path = require("path");

const rules = require("../tools/modes/rules.js");
const render = require("../tools/modes/render.js");
const modes = require("../tools/modes/modes.js");
const settings = require("../tools/modes/settings.js");

/**
 * A mode's primary band with the standing band removed.
 *
 * The design keeps every rule and only reorders, on the argument that a mode
 * therefore cannot silently disable a guardrail. That argument is only worth
 * anything if the standing band is doing something. These arms are how that gets
 * measured: if dropped output is indistinguishable from ordered output, the
 * standing rules are inert and "nothing is dropped" is a property of the file
 * rather than of the behaviour.
 */
function renderPrimaryOnly(configDir, name) {
  const corpus = rules.loadCorpus(path.join(configDir, "modes", "rules")).rules;
  const mode = modes.parseMode(
    JSON.parse(
      fs.readFileSync(path.join(configDir, "modes", `${name}.json`), "utf8"),
    ),
    `${name}.json`,
  );
  const banded = render.band(corpus, { ...settings.DEFAULTS, ...mode.settings });
  return render.renderActive(banded.primary, { ...settings.DEFAULTS, ...mode.settings }, name);
}

function renderMode(configDir, name) {
  const corpus = rules.loadCorpus(path.join(configDir, "modes", "rules")).rules;
  const mode = modes.parseMode(
    JSON.parse(
      fs.readFileSync(path.join(configDir, "modes", `${name}.json`), "utf8"),
    ),
    `${name}.json`,
  );
  return render.renderActive(
    corpus,
    { ...settings.DEFAULTS, ...mode.settings },
    name,
  );
}

const CONFIG_DIR =
  process.env.CLAUDE_CONFIG_DIR ||
  path.join(require("os").homedir(), ".claude");

const TASKS = [
  {
    id: "slugify",
    prompt:
      "Write a JavaScript function that turns a title string into a URL slug: " +
      "lowercase, spaces to hyphens, punctuation stripped, no leading or " +
      "trailing hyphen.",
  },
  {
    id: "retry",
    prompt:
      "Write a JavaScript function that retries an async operation up to three " +
      "times with exponential backoff.",
  },
  {
    id: "parse-duration",
    prompt:
      'Write a JavaScript function that parses a duration string like "2h30m" ' +
      "into milliseconds.",
  },
  {
    id: "chunk",
    prompt:
      "Write a JavaScript function that splits an array into chunks of at most " +
      "n elements.",
  },
];

// A violation here is the absence of a test, so the arm with more "violations"
// is the one that shipped bare code.
const TEST_MARKER =
  /\b(test|it|describe|assert|expect)\s*\(|\bfunction\s+test[A-Z_]|#\[test\]/;

module.exports = {
  name: "mode-divergence",
  kind: "model",
  question: "Do spike and ship produce measurably different work on the same task?",
  why: "The ten modes are assumed to differ. Nothing has measured whether they do. If the extremes tie, the postures are decoration.",

  control: "none",
  reps: 6,
  tasks: TASKS,

  get arms() {
    return {
      none: "",
      spike: renderMode(CONFIG_DIR, "spike"),
      ship: renderMode(CONFIG_DIR, "ship"),
      "spike-only": renderPrimaryOnly(CONFIG_DIR, "spike"),
      "ship-only": renderPrimaryOnly(CONFIG_DIR, "ship"),
    };
  },

  fixtures: {
    clean:
      "function slugify(title) { return title; }\n" +
      "test('lowercases the title', () => { expect(slugify('A B')).toBe('a-b'); });",
    violating: "function slugify(title) { return title.toLowerCase(); }",
  },

  grade: (output) => ({
    violations: TEST_MARKER.test(output) ? [] : ["no test shipped"],
  }),
};
