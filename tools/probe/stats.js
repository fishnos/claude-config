"use strict";

// Significance testing for probe results, with no dependencies.
//
// Every rate this harness prints carries an interval, because "no effect" at
// n=12 and "no effect" at n=576 are different claims and a bare percentage
// cannot tell them apart.

// Abramowitz-Stegun 7.1.26. Accurate to about 1.5e-7, which is far past what a
// p-value reported to four places needs.
function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * absolute);
  const series =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
    t;
  return sign * (1 - series * Math.exp(-absolute * absolute));
}

function normalTailTwoSided(z) {
  // erf(0) is exactly 0, but the series approximation returns ~1e-9 there, so a
  // genuine tie would print as 0.999999999 rather than 1. Everywhere else the
  // approximation is far more accurate than a four-place p-value needs.
  if (z === 0) return 1;
  return 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
}

/**
 * Two-proportion z-test between arms.
 *
 * Returns p = 1 for two arms with no combined variance -- both empty, or both
 * at the same extreme. That case is genuinely "no evidence of a difference",
 * and returning NaN would let it print as a result.
 */
function twoProportion(hitsA, trialsA, hitsB, trialsB) {
  if (trialsA === 0 || trialsB === 0)
    return { rateA: 0, rateB: 0, delta: 0, z: 0, p: 1 };

  const rateA = hitsA / trialsA;
  const rateB = hitsB / trialsB;
  const pooled = (hitsA + hitsB) / (trialsA + trialsB);
  const standardError = Math.sqrt(
    pooled * (1 - pooled) * (1 / trialsA + 1 / trialsB),
  );
  if (standardError === 0)
    return { rateA, rateB, delta: rateA - rateB, z: 0, p: 1 };

  const z = (rateA - rateB) / standardError;
  return { rateA, rateB, delta: rateA - rateB, z, p: normalTailTwoSided(z) };
}

/**
 * Wilson score interval.
 *
 * Wald was the obvious choice and is wrong at the edges: it produces intervals
 * that run past 0 or 1, and collapses to zero width at a rate of exactly 0 --
 * which is precisely where several of this config's rules sit.
 */
function confidenceInterval(hits, trials, z = 1.96) {
  if (trials === 0) return { low: 0, high: 1 };
  const rate = hits / trials;
  const denominator = 1 + (z * z) / trials;
  const centre = rate + (z * z) / (2 * trials);
  const spread =
    z * Math.sqrt((rate * (1 - rate)) / trials + (z * z) / (4 * trials * trials));
  return {
    low: Math.max(0, (centre - spread) / denominator),
    high: Math.min(1, (centre + spread) / denominator),
  };
}

module.exports = { twoProportion, confidenceInterval };
