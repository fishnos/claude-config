"use strict";

// Has work from a loaded state file degraded by 100K tokens of history? By 200K?
//
// The context gauge's amber threshold (120K) is a guess. Each arm loads the
// state file exactly as hooks/state-restore.js does after a clear, then buries
// it under N tokens of mundane history before the task. An arm whose hit rate is
// significantly above depth-0 is a depth where quality has dropped. Two arms
// bracket amber rather than locating the drop: this probe answers which side of
// the threshold is in trouble, not the exact token count where trouble starts.
//
// Three arms at six reps, not six arms at three, decided 2026-09-15. Two reasons.
// Power: at three reps the only result this probe's twoProportion can call
// significant is a clean 3/3 against 0/3, and even that is p=0.014 on a normal
// approximation where Fisher's exact says 0.10 — so five of the six arms could
// only ever report "no difference". At six reps a 6/6 against 0/6 is p=0.0005
// and partial separation can register at all. Scope: the red threshold is not
// actually in play. settings.json sets autoCompactWindow to 220,000, so red at
// 200K already leaves about one turn of runway and cannot usefully move up;
// amber is the only number a measurement can change. Bracketing amber at 100K
// and 200K answers that question on 1.8M tokens of prompt against 2.4M — which
// is the prompt total across all cells, not the run's cost; for that, apply the
// per-cell multiplier recorded below.
//
// Both the state and the filler sit in the appended system prompt, while the
// real hook puts the state on the user message. Position is a known difference
// from production and it is not yet justified. The original reason was that 300K
// tokens of filler exceeds the argument limit the user-message prefix travels
// through, but on 2026-09-15 both the old 300K arm (901,442 characters) and this
// probe's largest (601,398) passed through a spawned argument with ARG_MAX at
// 1,048,576. So either the limit lies somewhere other than ARG_MAX or the
// original attempt failed for another reason; nobody has re-tested the
// user-message path since the arms shrank. Worth settling before reading too
// much into a null result, because a state file buried in the system prompt is
// not where the hook puts it.
//
// Filler is sized at 3 characters a token, measured 2026-09-14 rather than
// estimated. At the original estimate of 4, a 300K arm came to 1,201,466
// characters, and the prompt carrying it measured 408,890 tokens; the filler
// dominates that total, so the true ratio is about 2.9 and every arm ran roughly
// 1.39 times its label. Three characters a token puts each arm near its label.
//
// Cost, from the same smoke call: a cell is an agent loop, not one exchange.
// `claude -p` carries no turn limit here, and the 300K arm took 14 turns and
// 2,067,133 tokens in total (417,687 written to cache, 1,649,316 read back) —
// about 6.9 times its own prompt. Budget against that multiplier, not against
// the arm sizes. depth-200k is now the largest arm and was never smoked at three
// characters a token; its turn count is assumed, not measured.

const carryover = require("./state-carryover.js");

const DEPTHS = {
  "depth-0": 0,
  "depth-100k": 100000,
  "depth-200k": 200000,
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
    "Has work from a loaded state file degraded by 100K tokens of history? By 200K?",
  why: "The gauge's 120K amber threshold is a guess, and above it every turn carries a nag to clear. Set too high, sessions degrade before the clear is suggested; too low, clears interrupt work that was going fine.",

  control: "depth-0",
  reps: 6,
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
