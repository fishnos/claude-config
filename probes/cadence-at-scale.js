"use strict";

// Does re-assertion help once the burial is realistic?
//
// The first cadence probe buried the rule under about 6,600 tokens and found
// nothing: 0/36 either way. That is a mild burial. A real session pushes a
// session-start rule behind 100,000 tokens and a compaction, and the hook exists
// for exactly that case. This repeats the test with roughly an order of magnitude
// more distance, which is as far as a single prompt can carry it.

const naming = require("../tools/probe/graders/naming.js");
const cadence = require("./injection-cadence.js");

const RULE = `## Naming

Every name says what it holds, spelled out: \`table\` not \`tbl\`,
\`position_weight\` not \`pos_w\`, \`config\` not \`c\`, \`index\` not \`i\`
(loop counters i/j excepted). Prefer a named record over positional tuples.`;

// Varied rather than one line repeated: a repeated block compresses, and a model
// that notices the repetition is not reading 200,000 characters of history, it is
// reading one line and a count.
const TOPICS = [
  "the loader", "the transform step", "the retry path", "the fixture directory",
  "the integration suite", "the migration runner", "the cache layer", "the queue worker",
  "the auth middleware", "the report builder", "the export job", "the webhook receiver",
];
const HISTORY = Array.from({ length: 900 }, (unused, turn) => {
  const topic = TOPICS[turn % TOPICS.length];
  return (
    `Turn ${turn + 1}. Traced ${topic} and confirmed the call path still resolves ` +
    `through the adapter. Sample payloads parse. The branch is covered by the ` +
    `integration suite but not the unit suite, which matches what the notes said. ` +
    `Left ${topic} unchanged this turn and moved on to the next item on the list.`
  );
}).join("\n\n");

module.exports = {
  name: "cadence-at-scale",
  kind: "model",
  question: "Does re-asserting a rule help once it is buried behind a realistic session?",
  why: "The null came from a 6,600-token burial. The hook is for the 100,000-token case, which that did not test.",

  control: "none",
  reps: 5,
  tasks: cadence.tasks,

  arms: {
    none: "",
    buried: `${RULE}\n\n---\n\nEarlier in this session:\n\n${HISTORY}`,
    reasserted: `${RULE}\n\n---\n\nEarlier in this session:\n\n${HISTORY}\n\n---\n\n${RULE}`,
  },

  fixtures: cadence.fixtures,
  grade: (output, fixtureText) => naming.grade(output, fixtureText),
};
