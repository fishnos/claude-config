"use strict";

// What do two modes diverge *on*?
//
// A blind judge separates spike from ship output perfectly, which establishes
// that they differ and says nothing about how. This narrows it by ablation: run
// the same discrimination with one channel removed at a time. The ablation that
// collapses accuracy to chance is the channel carrying the difference.
//
// Ablation rather than a metric because a metric only tests the axis that was
// guessed. Six guessed axes found nothing that survived correction, on cells a
// judge then read at 20/20.

const fs = require("fs");
const path = require("path");

const { discriminate } = require("../tools/probe/discriminate.js");

const SPIKE_BRIEF = "rough code is fine, skip the process, move fast, no tests needed";
const SHIP_BRIEF = "polished code, full process, tests required, every claim sourced";

const FENCE = /```[a-z]*\n[\s\S]*?```/g;

// Each strips one channel. If accuracy holds without a channel, the signal was
// not in it; if accuracy dies, it was.
const CHANNELS = {
  // Everything. The reference.
  full: (text) => text,
  // Prose removed: only fenced code survives.
  "code only": (text) => (text.match(FENCE) || []).join("\n\n"),
  // Code removed: only the surrounding explanation survives.
  "prose only": (text) => text.replace(FENCE, "[code omitted]"),
  // Comments and docstrings stripped out of the code.
  "code, no comments": (text) =>
    (text.match(FENCE) || [])
      .join("\n\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, ""),
  // Length equalised: both sides cut to the shorter one's length, so a judge
  // cannot win on verbosity alone.
  "first 900 chars": (text) => text.slice(0, 900),
};

function cellsFor(configDir, arm) {
  const directory = path.join(configDir, "cache", "probe", "mode-divergence");
  return fs
    .readdirSync(directory)
    .filter((entry) => entry.startsWith(arm + "--") && entry.endsWith(".txt"))
    .map((entry) => ({
      taskId: entry.split("--")[1],
      text: fs.readFileSync(path.join(directory, entry), "utf8"),
    }));
}

module.exports = {
  name: "divergence-channel",
  kind: "live",
  question: "Which channel carries the difference between spike and ship output?",
  why: "A judge tells them apart at 20/20 and no single metric explains it. Until the channel is known, nothing can be said about what a mode actually changes.",

  async run({ configDir, io }) {
    const spike = cellsFor(configDir, "spike");
    const ship = cellsFor(configDir, "ship");
    if (spike.length === 0 || ship.length === 0)
      return { pass: null, answer: "unknown", evidence: "run mode-divergence first" };

    const lines = [];
    let survivingChannel = null;

    for (const [name, transform] of Object.entries(CHANNELS)) {
      const outcome = discriminate({
        targetCells: ship,
        otherCells: spike,
        controlCells: spike,
        targetBrief: SHIP_BRIEF,
        otherBrief: SPIKE_BRIEF,
        pairs: 16,
        controlPairs: 10,
        transform,
        io,
        label: name,
      });
      lines.push(
        `  ${name.padEnd(20)} ${outcome.correct}/${outcome.scored} ` +
          `(${(outcome.rate * 100).toFixed(0)}%) p=${outcome.p < 0.0001 ? "<0.0001" : outcome.p.toFixed(4)}` +
          `  control ${outcome.controlPicked}/${outcome.controlScored}` +
          (outcome.controlSane ? "" : "  [CONTROL OFF CHANCE]"),
      );
      if (name !== "full") survivingChannel = survivingChannel || [];
      if (name !== "full") survivingChannel.push({ name, ...outcome });
    }

    console.log("\n" + lines.join("\n"));

    // An ablation that keeps discrimination proves the surviving channel is
    // sufficient. One that loses significance at n=16 proves much less: 75% and
    // 88% are not far apart, and the earlier version of this probe reported
    // whichever non-significant ablation happened to run last as "the channel",
    // which is a claim the numbers do not support.
    const kept = (survivingChannel || []).filter((entry) => entry.discriminates);
    const lost = (survivingChannel || []).filter((entry) => !entry.discriminates);
    return {
      pass: null,
      answer:
        kept.length > 0
          ? `sufficient on its own: ${kept.map((entry) => entry.name).join(", ")}`
          : "no single channel retained significance",
      evidence:
        `not significant at n=16: ${lost.map((entry) => `${entry.name} ${(entry.rate * 100).toFixed(0)}%`).join(", ")}` +
        " -- underpowered to separate these from the full-text rate, not evidence of collapse",
    };
  },
};
