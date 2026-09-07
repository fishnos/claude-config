"use strict";

// Can a blind judge tell which mode produced an output?
//
// The strongest available test of divergence, and the cheapest: it consumes
// cells the mode-divergence probe already generated, so it costs judge calls
// and no generation.
//
// Every single-axis metric asks "do they differ on the thing I guessed?" and a
// null answers only that. Discrimination asks "do they differ at all?" and uses
// every signal in the text at once -- length, register, structure, what got
// mentioned -- without a multiple-comparison penalty, because there is one test.
//
// The control is the whole design: pairs drawn from the same arm must score at
// chance. A judge that "identifies" spike-vs-spike above 50% is guessing from
// something other than the posture, and its verdict on the real pairs means
// nothing.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const stats = require("../tools/probe/stats.js");

const SPIKE_BRIEF =
  "rough code is fine, skip the process, move fast, no tests needed";
const SHIP_BRIEF =
  "polished code, full process, tests required, every claim sourced";

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

function askJudge(first, second) {
  const prompt = `Two engineers were each asked the same programming question. One was working under a brief that said: "${SHIP_BRIEF}". The other was working under a brief that said: "${SPIKE_BRIEF}".

=== REPLY A ===
${first.slice(0, 4000)}

=== REPLY B ===
${second.slice(0, 4000)}

Which reply came from the engineer under the "${SHIP_BRIEF}" brief? Answer with exactly one character: A or B.`;

  const asked = spawnSync("claude", ["-p", "--safe-mode", prompt], {
    encoding: "utf8",
    timeout: 120000,
    cwd: require("os").tmpdir(),
  });
  const answer = (asked.stdout || "").trim().toUpperCase();
  const said = /\bA\b/.test(answer) ? "A" : /\bB\b/.test(answer) ? "B" : null;
  return said;
}

/**
 * Same-arm pairs, matched by task.
 *
 * Built separately from the cross-arm pairing because the first version sliced
 * one arm in half and paired the halves, which produced two pairs out of
 * twenty-four cells -- a control too small to validate anything, and it read as
 * judge bias rather than as a pairing bug.
 */
function buildControlPairs(cells, limit) {
  const byTask = {};
  for (const cell of cells) (byTask[cell.taskId] ||= []).push(cell);
  const pairs = [];
  for (const group of Object.values(byTask)) {
    for (let index = 0; index + 1 < group.length; index += 2) {
      pairs.push({ shipSide: group[index], spikeSide: group[index + 1] });
      if (pairs.length >= limit) return pairs;
    }
  }
  return pairs;
}

/** Pair cells task-by-task so the judge never compares answers to different questions. */
function buildPairs(left, right, limit) {
  const pairs = [];
  const byTask = {};
  for (const cell of right) (byTask[cell.taskId] ||= []).push(cell);
  for (const cell of left) {
    const partners = byTask[cell.taskId];
    if (!partners || partners.length === 0) continue;
    pairs.push({ shipSide: cell, spikeSide: partners.pop() });
    if (pairs.length >= limit) break;
  }
  return pairs;
}

module.exports = {
  name: "mode-discrimination",
  kind: "live",
  question: "Can a blind judge tell spike output from ship output?",
  why: "Single-axis metrics found nothing that survives correction. Discrimination uses every signal at once, and its same-arm control says whether the judge can be believed.",

  async run({ configDir, io }) {
    let spike;
    let ship;
    try {
      spike = cellsFor(configDir, "spike");
      ship = cellsFor(configDir, "ship");
    } catch {
      return {
        pass: null,
        answer: "unknown",
        evidence: "run mode-divergence first; this probe reads its cells",
      };
    }
    if (spike.length === 0 || ship.length === 0)
      return {
        pass: null,
        answer: "unknown",
        evidence: "no mode-divergence cells to judge",
      };

    const real = buildPairs(ship, spike, 20);
    // Drawn from spike rather than ship so the control cells are ones the real
    // comparison did not consume.
    // Same-arm pairs. The correct answer does not exist, so anything above
    // chance here is the judge reading something that is not the posture.
    const control = buildControlPairs(spike, 12);

    let correct = 0;
    let scored = 0;
    for (const [index, pair] of real.entries()) {
      // Alternate which side ship sits on, so a judge with a positional habit
      // scores at chance rather than at 100%.
      const shipIsFirst = index % 2 === 0;
      const said = askJudge(
        shipIsFirst ? pair.shipSide.text : pair.spikeSide.text,
        shipIsFirst ? pair.spikeSide.text : pair.shipSide.text,
      );
      if (said === null) continue;
      scored += 1;
      if ((said === "A") === shipIsFirst) correct += 1;
      io.progress(`  judged ${scored}/${real.length} real pairs`);
    }

    let controlPicked = 0;
    let controlScored = 0;
    for (const pair of control) {
      const said = askJudge(pair.shipSide.text, pair.spikeSide.text);
      if (said === null) continue;
      controlScored += 1;
      if (said === "A") controlPicked += 1;
    }

    const test = stats.twoProportion(correct, scored, scored / 2, scored);
    const interval = stats.confidenceInterval(correct, scored);
    const controlRate = controlScored === 0 ? 0 : controlPicked / controlScored;
    const controlSane = Math.abs(controlRate - 0.5) < 0.3;

    return {
      pass: controlSane ? test.p < 0.05 : null,
      answer:
        `judge identified ship in ${correct}/${scored} pairs ` +
        `(${((correct / scored) * 100).toFixed(0)}%, CI ${(interval.low * 100).toFixed(0)}-${(interval.high * 100).toFixed(0)}, p=${test.p.toFixed(4)})`,
      evidence: controlSane
        ? `same-arm control ${controlPicked}/${controlScored} -- judge is not guessing from position or length alone`
        : `same-arm control ${controlPicked}/${controlScored} is far from chance; the judge is unreliable and the real result cannot be read`,
    };
  },
};
