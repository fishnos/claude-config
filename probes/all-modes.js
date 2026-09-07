"use strict";

// Every mode, on the same tasks.
//
// Only the two extremes have been tested. If divergence tracks how far apart two
// postures are, one measurement generalises to all forty-five pairs; if it does
// not, each pair is its own claim and the ten modes are ten separate assertions
// with two of them checked.

const fs = require("fs");
const os = require("os");
const path = require("path");

const rules = require("../tools/modes/rules.js");
const render = require("../tools/modes/render.js");
const modes = require("../tools/modes/modes.js");
const settings = require("../tools/modes/settings.js");

const CONFIG_DIR =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

const MODE_NAMES = [
  "spike", "build", "ship", "paper", "research",
  "review", "debug", "design", "unattended", "pair",
];

function renderMode(name) {
  const corpus = rules.loadCorpus(path.join(CONFIG_DIR, "modes", "rules")).rules;
  const mode = modes.parseMode(
    JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "modes", `${name}.json`), "utf8")),
    `${name}.json`,
  );
  return render.renderActive(corpus, { ...settings.DEFAULTS, ...mode.settings }, name);
}

/** How many of the seven settings two modes answer differently. */
function settingDistance(left, right) {
  const load = (name) =>
    modes.parseMode(
      JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "modes", `${name}.json`), "utf8")),
      name,
    ).settings;
  const a = load(left);
  const b = load(right);
  return Object.keys(settings.SETTINGS).filter((key) => a[key] !== b[key]).length;
}

// Kept identical to mode-divergence so its spike and ship cells stay comparable.
const TASKS = [
  { id: "slugify", prompt: "Write a JavaScript function that turns a title string into a URL slug: lowercase, spaces to hyphens, punctuation stripped, no leading or trailing hyphen." },
  { id: "retry", prompt: "Write a JavaScript function that retries an async operation up to three times with exponential backoff." },
  { id: "parse-duration", prompt: 'Write a JavaScript function that parses a duration string like "2h30m" into milliseconds.' },
  { id: "chunk", prompt: "Write a JavaScript function that splits an array into chunks of at most n elements." },
];

const TEST_MARKER = /\b(test|it|describe|assert|expect)\s*\(|#\[test\]/;

module.exports = {
  name: "all-modes",
  kind: "model",
  question: "Do all ten modes produce distinguishable work, or only the extremes?",
  why: "Eight of the ten have never been measured. Ten modes is ten claims, and two of them are checked.",

  control: "spike",
  reps: 4,
  tasks: TASKS,

  get arms() {
    const built = {};
    for (const name of MODE_NAMES) built[name] = renderMode(name);
    return built;
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

  MODE_NAMES,
  settingDistance,
};
