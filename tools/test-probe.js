"use strict";

// Regression suite for the probe harness.
//
// Two of these tests exist because the failure happened: a rate-limit notice was
// graded as model output and produced a confident wrong result, and a grader
// that could not recognise the correct answer inverted a finding. Both are
// reproduced here as fixtures so the guards cannot quietly stop working.
//
// Usage: node ~/.claude/tools/test-probe.js

const fs = require("fs");
const os = require("os");
const path = require("path");

const SANDBOX_CONFIG = fs.mkdtempSync(path.join(os.tmpdir(), "ccfg-probe-"));
process.env.CLAUDE_CONFIG_DIR = SANDBOX_CONFIG;

const stats = require("./probe/stats.js");
const probes = require("./probe/probes.js");
const runner = require("./probe/runner.js");
const report = require("./probe/report.js");

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  if (actual === expected) {
    passed += 1;
    console.log(`[PASS] ${label}`);
    return;
  }
  failed += 1;
  console.log(`[FAIL] ${label}`);
  console.log(`       expected: ${JSON.stringify(expected)}`);
  console.log(`       actual:   ${JSON.stringify(actual)}`);
}

function near(label, actual, expected, tolerance) {
  const within = Math.abs(actual - expected) <= tolerance;
  check(`${label} (${actual.toFixed(4)} ~ ${expected})`, within, true);
}

// ------------------------------------------------------------------- stats

// Checked against the values this session's scratchpad harness produced for the
// same inputs, so a rewrite of the arithmetic cannot silently change a finding.
const shipVsSpike = stats.twoProportion(22, 48, 0, 48);
near("a large real delta reproduces its z", shipVsSpike.z, 5.34, 0.02);
check("a large real delta is significant", shipVsSpike.p < 0.0001, true);

const noDelta = stats.twoProportion(25, 48, 22, 48);
near("a null delta reproduces its p", noDelta.p, 0.5402, 0.005);
check("a null delta is not significant", noDelta.p < 0.05, false);

check(
  "identical proportions give p of exactly 1",
  stats.twoProportion(10, 20, 10, 20).p,
  1,
);
check(
  "two empty arms do not divide by zero",
  Number.isFinite(stats.twoProportion(0, 0, 0, 0).p),
  true,
);

const interval = stats.confidenceInterval(22, 48);
check(
  "a confidence interval brackets its point estimate",
  interval.low <= 22 / 48 && 22 / 48 <= interval.high,
  true,
);
check(
  "a confidence interval is not clamped past zero",
  interval.low >= 0,
  true,
);
check(
  "a confidence interval is not clamped past one",
  interval.high <= 1,
  true,
);

// The distinction the report rests on: the same rate at different n is not the
// same claim, and the interval is what says so.
const wide = stats.confidenceInterval(6, 12);
const narrow = stats.confidenceInterval(288, 576);
check(
  "a small sample gives a wider interval than a large one at the same rate",
  wide.high - wide.low > narrow.high - narrow.low,
  true,
);

// --------------------------------------------------------- contamination

// Captured from the run that was 99% contaminated. Graded as a clean trial at
// the time, which is what made the result look real.
const LIMIT_NOTICE =
  "You've hit your session limit. Your limit will reset at 3pm.";

check(
  "a session-limit notice is refused as model output",
  runner.isContaminated(LIMIT_NOTICE),
  true,
);
check(
  "a usage-limit notice is refused",
  runner.isContaminated("Approaching your usage limit for this week"),
  true,
);
check(
  "a rate-limit notice is refused",
  runner.isContaminated("Error: rate limit exceeded, retry later"),
  true,
);
check(
  "ordinary model output is not refused",
  runner.isContaminated("function total(rows) { return rows.length; }"),
  false,
);

// The one that would have bitten: prose that discusses limits without being a
// limit notice. Over-broad matching silently discards real data, which looks
// identical to a run that was never done.
check(
  "prose about rate limiting in code is not refused",
  runner.isContaminated(
    "Add a rate limit of 100 requests per minute to the login endpoint.",
  ),
  false,
);

// ------------------------------------------------------------ fixture gate

const WORKING_PROBE = {
  name: "working",
  kind: "model",
  question: "q",
  why: "w",
  arms: { bare: "", ruled: "Never use an abbreviation." },
  tasks: [{ id: "t1", prompt: "p" }],
  reps: 1,
  fixtures: {
    clean: "const configuration = load();",
    violating: "const cfg = load();",
  },
  grade: (output) => ({
    violations: /\bcfg\b/.test(output) ? ["abbreviation"] : [],
  }),
};

check(
  "a grader that separates its fixtures passes the gate",
  runner.checkFixtures(WORKING_PROBE).pass,
  true,
);

// The F1 failure in miniature: a grader blind to the violation it exists to
// catch. It reports zero violations for everything, so every arm ties and the
// probe concludes "no effect" from a broken instrument.
const BLIND_PROBE = {
  ...WORKING_PROBE,
  name: "blind",
  grade: () => ({ violations: [] }),
};
const blindGate = runner.checkFixtures(BLIND_PROBE);
check(
  "a grader blind to its own violation fails the gate",
  blindGate.pass,
  false,
);
check(
  "the gate says which fixture it got wrong",
  blindGate.reason.includes("violating"),
  true,
);

const PARANOID_PROBE = {
  ...WORKING_PROBE,
  name: "paranoid",
  grade: () => ({ violations: ["everything"] }),
};
check(
  "a grader that flags its clean fixture fails the gate",
  runner.checkFixtures(PARANOID_PROBE).pass,
  false,
);

// -------------------------------------------------------------- descriptors

check(
  "a probe missing its question is refused",
  probes.validate({ name: "x", kind: "oracle", why: "w", run: () => {} }).error,
  "x: no question",
);
check(
  "a probe of an unknown kind is refused",
  probes.validate({ name: "x", kind: "vibes", question: "q", why: "w" }).error,
  "x: unknown kind 'vibes'",
);
check(
  "an oracle probe with no run function is refused",
  probes.validate({ name: "x", kind: "oracle", question: "q", why: "w" }).error,
  "x: oracle and live probes need a run function",
);
check(
  "a model probe with no fixtures is refused",
  probes.validate({ ...WORKING_PROBE, fixtures: undefined }).error,
  "working: model probes need fixtures.clean and fixtures.violating",
);
check(
  "a well-formed probe validates",
  probes.validate(WORKING_PROBE).error,
  undefined,
);

// ----------------------------------------------------------------- verdicts

check(
  "an unfilled cell makes the whole probe incomplete",
  report.verdict({ cells: 48, filled: 47, fixturesPassed: true, p: 0.0001 }),
  "INCOMPLETE",
);
check(
  "a fixture failure makes the probe incomplete however good the numbers",
  report.verdict({ cells: 48, filled: 48, fixturesPassed: false, p: 0.0001 }),
  "INCOMPLETE",
);
check(
  "a full run below the threshold is a result",
  report.verdict({ cells: 48, filled: 48, fixturesPassed: true, p: 0.01 }),
  "RESULT",
);
check(
  "a full run above the threshold is no effect, not a failure",
  report.verdict({ cells: 48, filled: 48, fixturesPassed: true, p: 0.4 }),
  "NO EFFECT",
);

fs.rmSync(SANDBOX_CONFIG, { recursive: true, force: true });

console.log(`\nPASS ${passed}  FAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
