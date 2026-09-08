"use strict";

// Why can a judge separate reordered arms when no metric can?
//
// spike and ship carry the same twenty-five rules in different order. A judge
// tells their output apart at 20/20; prose-word count, comment presence, test
// presence, error handling and input validation all came back null or failed
// correction. Either the judge reads something none of those capture, or it is
// right for a reason that is not the posture.
//
// Asking it is the cheap move. Collect a one-line reason with every verdict,
// count what the reasons name, and hand the top answers back as candidate
// metrics. The count proves nothing on its own, because a stated reason is a
// report rather than a mechanism, and so the output is a list of things to go
// and measure.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SPIKE_BRIEF = "rough code is fine, skip the process, move fast, no tests needed";
const SHIP_BRIEF = "polished code, full process, tests required, every claim sourced";

// Surface features a reason might name. Counted by keyword so the tally is
// reproducible rather than a reading of the prose.
const THEMES = {
  "length / detail": /\blonger|longer\b|more detail|verbos|thorough|brief|terse|concise|short/i,
  "tests": /\btest|spec\b|assert/i,
  "comments / docs": /\bcomment|jsdoc|docstring|document/i,
  "error handling": /\berror|throw|edge case|guard|validat/i,
  "explanation prose": /\bexplain|explanation|rationale|reasoning|walkthrough/i,
  "caveats / hedging": /\bcaveat|hedge|assum|note that|trade-?off|limitation/i,
  "structure / headings": /\bstructure|heading|section|organis|organiz|bullet/i,
  "naming": /\bnaming|variable name|identifier/i,
  "types": /\btype|typescript|signature|annotation/i,
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

function askWithReason(firstText, secondText) {
  const prompt = `Two engineers were each asked the same programming question. One worked under this brief: "${SHIP_BRIEF}". The other worked under this brief: "${SPIKE_BRIEF}".

=== REPLY A ===
${firstText.slice(0, 4000)}

=== REPLY B ===
${secondText.slice(0, 4000)}

Which reply came from the engineer under the "${SHIP_BRIEF}" brief?

Answer on two lines, nothing else:
CHOICE: A or B
BECAUSE: one sentence naming the single most decisive difference you actually observed between the two replies.`;

  const asked = spawnSync("claude", ["-p", "--safe-mode", prompt], {
    encoding: "utf8",
    timeout: 120000,
    cwd: os.tmpdir(),
  });
  const text = asked.stdout || "";
  const choice = /CHOICE:\s*([AB])/i.exec(text);
  const reason = /BECAUSE:\s*(.+)/i.exec(text);
  return {
    choice: choice ? choice[1].toUpperCase() : null,
    reason: reason ? reason[1].trim() : null,
  };
}

module.exports = {
  name: "divergence-rationale",
  kind: "live",
  question: "What is the judge actually reading when it separates reordered arms?",
  why: "A judge separates spike from ship at 20/20 and every metric tried came back null. Either it reads something unmeasured, or it is right for the wrong reason.",

  async run({ configDir, io }) {
    const spike = cellsFor(configDir, "spike");
    const ship = cellsFor(configDir, "ship");
    if (spike.length === 0 || ship.length === 0)
      return { pass: null, answer: "unknown", evidence: "run mode-divergence first" };

    const byTask = {};
    for (const cell of spike) (byTask[cell.taskId] ||= []).push(cell);

    const reasons = [];
    let correct = 0;
    let scored = 0;

    for (const [index, shipCell] of ship.entries()) {
      const partners = byTask[shipCell.taskId];
      if (!partners || partners.length === 0) continue;
      const spikeCell = partners.pop();
      const shipIsFirst = index % 2 === 0;
      const { choice, reason } = askWithReason(
        shipIsFirst ? shipCell.text : spikeCell.text,
        shipIsFirst ? spikeCell.text : shipCell.text,
      );
      if (choice === null) continue;
      scored += 1;
      if ((choice === "A") === shipIsFirst) correct += 1;
      if (reason) reasons.push(reason);
      io.progress(`  collected ${scored} verdicts`);
      if (scored >= 20) break;
    }

    const tally = {};
    for (const [theme, pattern] of Object.entries(THEMES))
      tally[theme] = reasons.filter((reason) => pattern.test(reason)).length;

    const ranked = Object.entries(tally)
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1]);

    console.log(`\n  judge was right in ${correct}/${scored}\n`);
    console.log("  what the reasons named:");
    for (const [theme, count] of ranked)
      console.log(`    ${theme.padEnd(24)} ${count}/${reasons.length}`);
    console.log("\n  a sample of the reasons, verbatim:");
    for (const reason of reasons.slice(0, 6))
      console.log(`    - ${reason.slice(0, 150)}`);

    return {
      pass: null,
      answer: `${correct}/${scored} correct; reasons cluster on ${ranked.slice(0, 3).map(([theme]) => theme).join(", ")}`,
      evidence:
        "a stated reason is a report, not a mechanism; these are the next things to measure, not findings",
    };
  },
};
