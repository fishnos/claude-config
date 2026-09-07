"use strict";

// How much of the corpus is currently stated twice?
//
// The corpus was first copied out of CLAUDE.md without removing the originals,
// so every rule existed in both places. That was inert while nothing injected;
// with the switch machinery live it would send each rule twice and, worse,
// dilute the ordering the whole design rests on -- a fixed-order second copy
// sitting beside the mode's deliberately ordered one.
//
// The originals were cut on 2026-09-07, so this now asserts rather than watches.

const fs = require("fs");
const path = require("path");

const rules = require("../tools/modes/rules.js");

module.exports = {
  name: "rule-duplication",
  kind: "oracle",
  question: "How many corpus rules are also still stated in CLAUDE.md?",
  why: "A rule stated in both places is sent twice per turn, and its second fixed-order copy dilutes the ordering the mode system depends on.",

  async run({ configDir }) {
    const source = fs.readFileSync(path.join(configDir, "CLAUDE.md"), "utf8");
    const corpus = rules.loadCorpus(path.join(configDir, "modes", "rules"));

    // A distinctive sentence fragment is enough: this is measuring overlap, not
    // proving identity, and the bodies were lightly re-wrapped on the way out.
    const duplicated = corpus.rules.filter((rule) => {
      const probe = rule.body
        .replace(/\s+/g, " ")
        .replace(/[`*_]/g, "")
        .split(/[.:]/)[0]
        .trim()
        .slice(0, 40);
      return probe.length > 15 && source.replace(/\s+/g, " ").includes(probe);
    });

    const corpusWords = corpus.rules.reduce(
      (total, rule) => total + rule.body.split(/\s+/).length,
      0,
    );

    return {
      pass: duplicated.length === 0,
      answer: `${duplicated.length}/${corpus.rules.length} rules appear in both places (~${corpusWords} words of corpus)`,
      evidence:
        duplicated.length === 0
          ? "no overlap detected"
          : `each of these is sent twice and competes with the mode ordering: ${duplicated
              .map((rule) => rule.id)
              .join(", ")}`,
    };
  },
};
