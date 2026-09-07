"use strict";

// Does switching a mode in the middle of a session change anything?
//
// The design assumes it does: a hook re-injects the active mode's rules onto
// every user message, so a switch is supposed to take hold on the next turn.
// Nothing has ever tested that. Two outcomes make the switching machinery a
// mistake -- the new rules are ignored, or the old and new rules together
// produce something worse than either alone -- and both look identical to a
// working switch from the outside, because the banner prints either way.
//
// Measured on voice, which is the setting with the cleanest separation on
// record: caveman scored 0 violations in 24 cells and prose 24 in 24. A dial
// that stark is the most sensitive detector available, so a switch that fails
// to move it has not moved anything subtler either.
//
// This tests the ceiling on purpose. The injected text is one crisp instruction
// at the freshest position, not a whole rendered mode -- the easiest case a
// switch will ever get. A negative result here settles the question; a positive
// one would still need repeating against a full mode render.

const CAVEMAN = `## Voice

Respond like a smart caveman: drop articles, filler, and pleasantries; fragments
are fine; short synonyms over long ones. Technical terms, code blocks, and quoted
errors stay exact.`;

const PROSE = `## Voice

Write in full, careful prose. Complete sentences throughout, connectives between
clauses, no fragments. Explain the reasoning as you would in a written report.`;

// Stands in for the conversation that pushes a session-start rule out of the
// fresh window. Deliberately mundane and rule-free: it must add distance without
// adding instructions that compete with the setting under test. Same construction
// as injection-cadence, so cells there stay comparable to cells here.
const HISTORY = Array.from(
  { length: 90 },
  (unused, turn) =>
    `Turn ${turn + 1}. Looked at the module and traced the call path through the ` +
    `loader into the transform step. Checked the fixtures directory and confirmed ` +
    `the sample payloads still parse. Noted that the retry path is exercised by ` +
    `the integration suite but not the unit suite. No changes made this turn.`,
).join("\n\n");

const SWITCH_NOTICE = `[mode switched to ship]\n\n${PROSE}`;

// Prose tasks, ported from voice-register so its cells stay comparable. Every
// one invites explanation rather than code, because register is only visible in
// prose and a reply that is mostly a fenced block has nothing to measure.
const TASKS = [
  {
    id: "explain-closure",
    prompt:
      "Explain what a JavaScript closure is and when you would reach for one.",
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

const ARTICLES = /\b(the|a|an)\b/gi;

function articleDensity(text) {
  const prose = text.replace(/```[\s\S]*?```/g, " ");
  const words = prose.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return 0;
  return (prose.match(ARTICLES) || []).length / words.length;
}

module.exports = {
  name: "mid-session-switch",
  kind: "model",
  question:
    "Does a mode switch part-way through a session change what the model does?",
  why: "The whole switching design rests on it and nothing has measured it. If a switch does not take hold mid-session, the honest design is to apply a mode at session start and ask for a restart.",

  // The floor: the old mode, never switched away from. Every other arm is asked
  // how far it moved from here.
  control: "never-switched",
  reps: 3,
  tasks: TASKS,

  arms: {
    // Old rules at session start, buried, and nothing switches. Should stay in
    // the old register.
    "never-switched": `${CAVEMAN}\n\n---\n\nEarlier in this session:\n\n${HISTORY}`,

    // Old rules at session start, buried, then the new rules arrive on the user's
    // message the way the hook would deliver them. This is the question.
    switched: `${CAVEMAN}\n\n---\n\nEarlier in this session:\n\n${HISTORY}`,

    // New rules from the start with no history at all -- what restarting the
    // session would give you. This is the target a switch has to match.
    "clean-start": PROSE,

    // New rules from the start, then the same burial. Separates "the switch was
    // ignored" from "burial breaks everything", which would otherwise be
    // indistinguishable when switched and never-switched come out level.
    "buried-start": `${PROSE}\n\n---\n\nEarlier in this session:\n\n${HISTORY}`,
  },

  // Only the switched arm carries injected context on the user message, because
  // only the switched arm is simulating the hook firing.
  userPrefix: {
    switched: SWITCH_NOTICE,
  },

  // A violation is the OLD register surviving: sparse articles, caveman-shaped.
  // So violations high means the switch did not take.
  fixtures: {
    clean: "A closure is a function that captures the surrounding scope, and the reason you would reach for one is to keep a piece of state alive between the calls that need it.",
    violating:
      "Closure captures scope. Use when callback needs outer variable. Keeps state without object.",
  },

  grade: (output) => ({
    violations: articleDensity(output) < 0.06 ? ["old register survived"] : [],
  }),

  articleDensity,
};
