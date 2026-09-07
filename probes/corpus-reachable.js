"use strict";

// Can every rule lead in at least one mode?
//
// A rule nobody can reach is dead weight that reads as a live guardrail. This
// caught a real defect: with the asking dial ordered the wrong way round, three
// restraint rules were unreachable in all ten modes.

const fs = require("fs");
const path = require("path");

const rules = require("../tools/modes/rules.js");
const render = require("../tools/modes/render.js");
const modes = require("../tools/modes/modes.js");
const settings = require("../tools/modes/settings.js");

module.exports = {
  name: "corpus-reachable",
  kind: "oracle",
  question: "Does every corpus rule become primary in at least one mode?",
  why: "An unreachable rule looks like a guardrail and never fires. Three were unreachable when the asking dial was ordered backwards.",

  async run({ configDir }) {
    const corpus = rules.loadCorpus(path.join(configDir, "modes", "rules"));
    const modeDirectory = path.join(configDir, "modes");
    const loaded = fs
      .readdirSync(modeDirectory)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) =>
        modes.parseMode(
          JSON.parse(fs.readFileSync(path.join(modeDirectory, entry), "utf8")),
          entry,
        ),
      )
      .filter((mode) => mode.error === undefined);

    const unreachable = corpus.rules.filter(
      (rule) =>
        !loaded.some((mode) =>
          render
            .band([rule], { ...settings.DEFAULTS, ...mode.settings })
            .primary.includes(rule),
        ),
    );

    return {
      pass: unreachable.length === 0,
      answer: `${corpus.rules.length - unreachable.length}/${corpus.rules.length} rules reachable across ${loaded.length} modes`,
      evidence:
        unreachable.length === 0
          ? "every rule leads somewhere"
          : `unreachable: ${unreachable.map((rule) => rule.id).join(", ")}`,
    };
  },
};
