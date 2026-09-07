"use strict";

// Does the voice setting do anything?
//
// It is the only setting with no evidence behind it whatsoever -- zero trials --
// and it is the one setting that is categorical rather than ordered, so it is
// also the one whose mechanism is least like the others.
//
// Graded two ways on the same cells. The deterministic metric says whether the
// register moved in the direction the setting names; the blind judge says whether
// it moved at all. A metric alone would only test the axis guessed, and a judge
// alone would not say which way.

const naming = require("../tools/probe/graders/naming.js");

const CAVEMAN = `## Voice

Respond like a smart caveman: drop articles, filler, and pleasantries; fragments
are fine; short synonyms over long ones. Technical terms, code blocks, and quoted
errors stay exact.`;

const PROSE = `## Voice

Write in full, careful prose. Complete sentences throughout, connectives between
clauses, no fragments. Explain the reasoning as you would in a written report.`;

const TASKS = [
  {
    id: "explain-closure",
    prompt: "Explain what a JavaScript closure is and when you would reach for one.",
  },
  {
    id: "explain-index",
    prompt: "Explain why adding a database index can make writes slower.",
  },
  {
    id: "review-call",
    prompt:
      "A colleague wants to store session tokens in localStorage. Give them your view.",
  },
  {
    id: "explain-cache",
    prompt: "Explain the difference between a cache and a buffer.",
  },
];

// Articles are the clearest surface marker of the register the setting names:
// dropping them is the first instruction caveman gives and the first thing prose
// forbids. Measured as a share of all words so reply length does not confound it.
const ARTICLES = /\b(the|a|an)\b/gi;

function articleDensity(text) {
  const prose = text.replace(/```[\s\S]*?```/g, " ");
  const words = prose.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return 0;
  return (prose.match(ARTICLES) || []).length / words.length;
}

module.exports = {
  name: "voice-register",
  kind: "model",
  question: "Does the voice setting change the register of the reply?",
  why: "voice is the only setting with zero trials behind it, and the only categorical one. Nothing is known about whether it works.",

  control: "none",
  reps: 6,
  tasks: TASKS,
  arms: { none: "", caveman: CAVEMAN, prose: PROSE },

  // A violation is prose-shaped output: article density at or above the rate of
  // ordinary written English. The caveman arm should show few violations, the
  // prose arm many, and the gap is the effect.
  fixtures: {
    clean: "Closure captures scope. Use when callback needs outer variable. Keeps state without object.",
    violating:
      "A closure is a function that captures the surrounding scope, and the reason you would reach for one is to keep a piece of state alive between the calls that need it.",
  },

  grade: (output) => ({
    violations: articleDensity(output) >= 0.06 ? ["prose register"] : [],
  }),

  articleDensity,
};
