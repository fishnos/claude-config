"use strict";

// The first gate: does the report have the shape every later gate reads?
//
// Two things only. The run token, so the report can be joined to the dispatch
// that asked for it, and a terminal state word, so "what happened" is a value
// rather than a paragraph to interpret. Nothing here judges the work: a worker
// that says STATE blocked passes this gate, because reporting a blockage in the
// agreed shape is exactly what it is meant to do.
//
// Shape is checked and no more because format restriction measurably degrades
// reasoning. Four fields is the smallest structure a finish gate can join and
// read a state out of, and the survey's judge findings are why the semantic
// questions go to the evidence gate, which checks claims against a record no
// worker can write, rather than to a reader of prose.

const STATES = ["done", "blocked", "rejected", "input-required"];

// `tested` and above want a refusal; at `none` the runner carries a failure here
// as a warning instead, so a spike still sees what its report lacked.
module.exports = {
  id: "finish-shape",
  minimumVerify: "tested",
  check(run) {
    const finish = run.finish || {};

    if (!finish.run && !finish.state) {
      return {
        ok: false,
        reason:
          "the report ends in prose: it carries neither a RUN line nor a STATE line.",
      };
    }
    if (!finish.run) {
      return {
        ok: false,
        reason:
          "the report has no RUN line, so nothing joins it to the dispatch that asked for it.",
      };
    }
    if (!run.token) {
      return {
        ok: false,
        reason: `RUN ${finish.run} matches no dispatch in this session. Repeat the token from your own dispatch, unchanged.`,
      };
    }
    if (!finish.state) {
      return { ok: false, reason: "the report has no STATE line." };
    }
    if (!STATES.includes(finish.state)) {
      return {
        ok: false,
        reason: `STATE ${finish.state} is not a state. Use one of: ${STATES.join(", ")}.`,
      };
    }
    return { ok: true };
  },
  STATES,
};
