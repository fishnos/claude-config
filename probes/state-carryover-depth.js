"use strict";

// Where does working from a loaded state file start to fail as the session grows?
//
// The context gauge's zone numbers (120K amber, 200K red) are guesses. Each arm
// loads the state file exactly as hooks/state-restore.js does after a clear,
// then buries it under N tokens of mundane history before the task. The first
// depth whose hit rate is significantly above depth-0 is where quality drops.
//
// Both the state and the filler sit in the appended system prompt, because 300K
// tokens of filler exceeds the argument limit the user-message prefix travels
// through. The real hook puts the state on the user message; position is a known
// difference from production.
//
// Filler is sized at 3 characters a token, measured 2026-09-14 rather than
// estimated. At the original estimate of 4, depth-300k came to 1,201,466
// characters, and the prompt carrying it measured 408,890 tokens; the filler
// dominates that total, so the true ratio is about 2.9 and every arm ran roughly
// 1.39 times its label. Three characters a token puts depth-300k near 300K.
//
// Cost, from the same smoke call: a cell is an agent loop, not one exchange.
// `claude -p` carries no turn limit here, and the largest arm took 14 turns and
// 2,067,133 tokens in total (417,687 written to cache, 1,649,316 read back).
// Budget the full run against that per-cell figure, not against the arm sizes.

const carryover = require("./state-carryover.js");

const DEPTHS = {
  "depth-0": 0,
  "depth-50k": 50000,
  "depth-100k": 100000,
  "depth-150k": 150000,
  "depth-200k": 200000,
  "depth-300k": 300000,
};
const CHARACTERS_PER_TOKEN = 3;
const TOPICS = [
  "the loader",
  "the retry path",
  "the fixture directory",
  "the integration suite",
  "the migration runner",
  "the cache layer",
  "the queue worker",
  "the report builder",
];

function filler(tokens) {
  const turns = [];
  let length = 0;
  for (let turn = 0; length < tokens * CHARACTERS_PER_TOKEN; turn += 1) {
    const topic = TOPICS[turn % TOPICS.length];
    const text =
      `Turn ${turn + 1}. Traced ${topic} and confirmed the call path still resolves ` +
      `through the adapter. Sample payloads parse. Left ${topic} unchanged and ` +
      `moved on to the next item.`;
    turns.push(text);
    length += text.length + 2;
  }
  return turns.join("\n\n");
}

let builtArms;

module.exports = {
  name: "state-carryover-depth",
  kind: "model",
  question:
    "At what context size does work from a loaded state file start to degrade?",
  why: "The gauge's 120K and 200K thresholds are guesses. Set too high, sessions degrade before the clear is suggested; too low, clears interrupt work that was going fine.",

  control: "depth-0",
  reps: 3,
  tasks: [carryover.tasks[0]],

  get arms() {
    if (builtArms === undefined) {
      const loaded = carryover.hookOutput("clear", carryover.STATE_FILE);
      builtArms = {};
      for (const [arm, tokens] of Object.entries(DEPTHS)) {
        builtArms[arm] =
          tokens === 0
            ? loaded
            : `${loaded}\n\n---\n\nEarlier in this session:\n\n${filler(tokens)}`;
      }
    }
    return builtArms;
  },

  fixtures: carryover.fixtures,
  grade: carryover.grade,
  DEPTHS,
};
