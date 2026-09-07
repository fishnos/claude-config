"use strict";

// Blind paired discrimination: can a judge tell which of two conditions produced
// an output?
//
// Extracted because every remaining question about the mode system is the same
// question -- do these two things differ -- and a single-axis metric answers only
// "do they differ on the axis I guessed". Discrimination uses every signal at
// once and costs one test rather than one per axis.
//
// The same-condition control is not optional. A judge scoring above chance on
// pairs drawn from one condition is reading position, length, or its own habit,
// and its verdict on the real pairs cannot be separated from that.

const os = require("os");
const { spawnSync } = require("child_process");

const stats = require("./stats.js");

// How far the control may sit from chance before the judge is called unreliable.
// Wide because a 12-pair control is itself noisy: at n=12, 3/12 and 9/12 are both
// within ordinary sampling variation of a fair coin.
const CONTROL_TOLERANCE = 0.3;

function askJudge(firstText, secondText, briefA, briefB, transform) {
  const first = transform(firstText).slice(0, 4000);
  const second = transform(secondText).slice(0, 4000);
  const prompt = `Two engineers were each asked the same programming question. One worked under this brief: "${briefA}". The other worked under this brief: "${briefB}".

=== REPLY A ===
${first}

=== REPLY B ===
${second}

Which reply came from the engineer under the "${briefA}" brief? Answer with exactly one character: A or B.`;

  const asked = spawnSync("claude", ["-p", "--safe-mode", prompt], {
    encoding: "utf8",
    timeout: 120000,
    cwd: os.tmpdir(),
  });
  const answer = (asked.stdout || "").trim().toUpperCase();
  return /^A\b|\bA\b/.test(answer) ? "A" : /^B\b|\bB\b/.test(answer) ? "B" : null;
}

/** Pairs matched by task, so the judge never compares answers to different questions. */
function pairByTask(left, right, limit) {
  const available = {};
  for (const cell of right) (available[cell.taskId] ||= []).push(cell);
  const pairs = [];
  for (const cell of left) {
    const partners = available[cell.taskId];
    if (!partners || partners.length === 0) continue;
    pairs.push({ target: cell, other: partners.pop() });
    if (pairs.length >= limit) break;
  }
  return pairs;
}

/** Pairs drawn from one condition, matched by task. No correct answer exists. */
function pairWithinTask(cells, limit) {
  const byTask = {};
  for (const cell of cells) (byTask[cell.taskId] ||= []).push(cell);
  const pairs = [];
  for (const group of Object.values(byTask)) {
    for (let index = 0; index + 1 < group.length; index += 2) {
      pairs.push({ target: group[index], other: group[index + 1] });
      if (pairs.length >= limit) return pairs;
    }
  }
  return pairs;
}

/**
 * Run the test.
 *
 * `transform` strips a channel from both texts before judging, which is how a
 * positive result gets narrowed: run it again with the code removed, or the prose
 * removed, and see which ablation kills the signal.
 */
function discriminate({
  targetCells,
  otherCells,
  controlCells,
  targetBrief,
  otherBrief,
  pairs = 20,
  controlPairs = 12,
  transform = (text) => text,
  io,
  label = "",
}) {
  const real = pairByTask(targetCells, otherCells, pairs);
  const control = pairWithinTask(controlCells || otherCells, controlPairs);

  let correct = 0;
  let scored = 0;
  for (const [index, pair] of real.entries()) {
    // Alternate the side the target sits on, so a positional habit scores at
    // chance instead of at 100%.
    const targetIsFirst = index % 2 === 0;
    const said = askJudge(
      targetIsFirst ? pair.target.text : pair.other.text,
      targetIsFirst ? pair.other.text : pair.target.text,
      targetBrief,
      otherBrief,
      transform,
    );
    if (said === null) continue;
    scored += 1;
    if ((said === "A") === targetIsFirst) correct += 1;
    if (io) io.progress(`  ${label} judged ${scored}/${real.length}`);
  }

  let controlPicked = 0;
  let controlScored = 0;
  for (const pair of control) {
    const said = askJudge(
      pair.target.text,
      pair.other.text,
      targetBrief,
      otherBrief,
      transform,
    );
    if (said === null) continue;
    controlScored += 1;
    if (said === "A") controlPicked += 1;
  }

  const rate = scored === 0 ? 0 : correct / scored;
  // Against chance, not against the control arm: the null here is a coin.
  const test = stats.twoProportion(correct, scored, scored / 2, scored);
  const interval = stats.confidenceInterval(correct, scored);
  const controlRate = controlScored === 0 ? 0.5 : controlPicked / controlScored;
  const controlSane = Math.abs(controlRate - 0.5) < CONTROL_TOLERANCE;

  return {
    correct,
    scored,
    rate,
    p: test.p,
    interval,
    controlPicked,
    controlScored,
    controlSane,
    discriminates: controlSane && test.p < 0.05 && rate > 0.5,
  };
}

module.exports = { discriminate, pairByTask, pairWithinTask, CONTROL_TOLERANCE };
