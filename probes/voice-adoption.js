"use strict";

// Does naming "the active voice skill" cost anything against naming it?
//
// The prose rule used to say `daniel-voice` outright. It now says "the active
// voice skill", so that a clone whose user built their own voice follows the
// same rule. That swaps a name for a description the session has to resolve
// against its skill listing, and a rule that needs resolving can be skipped.
//
// A cell runs with skills stripped, so nothing can load. Each arm carries the
// rule and a listing as text, and the grader asks only whether the reply says
// it would load the voice skill before drafting.
//
// Written and dry-run clean. Never executed: a run is 36 paid cells.

const LISTING = `## Available skills

- google-style: naming, comments and formatting for code.
- find-docs: fetches current documentation for a library.
- sam-voice: Writes in Sam Lee's voice for any prose task, including drafting, editing, polishing and rewriting.
- git-workflow: commit messages and branch mechanics.`;

const ASK = `Before you write anything, list on a first line starting "Skills:" the skills from the listing you would load for this task, or "Skills: none". Then do the task.`;

const NAMED = `${LISTING}

## Rules

- **Prose**: \`sam-voice\` writes. Nothing else decides how a sentence reads.`;

const ACTIVE = `${LISTING}

## Rules

- **Prose**: the active voice skill writes: the \`*-voice\` skill in your listing. When none is listed, write plain prose and say that no voice is active.`;

const TASKS = [
  {
    id: "cover-note",
    prompt: `${ASK}\n\nTask: write a three-sentence cover note to go with a scholarship application.`,
  },
  {
    id: "polish",
    prompt: `${ASK}\n\nTask: polish this sentence. "The results was good and we think that it will be useful to many peoples."`,
  },
  {
    id: "reflection",
    prompt: `${ASK}\n\nTask: write a short paragraph reflecting on a book you were asked to read for class.`,
  },
];

function skillsLine(output) {
  const line = output
    .split("\n")
    .find((candidate) => /^\s*\**skills\**\s*:/i.test(candidate));
  return line === undefined ? "" : line;
}

module.exports = {
  name: "voice-adoption",
  kind: "model",
  question:
    'Does a session told to use "the active voice skill" pick the listed voice skill as often as one told to use it by name?',
  why:
    "The prose rule in CLAUDE.md stopped naming one voice skill so that any user's own voice follows the same rule. If the indirect wording is skipped more often, every clone writes with no voice and nothing reports it.",
  control: "named",
  reps: 6,
  tasks: TASKS,
  arms: { named: NAMED, active: ACTIVE },
  fixtures: {
    clean: "Skills: sam-voice\n\nI am writing to submit my application.",
    violating: "Skills: none\n\nI am writing to submit my application.",
  },
  grade: (output) => ({
    violations: skillsLine(output).includes("sam-voice")
      ? []
      : ["did not name the voice skill before drafting"],
  }),
};
