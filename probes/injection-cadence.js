"use strict";

// Does re-asserting a rule at the freshest position beat stating it once when
// the original has been buried under conversation history?
//
// This is the single largest untested assumption in the mode design. The
// measured position finding was about where a rule sits *inside one prompt*.
// The UserPromptSubmit hook extrapolates from that to *repeating it every turn*,
// which is a different claim: plausible, and never measured. If re-assertion
// does not help, the hook is pure token cost and the mode system should render
// once at session start instead.

const naming = require("../tools/probe/graders/naming.js");

const RULE = `## Naming

Every name says what it holds, spelled out: \`table\` not \`tbl\`,
\`position_weight\` not \`pos_w\`, \`config\` not \`c\`, \`index\` not \`i\`
(loop counters i/j excepted). Prefer a named record over positional tuples.`;

// Stands in for the conversation history that pushes a session-start rule out of
// the fresh window. Content is deliberately mundane and rule-free: it must add
// distance without adding instructions that compete with the rule under test.
const HISTORY = Array.from(
  { length: 90 },
  (unused, turn) =>
    `Turn ${turn + 1}. Looked at the module and traced the call path through the ` +
    `loader into the transform step. Checked the fixtures directory and confirmed ` +
    `the sample payloads still parse. Noted that the retry path is exercised by ` +
    `the integration suite but not the unit suite. No changes made this turn.`,
).join("\n\n");

// Ported verbatim from the harness that measured a 46 percent violation rate
// with no rule present. The strength is in the surrounding file: every task
// hands the model a whole module saturated with abbreviations and asks it to add
// to *that file*, which invites matching the local style. A weaker fixture --
// two lines and "reply with code only" -- produced 0 percent in every arm
// including the control, and a floor leaves nothing for a rule to improve.
// Ported verbatim from the harness that measured a 46 percent violation rate
// with no rule present. The strength is in the surrounding file: every task
// hands the model a whole module saturated with abbreviations and asks it to add
// to *that file*, which invites matching the local style. A weaker fixture --
// two lines and "reply with code only" -- produced 0 percent in every arm
// including the control, and a floor leaves nothing for a rule to improve.
const TASKS = [
  {
    id: "n1-rows",
    fixture: "const DEFAULT_CFG = { pageSz: 50, srtDir: 'asc' };\n\nexport function getTbl(res: ApiRes) {\n  const arr = res.data;\n  const tmp = [];\n  for (let i = 0; i < arr.length; i++) {\n    const el = arr[i];\n    tmp.push({ pos: i, val: el.amount });\n  }\n  return tmp;\n}\n",
    prompt: "Here is the existing file src/report/rows.ts:\n\n```ts\nconst DEFAULT_CFG = { pageSz: 50, srtDir: 'asc' };\n\nexport function getTbl(res: ApiRes) {\n  const arr = res.data;\n  const tmp = [];\n  for (let i = 0; i < arr.length; i++) {\n    const el = arr[i];\n    tmp.push({ pos: i, val: el.amount });\n  }\n  return tmp;\n}\n```\n\nAdd a function to this file that returns the weighted average position from those rows, where each row has a position and a weight.",
  },
  {
    id: "n2-cfg",
    fixture: "const cfg = loadCfg();\nconst ctx = { db: cfg.db, cch: cfg.cch };\n\nexport function getCfgVal(k: string) {\n  const v = ctx[k];\n  return v == null ? null : v;\n}\n",
    prompt: "Here is the existing file src/boot/cfg.ts:\n\n```ts\nconst cfg = loadCfg();\nconst ctx = { db: cfg.db, cch: cfg.cch };\n\nexport function getCfgVal(k: string) {\n  const v = ctx[k];\n  return v == null ? null : v;\n}\n```\n\nAdd a function to this file that merges a partial configuration object over the defaults and returns the completed configuration.",
  },
  {
    id: "n3-buf",
    fixture: "let buf: Chunk[] = [];\nlet cnt = 0;\n\nexport function push(c: Chunk) {\n  buf.push(c);\n  cnt += c.len;\n}\n",
    prompt: "Here is the existing file lib/stream/buf.ts:\n\n```ts\nlet buf: Chunk[] = [];\nlet cnt = 0;\n\nexport function push(c: Chunk) {\n  buf.push(c);\n  cnt += c.len;\n}\n```\n\nAdd a function to this file that flushes the buffer to a handler once it exceeds a maximum size.",
  },
  {
    id: "n4-err",
    fixture: "export function fmtErr(res: Response, msg?: string) {\n  const st = res.status;\n  const txt = res.statusText;\n  return `${st} ${txt}${msg ? ': ' + msg : ''}`;\n}\n",
    prompt: "Here is the existing file lib/http/err.ts:\n\n```ts\nexport function fmtErr(res: Response, msg?: string) {\n  const st = res.status;\n  const txt = res.statusText;\n  return `${st} ${txt}${msg ? ': ' + msg : ''}`;\n}\n```\n\nAdd a function to this file that decides whether a response is worth retrying, based on its status code.",
  },
  {
    id: "n5-group",
    fixture: "export function findEls(sel: string) {\n  const els = document.querySelectorAll(sel);\n  return Array.from(els);\n}\n",
    prompt: "Here is the existing file ui/dom/grp.ts:\n\n```ts\nexport function findEls(sel: string) {\n  const els = document.querySelectorAll(sel);\n  return Array.from(els);\n}\n```\n\nAdd a function to this file that groups elements by the value of a given data attribute and returns a Map.",
  },
  {
    id: "n6-debounce",
    fixture: "export function thr(fn: () => void, ms: number) {\n  let last = 0;\n  return () => {\n    const n = Date.now();\n    if (n - last > ms) { last = n; fn(); }\n  };\n}\n",
    prompt: "Here is the existing file lib/util/fns.ts:\n\n```ts\nexport function thr(fn: () => void, ms: number) {\n  let last = 0;\n  return () => {\n    const n = Date.now();\n    if (n - last > ms) { last = n; fn(); }\n  };\n}\n```\n\nAdd a debounce helper to this file that takes a callback and a delay in milliseconds.",
  },
];

module.exports = {
  name: "injection-cadence",
  kind: "model",
  question:
    "Does re-asserting a rule after a long history beat stating it once at the start?",
  why: "The UserPromptSubmit hook re-injects every turn. That extrapolates the position finding from within-one-prompt to across-turns, which was never measured. If it does not help, the hook is cost with no benefit.",

  control: "none",
  reps: 6,
  tasks: TASKS,

  arms: {
    // No rule at all. Establishes what the temptation is worth on its own.
    none: "",
    // Stated once, then buried under history -- a session-start load.
    buried: `${RULE}\n\n---\n\nEarlier in this session:\n\n${HISTORY}`,
    // Same distance, then stated again at the freshest position -- the hook.
    reasserted: `${RULE}\n\n---\n\nEarlier in this session:\n\n${HISTORY}\n\n---\n\n${RULE}`,
  },

  fixtures: {
    clean: "function activeRowsByOwner(rows) { const grouped = {}; return grouped; }",
    violating: "function actRowsByOwn(rows) { const grp = {}; return grp; }",
  },

  grade: (output, fixtureText) => naming.grade(output, fixtureText),
};
