"use strict";

// Verdicts.
//
// Three states and no others, because the interesting failure is a partial run
// that reads as a weak result. It is not a weak result; it is not a result.

const SIGNIFICANCE = 0.05;

function verdict({ cells, filled, fixturesPassed, p }) {
  if (!fixturesPassed) return "INCOMPLETE";
  if (filled < cells) return "INCOMPLETE";
  return p < SIGNIFICANCE ? "RESULT" : "NO EFFECT";
}

/**
 * Arm rates against the control, with an interval on every one.
 *
 * The control is whichever arm the probe names; deltas are reported against it
 * rather than against the best arm, so a probe cannot make itself look decisive
 * by picking its comparison after seeing the numbers.
 */
function table(armResults, controlName, stats, io) {
  const control = armResults.find((arm) => arm.name === controlName);
  const rows = [];
  const header =
    "  " +
    "arm".padEnd(14) +
    "n".padStart(5) +
    "  rate".padStart(8) +
    "        95% CI" +
    "   declined" +
    "   vs " +
    controlName;
  rows.push(io.dim(header));

  for (const arm of armResults) {
    const rate = arm.trials === 0 ? 0 : arm.hits / arm.trials;
    const interval = stats.confidenceInterval(arm.hits, arm.trials);
    let comparison = "";
    if (control !== undefined && arm.name !== controlName) {
      const test = stats.twoProportion(arm.hits, arm.trials, control.hits, control.trials);
      const points = (test.delta * 100).toFixed(1);
      const sign = test.delta > 0 ? "+" : "";
      comparison = `${sign}${points}pp  p=${test.p < 0.0001 ? "<0.0001" : test.p.toFixed(4)}`;
    }
    rows.push(
      "  " +
        arm.name.padEnd(14) +
        String(arm.trials).padStart(5) +
        `${(rate * 100).toFixed(0)}%`.padStart(8) +
        `  [${(interval.low * 100).toFixed(0)}-${(interval.high * 100).toFixed(0)}]`.padEnd(14) +
        String(arm.declined || 0).padStart(6) +
        "   " +
        comparison,
    );
  }
  return rows.join("\n");
}

module.exports = { SIGNIFICANCE, verdict, table };
