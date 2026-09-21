"use strict";

// A reviewer's report must say what it found in a form the turn-end hold can
// read. Sent back here, at the hand-back, the reviewer fixes its format while it
// still has the diff in front of it; left to the turn end, the only remedy is a
// whole second review.

const blindReview = require("../../lib/blind-review");

module.exports = {
  id: "review-shape",
  // Refused at every posture. A reviewer's report is only ever read by the
  // hold, and a report the hold cannot read is a review that did not happen.
  minimumVerify: "none",
  check(run) {
    const report = run && run.finish ? run.finish.report : "";
    if (blindReview.parseFindings(report) !== null) return { ok: true };
    return {
      ok: false,
      reason:
        "this review lists no finding the hold can read. Put each finding on its " +
        "own line opening with `Blocking:`, `Nit:`, `Optional:` or `FYI:`, or " +
        "write the line `Findings: none` if there are none.",
    };
  },
};
