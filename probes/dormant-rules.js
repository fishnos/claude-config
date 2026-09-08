"use strict";

// Are the commit rules that never fire actually internalised, or were the
// temptations too weak?
//
// Six of nine commit rules sat at zero violations across 210 neutral trials.
// Zero could mean the rule is redundant or that nothing ever pushed against it.
// The distinction matters: a redundant rule is deletable, an untested one is not,
// and the earlier read of "redundant" was wrong for exactly this reason.
//
// Each task below is built to make the forbidden form the natural answer: an
// effect-led subject, a trailing period, a body long enough to want bullets.

const commitMessage = require("../hooks/lib/commit-message.js");

const RULES = `## Commits

Subject in imperative mood, under 50 characters, no trailing period: it completes
"if applied, this commit will ___".

Subject names what the change does, not that it was made. Name the thing, never a
stand-in for it: bug, issue, fault, problem, error, thing, fixes, cleanup are
placeholders. Counting is the worst version of this, because if you knew there
were three, you could name them or split the commit.

Open with the work, not with the result: "Modify the sentinel to stop warning",
never "Stop warning". Opening on stop, prevent, avoid, ensure, allow, let, keep,
leave, silence or disallow is the tell. "Make X do Y" is the exception.

Body wrapped at 72, written as prose in two to four short paragraphs, never as
bullets.`;

// Each prompt describes the change in language that leads straight to the
// prohibited form, so a model that has not internalised the rule will produce it.
const TASKS = [
  {
    id: "effect-led",
    prompt:
      "I changed the config sentinel so it no longer prints a warning when the " +
      "settings file is newer than the lockfile. Write the git commit message " +
      "for this change. Reply with the message only.",
  },
  {
    id: "counted",
    prompt:
      "While chasing one crash I fixed three faults in the retry helper: the " +
      "backoff multiplier was applied before the first sleep rather than after, " +
      "the jitter used Math.random() without a seed so retries synchronised " +
      "across workers, and a 429 was retried without reading Retry-After. " +
      "Write the git commit message. Reply with the message only.",
  },
  {
    id: "long-body",
    prompt:
      "Write a git commit message for a change that reworks the token refresh " +
      "path: it now refreshes ahead of expiry, retries once on a 401, and stops " +
      "sharing a mutable client between requests. Explain all of it thoroughly " +
      "in the body. Reply with the message only.",
  },
  {
    id: "prevent-led",
    prompt:
      "I added a guard that keeps the uploader from running twice when the user " +
      "double-clicks. Write the git commit message. Reply with the message only.",
  },
];

module.exports = {
  name: "dormant-rules",
  kind: "model",
  question:
    "Do the commit rules that never fire actually change behaviour under temptation?",
  why: "Six of nine sat at zero across 210 neutral trials. Zero means redundant or untested, and treating one as the other is how a working rule gets deleted.",

  control: "none",
  reps: 6,
  tasks: TASKS,

  arms: { none: "", ruled: RULES },

  // Fixtures must look like real model output, not like the ideal answer.
  // The first version used bare one-line strings; the gate passed, and every
  // real reply arrived as a fenced block behind a paragraph of preamble, so the
  // grader linted the preamble and both arms scored 100%. A fixture that does
  // not share the shape of the data proves nothing about the grader.
  fixtures: {
    clean:
      "Here is the message:\n\n```\nWiden the wait when supabase calls a token early\n\n" +
      "The client asked for a token before the session settled, so the\n" +
      "first call of a cold start failed and the retry masked it.\n```",
    violating:
      "Here is the message:\n\n```\nStop warning about the lockfile.\n\n" +
      "The warning fired constantly.\n```",
  },

  // `commitMessage.extract` parses a git command line rather than prose, and so
  // it is the wrong tool here. The message is whatever the model put in the first fenced
  // block, falling back to the whole reply when it used no fence.
  grade: (output) => {
    const fenced = /```(?:[a-z]*)\n([\s\S]*?)```/.exec(output);
    // No fence and a first line far past any subject length means the model
    // answered in prose rather than producing a message, usually to say it
    // needs facts the prompt withheld. That is a refusal, not a bad subject.
    if (fenced === null) {
      const firstLine = output.trim().split("\n")[0];
      if (firstLine.length > 72) return { violations: [], declined: true };
    }
    const message = (fenced ? fenced[1] : output).trim();
    return { violations: commitMessage.lint(message) };
  },
};
