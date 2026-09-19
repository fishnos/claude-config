"use strict";

// The blind review gate: a second worker reads the diff, and is never told what
// the change was meant to do.
//
// Blindness is the mechanism, not a formality. A reviewer handed the brief
// argues toward it: it reads the diff looking for the thing it was told to
// expect, and finds it. Withholding the brief is what leaves it judging the
// change that exists rather than the change that was ordered.
//
// What this gate must never be asked to do, and it is the sharpest finding in
// the survey behind this design: judge whether a completion claim is true. On
// false completion claims, where a worker asserts a success the environment
// contradicts, no model-judge configuration exceeded an AUROC of 0.65 (the area
// under the receiver operating characteristic curve, a 0.5-to-1 score where 0.5
// is a coin flip), because judges anchor on confident closing language, which is
// exactly what a false success produces. The best frontier model localises
// errors in an agent's trace 11% of the time. So this gate judges code quality
// and the `evidence` gate judges claims, which are checked against a log no
// worker may write. Never the other way round.
//
// `minimumVerify: "proven"`, so it binds under FIXER (the release posture) and
// nowhere else. No role names it in its `gates:` list today, so nothing runs it
// yet; the role that names it and the dispatch that produces a verdict are the
// wiring task.

// Severities a reviewer may label a finding with that leave the change
// shippable, spelled as the reviewer role file spells them and matched without
// regard to case. Everything else blocks, including an unlabelled finding and a
// severity nobody here has seen before: a gate that treats what it does not
// recognise as harmless is a gate that stops working the moment the reviewer's
// vocabulary grows.
const ADVISORY = ["Nit", "Optional", "FYI"];

// How many blocking findings a refusal spells out before it counts the rest.
// The reason is written into a worker's context, so its length is bounded here
// rather than by however much the reviewer had to say.
const MAX_NAMED = 5;

/**
 * The prompt a blind reviewer receives.
 *
 * Takes both the diff and the brief, and puts only the diff in the prompt.
 * `brief` is accepted and dropped on purpose: a caller holding both can hand
 * over both, and the dropping happens here, which is what makes "the reviewer
 * never sees the brief" a property of this file rather than a habit of whoever
 * calls it.
 */
function buildPrompt({ diff } = {}) {
  return [
    "Review this diff. You have not been told what it was supposed to do, and",
    "that is deliberate: a reviewer who knows the goal argues toward it.",
    "",
    "Judge whether the change improves the overall health of this code, not",
    "whether it is perfect. Design first, then correctness, complexity, tests,",
    "naming, comments, style.",
    "",
    `Label each finding with a severity. Use ${ADVISORY.join(", ")} for anything`,
    "the change can ship with, and Blocking for anything it cannot. Say what is",
    "good, not only what is wrong, and name any area you did not cover.",
    "",
    "Do not judge whether a command was really run or a claim is true. You",
    "cannot see that, and another gate checks it against a record.",
    "",
    "The diff:",
    "",
    String(diff ?? ""),
  ].join("\n");
}

/** True when a finding's severity is one the change may ship with. */
function isAdvisory(finding) {
  const severity = String((finding && finding.severity) || "")
    .trim()
    .replace(/:$/, "")
    .toLowerCase();
  return ADVISORY.some((label) => label.toLowerCase() === severity);
}

/**
 * A reviewer's answer as a gate result.
 *
 * A missing review is a failure rather than a pass, and that is the whole point
 * of the function: the survey's mechanism 3 is that a guardrail which degrades
 * to "no reviewer was available, therefore fine" is worse than no guardrail,
 * because it reports a check that never happened as a check that passed.
 */
function interpret(review) {
  if (!review || typeof review !== "object") {
    return {
      ok: false,
      reason:
        "no blind review came back for this run, so nothing has read the diff. " +
        "A missing review is not a pass.",
    };
  }

  // A clean review is an empty list, not a missing one. An answer carrying no
  // list at all never reached the diff, and reading it as approval is the same
  // silent degradation as treating an absent reviewer as a pass.
  if (!Array.isArray(review.findings)) {
    return {
      ok: false,
      reason:
        "the blind review came back without a list of findings, so it cannot be " +
        "read either way. A review that says nothing is not a review that found " +
        "nothing.",
    };
  }

  const blocking = review.findings.filter((finding) => !isAdvisory(finding));
  if (blocking.length === 0) return { ok: true };

  const named = blocking
    .slice(0, MAX_NAMED)
    .map((finding) => String(finding.text || "(a finding with no text)"));
  const unnamed = blocking.length - named.length;
  const andMore = unnamed > 0 ? `, and ${unnamed} more` : "";
  return {
    ok: false,
    reason:
      "the blind review of this diff found something it will not ship: " +
      `${named.join("; ")}${andMore}. Fix it, or say in the report why it stands.`,
  };
}

module.exports = {
  id: "review",
  minimumVerify: "proven",
  check(run) {
    // `review` is the verdict the reviewer's own dispatch leaves on the run
    // view. Nothing writes it yet, so this gate refuses every run it is named
    // by, which is the correct direction to be wrong in while it is unwired:
    // no role names it, so it blocks nobody, and the day one does, the refusal
    // says what is missing rather than waving the run through.
    return interpret((run && run.review) || null);
  },
  buildPrompt,
  interpret,
  ADVISORY,
};
