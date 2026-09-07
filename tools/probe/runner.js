"use strict";

// Running probes, and the two guards that make a result trustworthy.
//
// Both guards exist because the failure happened, in this config, and both
// produced a confident wrong answer rather than an error -- which is the only
// kind of harness bug that survives to be reported.

const fs = require("fs");
const path = require("path");

// A limit notice is written by the platform, not the model. Captured verbatim
// from the run where it filled 99% of the output files and graded as clean
// trials. Anchored on the possessive and the error prefix so that a task about
// building a rate limiter is not mistaken for one.
const LIMIT_NOTICE =
  /(you've|you have) (hit|reached)[^.]*\blimit\b|approaching your (usage|session|rate) limit|^error:[^\n]*\brate limit\b/im;

function isContaminated(output) {
  return LIMIT_NOTICE.test(output);
}

/**
 * Prove the grader can tell its own fixtures apart, before any budget is spent.
 *
 * A grader blind to the violation it exists to catch scores every arm the same
 * and the probe concludes "no effect" from a broken instrument. That is not
 * hypothetical: it is how this config came to report that a rule caused the
 * behaviour it forbade.
 */
function checkFixtures(probe) {
  const clean = probe.grade(probe.fixtures.clean);
  if (clean.violations.length > 0)
    return {
      pass: false,
      reason: `grader flags its own clean fixture: ${clean.violations.join(", ")}`,
    };

  const violating = probe.grade(probe.fixtures.violating);
  if (violating.violations.length === 0)
    return {
      pass: false,
      reason: "grader sees no violation in its own violating fixture",
    };

  return { pass: true };
}

function resultsDir(configDir, probeName) {
  return path.join(configDir, "cache", "probe", probeName);
}

/** One file per cell, so an interrupted run resumes instead of restarting. */
function cellPath(configDir, probeName, arm, taskId, repetition) {
  return path.join(
    resultsDir(configDir, probeName),
    `${arm}--${taskId}--${repetition}.txt`,
  );
}

function readCells(configDir, probeName) {
  const directory = resultsDir(configDir, probeName);
  const cells = [];
  let entries;
  try {
    entries = fs.readdirSync(directory).sort();
  } catch {
    return cells;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".txt")) continue;
    const [arm, taskId, repetition] = entry.replace(/\.txt$/, "").split("--");
    cells.push({
      arm,
      taskId,
      repetition: Number(repetition),
      output: fs.readFileSync(path.join(directory, entry), "utf8"),
    });
  }
  return cells;
}

module.exports = {
  isContaminated,
  checkFixtures,
  resultsDir,
  cellPath,
  readCells,
};
