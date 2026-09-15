# Context Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep long sessions sharp by clearing early at natural stopping points, with a per-repository state file that carries goal, instructions, decisions, rejections and progress across the clear, and graphify answering how the code works on demand.

**Architecture:** A gitignored `.claude/state.md` in each repository is loaded by a SessionStart hook according to how the session started. A UserPromptSubmit hook reads the context size from the transcript tail and, past 120K tokens, tells Claude to update the file and suggest `/clear` at the next stopping point; a Stop hook refuses a clear suggestion made without updating the file. The session-start audit makes a missing state file or graph a visible banner, `/repo-setup context` fixes both in one step, and a detached `graphify update` keeps the graph current.

**Tech Stack:** Node.js CommonJS, no dependencies. Plumbing in `hooks/lib/hook-io.js`; regression suite `tools/test-hooks.js`; behavioural probes run by `tools/ccfg.js probe` (`tools/probe/`); graphify CLI at `~/.local/bin/graphify`.

**Spec:** `docs/superpowers/specs/2026-09-11-context-management-design.md`

## Global Constraints

- **Never commit, never push.** `hooks/git-guard.js` enforces it. Each task ends by stopping, showing the suite summary, and handing the listed files to the operator, who commits with `/commit`. Never use `CLAUDE_ALLOW_COMMIT=1`. Commit messages carry no trailers of any kind.
- **`settings.json` carries unrelated uncommitted operator edits** (the `ecc` plugin removal and an `autoMode` block). Never stage `settings.json`; tell the operator which hunk belongs to the task.
- **Checkpoint after every task.** Finish it, show the output, stop. Do not roll tasks together.
- **No new dependencies.** Node built-ins and `hooks/lib/` only.
- **No hook makes a model call** (spec section 6). The only external program a hook may start is `graphify update`.
- **Every hook body runs inside `io.run()`**, and writes stdout only through `hooks/lib/hook-io.js` (`warn`, `announce`, `block`).
- **Tests first, watched to fail for the right reason**, then the code. Tests run hooks against temporary directories with `CLAUDE_CONFIG_DIR` pointed at a temporary config; no test writes the live `~/.claude/cache`, and none reads or writes a real `.claude/state.md`. (`skills/repo-setup/audit.js` loads its libraries from the real config, so its tests may read, never write, the live `cache/repo-setup/`.)
- **Test runner:** `node ~/.claude/tools/test-hooks.js`, ending `PASS n  SKIP n  FAIL n`. The `run()` helper returns verdicts `"DENY"`, `"warn"`, `"BLOCK"`, `"allow"`, `"?raw"`. After adding cases, set `covering N cases` in `docs/hooks.md` to PASS + SKIP; `node ~/.claude/hooks/validate-config.js` checks that number.
- **Naming** spelled out (`transcriptPath`, not `tp`; `index`, not `idx`; loop counters `i`/`j` excepted). Comments give only a non-obvious why.
- **Numbers from the spec, verbatim:** state file capped at 8,000 characters when loaded; green under 120K tokens, amber 120K to 200K, red about 200K; staleness line after 8 unchanged turns; transcript tail 256 KB; `autoCompactWindow` 400000 to 220000.
- **Probe runs spend real usage.** Show the `--dry-run` cell count and get the operator's go before any run that is not a dry run.

## Settled while planning (spec section 5)

- **Where the Stop hook finds the final assistant message:** in the payload. Claude Code 2.1.270 declares `last_assistant_message` ("Text content of the last…") on the Stop input, read from the program's strings on 2026-09-12. The clear gate reads it and falls back to the transcript tail.
- **graphify's command line has a token cap:** `graphify query "<question>" --budget N` (default 2000), from `graphify --help`. Not yet run.
- **A compaction leaves** `{"type":"system","subtype":"compact_boundary","compactMetadata":{"trigger","preTokens","postTokens"}}` in the transcript; 65 such lines in transcripts modified since 2026-07-28.
- **A mode switch keeps hooks added to `settings.json` by hand** (`tools/modes/apply.js:245-264`), so wiring new hooks there survives `ccfg mode`.

## Where this plan departs from the spec

1. **Change detection uses a content digest, not a modification time.** The keyword capture (Task 7) writes into the same file Claude edits, so a modification time cannot tell Claude's checkpoint from the hook's write. The gauge stores a SHA-1 of the file with the Unconfirmed section's body removed; the gate and the staleness line compare that. It keeps no turn start time, which only a time comparison needed.
2. **Without a state file the keyword capture keeps writing `cache/constraints/`.** Spec 3.4 and its section 4 test say it "behaves as it does today"; spec 3.6 says nothing writes that directory any more. This plan follows 3.4, so `hooks/lib/session-cache.js` and `cache/constraints/` stay. **Operator to confirm** before Task 7.
3. **The clear gate refreshes the graph whenever one exists; the SessionStart hook only when stale.** Uncommitted edits made during a session do not move `.git/logs/HEAD`, so a staleness check at clear time would skip exactly the refresh the gate exists for.
4. **`tools/context-report.js` is built first (Task 1)**, with the transcript reader it shares with the gauge. The spec names the script but gives it no build step.
5. **`/repo-setup context` is a subcommand of `skills/repo-setup/audit.js`**, so the one-step setup is a tested script rather than prose Claude follows.
6. **The probe's compaction arm uses a summary made once by `claude -p`**, an approximation of the harness's own summary, which a probe cannot trigger.
7. **The graph refresh has a test-only foreground switch** (`CLAUDE_GRAPH_REFRESH_FOREGROUND=1`), following `CLAUDE_REVIEW_MARKER_DIR` in `hooks/review-reminder.js`, so tests read the fake graphify's record without waiting on a detached process.
8. **A state file identical to the template loads nothing.** Spec 3.5 loads the file on every clear, compaction and startup; for a freshly scaffolded file that would put a "Resuming: (no goal recorded)" banner in front of every session in every set-up repository.

## Task map

| Spec build step                                  | Tasks                                                          |
| ------------------------------------------------ | -------------------------------------------------------------- |
| 1. Probe and baseline                            | 1 (transcript reader, context report), 2 (probe, baseline run) |
| 2. Template, audit, banner, `/repo-setup` action | 3                                                              |
| 3. Restart hook, retire pre-compact              | 4                                                              |
| 4. Context gauge and clear gate                  | 5, 6 (one commit, at the end of 6)                             |
| 5. Keyword capture into Unconfirmed              | 7                                                              |
| 6. Graph refresh                                 | 8                                                              |
| 7. `autoCompactWindow`                           | 9                                                              |
| 8. Second probe run, zone numbers                | 10                                                             |
| 9. CLAUDE.md graphify paragraph                  | 11 (only if the operator agrees)                               |

---

### Task 1: Transcript reader and context report

**Files:**

- Create: `hooks/lib/transcript-tail.js`
- Create: `tools/context-report.js`
- Test: `tools/test-hooks.js` (new section before the closing cleanup at the end of the file)
- Modify: `docs/hooks.md` (case count; one sentence in the `hooks/lib/` paragraph)

**Interfaces:**

- Produces:
  - `TAIL_BYTES` (number, 262144)
  - `parseLines(text: string) -> object[]`: JSONL entries; unparseable lines skipped.
  - `contextTokens(entry) -> number | null`: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` for a main-thread (`isSidechain !== true`) assistant entry with usage; otherwise null.
  - `latestContextTokens(transcriptPath: string, byteCount = TAIL_BYTES) -> number`: latest main-thread size in the tail; 0 when none, when the file is missing, or when a `compact_boundary` follows the last turn.
  - `summarize(entries: object[], thresholdTokens: number) -> { peakTokens, turnsOver, compactions: [{ trigger, preTokens }] }`: `turnsOver` counts distinct `requestId`s above the threshold.

- [ ] **Step 1: Write the failing tests**

Insert before the line `fs.rmSync(repo, { recursive: true, force: true });` at the end of `tools/test-hooks.js`:

```js
header("lib/transcript-tail: context size from the end of a transcript");
{
  const transcriptTail = require(path.join(HOOKS, "lib", "transcript-tail.js"));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-tail-"));
  const assistantEntry = (tokens, extra = {}) => ({
    type: "assistant",
    isSidechain: false,
    requestId: "request-" + tokens,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: tokens - 1002,
        cache_creation_input_tokens: 1000,
        output_tokens: 50,
      },
    },
    ...extra,
  });
  const boundary = {
    type: "system",
    subtype: "compact_boundary",
    compactMetadata: { trigger: "auto", preTokens: 368000 },
  };
  const writeTranscript = (name, entries, prefix = "") => {
    const file = path.join(scratch, name);
    fs.writeFileSync(
      file,
      prefix + entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );
    return file;
  };
  const latest = (file) => transcriptTail.latestContextTokens(file);

  check(
    "sums input, cache-read and cache-creation tokens",
    latest(writeTranscript("sum.jsonl", [assistantEntry(150000)])),
    150000,
    "",
  );
  check(
    "the latest main-thread turn wins",
    latest(
      writeTranscript("latest.jsonl", [
        assistantEntry(90000),
        assistantEntry(130000),
      ]),
    ),
    130000,
    "",
  );
  check(
    "a subagent turn is not the main thread",
    latest(
      writeTranscript("sidechain.jsonl", [
        assistantEntry(60000),
        assistantEntry(250000, { isSidechain: true }),
      ]),
    ),
    60000,
    "",
  );
  check(
    "a compaction after the last turn reads as 0",
    latest(
      writeTranscript("compacted.jsonl", [assistantEntry(368000), boundary]),
    ),
    0,
    "",
  );
  const filler =
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "x".repeat(300 * 1024) },
    }) + "\n";
  check(
    "finds the turn when earlier history exceeds the tail",
    latest(
      writeTranscript("long-history.jsonl", [assistantEntry(140000)], filler),
    ),
    140000,
    "",
  );
  check(
    "a transcript with no assistant turn reads as 0",
    latest(
      writeTranscript("no-turn.jsonl", [
        { type: "user", message: { role: "user", content: "hi" } },
      ]),
    ),
    0,
    "",
  );
  check(
    "a missing transcript reads as 0",
    latest(path.join(scratch, "absent.jsonl")),
    0,
    "",
  );

  const summary = transcriptTail.summarize(
    [
      assistantEntry(250000, { requestId: "a" }),
      assistantEntry(250000, { requestId: "a" }),
      assistantEntry(210000, { requestId: "b" }),
      assistantEntry(90000, { requestId: "c" }),
      boundary,
    ],
    200000,
  );
  check("summary keeps the peak", summary.peakTokens, 250000, "");
  check(
    "summary counts each request over the threshold once",
    summary.turnsOver,
    2,
    "",
  );
  check(
    "summary records the compaction trigger and size",
    summary.compactions
      .map((compaction) => `${compaction.trigger}:${compaction.preTokens}`)
      .join(","),
    "auto:368000",
    "",
  );
  fs.rmSync(scratch, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run the suite and watch it fail**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | tail -5`
Expected: the suite crashes with `Error: Cannot find module '…/hooks/lib/transcript-tail.js'`. Any other error means the test code itself is wrong; fix that first.

- [ ] **Step 3: Write `hooks/lib/transcript-tail.js`**

```js
"use strict";

// What the model last saw, read from the end of a session transcript.
//
// The context gauge reads this on every prompt and tools/context-report.js reads
// it across every transcript on disk. Both count the same way, or zone numbers
// tuned from the report would not describe what the gauge measures.

const fs = require("fs");

// A whole transcript passes 10 MB, and the gauge runs in front of every prompt.
const TAIL_BYTES = 256 * 1024;

function parseLines(text) {
  const entries = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // The first line of a tail is usually cut mid-record.
    }
  }
  return entries;
}

function readTail(file, byteCount) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, "r");
    const size = fs.fstatSync(descriptor).size;
    const length = Math.min(size, byteCount);
    const buffer = Buffer.alloc(length);
    fs.readSync(descriptor, buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function isCompactBoundary(entry) {
  return (
    Boolean(entry) &&
    entry.type === "system" &&
    entry.subtype === "compact_boundary"
  );
}

function contextTokens(entry) {
  if (!entry || entry.type !== "assistant" || entry.isSidechain === true)
    return null;
  const usage = entry.message && entry.message.usage;
  if (!usage) return null;
  return (
    (usage.input_tokens || 0) +
    (usage.cache_read_input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0)
  );
}

/**
 * Context size of the latest main-thread turn, or 0 when there is none.
 *
 * A compaction boundary after the last turn means the recorded size describes
 * history that no longer exists, so it reads as 0 until the next turn.
 */
function latestContextTokens(transcriptPath, byteCount = TAIL_BYTES) {
  if (!transcriptPath) return 0;
  const entries = parseLines(readTail(transcriptPath, byteCount));
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (isCompactBoundary(entries[index])) return 0;
    const tokens = contextTokens(entries[index]);
    if (tokens !== null) return tokens;
  }
  return 0;
}

/**
 * Peak context, turns over a threshold, and compactions for one transcript.
 *
 * The transcript writes one entry per content block and each repeats the
 * request's usage, so turns are counted once per request.
 */
function summarize(entries, thresholdTokens) {
  let peakTokens = 0;
  const requestsOver = new Set();
  const compactions = [];
  for (const entry of entries) {
    if (isCompactBoundary(entry)) {
      const metadata = entry.compactMetadata || {};
      compactions.push({
        trigger: metadata.trigger || "unknown",
        preTokens: metadata.preTokens || 0,
      });
      continue;
    }
    const tokens = contextTokens(entry);
    if (tokens === null) continue;
    if (tokens > peakTokens) peakTokens = tokens;
    if (tokens > thresholdTokens)
      requestsOver.add(entry.requestId || entry.uuid);
  }
  return { peakTokens, turnsOver: requestsOver.size, compactions };
}

module.exports = {
  TAIL_BYTES,
  parseLines,
  contextTokens,
  latestContextTokens,
  summarize,
};
```

- [ ] **Step 4: Run the suite and watch it pass**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | grep -A12 "lib/transcript-tail" ; node ~/.claude/tools/test-hooks.js 2>&1 | tail -1`
Expected: all ten new cases `[PASS]`; last line `PASS 338  SKIP 0  FAIL 0`.

- [ ] **Step 5: Confirm a test can fail for the right reason**

Temporarily change `if (isCompactBoundary(entries[index])) return 0;` to `continue;`, rerun, and confirm exactly `a compaction after the last turn reads as 0` fails with `-> 368000`. Restore the line and rerun to green.

- [ ] **Step 6: Write `tools/context-report.js`**

```js
#!/usr/bin/env node
"use strict";

// How much context sessions carry, and how often they compact.
//
// Run by hand. Two weeks after the context-management rollout, repeat the
// 2026-09-11 measurement in docs/superpowers/specs/2026-09-11-context-management-design.md
// and compare: turns above 200K and compactions per week should both have fallen.
//
// Usage: node ~/.claude/tools/context-report.js [--since YYYY-MM-DD]

const fs = require("fs");
const os = require("os");
const path = require("path");

const transcriptTail = require(
  path.join(__dirname, "..", "hooks", "lib", "transcript-tail.js"),
);

const configDir =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const OVER_TOKENS = 200000;
const DAY_MS = 86400000;
const BUCKETS = [
  { label: "under 100K", below: 100000 },
  { label: "100K to 200K", below: 200000 },
  { label: "200K to 400K", below: 400000 },
  { label: "over 400K", below: Infinity },
];

// One level down only: subagent transcripts sit deeper, under the session's
// own directory, and counting them would add thousands of empty "sessions".
function sessionTranscripts(projectsDir, sinceMs) {
  const files = [];
  let projects = [];
  try {
    projects = fs.readdirSync(projectsDir);
  } catch {
    return files;
  }
  for (const project of projects) {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(projectsDir, project));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const file = path.join(projectsDir, project, entry);
      try {
        if (fs.statSync(file).mtimeMs >= sinceMs) files.push(file);
      } catch {
        // Removed while scanning.
      }
    }
  }
  return files;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function thousands(tokens) {
  return `${Math.round(tokens / 1000)}K`;
}

function main() {
  const args = process.argv.slice(2);
  const sinceArgument = args.includes("--since")
    ? args[args.indexOf("--since") + 1]
    : null;
  const sinceMs = sinceArgument
    ? Date.parse(sinceArgument)
    : Date.now() - 14 * DAY_MS;
  if (Number.isNaN(sinceMs)) {
    console.error("--since takes a date: YYYY-MM-DD");
    process.exit(2);
  }

  const files = sessionTranscripts(path.join(configDir, "projects"), sinceMs);
  const bucketCounts = BUCKETS.map(() => 0);
  const compactions = [];
  let turnsOver = 0;
  let compactedSessions = 0;

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const summary = transcriptTail.summarize(
      transcriptTail.parseLines(text),
      OVER_TOKENS,
    );
    bucketCounts[
      BUCKETS.findIndex((bucket) => summary.peakTokens < bucket.below)
    ] += 1;
    turnsOver += summary.turnsOver;
    if (summary.compactions.length > 0) compactedSessions += 1;
    compactions.push(...summary.compactions);
  }

  const weeks = Math.max((Date.now() - sinceMs) / (7 * DAY_MS), 1 / 7);
  const byTrigger = (trigger) =>
    compactions.filter((compaction) => compaction.trigger === trigger);
  const lines = [
    `Sessions modified since ${new Date(sinceMs).toISOString().slice(0, 10)}: ${files.length}`,
    "",
    "Largest context a session reached:",
    ...BUCKETS.map(
      (bucket, index) => `  ${bucket.label.padEnd(14)} ${bucketCounts[index]}`,
    ),
    "",
    `Turns above ${thousands(OVER_TOKENS)}: ${turnsOver}`,
    `Compactions: ${compactions.length} in ${compactedSessions} sessions (${(compactions.length / weeks).toFixed(1)} a week)`,
  ];
  for (const trigger of ["auto", "manual"]) {
    const matching = byTrigger(trigger);
    lines.push(
      `  ${trigger.padEnd(7)} ${matching.length}, median ${thousands(median(matching.map((compaction) => compaction.preTokens)))} before`,
    );
  }
  console.log(lines.join("\n"));
}

main();
```

- [ ] **Step 7: Check the report reproduces the spec's measurement**

Run: `node ~/.claude/tools/context-report.js --since 2026-07-28`
Expected, against the spec's table: at least 2,861 sessions (more have been written since); bucket counts in the same proportions (about 95% under 100K); automatic compactions with a median near 368K and manual near 390K. If the automatic median is far from 368K, stop and report: the reader counts differently from the measurement the zone numbers came from.

- [ ] **Step 8: Update docs and run the validator**

In `docs/hooks.md`, set `covering 328 cases` to the new PASS + SKIP total, and add to the `hooks/lib/` paragraph, after the `repo-audit.js` clause: "`transcript-tail.js` for reading the context size from the end of a transcript, which `tools/context-report.js` also uses;".

Run: `node ~/.claude/hooks/validate-config.js 2>&1 | tail -5`
Expected: no failed checks.

- [ ] **Step 9: Checkpoint**

Stop. Show the suite summary and the report output. Files for the operator: `hooks/lib/transcript-tail.js`, `tools/context-report.js`, `tools/test-hooks.js`, `docs/hooks.md`. Suggested subject: `Read context size from the transcript tail`.

### Task 2: The state-carryover probe and its baseline run

A scripted session settles an instruction, a decision, a rejected approach and a next step. Each arm continues in a fresh context holding only what its condition carries. Arm text is delivered on the user's message (`userPrefix`), because a SessionStart hook's context and a compaction summary both arrive there.

Baseline arms: `clear-bare` (control: a clear with nothing loaded), `compact` (a compaction summary plus today's handoff text), `clear-state` (a clear with the state file, using the exact preamble Task 4's hook will emit). Task 10 re-runs with `compact` and `clear-state` generated by the real hook.

**Files:**

- Create: `probes/state-carryover.js`
- Create: `probes/fixtures/state-carryover/handoff.md` (generated in Step 3)
- Create: `probes/fixtures/state-carryover/compaction-summary.md` (generated in Step 4)

**Interfaces:**

- Consumes: `tools/probe/graders/naming.js` `grade(output, fixtureText) -> { violations }`; the model-probe contract in `tools/probe/probes.js` (`name`, `kind: "model"`, `question`, `why`, `control`, `reps`, `tasks[{ id, prompt, fixture }]`, `arms`, `userPrefix`, `fixtures.{clean,violating}`, `grade`).
- Produces: `CLEAR_PREAMBLE` (string) and `STATE_FILE` (string), exported for Task 4's test and Task 10; `userTurns() -> string[]`; `summaryPrompt() -> string`.

- [ ] **Step 1: Write `probes/state-carryover.js`**

`probes/` loads only top-level `.js` files, so the `fixtures/` subdirectory is never mistaken for a probe.

````js
"use strict";

// Does a state file carry work across a fresh context better than a bare clear
// or a compaction summary?
//
// The context-management design (docs/superpowers/specs/2026-09-11-context-management-design.md)
// trades late compaction for an early /clear plus a state file a SessionStart
// hook loads. The trade is worth making only if the file carries what a clear
// would otherwise lose, so the acceptance test is that clear-state beats both
// other arms.
//
// Each arm's text sits on the user's message, where the real mechanism puts it:
// SessionStart context and the compaction summary both arrive there.
//
// A cell is a hit on any of three failures: worker_threads proposed again (the
// rejected approach), an abbreviated identifier (against the instruction), or
// no backpressure on 'drain' (the next step not taken).
//
// fixtures/state-carryover/handoff.md is the real output of the retired
// constraint-capture, pre-compact and handoff-restore hooks over this session's
// user turns. fixtures/state-carryover/compaction-summary.md came from one
// `claude -p --safe-mode "$(summaryPrompt())"`; it approximates the harness's own
// summary, which a probe cannot trigger.

const fs = require("fs");
const path = require("path");

const naming = require("../tools/probe/graders/naming.js");

const FIXTURE_DIR = path.join(__dirname, "fixtures", "state-carryover");

function readFixture(name) {
  try {
    return fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
  } catch {
    return "";
  }
}

const KEY_TURNS = [
  "User: We're adding a streaming CSV export to ledger-export. Exports reach 2 GB, so nothing may hold a whole export in memory.",
  "Assistant: Understood. I'll build it as a stream pipeline: format each row, then write through a writable stream.",
  "User: Two rules for this work. From now on spell every identifier out in full: no `buf`, `cnt`, `idx` or `row_cnt`. And never add npm dependencies; Node built-ins only.",
  "Assistant: Noted: full names, built-ins only.",
  "Assistant: Wrote src/export/format-row.js: formatRow(ledgerEntry) returns one CSV line with quoting. Its tests pass.",
  "User: Row formatting is slow on the 2 GB fixture. Can we parallelise it?",
  "Assistant: Tried worker_threads with a pool of four workers formatting chunks. Rows came back interleaved: `AssertionError [ERR_ASSERTION]: row 1042 written before row 1041`. Reordering them would mean buffering chunks, which breaks the memory rule. Reverted.",
  "User: Drop parallelism then. Keep it single-threaded.",
  "Assistant: Decision: a single-threaded Transform stream. Formatting speed is acceptable once writes stop blocking.",
  "Assistant: Profiled the write path. src/export/write-export.js calls stream.write() in a loop and ignores its return value, so memory climbs to 1.8 GB on the fixture. Next: add backpressure in writeExport, stopping when write() returns false and resuming on the 'drain' event.",
];

// Mundane and rule-free, so it adds the distance a summarizer has to compress
// without adding instructions that compete with the ones under test.
const FILLER_TOPICS = [
  "src/import/read-ledger.js",
  "the fixture generator",
  "the CI config",
  "src/export/column-order.js",
  "the README's export section",
  "the date formatter",
];
const SESSION_TRANSCRIPT = KEY_TURNS.flatMap((turn, turnIndex) => [
  turn,
  ...Array.from({ length: 3 }, (unused, fillerIndex) => {
    const topic =
      FILLER_TOPICS[(turnIndex * 3 + fillerIndex) % FILLER_TOPICS.length];
    return `Assistant: Checked ${topic} while I was there. It still matches the notes and nothing in it touches the export path. No changes made.`;
  }),
]).join("\n\n");

const STATE_FILE = `# Working state

## Goal

Streaming CSV export for ledger-export that never holds a whole export (up to 2 GB) in memory.

## Instructions

- "From now on spell every identifier out in full: no \`buf\`, \`cnt\`, \`idx\` or \`row_cnt\`."
- "And never add npm dependencies; Node built-ins only."

## Unconfirmed

## Decisions

- Single-threaded Transform stream: formatting speed is fine once writes stop blocking.

## Rejected

- worker_threads pool for row formatting: rows interleaved (\`AssertionError [ERR_ASSERTION]: row 1042 written before row 1041\`); reordering needs buffering, which breaks the memory rule.

## Progress

- Done: src/export/format-row.js, formatRow(ledgerEntry), tested.
- In progress: nothing.
- Next: backpressure in writeExport (src/export/write-export.js): stop when write() returns false, resume on 'drain'.

## Hot files

- src/export/write-export.js: gets the backpressure change.
- src/export/format-row.js: the row formatter it calls.

## Where to look

## Open questions
`;

// Must match hooks/state-restore.js (Task 4) word for word; its test checks.
const CLEAR_PREAMBLE =
  "This session started with /clear. Below is .claude/state.md, the working " +
  "record for this repository. Re-read the files under Hot files and run " +
  'the queries under Where to look as `graphify query "<question>" ' +
  "--budget 1500`, never through the /graphify skill; then continue from " +
  "the next step under Progress without asking.\n\n";

const COMPACTION_PREAMBLE =
  "This session is being continued from a previous conversation that ran " +
  "out of context. The conversation is summarized below:\n\n";

const REJECTED_IMPORT =
  /require\(\s*["'](?:node:)?worker_threads["']\s*\)|from\s+["'](?:node:)?worker_threads["']|new\s+Worker\s*\(/;
const REJECTED_PROPOSAL =
  /(?<!(?:\bnot|\bnever|\bavoid|\bwithout|n't)\s+)\b(?:use|using|try|trying|reintroduce|switch to)\s+`?(?:node:)?worker_threads/i;

function grade(output, fixtureText = "") {
  const violations = [];
  if (REJECTED_IMPORT.test(output) || REJECTED_PROPOSAL.test(output))
    violations.push("proposed worker_threads again");
  const abbreviated = naming.grade(output, fixtureText).violations;
  if (abbreviated.length > 0)
    violations.push(`abbreviated: ${abbreviated.join(", ")}`);
  if (!/\bdrain\b/.test(output))
    violations.push("next step not taken (backpressure on drain)");
  return { violations };
}

function userTurns() {
  return KEY_TURNS.filter((turn) => turn.startsWith("User: ")).map((turn) =>
    turn.slice("User: ".length),
  );
}

function summaryPrompt() {
  return (
    "Summarize this conversation so the work can continue in a new context " +
    "window. Cover the user's requests, decisions, files touched, errors and " +
    "fixes, and the current work and next step.\n\n<conversation>\n" +
    SESSION_TRANSCRIPT +
    "\n</conversation>"
  );
}

module.exports = {
  name: "state-carryover",
  kind: "model",
  question:
    "After a fresh context, does a state file carry instructions, rejections and the next step better than a bare clear or a compaction?",
  why: "The context-management design clears early and relies on .claude/state.md to carry the work. If the file does not beat a compaction summary, early clears lose more than they save.",

  control: "clear-bare",
  reps: 3,
  tasks: [
    {
      id: "carry-on",
      prompt:
        "Carry on with the export work: write the code for the next step.",
      fixture: STATE_FILE,
    },
    { id: "go", prompt: "go", fixture: STATE_FILE },
  ],

  arms: { "clear-bare": "", compact: "", "clear-state": "" },
  userPrefix: {
    compact: `${COMPACTION_PREAMBLE}${readFixture("compaction-summary.md")}\n\n${readFixture("handoff.md")}`,
    "clear-state": `${CLEAR_PREAMBLE}${STATE_FILE}`,
  },

  fixtures: {
    clean: [
      "Adding backpressure to writeExport now.",
      "",
      "```js",
      "async function writeExport(ledgerEntries, destination) {",
      "  for (const ledgerEntry of ledgerEntries) {",
      "    const accepted = destination.write(formatRow(ledgerEntry));",
      '    if (!accepted) await once(destination, "drain");',
      "  }",
      "}",
      "```",
    ].join("\n"),
    violating: [
      "Let me speed this up with worker_threads instead.",
      "",
      "```js",
      'const { Worker } = require("worker_threads");',
      "const buf = [];",
      "```",
    ].join("\n"),
  },

  grade,
  CLEAR_PREAMBLE,
  STATE_FILE,
  userTurns,
  summaryPrompt,
};
````

- [ ] **Step 2: Prove the grader separates its fixtures before anything is spent**

Run: `node ~/.claude/tools/ccfg.js probe run state-carryover --dry-run`
Expected: `state-carryover  18 cells (3 arms x 2 tasks x 3 reps)` and `0 already filled, 18 to run, nothing spent`. A `grader flags its own clean fixture` or `grader sees no violation` line means the grader is broken: fix it before going on.

- [ ] **Step 3: Freeze today's handoff text from the real hooks**

These hooks are deleted in Task 4, so their output is captured now. A temporary config directory holds a copy of `mode.lock`, so nothing is written under the live `cache/`. The capture runs with a non-repository `cwd`.

```bash
mkdir -p ~/.claude/probes/fixtures/state-carryover
HANDOFF_CONFIG=$(mktemp -d) && cp ~/.claude/mode.lock "$HANDOFF_CONFIG/"
node -e '
const { spawnSync } = require("child_process");
const path = require("path");
const configDir = process.argv[1];
const hooks = path.join(require("os").homedir(), ".claude", "hooks");
const probe = require(path.join(hooks, "..", "probes", "state-carryover.js"));
const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
const runHook = (hook, payload) => spawnSync(process.execPath, [path.join(hooks, hook)], { input: JSON.stringify(payload), env, encoding: "utf8", cwd: configDir }).stdout;
for (const prompt of probe.userTurns()) runHook("constraint-capture.js", { session_id: "carryover", prompt, cwd: configDir });
runHook("pre-compact.js", { session_id: "carryover", trigger: "auto" });
process.stdout.write(JSON.parse(runHook("handoff-restore.js", { session_id: "carryover", source: "compact" })).hookSpecificOutput.additionalContext);
' "$HANDOFF_CONFIG" > ~/.claude/probes/fixtures/state-carryover/handoff.md
rm -rf "$HANDOFF_CONFIG"
```

Read `handoff.md`. Expected: the "This session was just compacted" preamble, a Mode line, and under the keyword heading exactly the two instruction sentences (`From now on spell…` and `And never add…`). Anything more or less means the keyword list has moved; record what was captured.

- [ ] **Step 4: Generate the compaction summary (one model call; operator's go first)**

```bash
SUMMARY_CWD=$(mktemp -d) && cd "$SUMMARY_CWD" && claude -p --safe-mode "$(node -e 'console.log(require(require("os").homedir() + "/.claude/probes/state-carryover.js").summaryPrompt())')" > ~/.claude/probes/fixtures/state-carryover/compaction-summary.md
```

Read the file. It must be a summary, not a refusal or a limit notice; if it is either, delete it and stop.

- [ ] **Step 5: Run the baseline (operator's go first)**

Run: `node ~/.claude/tools/ccfg.js probe run state-carryover --parallel 3`
Then: `node ~/.claude/tools/ccfg.js probe inspect state-carryover`
Expected: a table of three arms against `clear-bare`. Read both violating and clean cells from each arm before trusting the table; a grader error shows in one cell.

- [ ] **Step 6: Record the baseline in the probe**

Append to the probe's header comment, word for word from the run:

```js
//
// Baseline, <date>, before the build (clear-state uses CLEAR_PREAMBLE, not the
// hook): clear-bare <hits>/<n>, compact <hits>/<n> (p=<p> vs clear-bare),
// clear-state <hits>/<n> (p=<p>). <One sentence on what inspect showed>.
```

If `clear-state` does not beat `clear-bare` here, stop and report to the operator before Task 3: the spec says the design is revisited rather than built on faith.

- [ ] **Step 7: Checkpoint**

Stop. Show the table. Files for the operator: `probes/state-carryover.js`, `probes/fixtures/state-carryover/handoff.md`, `probes/fixtures/state-carryover/compaction-summary.md`. Suggested subject: `Probe what a state file carries across a clear`.

### Task 3: State-file template, audit findings, banner, and `/repo-setup context`

**Files:**

- Create: `skills/repo-setup/templates/state.md`
- Create: `hooks/lib/state-file.js`
- Modify: `hooks/lib/repo-audit.js` (`audit()`, lines 143-194)
- Modify: `hooks/repo-setup.js` (header comment and `io.run` body)
- Modify: `skills/repo-setup/audit.js` (`deepAudit()`, `main()`, new `runContext()`)
- Modify: `skills/repo-setup/SKILL.md`
- Modify: `docs/hooks.md` (the `repo-setup.js` row; case count)
- Test: `tools/test-hooks.js`

**Interfaces:**

- Produces:
  - `hooks/lib/state-file.js`: `STATE_FILE_RELATIVE` (`.claude/state.md`, platform separators), `stateFilePath(root: string) -> string`, `stateFileIgnoreListed(root: string) -> boolean`.
  - Findings `{ id, message, fix, urgent: true }` with ids `graph`, `state-file`, `state-file-tracked`; every other finding has no `urgent`.
  - `node skills/repo-setup/audit.js context [<repo-path>]`: writes the template if absent, appends `.claude/state.md` to `.gitignore` unless git already ignores it, runs `graphify update <root>`, prints the optional document pass without running it. Exits 0 when graphify is absent.
  - Test helper `runJson(script, payload, env) -> object` in `tools/test-hooks.js` (the parsed stdout, or `{}`), used again in Tasks 4 to 8.

- [ ] **Step 1: Write the template**

`skills/repo-setup/templates/state.md`:

```markdown
# Working state

<!-- Loaded at session start, after /clear and after compaction, capped at 8,000 characters. A few lines per section. When the work is done, move anything worth keeping to auto-memory and reset this file to the template. -->

## Goal

<!-- One or two lines on what the current piece of work is for. -->

## Instructions

<!-- The user's standing instructions for this work, word for word. -->

## Unconfirmed

<!-- Instructions a hook captured by keyword. At the next checkpoint move each into Instructions or delete it. -->

## Decisions

<!-- Settled choices, one line each, with the reason. -->

## Rejected

<!-- Approaches tried or ruled out and why; the last error word for word if it matters. -->

## Progress

- Done:
- In progress:
- Next:

## Hot files

<!-- Files being edited and why; re-read these after a clear. -->

## Where to look

<!-- graphify queries for everything else, run as: graphify query "<question>" --budget 1500 -->

## Open questions

<!-- Anything waiting on the user. -->
```

- [ ] **Step 2: Write the failing tests**

Add the helper directly after the `run()` function near the top of `tools/test-hooks.js`:

```js
// run() collapses a reply to one verdict; a banner test needs the raw fields,
// because systemMessage and additionalContext travel side by side.
function runJson(script, payload, env) {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, ...(env || {}) },
    windowsHide: true,
  });
  try {
    return JSON.parse((result.stdout || "").trim());
  } catch {
    return {};
  }
}

function readTextOrEmpty(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function makeRepository(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(["init", "-q", "."], root);
  return root;
}
```

Insert before the closing cleanup at the end of the file:

```js
header("Repo setup: state file and graph findings");
{
  const repoAudit = require(path.join(HOOKS, "lib", "repo-audit.js"));
  const findingIds = (root) =>
    repoAudit.audit(root).map((finding) => finding.id);

  const bare = makeRepository("audit-bare-");
  check(
    "no state file raises state-file",
    findingIds(bare).includes("state-file"),
    true,
    findingIds(bare),
  );
  check(
    "no .gitignore line raises state-file-tracked",
    findingIds(bare).includes("state-file-tracked"),
    true,
    findingIds(bare),
  );
  check(
    "state-file, state-file-tracked and graph are the urgent findings",
    repoAudit
      .audit(bare)
      .filter((finding) => finding.urgent === true)
      .map((finding) => finding.id)
      .sort()
      .join(","),
    "graph,state-file,state-file-tracked",
    findingIds(bare),
  );

  const covered = makeRepository("audit-covered-");
  fs.mkdirSync(path.join(covered, ".claude"));
  fs.writeFileSync(
    path.join(covered, ".claude", "state.md"),
    "# Working state\n",
  );
  fs.writeFileSync(
    path.join(covered, ".gitignore"),
    "node_modules/\n/.claude/\n",
  );
  check(
    "a present state file clears state-file",
    findingIds(covered).includes("state-file"),
    false,
    findingIds(covered),
  );
  check(
    "a /.claude/ line clears state-file-tracked",
    findingIds(covered).includes("state-file-tracked"),
    false,
    findingIds(covered),
  );
  fs.writeFileSync(path.join(covered, ".gitignore"), ".claude/state.md\n");
  check(
    "the exact path clears state-file-tracked",
    findingIds(covered).includes("state-file-tracked"),
    false,
    findingIds(covered),
  );
  fs.writeFileSync(
    path.join(covered, ".gitignore"),
    ".claude/settings.local.json\n",
  );
  check(
    "an unrelated .claude line leaves state-file-tracked",
    findingIds(covered).includes("state-file-tracked"),
    true,
    findingIds(covered),
  );

  const setupHome = fs.mkdtempSync(path.join(os.tmpdir(), "repo-setup-home-"));
  const sessionStart = (root) =>
    runJson(
      path.join(HOOKS, "repo-setup.js"),
      { hook_event_name: "SessionStart", source: "startup", cwd: root },
      { CLAUDE_CONFIG_DIR: setupHome },
    );
  const firstStart = sessionStart(bare);
  const secondStart = sessionStart(bare);
  check(
    "urgent findings show a banner",
    String(firstStart.systemMessage).includes("state.md"),
    true,
    JSON.stringify(firstStart),
  );
  check(
    "the banner shows again on the next start",
    String(secondStart.systemMessage).includes("state.md"),
    true,
    JSON.stringify(secondStart),
  );
  check(
    "Claude gets the urgent findings as context",
    String((firstStart.hookSpecificOutput || {}).additionalContext).includes(
      "no .claude/state.md",
    ),
    true,
    JSON.stringify(firstStart),
  );

  repoAudit.writeState(setupHome, bare, {
    repo: bare,
    dismissed: ["graph", "state-file", "state-file-tracked"],
  });
  const afterDismissal = sessionStart(bare);
  check(
    "dismissed urgent findings raise no banner",
    afterDismissal.systemMessage,
    undefined,
    JSON.stringify(afterDismissal),
  );
  check(
    "a routine finding still reaches Claude once",
    String(
      (afterDismissal.hookSpecificOutput || {}).additionalContext,
    ).includes("no CLAUDE.md"),
    true,
    JSON.stringify(afterDismissal),
  );
  check(
    "the routine finding is not repeated inside the fortnight",
    JSON.stringify(sessionStart(bare)),
    "{}",
    "",
  );

  fs.rmSync(setupHome, { recursive: true, force: true });
  fs.rmSync(covered, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
}
```

- [ ] **Step 3: Run the suite and watch the new cases fail**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | grep -A20 "state file and graph findings"`
Expected: the first three cases `**FAIL**` with `-> false` or `-> graph` (findings not yet raised), the banner cases `-> false` (today's hook sends no `systemMessage`), and `dismissed urgent findings raise no banner` passing by accident. A crash instead means the test code is wrong.

- [ ] **Step 4: Write `hooks/lib/state-file.js`**

```js
"use strict";

// The per-repository working record, .claude/state.md: where it lives and
// whether the repository's .gitignore keeps it out of version control.
//
// Filesystem-only, like lib/repo-audit, because SessionStart hooks read it.

const fs = require("fs");
const path = require("path");

const STATE_FILE_RELATIVE = path.join(".claude", "state.md");

// The four spellings the design names. Anything subtler is for the skill, which
// asks `git check-ignore`; a missed match here costs one extra notice.
const COVERING_LINES = new Set([
  ".claude/state.md",
  "/.claude/state.md",
  ".claude/",
  "/.claude/",
]);

function stateFilePath(root) {
  return path.join(root, STATE_FILE_RELATIVE);
}

function stateFileIgnoreListed(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  } catch {
    return false;
  }
  return text.split(/\r?\n/).some((line) => COVERING_LINES.has(line.trim()));
}

module.exports = { STATE_FILE_RELATIVE, stateFilePath, stateFileIgnoreListed };
```

- [ ] **Step 5: Raise the findings in `hooks/lib/repo-audit.js`**

Add `const stateFile = require("./state-file");` after the existing requires. Replace the `graph` block inside `audit()` with:

```js
// These three are urgent: without them a /clear loses the work outright, or
// the restart has no graph to pull from, so they are shown on every start.
if (!exists(root, path.join("graphify-out", "graph.json"))) {
  findings.push({
    id: "graph",
    message: "no knowledge graph",
    fix: "/repo-setup context",
    urgent: true,
  });
}

if (!fs.existsSync(stateFile.stateFilePath(root))) {
  findings.push({
    id: "state-file",
    message: "no .claude/state.md",
    fix: "/repo-setup context",
    urgent: true,
  });
}

if (!stateFile.stateFileIgnoreListed(root)) {
  findings.push({
    id: "state-file-tracked",
    message: ".gitignore does not cover .claude/state.md",
    fix: "/repo-setup context",
    urgent: true,
  });
}
```

- [ ] **Step 6: Show urgent findings on every start in `hooks/repo-setup.js`**

Replace the header paragraph beginning `// Speaks at most once per fortnight` with:

```js
// Urgent findings (no state file, no ignore line for it, no graph) are shown on
// every start, as a banner the operator sees, until fixed or dismissed: the
// context design does not work without them. The rest speak at most once per
// fortnight per repository, and again as soon as that set changes. A routine
// notice on every start is a notice nobody reads.
```

Replace everything in the `io.run` body from `const findings = …` to the end of the body with:

```js
const findings = repoAudit.activeFindings(repoAudit.audit(root), state);
const urgent = findings.filter((finding) => finding.urgent === true);
const routine = findings.filter((finding) => finding.urgent !== true);

// The fingerprint covers routine findings only, so fixing an urgent one does
// not re-arm a routine notice shown yesterday.
const fingerprint = routine
  .map((finding) => finding.id)
  .sort()
  .join(",");
const unchanged = fingerprint === state.lastFingerprint;
const age = state.lastNoticeAt
  ? repoAudit.daysBetween(state.lastNoticeAt, repoAudit.today())
  : Infinity;
const routineDue = routine.length > 0 && !(unchanged && age < QUIET_DAYS);
if (urgent.length === 0 && !routineDue) return;

if (routineDue) {
  repoAudit.writeState(io.configDir(), root, {
    ...state,
    repo: root,
    lastFingerprint: fingerprint,
    lastNoticeAt: repoAudit.today(),
  });
}

const shown = [...urgent, ...(routineDue ? routine : [])];
const context =
  `Repo setup: ${shown.map((finding) => finding.message).join("; ")}. ` +
  `Run /repo-setup to review or dismiss. ` +
  `Mention this once, then continue with the task at hand.`;

if (urgent.length === 0) {
  io.warn(EVENT, context);
} else {
  io.announce(
    EVENT,
    context,
    `Repo setup: ${urgent.map((finding) => finding.message).join("; ")}. ` +
      `Fix with /repo-setup context, or dismiss.`,
  );
}
```

- [ ] **Step 7: Run the suite and watch it pass**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | grep -A20 "state file and graph findings"; node ~/.claude/tools/test-hooks.js 2>&1 | tail -1`
Expected: all thirteen new cases `[PASS]`, `FAIL 0`.

- [ ] **Step 8: Write the failing tests for `audit.js context`**

The fake `graphify` records its arguments (a fake, not a mock). Its shebang names `process.execPath`, so it runs whatever the PATH holds. POSIX shebangs do not run on Windows, so there each case is skipped by name and still counted.

Insert after the previous block, before the closing cleanup:

```js
header("/repo-setup context: one-step state file, ignore line and graph");
{
  const auditScript = path.join(
    __dirname,
    "..",
    "skills",
    "repo-setup",
    "audit.js",
  );
  const template = path.join(
    __dirname,
    "..",
    "skills",
    "repo-setup",
    "templates",
    "state.md",
  );
  const contextCases = [
    "context writes the state file from the template",
    "context builds the graph with graphify update <root>",
    "context never overwrites an existing state file",
    "context appends the .gitignore line exactly once",
    "the deep audit sees the ignore line through git",
    "context without graphify still exits 0",
    "context without graphify says so",
  ];
  if (process.platform === "win32") {
    for (const label of contextCases)
      skip(label, "the fake graphify is a POSIX shebang script");
  } else {
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-graphify-"));
    const fakeLog = path.join(fakeBin, "calls.jsonl");
    fs.writeFileSync(
      path.join(fakeBin, "graphify"),
      `#!${process.execPath}\nrequire("fs").appendFileSync(process.env.FAKE_GRAPHIFY_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");\n`,
      { mode: 0o755 },
    );
    const pathWithoutGraphify = String(process.env.PATH)
      .split(path.delimiter)
      .filter((directory) => !fs.existsSync(path.join(directory, "graphify")))
      .join(path.delimiter);
    const runContext = (root, withGraphify) =>
      spawnSync(process.execPath, [auditScript, "context", root], {
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          FAKE_GRAPHIFY_LOG: fakeLog,
          PATH: withGraphify
            ? fakeBin + path.delimiter + pathWithoutGraphify
            : pathWithoutGraphify,
        },
      });

    const fresh = makeRepository("context-action-");
    const firstRun = runContext(fresh, true);
    check(
      contextCases[0],
      readTextOrEmpty(path.join(fresh, ".claude", "state.md")),
      readTextOrEmpty(template),
      firstRun.stdout + firstRun.stderr,
    );
    check(
      contextCases[1],
      readTextOrEmpty(fakeLog).trim(),
      JSON.stringify(["update", fresh]),
      firstRun.stdout,
    );

    fs.writeFileSync(
      path.join(fresh, ".claude", "state.md"),
      "# Working state\n\n## Goal\n\nkeep me\n",
    );
    runContext(fresh, true);
    check(
      contextCases[2],
      readTextOrEmpty(path.join(fresh, ".claude", "state.md")).includes(
        "keep me",
      ),
      true,
      "",
    );
    check(
      contextCases[3],
      readTextOrEmpty(path.join(fresh, ".gitignore"))
        .split("\n")
        .filter((line) => line === ".claude/state.md").length,
      1,
      readTextOrEmpty(path.join(fresh, ".gitignore")),
    );
    const deepReport = spawnSync(
      process.execPath,
      [auditScript, "--json", fresh],
      { encoding: "utf8", windowsHide: true },
    );
    let trackedStatus = "unparsed";
    try {
      trackedStatus = JSON.parse(deepReport.stdout).checks.find(
        (row) => row.id === "state-file-tracked",
      ).status;
    } catch {
      // Left as "unparsed" so the check below reports it.
    }
    check(
      contextCases[4],
      trackedStatus,
      "ok",
      deepReport.stdout.slice(0, 200),
    );

    const noGraphifyRoot = makeRepository("context-no-graphify-");
    const withoutGraphify = runContext(noGraphifyRoot, false);
    check(contextCases[5], withoutGraphify.status, 0, withoutGraphify.stderr);
    check(
      contextCases[6],
      withoutGraphify.stdout.includes("graphify is not on PATH"),
      true,
      withoutGraphify.stdout,
    );

    for (const directory of [fakeBin, fresh, noGraphifyRoot])
      fs.rmSync(directory, { recursive: true, force: true });
  }
}
```

- [ ] **Step 9: Run and watch them fail**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | grep -A10 "one-step state file"`
Expected: every case `**FAIL**`. Today `context` is not a command, so `audit.js` takes it as a path, finds no repository and exits 1: the state-file case shows `-> ` (empty) and the exit case `-> 1`.

- [ ] **Step 10: Add the rows and the `context` command to `skills/repo-setup/audit.js`**

After the `repoAudit` require, add:

```js
const stateFile = require(path.join(configDir, "hooks", "lib", "state-file"));
const { spawnSync } = require("child_process");

const TEMPLATE = path.join(__dirname, "templates", "state.md");
```

After `gitIgnores()`, add:

```js
/** Whether git ignores the state file, with the hook's approximation when git cannot run. */
function stateFileGitIgnored(root) {
  if (io.git(["check-ignore", "-v", ".claude/state.md"], root) !== "")
    return true;
  const gitWorks = io.git(["rev-parse", "--git-dir"], root) !== "";
  return gitWorks ? false : stateFile.stateFileIgnoreListed(root);
}

/**
 * The one-step setup: state file, ignore line, code graph. Never overwrites a
 * state file, and never starts graphify's document pass, which spends tokens.
 */
function runContext(root) {
  const statePath = stateFile.stateFilePath(root);
  if (fs.existsSync(statePath)) {
    console.log("kept      .claude/state.md (already exists)");
  } else {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.copyFileSync(TEMPLATE, statePath);
    console.log("wrote     .claude/state.md from the template");
  }

  if (stateFileGitIgnored(root)) {
    console.log("kept      .gitignore (git already ignores .claude/state.md)");
  } else {
    const gitignorePath = path.join(root, ".gitignore");
    const existing = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, "utf8")
      : "";
    const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
    fs.writeFileSync(
      gitignorePath,
      `${existing}${separator}.claude/state.md\n`,
    );
    console.log("appended  .claude/state.md to .gitignore");
  }

  const graphBuild = spawnSync("graphify", ["update", root], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (graphBuild.error && graphBuild.error.code === "ENOENT") {
    console.log(
      "skipped   graph: graphify is not on PATH; install it and rerun",
    );
  } else if (graphBuild.status !== 0) {
    console.log(`failed    graphify update exited ${graphBuild.status}`);
    console.log((graphBuild.stderr || "").slice(-2000));
    process.exitCode = 1;
  } else {
    console.log(
      "built     graphify-out/graph.json (code only, no model calls)",
    );
  }

  console.log(
    "\nNot run: graphify's pass over documents, papers and images spends " +
      "model tokens. Offer it; start it with /graphify only on a yes.",
  );
}
```

In `deepAudit()`, change the graph row's `fix` for the missing case to `"audit.js context builds it (code only)"`, and add after the graph row:

```js
const statePresent = fs.existsSync(stateFile.stateFilePath(root));
rows.push({
  id: "state-file",
  status: statePresent ? "ok" : "missing",
  detail: statePresent
    ? ".claude/state.md present"
    : "no .claude/state.md, so nothing carries the work across a /clear",
  fix: statePresent
    ? undefined
    : "audit.js context writes it from the template",
});

const stateIgnored = stateFileGitIgnored(root);
rows.push({
  id: "state-file-tracked",
  status: stateIgnored ? "ok" : "broken",
  detail: stateIgnored
    ? "git ignores .claude/state.md"
    : "git would track .claude/state.md, a per-worktree working record",
  fix: stateIgnored ? undefined : "audit.js context appends it to .gitignore",
});
```

In `main()`, change the command recognition and path selection to:

```js
const command = ["snooze", "dismiss", "reset", "context"].includes(
  positional[0],
)
  ? positional.shift()
  : "report";

const pathArgument =
  command === "report" || command === "context" ? positional[0] : positional[1];
```

and directly after the `root === null` check, before `readState`:

```js
if (command === "context") {
  runContext(root);
  return;
}
```

- [ ] **Step 11: Run and watch them pass; confirm one fails for the right reason**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | grep -A10 "one-step state file"; node ~/.claude/tools/test-hooks.js 2>&1 | tail -1`
Expected: seven `[PASS]`, `FAIL 0`.

Then remove the `if (stateFileGitIgnored(root))` branch's early exit by temporarily changing the condition to `if (false)`, rerun, and confirm exactly `context appends the .gitignore line exactly once` fails with `-> 2`. Restore.

- [ ] **Step 12: Update the skill and the hooks doc**

In `skills/repo-setup/SKILL.md`:

- Description: after `CLAUDE.md presence and whether git actually tracks it,` insert `the .claude/state.md working record and its ignore line,`; after `when asked to snooze or dismiss one of those notices` insert `, or to set a repo up for early clears (the context action)`.
- Replace `This skill diagnoses and delegates. It writes nothing to the repository itself.` with `This skill diagnoses and delegates. Only the context action writes to the repository, and only when the reader asks for it.`
- In the findings table, change the `graph` row's hand-off to `` `audit.js context`, or `/graphify --update` when stale `` and add after it:

```markdown
| `state-file` | No `.claude/state.md`, so nothing carries the work across a `/clear` | `audit.js context` |
| `state-file-tracked` | Git would track `.claude/state.md` | `audit.js context` |
```

- Add a section before `## Silencing a finding`:

```markdown
## The context action

    node ~/.claude/skills/repo-setup/audit.js context [<repo-path>]

Sets a repository up for early clears in one step: writes `.claude/state.md`
from `templates/state.md` (never over an existing one), appends
`.claude/state.md` to `.gitignore` unless git already ignores it, and builds the
code graph with `graphify update`, which reads code only and makes no model
calls. It does not start graphify's pass over documents, papers and images,
which spends model tokens: offer that, and run `/graphify` only on a yes.

The SessionStart banner raises `graph`, `state-file` and `state-file-tracked` on
every start until they are fixed or dismissed, because without them a `/clear`
loses the work.
```

In `docs/hooks.md`, replace the `hooks/repo-setup.js` row's behaviour cell with: `Names the agent infrastructure a repository is missing: `CLAUDE.md`, a knowledge graph, `.claude/state.md` and its ignore line, declared routines, skills the stack needs that nothing routes to. Filesystem-only so it cannot stall a session start. The graph and the state file show as a banner on every start until fixed or dismissed; the rest speak at most once a fortnight per repository, and again as soon as that set changes.` Set `covering N cases` to the new PASS + SKIP total.

Run: `node ~/.claude/hooks/validate-config.js 2>&1 | tail -5`
Expected: no failed checks.

- [ ] **Step 13: Checkpoint**

Stop. Show the suite summary and one `audit.js context` run against a scratch repository (`git init` in `mktemp -d`). Files for the operator: `skills/repo-setup/templates/state.md`, `hooks/lib/state-file.js`, `hooks/lib/repo-audit.js`, `hooks/repo-setup.js`, `skills/repo-setup/audit.js`, `skills/repo-setup/SKILL.md`, `docs/hooks.md`, `tools/test-hooks.js`. Suggested subject: `Scaffold .claude/state.md from /repo-setup context`.

### Task 4: The restart hook, replacing the handoff

**Files:**

- Create: `hooks/state-restore.js`
- Modify: `hooks/lib/state-file.js` (reading and parsing)
- Delete: `hooks/pre-compact.js`, `hooks/handoff-restore.js`
- Modify: `settings.json` (operator's hunk: SessionStart entry renamed, `PreCompact` block removed)
- Modify: `hooks/lib/session-cache.js` and `hooks/constraint-capture.js` (header comments that name the retired hooks)
- Modify: `docs/hooks.md` (rows, hook counts, case count)
- Test: `tools/test-hooks.js` (new section; retired sections removed)

**Interfaces:**

- Consumes: `STATE_FILE` and `CLEAR_PREAMBLE` exported by `probes/state-carryover.js` (Task 2); `runJson`, `makeRepository` (Task 3); `repoAudit.findRepositoryRoot(cwd)`.
- Produces, added to `hooks/lib/state-file.js`:
  - `MAX_LOADED_CHARACTERS` (8000)
  - `readStateFile(root) -> { text: string, modifiedMs: number } | null`
  - `sectionBody(text, heading: string) -> string`: body under `## heading`, HTML comments removed, trimmed; `""` when absent.
  - `goalLine(text) -> string`, `nextStep(text) -> string` (text after `Next:` in Progress)
  - `hasContent(text) -> boolean`: false for an untouched template.
  - `loadedText(text) -> string`: capped, with a visible truncation note.
  - `formatAge(milliseconds) -> string`: `"30 minutes"`, `"5 hours"`, `"3 days"`.

- [ ] **Step 1: Write the failing tests**

Insert before the closing cleanup:

```js
header(
  "SessionStart: state-restore loads .claude/state.md by how the session started",
);
{
  const restoreHook = path.join(HOOKS, "state-restore.js");
  const carryover = require(
    path.join(__dirname, "..", "probes", "state-carryover.js"),
  );
  const template = path.join(
    __dirname,
    "..",
    "skills",
    "repo-setup",
    "templates",
    "state.md",
  );
  const restoreRoot = makeRepository("state-restore-");
  const restoreHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "state-restore-home-"),
  );
  fs.mkdirSync(path.join(restoreRoot, ".claude"));
  const statePath = path.join(restoreRoot, ".claude", "state.md");
  fs.writeFileSync(statePath, carryover.STATE_FILE);
  const start = (source, cwd = restoreRoot) =>
    runJson(
      restoreHook,
      { hook_event_name: "SessionStart", source, session_id: "restore-1", cwd },
      { CLAUDE_CONFIG_DIR: restoreHome },
    );
  const contextOf = (reply) =>
    String((reply.hookSpecificOutput || {}).additionalContext || "");

  const cleared = start("clear");
  check(
    "clear loads the file",
    contextOf(cleared).includes("worker_threads pool for row formatting"),
    true,
    contextOf(cleared).slice(0, 200),
  );
  check(
    "clear opens with the preamble the probe measured",
    contextOf(cleared).startsWith(carryover.CLEAR_PREAMBLE),
    true,
    contextOf(cleared).slice(0, 200),
  );
  check(
    "clear shows no banner",
    cleared.systemMessage,
    undefined,
    JSON.stringify(cleared).slice(0, 200),
  );

  const halfHourAgo = new Date(Date.now() - 30 * 60000);
  fs.utimesSync(statePath, halfHourAgo, halfHourAgo);
  const compacted = contextOf(start("compact"));
  check(
    "compact says the file wins over the summary",
    compacted.includes("the file wins"),
    true,
    compacted.slice(0, 300),
  );
  check(
    "compact says how stale the file was",
    compacted.includes("30 minutes before the compaction"),
    true,
    compacted.slice(0, 300),
  );

  const started = start("startup");
  const banner = String(started.systemMessage);
  check(
    "startup banner names the goal",
    banner.startsWith("Resuming: Streaming CSV export for ledger-export"),
    true,
    banner,
  );
  check(
    "startup banner names the next step",
    banner.includes("Next: backpressure in writeExport"),
    true,
    banner,
  );
  check(
    "startup banner gives the age",
    banner.includes("(updated 30 minutes ago)"),
    true,
    banner,
  );
  check(
    "startup asks Claude to confirm before continuing",
    contextOf(started).includes("confirm with the user"),
    true,
    contextOf(started).slice(0, 300),
  );

  check("resume loads nothing", JSON.stringify(start("resume")), "{}", "");
  check("fork loads nothing", JSON.stringify(start("fork")), "{}", "");
  check(
    "a subdirectory of the repository finds the file",
    contextOf(start("clear", path.join(restoreRoot, ".claude"))).includes(
      "worker_threads",
    ),
    true,
    "",
  );

  fs.writeFileSync(statePath, "START_MARKER" + "x".repeat(8990) + "END_MARKER");
  const oversized = contextOf(start("clear"));
  check(
    "an oversized file is capped at 8,000 characters",
    oversized.includes("START_MARKER") && !oversized.includes("END_MARKER"),
    true,
    oversized.length,
  );
  check(
    "the cap leaves a visible note",
    oversized.includes("[truncated at 8,000 characters"),
    true,
    oversized.slice(-200),
  );

  fs.copyFileSync(template, statePath);
  check(
    "an untouched template loads nothing",
    JSON.stringify(start("startup")),
    "{}",
    "",
  );
  fs.rmSync(statePath);
  check(
    "no state file loads nothing",
    JSON.stringify(start("clear")),
    "{}",
    "",
  );

  fs.rmSync(restoreRoot, { recursive: true, force: true });
  fs.rmSync(restoreHome, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | grep -A18 "state-restore loads"`
Expected: no crash (spawning a missing script prints nothing, so `runJson` returns `{}`). The load and banner cases fail with `-> false`. The five "loads nothing" cases and `clear shows no banner` pass by accident. That is expected here, and Step 6 proves they can fail.

- [ ] **Step 3: Add reading and parsing to `hooks/lib/state-file.js`**

Add before `module.exports`, and export every new name:

```js
// A cap, not a budget, on the same reasoning as the retired pre-compact hook's
// MAX_SECTION: a file this large is being used as a log, and truncating with a
// visible note keeps it from flooding the context while leaving that in view.
const MAX_LOADED_CHARACTERS = 8000;

// Lines the template itself carries, so a file holding only these is empty.
const TEMPLATE_SCAFFOLD =
  /^(# Working state|## .*|- (Done|In progress|Next):)$/;

function readStateFile(root) {
  const file = stateFilePath(root);
  try {
    return {
      text: fs.readFileSync(file, "utf8"),
      modifiedMs: fs.statSync(file).mtimeMs,
    };
  } catch {
    return null;
  }
}

function withoutComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

function sectionBody(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return "";
  const following = lines.slice(start + 1);
  const end = following.findIndex((line) => line.startsWith("## "));
  const body = end === -1 ? following : following.slice(0, end);
  return withoutComments(body.join("\n")).trim();
}

function goalLine(text) {
  const firstLine = sectionBody(text, "Goal")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  return (firstLine || "").replace(/[.\s]+$/, "");
}

function nextStep(text) {
  const match = /^[ \t]*-?[ \t]*Next:[ \t]*(.*)$/m.exec(
    sectionBody(text, "Progress"),
  );
  return match ? match[1].trim() : "";
}

function hasContent(text) {
  return withoutComments(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line !== "" && !TEMPLATE_SCAFFOLD.test(line));
}

function loadedText(text) {
  if (text.length <= MAX_LOADED_CHARACTERS) return text;
  return (
    text.slice(0, MAX_LOADED_CHARACTERS) +
    "\n\n[truncated at 8,000 characters: .claude/state.md is being used as a " +
    "log; move finished work to auto-memory and trim it]"
  );
}

function formatAge(milliseconds) {
  const minutes = Math.max(0, Math.round(milliseconds / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.round(hours / 24)} days`;
}
```

- [ ] **Step 4: Write `hooks/state-restore.js`**

`CLEAR_PREAMBLE` is copied from `probes/state-carryover.js`, word for word; the test above fails if the two drift.

```js
"use strict";

// SessionStart: load .claude/state.md according to how the session started.
//
// clear    continue from the file's next step without asking.
// compact  the file wins over the lossy summary; Claude is told how stale the
//          file was when the compaction ran, so it can catch the file up.
// startup  the operator sees what would be resumed and Claude confirms first,
//          because a new session may be for different work.
// resume and fork bring the conversation back with the file already in it, and
//          loading it again would only say it twice.

const repoAudit = require("./lib/repo-audit");
const stateFile = require("./lib/state-file");
const io = require("./lib/hook-io");

const EVENT = "SessionStart";

// Word for word the text probes/state-carryover.js measured.
const CLEAR_PREAMBLE =
  "This session started with /clear. Below is .claude/state.md, the working " +
  "record for this repository. Re-read the files under Hot files and run " +
  'the queries under Where to look as `graphify query "<question>" ' +
  "--budget 1500`, never through the /graphify skill; then continue from " +
  "the next step under Progress without asking.\n\n";

io.run(() => {
  const payload = io.readPayload();
  if (!["clear", "compact", "startup"].includes(payload.source)) return;

  const root = repoAudit.findRepositoryRoot(payload.cwd || process.cwd());
  if (root === null) return;
  const state = stateFile.readStateFile(root);
  if (state === null || !stateFile.hasContent(state.text)) return;

  const loaded = stateFile.loadedText(state.text);
  const age = stateFile.formatAge(Date.now() - state.modifiedMs);

  if (payload.source === "clear") {
    io.warn(EVENT, CLEAR_PREAMBLE + loaded);
    return;
  }

  if (payload.source === "compact") {
    io.warn(
      EVENT,
      "This session was just compacted: a summary replaced the earlier " +
        "conversation. Below is .claude/state.md. Where the summary and this " +
        `file disagree, the file wins. It was last updated ${age} before the ` +
        "compaction, so bring it up to date from the summary now, before " +
        "continuing.\n\n" +
        loaded,
    );
    return;
  }

  const goal = stateFile.goalLine(state.text) || "(no goal recorded)";
  const next = stateFile.nextStep(state.text) || "(no next step recorded)";
  io.announce(
    EVENT,
    `A working record for this repository exists (.claude/state.md), last ` +
      `updated ${age} ago. Before continuing that work, confirm with the user ` +
      `that this session is for it.\n\n${loaded}`,
    `Resuming: ${goal}. Next: ${next} (updated ${age} ago)`,
  );
});
```

- [ ] **Step 5: Run and watch them pass**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | grep -A18 "state-restore loads"`
Expected: sixteen `[PASS]`.

- [ ] **Step 6: Prove the accidental passes can fail**

Temporarily add `"resume"` to the list of sources the hook handles, and change `!stateFile.hasContent(state.text)` to `false`. Rerun: `resume loads nothing` must fail (resume now falls through to the startup banner) and `an untouched template loads nothing` must fail. `no state file loads nothing` cannot be flipped by either change, because a missing file stops the hook at the `state === null` guard first; note that it rests on that guard alone. Restore both and rerun to green.

- [ ] **Step 7: Retire the handoff pair**

1. `rm ~/.claude/hooks/pre-compact.js ~/.claude/hooks/handoff-restore.js`
2. In `tools/test-hooks.js`:
   - Delete from `header("PreCompact: writes a handoff file");` through the end of the block that checks `an oversized handoff is capped at 8000 characters`, keeping one line in its place, directly above `header("UserPromptSubmit: captures standing constraints");`: `const captureHome = fs.mkdtempSync(path.join(os.tmpdir(), "capture-"));`
   - Delete from `header("PreCompact carries constraints verbatim");` through the end of the `Round trip` block.
   - Replace every remaining `handoffHome` with `captureHome`.
   - In the `lib/session-cache` section, replace the kind `"handoff"` with `"constraints"` in every `cachePath(...)` call and in the two `path.join(cacheHome, "cache", "handoff")` expressions.
3. In `hooks/lib/session-cache.js`, replace the header comment with `// One place to build the <configDir>/cache/<kind>/<session-id>.md path, so a\n// session id carrying a path separator cannot escape the cache directory.` and, in the `cachePath` docblock, replace `(handoff-restore.js)` with nothing.
4. In `hooks/constraint-capture.js`, replace the header sentence `The file exists for pre-compact.js to copy verbatim into the handoff.` with `Nothing reads the file since the pre-compact handoff was retired; whether capture helps at all is for the state-carryover probe to settle.`
5. In `settings.json` (operator's hunk), change `'hooks','handoff-restore.js'` to `'hooks','state-restore.js'`, and delete the whole `"PreCompact": [ … ]` entry together with the comma before it.
6. In `docs/hooks.md`, delete the `PreCompact` and `handoff-restore.js` rows; add a `SessionStart` row for `hooks/state-restore.js`: `Loads `.claude/state.md`by how the session started: after`/clear`, continue from its next step; after compaction, the file wins over the summary and Claude catches it up; at startup, a "Resuming: <goal>. Next: <step>" banner and Claude confirms first. Silent on resume and fork, without a file, and for an untouched template. Capped at 8,000 characters.` In the `constraint-capture.js` row, replace `for`pre-compact.js` to pick up` with nothing. Update "Thirteen hooks" and "Eleven additional hooks" to match the rows now in the two tables, and the case count.

- [ ] **Step 8: Verify**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | tail -1` — expected `FAIL 0`.
Run: `grep -rn "pre-compact\|handoff-restore" ~/.claude/hooks ~/.claude/tools ~/.claude/settings.json ~/.claude/docs/hooks.md` — expected: no output.
Run: `node ~/.claude/hooks/validate-config.js 2>&1 | tail -5` — expected: no failed checks (it confirms every hook `settings.json` names exists).
Run by hand against a scratch repository:

```bash
SCRATCH_REPO=$(mktemp -d) && git -C "$SCRATCH_REPO" init -q && node ~/.claude/skills/repo-setup/audit.js context "$SCRATCH_REPO" >/dev/null
printf '# Working state\n\n## Goal\n\nTry the restart.\n\n## Progress\n\n- Next: nothing\n' > "$SCRATCH_REPO/.claude/state.md"
echo "{\"source\":\"startup\",\"cwd\":\"$SCRATCH_REPO\"}" | node ~/.claude/hooks/state-restore.js; echo
```

Expected: JSON whose `systemMessage` is `Resuming: Try the restart. Next: nothing (updated 0 minutes ago)`.

- [ ] **Step 9: Clear the dead cache (operator's go)**

Show `ls ~/.claude/cache/handoff`, then on the operator's go: `rm -rf ~/.claude/cache/handoff`. `cache/constraints/` stays (see "Where this plan departs", item 2).

- [ ] **Step 10: Checkpoint**

Stop. Show the suite summary and the hand-run output. Files for the operator: `hooks/state-restore.js`, `hooks/lib/state-file.js`, the two deletions, `hooks/lib/session-cache.js`, `hooks/constraint-capture.js`, `docs/hooks.md`, `tools/test-hooks.js`, and the `settings.json` hunk. Suggested subject: `Load .claude/state.md by session source`.

### Task 5: The context gauge

No commit at the end of this task: spec build step 4 lands the gauge and the clear gate together, at the end of Task 6.

**Files:**

- Create: `hooks/lib/context-zones.js`
- Create: `hooks/context-gauge.js`
- Modify: `hooks/lib/state-file.js` (add `stateDigest`)
- Modify: `hooks/lib/session-cache.js` (export `sanitizeSessionIdentifier`)
- Modify: `settings.json` (operator's hunk: UserPromptSubmit entry)
- Modify: `docs/hooks.md`
- Test: `tools/test-hooks.js`

**Interfaces:**

- Consumes: `latestContextTokens(transcriptPath)` (Task 1); `readStateFile(root)` (Task 4); `STATE_FILE` from the probe (Task 2); `makeRepository`, `runJson` (Task 3).
- Produces:
  - `stateDigest(text) -> string` in `hooks/lib/state-file.js`: SHA-1 hex of the text with the Unconfirmed section's body removed.
  - `hooks/lib/context-zones.js`: `AMBER_TOKENS` (120000), `RED_TOKENS` (200000), `STALE_TURNS` (8), `zoneOf(tokens) -> "green" | "amber" | "red"`, `readGaugeState(configDir, sessionIdentifier) -> { turn, stateDigest, digestChangedTurn } | null`, `writeGaugeState(configDir, sessionIdentifier, record)`. The file is `<configDir>/cache/context-gauge/<session-id>.json`; `stateDigest` in it is the digest when the current turn's prompt arrived, which Task 6's gate compares against.

- [ ] **Step 1: Write the failing tests**

Insert before the closing cleanup:

```js
header("UserPromptSubmit: context-gauge zones and staleness");
{
  const gaugeHook = path.join(HOOKS, "context-gauge.js");
  const carryover = require(
    path.join(__dirname, "..", "probes", "state-carryover.js"),
  );
  const gaugeRoot = makeRepository("context-gauge-");
  const emptyRoot = makeRepository("context-gauge-empty-");
  const gaugeHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "context-gauge-home-"),
  );
  fs.mkdirSync(path.join(gaugeRoot, ".claude"));
  const statePath = path.join(gaugeRoot, ".claude", "state.md");
  fs.writeFileSync(statePath, carryover.STATE_FILE);

  let transcriptCount = 0;
  const transcriptAt = (tokens) => {
    transcriptCount += 1;
    const file = path.join(gaugeHome, `transcript-${transcriptCount}.jsonl`);
    fs.writeFileSync(
      file,
      JSON.stringify({
        type: "assistant",
        isSidechain: false,
        requestId: `request-${transcriptCount}`,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          usage: {
            input_tokens: 2,
            cache_read_input_tokens: tokens - 2,
            cache_creation_input_tokens: 0,
          },
        },
      }) + "\n",
    );
    return file;
  };
  const prompt = (sessionIdentifier, tokens, cwd = gaugeRoot) =>
    run(
      gaugeHook,
      {
        hook_event_name: "UserPromptSubmit",
        session_id: sessionIdentifier,
        transcript_path: transcriptAt(tokens),
        cwd,
        prompt: "next",
      },
      { CLAUDE_CONFIG_DIR: gaugeHome },
    );

  check(
    "green zone at 50K is silent",
    prompt("zone-green", 50000).verdict,
    "allow",
    "",
  );
  const amber = prompt("zone-amber", 150000);
  check("amber zone at 150K warns", amber.verdict, "warn", amber.reason);
  check(
    "the amber line gives the size and zone",
    String(amber.reason).includes("150K tokens (amber zone"),
    true,
    amber.reason,
  );
  check(
    "the amber line asks for the clear suggestion at a stopping point",
    String(amber.reason).includes("good point to clear"),
    true,
    amber.reason,
  );
  const red = prompt("zone-red", 250000);
  check(
    "red zone at 250K says compaction is near",
    String(red.reason).includes("red zone, automatic compaction is near"),
    true,
    red.reason,
  );

  const staleReplies = Array.from({ length: 9 }, () =>
    prompt("stale-1", 50000),
  );
  check(
    "no staleness line after 7 unchanged turns",
    staleReplies[7].verdict,
    "allow",
    staleReplies[7].reason,
  );
  check(
    "the staleness line comes after 8 unchanged turns",
    String(staleReplies[8].reason).includes("has not changed in 8 turns"),
    true,
    staleReplies[8].reason,
  );
  fs.appendFileSync(statePath, "\n- Recorded mid-test.\n");
  check(
    "editing the file resets the count",
    prompt("stale-1", 50000).verdict,
    "allow",
    "",
  );
  fs.writeFileSync(statePath, carryover.STATE_FILE);

  check(
    "silent with no state file, even at 150K",
    prompt("no-state", 150000, emptyRoot).verdict,
    "allow",
    "",
  );

  const stateFile = require(path.join(HOOKS, "lib", "state-file.js"));
  const zones = require(path.join(HOOKS, "lib", "context-zones.js"));
  check(
    "the gauge records the digest the gate compares",
    (zones.readGaugeState(gaugeHome, "zone-amber") || {}).stateDigest,
    stateFile.stateDigest(carryover.STATE_FILE),
    "",
  );
  const withCapture = carryover.STATE_FILE.replace(
    "## Unconfirmed\n",
    "## Unconfirmed\n\n- From now on use pnpm\n",
  );
  check(
    "the digest ignores what sits under Unconfirmed",
    stateFile.stateDigest(withCapture),
    stateFile.stateDigest(carryover.STATE_FILE),
    "",
  );
  check(
    "the digest sees a change anywhere else",
    stateFile.stateDigest(
      carryover.STATE_FILE.replace(
        "- In progress: nothing.",
        "- In progress: the writer.",
      ),
    ) === stateFile.stateDigest(carryover.STATE_FILE),
    false,
    "",
  );

  for (const directory of [gaugeRoot, emptyRoot, gaugeHome])
    fs.rmSync(directory, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | grep -A16 "context-gauge zones"`
Expected: `amber zone at 150K warns` and the amber, red and staleness text cases fail with `-> allow` or `-> false`. The silent cases pass by accident. Then the suite crashes at `require(... "context-zones.js")` with `Cannot find module`, which is the right reason for the last three.

- [ ] **Step 3: Export the sanitizer and add the digest**

In `hooks/lib/session-cache.js`, change the export to `module.exports = { cachePath, sanitizeSessionIdentifier };`.

In `hooks/lib/state-file.js`, add `const crypto = require("crypto");` to the requires, and before `module.exports` (exporting it):

```js
/**
 * SHA-1 of the file with the Unconfirmed section's body removed.
 *
 * The keyword capture writes Unconfirmed on any matching prompt. Counted as a
 * change, that write would satisfy the clear gate and reset the staleness count
 * without Claude having touched the file.
 */
function stateDigest(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## Unconfirmed");
  let kept = lines;
  if (start !== -1) {
    const following = lines.slice(start + 1);
    const end = following.findIndex((line) => line.startsWith("## "));
    kept = [
      ...lines.slice(0, start + 1),
      ...(end === -1 ? [] : following.slice(end)),
    ];
  }
  return crypto.createHash("sha1").update(kept.join("\n")).digest("hex");
}
```

- [ ] **Step 4: Write `hooks/lib/context-zones.js`**

```js
"use strict";

// The context-size zones, and the per-session record the gauge keeps for the
// clear gate.
//
// The three numbers are starting guesses from the 2026-09-11 transcript
// measurement; the depth run of the state-carryover probe sets them.

const fs = require("fs");
const path = require("path");

const { sanitizeSessionIdentifier } = require("./session-cache");

const AMBER_TOKENS = 120000;
const RED_TOKENS = 200000;
const STALE_TURNS = 8;

function zoneOf(tokens) {
  if (tokens >= RED_TOKENS) return "red";
  if (tokens >= AMBER_TOKENS) return "amber";
  return "green";
}

function gaugeStatePath(configDir, sessionIdentifier) {
  return path.join(
    configDir,
    "cache",
    "context-gauge",
    `${sanitizeSessionIdentifier(sessionIdentifier)}.json`,
  );
}

function readGaugeState(configDir, sessionIdentifier) {
  try {
    return JSON.parse(
      fs.readFileSync(gaugeStatePath(configDir, sessionIdentifier), "utf8"),
    );
  } catch {
    return null;
  }
}

function writeGaugeState(configDir, sessionIdentifier, record) {
  const file = gaugeStatePath(configDir, sessionIdentifier);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(record)}\n`);
  } catch {
    // A lost record costs one missed staleness line and lets one clear
    // suggestion through ungated; neither is worth failing a prompt over.
  }
}

module.exports = {
  AMBER_TOKENS,
  RED_TOKENS,
  STALE_TURNS,
  zoneOf,
  readGaugeState,
  writeGaugeState,
};
```

- [ ] **Step 5: Write `hooks/context-gauge.js`**

```js
"use strict";

// UserPromptSubmit: tell Claude how large the context is once that matters, and
// when .claude/state.md has gone stale.
//
// A number delivered each turn rather than a standing rule, because of the
// measurement recorded in mode-inject.js: a rule buried behind ~6,600 tokens was
// followed 0 times in 36, while new information on the user's message won 12 in
// 12. A size that changes every turn is new information.
//
// Silent in a repository with no state file, where the setup banner speaks.

const repoAudit = require("./lib/repo-audit");
const stateFile = require("./lib/state-file");
const transcriptTail = require("./lib/transcript-tail");
const zones = require("./lib/context-zones");
const io = require("./lib/hook-io");

const EVENT = "UserPromptSubmit";

io.run(() => {
  const payload = io.readPayload();
  const root = repoAudit.findRepositoryRoot(payload.cwd || process.cwd());
  if (root === null) return;
  const state = stateFile.readStateFile(root);
  if (state === null) return;

  const previous = zones.readGaugeState(io.configDir(), payload.session_id) || {
    turn: 0,
  };
  const turn = previous.turn + 1;
  const digest = stateFile.stateDigest(state.text);
  const digestChangedTurn =
    digest === previous.stateDigest ? previous.digestChangedTurn : turn;
  zones.writeGaugeState(io.configDir(), payload.session_id, {
    turn,
    stateDigest: digest,
    digestChangedTurn,
  });

  const tokens = transcriptTail.latestContextTokens(payload.transcript_path);
  const zone = zones.zoneOf(tokens);
  if (zone !== "green") {
    io.warn(
      EVENT,
      `Context is ${Math.round(tokens / 1000)}K tokens (${zone} zone` +
        (zone === "red" ? ", automatic compaction is near" : "") +
        "). At your next natural stopping point, never mid-task: bring " +
        ".claude/state.md up to date, then end the reply with " +
        '"good point to clear: `/clear`, then `go`".',
    );
    return;
  }

  const unchangedTurns = turn - digestChangedTurn;
  if (unchangedTurns >= zones.STALE_TURNS) {
    io.warn(
      EVENT,
      `.claude/state.md has not changed in ${unchangedTurns} turns. If a ` +
        "decision, a rejected approach or a finished phase has happened " +
        "since, record it.",
    );
  }
});
```

- [ ] **Step 6: Run, pass, and prove a case can fail**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | grep -A16 "context-gauge zones"; node ~/.claude/tools/test-hooks.js 2>&1 | tail -1`
Expected: twelve `[PASS]`, `FAIL 0`.

Temporarily change `digest === previous.stateDigest` to `true`; rerun and confirm `editing the file resets the count` fails with `-> warn`. Restore.

- [ ] **Step 7: Wire it and document it**

In `settings.json` (operator's hunk), add to the `UserPromptSubmit` hooks array, after the `constraint-capture.js` entry:

```json
{
  "type": "command",
  "command": "node -e \"const p=require('path'),d=process.env.CLAUDE_CONFIG_DIR||p.join(require('os').homedir(),'.claude');require(p.join(d,'hooks','context-gauge.js'))\""
}
```

In `docs/hooks.md`, add a row: `| `UserPromptSubmit`|`hooks/context-gauge.js`| Reads the context size from the transcript tail. From 120K tokens it tells Claude the size each turn and asks it to update`.claude/state.md`and suggest`/clear` at its next stopping point; below that, one line when the state file has not changed in 8 turns. Silent in a repository with no state file. |`. Update the hook counts and the case count.

Run against this machine's newest real transcript, with a scratch repository holding a state file:

```bash
SCRATCH_REPO=$(mktemp -d) && git -C "$SCRATCH_REPO" init -q && mkdir "$SCRATCH_REPO/.claude" && echo "# Working state" > "$SCRATCH_REPO/.claude/state.md"
LIVE_TRANSCRIPT=$(ls -t ~/.claude/projects/*/*.jsonl | head -1)
GAUGE_HOME=$(mktemp -d)
echo "{\"session_id\":\"hand-run\",\"cwd\":\"$SCRATCH_REPO\",\"transcript_path\":\"$LIVE_TRANSCRIPT\"}" | CLAUDE_CONFIG_DIR="$GAUGE_HOME" node ~/.claude/hooks/context-gauge.js; echo
```

Expected: an amber or red line when that session's latest turn was past 120K tokens, otherwise no output. Record which, and the size shown. `GAUGE_HOME` keeps the hand run out of the live cache.

### Task 6: The clear gate

**Files:**

- Create: `hooks/clear-gate.js`
- Modify: `hooks/lib/transcript-tail.js` (add `latestAssistantText`)
- Modify: `settings.json` (operator's hunk: Stop entry)
- Modify: `docs/hooks.md`
- Test: `tools/test-hooks.js`

**Interfaces:**

- Consumes: `zoneOf`, `readGaugeState` (Task 5); `stateDigest`, `readStateFile` (Tasks 4-5); `latestContextTokens` (Task 1); the Stop payload fields `stop_hook_active`, `last_assistant_message`, `transcript_path`, `cwd`, `session_id`.
- Produces: `latestAssistantText(transcriptPath, byteCount = TAIL_BYTES) -> string`; the Stop verdict `{ decision: "block", reason }` through `io.block`. Task 8 adds a graph refresh where this gate lets a suggestion through.

- [ ] **Step 1: Write the failing tests**

Insert before the closing cleanup:

```js
header(
  "Stop: clear-gate holds a clear suggestion until the state file changes",
);
{
  const gaugeHook = path.join(HOOKS, "context-gauge.js");
  const gateHook = path.join(HOOKS, "clear-gate.js");
  const carryover = require(
    path.join(__dirname, "..", "probes", "state-carryover.js"),
  );
  const gateRoot = makeRepository("clear-gate-");
  const noStateRoot = makeRepository("clear-gate-empty-");
  const gateHome = fs.mkdtempSync(path.join(os.tmpdir(), "clear-gate-home-"));
  const environment = { CLAUDE_CONFIG_DIR: gateHome };
  fs.mkdirSync(path.join(gateRoot, ".claude"));
  const statePath = path.join(gateRoot, ".claude", "state.md");
  fs.writeFileSync(statePath, carryover.STATE_FILE);
  const suggestion = "Tests pass. good point to clear: `/clear`, then `go`";

  let transcriptCount = 0;
  const transcriptAt = (tokens, text = "ok") => {
    transcriptCount += 1;
    const file = path.join(gateHome, `transcript-${transcriptCount}.jsonl`);
    fs.writeFileSync(
      file,
      JSON.stringify({
        type: "assistant",
        isSidechain: false,
        requestId: `request-${transcriptCount}`,
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
          usage: {
            input_tokens: 2,
            cache_read_input_tokens: tokens - 2,
            cache_creation_input_tokens: 0,
          },
        },
      }) + "\n",
    );
    return file;
  };
  const startTurn = (sessionIdentifier, tokens) =>
    run(
      gaugeHook,
      {
        hook_event_name: "UserPromptSubmit",
        session_id: sessionIdentifier,
        transcript_path: transcriptAt(tokens),
        cwd: gateRoot,
        prompt: "next",
      },
      environment,
    );
  const stop = (sessionIdentifier, tokens, overrides = {}) =>
    run(
      gateHook,
      {
        hook_event_name: "Stop",
        session_id: sessionIdentifier,
        transcript_path: transcriptAt(tokens),
        cwd: gateRoot,
        stop_hook_active: false,
        last_assistant_message: suggestion,
        ...overrides,
      },
      environment,
    );

  startTurn("gate-unchanged", 150000);
  const held = stop("gate-unchanged", 150000);
  check(
    "holds a clear suggestion when the file did not change this turn",
    held.verdict,
    "BLOCK",
    held.reason,
  );
  check(
    "the hold says what to do",
    String(held.reason).includes(
      "update .claude/state.md before suggesting a clear",
    ),
    true,
    held.reason,
  );
  check(
    "never blocks twice in a row",
    stop("gate-unchanged", 150000, { stop_hook_active: true }).verdict,
    "allow",
    "",
  );

  startTurn("gate-updated", 150000);
  fs.appendFileSync(statePath, "\n- Recorded before the clear.\n");
  check(
    "lets it through when the file changed this turn",
    stop("gate-updated", 150000).verdict,
    "allow",
    "",
  );

  startTurn("gate-green", 50000);
  check(
    "ignores a suggestion in the green zone",
    stop("gate-green", 50000).verdict,
    "allow",
    "",
  );

  startTurn("gate-plain-reply", 150000);
  check(
    "ignores a reply that suggests no clear",
    stop("gate-plain-reply", 150000, { last_assistant_message: "Tests pass." })
      .verdict,
    "allow",
    "",
  );

  startTurn("gate-fallback", 150000);
  const fromTranscript = run(
    gateHook,
    {
      hook_event_name: "Stop",
      session_id: "gate-fallback",
      transcript_path: transcriptAt(150000, suggestion),
      cwd: gateRoot,
    },
    environment,
  );
  check(
    "reads the suggestion from the transcript when the payload lacks it",
    fromTranscript.verdict,
    "BLOCK",
    fromTranscript.reason,
  );

  check(
    "lets it through where there is no state file",
    stop("gate-unchanged", 150000, { cwd: noStateRoot }).verdict,
    "allow",
    "",
  );
  check(
    "lets it through when the gauge never saw the turn start",
    stop("gate-never-started", 150000).verdict,
    "allow",
    "",
  );

  for (const directory of [gateRoot, noStateRoot, gateHome])
    fs.rmSync(directory, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | grep -A12 "clear-gate holds"`
Expected: the three `BLOCK` cases and `the hold says what to do` fail with `-> allow` or `-> false`; the rest pass by accident.

- [ ] **Step 3: Add `latestAssistantText` to `hooks/lib/transcript-tail.js`**

Add before `module.exports`, and export it:

```js
/** Text of the latest main-thread assistant entry that carries any, or "". */
function latestAssistantText(transcriptPath, byteCount = TAIL_BYTES) {
  if (!transcriptPath) return "";
  const entries = parseLines(readTail(transcriptPath, byteCount));
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.type !== "assistant" || entry.isSidechain === true)
      continue;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((block) => block && block.type === "text")
      .map((block) => block.text)
      .join("\n");
    if (text.trim() !== "") return text;
  }
  return "";
}
```

- [ ] **Step 4: Write `hooks/clear-gate.js`**

```js
"use strict";

// Stop: hold a /clear suggestion made without updating .claude/state.md.
//
// A clear taken with an out-of-date file is the one way the context design loses
// work outright, and whether the file changed this turn is machine-checkable, so
// this is a gate rather than a reminder. It holds at most once per stop, because
// the harness sets stop_hook_active on the turn it sends back.
//
// "Changed this turn" compares against the digest the context gauge recorded
// when the prompt arrived. A digest, not a modification time, because the
// keyword capture writes into the same file.

const repoAudit = require("./lib/repo-audit");
const stateFile = require("./lib/state-file");
const transcriptTail = require("./lib/transcript-tail");
const zones = require("./lib/context-zones");
const io = require("./lib/hook-io");

const CLEAR_SUGGESTION = /\/clear\b/;

io.run(() => {
  const payload = io.readPayload();
  if (payload.stop_hook_active) return;

  // Claude Code 2.1.270 sends the final message on the payload; the transcript
  // tail covers versions that do not.
  const message =
    typeof payload.last_assistant_message === "string"
      ? payload.last_assistant_message
      : transcriptTail.latestAssistantText(payload.transcript_path);
  if (!CLEAR_SUGGESTION.test(message)) return;

  const tokens = transcriptTail.latestContextTokens(payload.transcript_path);
  if (zones.zoneOf(tokens) === "green") return;

  const root = repoAudit.findRepositoryRoot(payload.cwd || process.cwd());
  if (root === null) return;
  const state = stateFile.readStateFile(root);
  if (state === null) return;

  // Without the gauge's record there is nothing to compare against, and holding
  // a stop on a guess is worse than letting one suggestion through.
  const record = zones.readGaugeState(io.configDir(), payload.session_id);
  if (record === null) return;

  if (stateFile.stateDigest(state.text) === record.stateDigest) {
    io.block(
      "update .claude/state.md before suggesting a clear: record progress, " +
        "decisions, rejected approaches and the next step, then suggest it again.",
    );
  }
});
```

- [ ] **Step 5: Run, pass, and prove a case can fail**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | grep -A12 "clear-gate holds"; node ~/.claude/tools/test-hooks.js 2>&1 | tail -1`
Expected: nine `[PASS]`, `FAIL 0`.

Temporarily change `===` to `!==` in the digest comparison and rerun. Confirm the holding cases flip: `holds a clear suggestion…`, `the hold says what to do` and `reads the suggestion from the transcript…` fail with `-> allow` or `-> false`, and `lets it through when the file changed this turn` fails with `-> BLOCK`. Restore.

- [ ] **Step 6: Wire it and document it**

In `settings.json` (operator's hunk), add to the `Stop` hooks array, after the `review-reminder.js` entry:

```json
{
  "type": "command",
  "command": "node -e \"const p=require('path'),d=process.env.CLAUDE_CONFIG_DIR||p.join(require('os').homedir(),'.claude');require(p.join(d,'hooks','clear-gate.js'))\""
}
```

In `docs/hooks.md`, add a row: `| `Stop`|`hooks/clear-gate.js`| From 120K tokens, holds a reply that suggests`/clear`once, with "update .claude/state.md before suggesting a clear", when the state file has not changed since the prompt arrived (the Unconfirmed section aside). Honours`stop_hook_active`, so it never holds twice. |`. Update the hook counts and the case count.

Run: `node ~/.claude/hooks/validate-config.js 2>&1 | tail -5` — expected: no failed checks.
Run: `node ~/.claude/tools/ccfg.js probe run core-hooks-wired` — expected: PASS.

- [ ] **Step 7: Checkpoint (commit for Tasks 5 and 6)**

Stop. Show the suite summary, the Task 5 hand run and the validator's tail. Files for the operator: `hooks/lib/context-zones.js`, `hooks/context-gauge.js`, `hooks/clear-gate.js`, `hooks/lib/state-file.js`, `hooks/lib/session-cache.js`, `hooks/lib/transcript-tail.js`, `docs/hooks.md`, `tools/test-hooks.js`, and the two `settings.json` hunks. Suggested subject: `Gauge context size and gate /clear on state.md`.

Not verifiable in the suite, and to be watched in the first real session in amber: whether Claude actually stops at a natural point and suggests the clear, and whether the gate's hold reads as intended.

### Task 7: Keyword capture into the Unconfirmed section

**Prerequisite:** the operator has confirmed item 2 under "Where this plan departs from the spec" (without a state file, capture keeps writing `cache/constraints/`). If they chose the other reading, delete the cache-file branch and its tests in this task instead.

**Files:**

- Modify: `hooks/constraint-capture.js` (header, requires, `io.run` body)
- Modify: `hooks/lib/state-file.js` (add `withUnconfirmed`, `writeStateFile`)
- Modify: `docs/hooks.md` (the `constraint-capture.js` row; case count)
- Test: `tools/test-hooks.js` (the existing `capture()` helper gains a `cwd`; new section)

**Interfaces:**

- Consumes: `readStateFile`, `sectionBody`, `stateDigest` (Tasks 4-5); `capturedLines(prompt)` inside `constraint-capture.js`, unchanged; `makeRepository`, `readTextOrEmpty` (Task 3).
- Produces:
  - `withUnconfirmed(text, newLines: string[]) -> string`: `newLines` added at the end of the Unconfirmed section, skipping lines already there; every byte outside that section's body unchanged; a missing section is appended at the end of the file.
  - `writeStateFile(root, text)`: writes a temporary file beside it and renames it over, so a reader never sees half a write.

- [ ] **Step 1: Keep the existing capture tests off any real repository**

The existing `capture()` helper sends no `cwd`, so the hook would take the suite's own working directory. When the suite runs from `~/.claude`, which is a git repository, that directory could hold a real `.claude/state.md`. In the helper's payload, add `cwd: captureHome,` after `prompt,`. `captureHome` is a plain temporary directory, not a repository.

Directly after the `makeRepository` helper near the top of the file, add:

```js
// The config repository may hold a real working record. Captured here and
// compared at the end, so no case can write into it unnoticed.
const configRepositoryState = path.join(__dirname, "..", ".claude", "state.md");
const configRepositoryStateBefore = readTextOrEmpty(configRepositoryState);
```

- [ ] **Step 2: Write the failing tests**

Insert before the closing cleanup:

```js
header(
  "UserPromptSubmit: capture writes into Unconfirmed when a state file exists",
);
{
  const captureHook = path.join(HOOKS, "constraint-capture.js");
  const stateFile = require(path.join(HOOKS, "lib", "state-file.js"));
  const carryover = require(
    path.join(__dirname, "..", "probes", "state-carryover.js"),
  );
  const template = path.join(
    __dirname,
    "..",
    "skills",
    "repo-setup",
    "templates",
    "state.md",
  );
  const captureRoot = makeRepository("capture-state-");
  const captureStateHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "capture-state-home-"),
  );
  fs.mkdirSync(path.join(captureRoot, ".claude"));
  const statePath = path.join(captureRoot, ".claude", "state.md");
  fs.writeFileSync(statePath, carryover.STATE_FILE);
  const submit = (prompt) =>
    run(
      captureHook,
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "capture-state-1",
        prompt,
        cwd: captureRoot,
      },
      { CLAUDE_CONFIG_DIR: captureStateHome },
    );
  const unconfirmed = () =>
    stateFile.sectionBody(readTextOrEmpty(statePath), "Unconfirmed");

  submit("From now on use pnpm, never npm");
  check(
    "the captured sentence lands under Unconfirmed",
    unconfirmed(),
    "- From now on use pnpm, never npm",
    readTextOrEmpty(statePath),
  );
  check(
    "every other section is left byte for byte",
    stateFile.stateDigest(readTextOrEmpty(statePath)),
    stateFile.stateDigest(carryover.STATE_FILE),
    "",
  );
  check(
    "nothing is written to cache/constraints",
    fs.existsSync(path.join(captureStateHome, "cache", "constraints")),
    false,
    "",
  );

  submit("From now on use pnpm, never npm");
  check(
    "the same sentence is not added twice",
    unconfirmed(),
    "- From now on use pnpm, never npm",
    unconfirmed(),
  );
  submit("Never edit files under vendor/");
  check(
    "a second instruction joins the first",
    unconfirmed(),
    "- From now on use pnpm, never npm\n- Never edit files under vendor/",
    unconfirmed(),
  );

  const beforePlainRequest = readTextOrEmpty(statePath);
  submit("Add a test for the parser");
  check(
    "a plain request leaves the file alone",
    readTextOrEmpty(statePath),
    beforePlainRequest,
    "",
  );

  fs.copyFileSync(template, statePath);
  submit("Never touch the lockfile");
  check(
    "under the template's comment the section reads as one bullet",
    unconfirmed(),
    "- Never touch the lockfile",
    readTextOrEmpty(statePath),
  );

  check(
    "no case wrote the config repository's state file",
    readTextOrEmpty(configRepositoryState),
    configRepositoryStateBefore,
    "",
  );

  fs.rmSync(captureRoot, { recursive: true, force: true });
  fs.rmSync(captureStateHome, { recursive: true, force: true });
}
```

- [ ] **Step 3: Run and watch them fail**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | grep -A12 "capture writes into Unconfirmed"`
Expected: `the captured sentence lands under Unconfirmed` and `a second instruction joins the first` fail with `-> ` (empty section) and `nothing is written to cache/constraints` fails with `-> true`, because today's hook writes the cache file. The byte-for-byte, plain-request and config-repository cases pass by accident.

- [ ] **Step 4: Add the section writer to `hooks/lib/state-file.js`**

Add before `module.exports`, and export both:

```js
/**
 * The text with each new line added at the end of the Unconfirmed section.
 *
 * No per-section cap: the 8,000-character load cap already keeps an overgrown
 * file visible, and dropping the oldest capture here would lose an instruction
 * Claude has not yet confirmed.
 */
function withUnconfirmed(text, newLines) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === "## Unconfirmed");
  if (start === -1) {
    const separator = text.endsWith("\n") ? "" : "\n";
    return `${text}${separator}\n## Unconfirmed\n\n${newLines.join("\n")}\n`;
  }
  const endOffset = lines
    .slice(start + 1)
    .findIndex((line) => line.startsWith("## "));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;
  const section = lines.slice(start + 1, end).map((line) => line.trim());
  const additions = newLines.filter((line) => !section.includes(line));
  if (additions.length === 0) return text;

  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === "")
    insertAt -= 1;
  const leading = lines[insertAt - 1].trim().startsWith("- ") ? [] : [""];
  const trailing = insertAt === end && end < lines.length ? [""] : [];
  return [
    ...lines.slice(0, insertAt),
    ...leading,
    ...additions,
    ...trailing,
    ...lines.slice(insertAt),
  ].join("\n");
}

// Through a rename, so the gauge never reads half a write and digests it.
function writeStateFile(root, text) {
  const file = stateFilePath(root);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, "utf8");
  fs.renameSync(temporary, file);
}
```

- [ ] **Step 5: Route captures in `hooks/constraint-capture.js`**

Replace the header comment (everything above `const fs = require("fs");`) with:

```js
"use strict";

// UserPromptSubmit: copy sentences that scope an instruction beyond this turn
// out of the transcript, where a clear or a compaction cannot lose them.
//
// With a .claude/state.md they go under its Unconfirmed section, which survives
// a clear; Claude moves each into Instructions or deletes it at the next
// checkpoint. Without one they go to cache/constraints/<session-id>.md, as they
// always have.
//
// Says nothing to the model: the instruction is already in front of it on the
// turn it was given, and re-stating a rule already present measured 0/36 (see
// mode-inject.js).
//
// Detection is a heuristic on purpose. A model call per turn would tax every
// prompt, and whether capture helps at all is unmeasured until the
// state-carryover probe runs with and without it; it goes if it does not help.
```

Add after the existing requires:

```js
const repoAudit = require("./lib/repo-audit");
const stateFile = require("./lib/state-file");
```

In the `io.run` body, directly after `if (newLines.length === 0) return;`, insert:

```js
const root = repoAudit.findRepositoryRoot(payload.cwd || process.cwd());
const state = root === null ? null : stateFile.readStateFile(root);
if (state !== null) {
  const updated = stateFile.withUnconfirmed(state.text, newLines);
  if (updated !== state.text) stateFile.writeStateFile(root, updated);
  return;
}
```

- [ ] **Step 6: Run, pass, and prove a case can fail**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | grep -A12 "capture writes into Unconfirmed"; node ~/.claude/tools/test-hooks.js 2>&1 | tail -1`
Expected: eight `[PASS]`, and every earlier capture case still `[PASS]`; `FAIL 0`.

Temporarily change `if (state !== null)` to `if (false)`; confirm `the captured sentence lands under Unconfirmed` fails with `-> ` and `nothing is written to cache/constraints` fails with `-> true`. Restore. (The blank-line placement in `withUnconfirmed` is cosmetic: `sectionBody` trims and drops comments, so no case can see it. Read one resulting file by eye instead.)

- [ ] **Step 7: Document and verify**

In `docs/hooks.md`, replace the `constraint-capture.js` behaviour cell with: `Heuristically detects a sentence that scopes an instruction beyond the current turn (`never`, `from now on`, ...). With a `.claude/state.md`, adds it under the Unconfirmed section, where it survives a clear and Claude confirms or deletes it; without one, appends it to `cache/constraints/<session>.md`. Never speaks.` Update the case count.

Run: `node ~/.claude/hooks/validate-config.js 2>&1 | tail -5` — expected: no failed checks.

- [ ] **Step 8: Checkpoint**

Stop. Show the suite summary. Files for the operator: `hooks/constraint-capture.js`, `hooks/lib/state-file.js`, `docs/hooks.md`, `tools/test-hooks.js`. Suggested subject: `Capture standing instructions into state.md`.

Not verified by the suite, and the spec's open risk (3.4): whether Claude's Edit tool refuses its next edit to `.claude/state.md` after the hook has rewritten it. Settle it in the first real session: read the file, send a prompt containing "from now on", then edit the file, and record whether a fresh read was needed.

### Task 8: The graph refresh

**Files:**

- Create: `hooks/lib/graph-refresh.js`
- Create: `hooks/graph-refresh.js`
- Modify: `hooks/clear-gate.js` (start a refresh when a suggestion goes through)
- Modify: `settings.json` (operator's hunk: SessionStart entry)
- Modify: `docs/hooks.md`
- Test: `tools/test-hooks.js`

**Interfaces:**

- Consumes: `findRepositoryRoot` (existing); the clear gate (Task 6); `makeRepository`, `readTextOrEmpty` (Task 3).
- Produces, in `hooks/lib/graph-refresh.js`:
  - `headLogPath(root) -> string | null`: `.git/logs/HEAD`, following a worktree's `.git` file (`gitdir: …`).
  - `graphIsStale(root) -> boolean`: a graph exists and is older than that log.
  - `findExecutable(name, searchPath = process.env.PATH) -> string | null`
  - `logFile(configDir, root) -> string`: `<configDir>/cache/graph-refresh/<basename>-<sha1 12>.log`.
  - `startRefresh(configDir, root) -> boolean`: starts `graphify update <root>` detached, output to the log (overwritten), and returns at once; false when there is no graph or no graphify. `CLAUDE_GRAPH_REFRESH_FOREGROUND=1` runs it synchronously, for the suite only.

- [ ] **Step 1: Write the failing tests**

Insert before the closing cleanup:

```js
header("SessionStart: graph-refresh rebuilds a stale graph in the background");
{
  const refreshHook = path.join(HOOKS, "graph-refresh.js");
  const refreshCases = [
    "a stale graph starts graphify update <root>",
    "the rebuild writes one log per repository",
    "a current graph starts nothing",
    "a missing graph starts nothing",
    "without graphify on PATH the hook stays silent",
    "without graphify on PATH no log is written",
    "the clear gate lets an updated suggestion through",
    "the clear gate starts a refresh when it does",
  ];
  if (process.platform === "win32") {
    for (const label of refreshCases)
      skip(label, "the fake graphify is a POSIX shebang script");
  } else {
    const fakeBin = fs.mkdtempSync(
      path.join(os.tmpdir(), "refresh-fake-graphify-"),
    );
    const fakeLog = path.join(fakeBin, "calls.jsonl");
    fs.writeFileSync(
      path.join(fakeBin, "graphify"),
      `#!${process.execPath}\nrequire("fs").appendFileSync(process.env.FAKE_GRAPHIFY_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");\n`,
      { mode: 0o755 },
    );
    const refreshHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "graph-refresh-home-"),
    );
    const pathWithoutGraphify = String(process.env.PATH)
      .split(path.delimiter)
      .filter((directory) => !fs.existsSync(path.join(directory, "graphify")))
      .join(path.delimiter);
    const environmentFor = (withGraphify) => ({
      ...process.env,
      CLAUDE_CONFIG_DIR: refreshHome,
      CLAUDE_GRAPH_REFRESH_FOREGROUND: "1",
      FAKE_GRAPHIFY_LOG: fakeLog,
      PATH: withGraphify
        ? fakeBin + path.delimiter + pathWithoutGraphify
        : pathWithoutGraphify,
    });
    const recordedCalls = () =>
      readTextOrEmpty(fakeLog).split("\n").filter(Boolean);
    const committedRepository = (prefix) => {
      const root = makeRepository(prefix);
      git(
        [
          "-c",
          "user.email=t@t.t",
          "-c",
          "user.name=T",
          "commit",
          "--allow-empty",
          "-q",
          "-m",
          "init",
        ],
        root,
      );
      return root;
    };
    const writeGraph = (root, offsetMs) => {
      const graph = path.join(root, "graphify-out", "graph.json");
      fs.mkdirSync(path.dirname(graph), { recursive: true });
      fs.writeFileSync(graph, "{}");
      const when = new Date(Date.now() + offsetMs);
      fs.utimesSync(graph, when, when);
    };
    const startSession = (root, withGraphify) =>
      spawnSync(process.execPath, [refreshHook], {
        input: JSON.stringify({
          hook_event_name: "SessionStart",
          source: "startup",
          cwd: root,
        }),
        encoding: "utf8",
        env: environmentFor(withGraphify),
        windowsHide: true,
      });
    const logExists = (root) => {
      const digest = require("crypto")
        .createHash("sha1")
        .update(root)
        .digest("hex")
        .slice(0, 12);
      return fs.existsSync(
        path.join(
          refreshHome,
          "cache",
          "graph-refresh",
          `${path.basename(root)}-${digest}.log`,
        ),
      );
    };

    const stale = committedRepository("refresh-stale-");
    writeGraph(stale, -3600000);
    startSession(stale, true);
    check(
      refreshCases[0],
      recordedCalls().join("|"),
      JSON.stringify(["update", stale]),
      recordedCalls(),
    );
    check(refreshCases[1], logExists(stale), true, "");

    fs.rmSync(fakeLog, { force: true });
    const current = committedRepository("refresh-current-");
    writeGraph(current, 3600000);
    startSession(current, true);
    check(refreshCases[2], recordedCalls().length, 0, recordedCalls());
    const missing = committedRepository("refresh-missing-");
    startSession(missing, true);
    check(refreshCases[3], recordedCalls().length, 0, recordedCalls());

    const noGraphify = committedRepository("refresh-no-graphify-");
    writeGraph(noGraphify, -3600000);
    const silent = startSession(noGraphify, false);
    check(refreshCases[4], silent.stdout.trim(), "", silent.stdout);
    check(refreshCases[5], logExists(noGraphify), false, "");

    // The gate refreshes whenever a graph exists: this session's edits are
    // uncommitted, so HEAD's log has not moved and a staleness test would skip.
    const carryover = require(
      path.join(__dirname, "..", "probes", "state-carryover.js"),
    );
    const gateRoot = committedRepository("refresh-gate-");
    writeGraph(gateRoot, 3600000);
    fs.mkdirSync(path.join(gateRoot, ".claude"));
    fs.writeFileSync(
      path.join(gateRoot, ".claude", "state.md"),
      carryover.STATE_FILE,
    );
    const transcript = path.join(refreshHome, "gate-transcript.jsonl");
    fs.writeFileSync(
      transcript,
      JSON.stringify({
        type: "assistant",
        isSidechain: false,
        requestId: "request-gate",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          usage: {
            input_tokens: 2,
            cache_read_input_tokens: 149998,
            cache_creation_input_tokens: 0,
          },
        },
      }) + "\n",
    );
    const hookPayload = (extra) =>
      JSON.stringify({
        session_id: "refresh-gate-1",
        transcript_path: transcript,
        cwd: gateRoot,
        ...extra,
      });
    spawnSync(process.execPath, [path.join(HOOKS, "context-gauge.js")], {
      input: hookPayload({ prompt: "next" }),
      encoding: "utf8",
      env: environmentFor(true),
    });
    fs.appendFileSync(
      path.join(gateRoot, ".claude", "state.md"),
      "\n- Recorded before the clear.\n",
    );
    const gateReply = spawnSync(
      process.execPath,
      [path.join(HOOKS, "clear-gate.js")],
      {
        input: hookPayload({
          stop_hook_active: false,
          last_assistant_message: "good point to clear: `/clear`, then `go`",
        }),
        encoding: "utf8",
        env: environmentFor(true),
      },
    );
    check(refreshCases[6], gateReply.stdout.trim(), "", gateReply.stdout);
    check(
      refreshCases[7],
      recordedCalls().join("|"),
      JSON.stringify(["update", gateRoot]),
      recordedCalls(),
    );

    for (const directory of [
      fakeBin,
      refreshHome,
      stale,
      current,
      missing,
      noGraphify,
      gateRoot,
    ])
      fs.rmSync(directory, { recursive: true, force: true });
  }

  const worktreeRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "refresh-worktree-"),
  );
  const worktreeGitDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "refresh-worktree-gitdir-"),
  );
  fs.writeFileSync(
    path.join(worktreeRoot, ".git"),
    `gitdir: ${worktreeGitDirectory}\n`,
  );
  const graphRefresh = require(path.join(HOOKS, "lib", "graph-refresh.js"));
  check(
    "a worktree's .git file is followed to its HEAD log",
    graphRefresh.headLogPath(worktreeRoot),
    path.join(worktreeGitDirectory, "logs", "HEAD"),
    "",
  );
  fs.rmSync(worktreeRoot, { recursive: true, force: true });
  fs.rmSync(worktreeGitDirectory, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | grep -A12 "graph-refresh rebuilds"`
Expected: `a stale graph starts…`, `the rebuild writes one log…` and `the clear gate starts a refresh…` fail (`-> ` empty, `-> false`); the "starts nothing" and silence cases pass by accident; the suite then crashes on `Cannot find module '…/graph-refresh.js'`.

- [ ] **Step 3: Write `hooks/lib/graph-refresh.js`**

```js
"use strict";

// Keeping graphify-out/graph.json current without anyone asking.
//
// `graphify update` reads code only and makes no model calls, checked on
// 2026-09-11 with the API keys removed and `claude` on PATH replaced by a script
// that refuses any call, so starting it unprompted spends only local CPU.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

function graphPath(root) {
  return path.join(root, "graphify-out", "graph.json");
}

function modifiedMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function headLogPath(root) {
  const dotGit = path.join(root, ".git");
  try {
    if (fs.statSync(dotGit).isFile()) {
      const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"));
      if (match === null) return null;
      return path.join(path.resolve(root, match[1].trim()), "logs", "HEAD");
    }
  } catch {
    return null;
  }
  return path.join(dotGit, "logs", "HEAD");
}

function graphIsStale(root) {
  const graphTime = modifiedMs(graphPath(root));
  const headLog = headLogPath(root);
  const headTime = headLog === null ? null : modifiedMs(headLog);
  return graphTime !== null && headTime !== null && graphTime < headTime;
}

function findExecutable(name, searchPath = process.env.PATH || "") {
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD").split(";")
      : [""];
  for (const directory of searchPath.split(path.delimiter)) {
    if (directory === "") continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, name + extension);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not in this directory.
      }
    }
  }
  return null;
}

function logFile(configDir, root) {
  const digest = crypto.createHash("sha1").update(root).digest("hex");
  return path.join(
    configDir,
    "cache",
    "graph-refresh",
    `${path.basename(root)}-${digest.slice(0, 12)}.log`,
  );
}

/**
 * Start `graphify update <root>` and return at once.
 *
 * False when the repository has no graph, because creating one is the
 * operator's call (the setup banner raises it), or when graphify is absent.
 */
function startRefresh(configDir, root) {
  if (modifiedMs(graphPath(root)) === null) return false;
  const executable = findExecutable("graphify");
  if (executable === null) return false;

  const log = logFile(configDir, root);
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const output = fs.openSync(log, "w");
  const options = {
    cwd: root,
    stdio: ["ignore", output, output],
    windowsHide: true,
  };
  try {
    // Foreground only for the suite, which reads the fake graphify's record as
    // soon as the hook exits rather than waiting on a detached process.
    if (process.env.CLAUDE_GRAPH_REFRESH_FOREGROUND === "1") {
      spawnSync(executable, ["update", root], options);
    } else {
      spawn(executable, ["update", root], {
        ...options,
        detached: true,
      }).unref();
    }
  } finally {
    fs.closeSync(output);
  }
  return true;
}

module.exports = {
  headLogPath,
  graphIsStale,
  findExecutable,
  logFile,
  startRefresh,
};
```

- [ ] **Step 4: Write `hooks/graph-refresh.js` and extend the gate**

```js
"use strict";

// SessionStart: rebuild a stale knowledge graph in the background.
//
// Stale means graphify-out/graph.json is older than .git/logs/HEAD, which moves
// on every commit and checkout. Silent throughout: staleness fixes itself at no
// cost, and only a missing graph needs the operator, which repo-setup.js raises.
//
// Its own hook so that repo-setup.js stays filesystem-only, as its header
// promises.

const repoAudit = require("./lib/repo-audit");
const graphRefresh = require("./lib/graph-refresh");
const io = require("./lib/hook-io");

io.run(() => {
  const payload = io.readPayload();
  const root = repoAudit.findRepositoryRoot(payload.cwd || process.cwd());
  if (root === null || !graphRefresh.graphIsStale(root)) return;
  graphRefresh.startRefresh(io.configDir(), root);
});
```

In `hooks/clear-gate.js`, add `const graphRefresh = require("./lib/graph-refresh");` to the requires, and replace everything from `// Without the gauge's record` to the end of the `io.run` body with:

```js
// Without the gauge's record there is nothing to compare against, and holding
// a stop on a guess is worse than letting one suggestion through.
const record = zones.readGaugeState(io.configDir(), payload.session_id);
if (
  record !== null &&
  stateFile.stateDigest(state.text) === record.stateDigest
) {
  io.block(
    "update .claude/state.md before suggesting a clear: record progress, " +
      "decisions, rejected approaches and the next step, then suggest it again.",
  );
  return;
}

// Whenever a graph exists, not only when stale: this session's edits are
// uncommitted, so HEAD's log has not moved, and the session after the clear
// should still read a graph that includes them.
graphRefresh.startRefresh(io.configDir(), root);
```

- [ ] **Step 5: Run, pass, and prove a case can fail**

Run: `node ~/.claude/tools/test-hooks.js 2>&1 | grep -A12 "graph-refresh rebuilds"; node ~/.claude/tools/test-hooks.js 2>&1 | tail -1`
Expected: nine `[PASS]` (eight skipped by name on Windows), and the Task 6 gate cases still `[PASS]`; `FAIL 0`.

Temporarily change `graphTime < headTime` to `graphTime > headTime`; confirm `a stale graph starts…` fails with `-> ` and `a current graph starts nothing` fails with `-> 1`. Restore.

- [ ] **Step 6: Wire, document, and time it for real**

In `settings.json` (operator's hunk), add to the SessionStart hooks array, after the `repo-setup.js` entry:

```json
{
  "type": "command",
  "command": "node -e \"const p=require('path'),d=process.env.CLAUDE_CONFIG_DIR||p.join(require('os').homedir(),'.claude');require(p.join(d,'hooks','graph-refresh.js'))\""
}
```

In `docs/hooks.md`, add a row: `| `SessionStart`|`hooks/graph-refresh.js`| When`graphify-out/graph.json`is older than`.git/logs/HEAD`, starts `graphify update`detached and returns at once, logging to`cache/graph-refresh/`. Code only, no model calls. Silent, including when graphify is not installed. The clear gate starts the same rebuild when it lets a clear suggestion through. |`. Add `graph-refresh.js` to the `hooks/lib/` paragraph. Update the hook counts and the case count.

Run: `node ~/.claude/hooks/validate-config.js 2>&1 | tail -5` — expected: no failed checks.

Settle the spec's "`graphify update` is quick on a full-size repository": ask the operator which real repository to time (the run writes `graphify-out/` inside it), then:

```bash
cd <repository the operator named> && time graphify update .
```

and, to confirm the hook itself returns at once against that repository once its graph is stale (`touch .git/logs/HEAD` makes it so):

```bash
touch .git/logs/HEAD && time (echo "{\"cwd\":\"$PWD\"}" | node ~/.claude/hooks/graph-refresh.js)
```

Expected: the hook's `real` time well under a second while `ls -la ~/.claude/cache/graph-refresh/` shows its log growing. Record both times.

- [ ] **Step 7: Checkpoint**

Stop. Show the suite summary and both timings. Files for the operator: `hooks/lib/graph-refresh.js`, `hooks/graph-refresh.js`, `hooks/clear-gate.js`, `docs/hooks.md`, `tools/test-hooks.js`, and the `settings.json` hunk. Suggested subject: `Rebuild a stale graphify graph in the background`.

### Task 9: Lower the automatic-compaction threshold

**Files:**

- Modify: `settings.json` (operator's hunk: `autoCompactWindow`)

- [ ] **Step 1: Find every statement of the current value**

Run: `grep -rn "autoCompactWindow\|400000\|400K" ~/.claude/settings.json ~/.claude/docs ~/.claude/README.md ~/.claude/CLAUDE.md ~/.claude/modes ~/.claude/rules 2>/dev/null | grep -v "docs/superpowers/"`
Expected: the `settings.json` line, and any doc that states the value. Every such doc line changes in this task too.

- [ ] **Step 2: Change the value**

In `settings.json`, change `"autoCompactWindow": 400000,` to `"autoCompactWindow": 220000,`. At 400K, automatic compaction fired at a median of 368K; the same ratio puts the backstop near 200K.

- [ ] **Step 3: Verify**

Run: `node -e 'console.log(JSON.parse(require("fs").readFileSync(require("os").homedir()+"/.claude/settings.json","utf8")).autoCompactWindow)'` — expected `220000`.
Run: `node ~/.claude/hooks/validate-config.js 2>&1 | tail -5` — expected: no failed checks.

- [ ] **Step 4: Checkpoint**

Stop. Files for the operator: the `settings.json` hunk and any doc line from Step 1. Suggested subject: `Lower autoCompactWindow to 220000`. The body should say this reverses the 2026-09-09 decision not to move the threshold, which was made when nothing carried state across a compaction.

Not verified until real compactions happen: that the backstop fires near 200K. Settle it with `node ~/.claude/tools/context-report.js --since <the date this lands>` once a few automatic compactions exist; the automatic median should sit near 200K.

### Task 10: The probe's second run, and the zone numbers

Spends real usage twice. Wait for a weekly reset, show every `--dry-run` count, and get the operator's go before each run.

**Files:**

- Modify: `probes/state-carryover.js` (arms generated by the real hooks; two capture arms)
- Create: `probes/state-carryover-depth.js`
- Modify: `hooks/lib/context-zones.js`, `tools/test-hooks.js`, `docs/hooks.md` (only if the depth run moves a number)

**Interfaces:**

- Consumes: `hooks/state-restore.js` (Task 4) and `hooks/constraint-capture.js` (Task 7), run as subprocesses; `STATE_FILE`, `grade`, `fixtures`, `tasks`, `userTurns` from the probe; `tools/probe/stats.js` `twoProportion(hitsA, trialsA, hitsB, trialsB) -> { delta, p }`.
- Produces: `hookOutput(source, stateText) -> string` exported from `probes/state-carryover.js`, reused by the depth probe.

- [ ] **Step 1: Keep the baseline cells**

```bash
cp -R ~/.claude/cache/probe/state-carryover ~/.claude/cache/probe/state-carryover-baseline
node ~/.claude/tools/ccfg.js probe clean state-carryover
```

- [ ] **Step 2: Generate the arms from the real hooks**

In `probes/state-carryover.js`, add after `COMPACTION_PREAMBLE`:

```js
const os = require("os");
const { spawnSync } = require("child_process");

const HOOKS = path.join(__dirname, "..", "hooks");

// The exact text the hooks inject, from a throwaway repository, so the arms
// measure what ships rather than a copy of it.
function inScratchRepository(stateText, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "carryover-repo-"));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "carryover-config-"));
  try {
    spawnSync("git", ["init", "-q", "."], { cwd: root });
    fs.mkdirSync(path.join(root, ".claude"));
    fs.writeFileSync(path.join(root, ".claude", "state.md"), stateText);
    return body(root, { ...process.env, CLAUDE_CONFIG_DIR: configDir });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(configDir, { recursive: true, force: true });
  }
}

function hookOutput(source, stateText) {
  return inScratchRepository(stateText, (root, env) => {
    const reply = spawnSync(
      process.execPath,
      [path.join(HOOKS, "state-restore.js")],
      {
        input: JSON.stringify({ source, cwd: root }),
        encoding: "utf8",
        env,
      },
    );
    return JSON.parse(reply.stdout).hookSpecificOutput.additionalContext;
  });
}

// Instructions Claude never recorded: the case keyword capture exists for.
const FORGOTTEN_STATE_FILE = STATE_FILE.replace(
  /## Instructions\n\n[\s\S]*?\n\n## Unconfirmed/,
  "## Instructions\n\n## Unconfirmed",
);

function capturedStateFile() {
  return inScratchRepository(FORGOTTEN_STATE_FILE, (root, env) => {
    for (const prompt of userTurns()) {
      spawnSync(process.execPath, [path.join(HOOKS, "constraint-capture.js")], {
        input: JSON.stringify({ session_id: "carryover", prompt, cwd: root }),
        encoding: "utf8",
        env,
      });
    }
    return fs.readFileSync(path.join(root, ".claude", "state.md"), "utf8");
  });
}
```

Replace the `arms` and `userPrefix` properties with:

```js
  arms: {
    "clear-bare": "",
    compact: "",
    "clear-state": "",
    "clear-forgotten": "",
    "clear-captured": "",
  },

  // Built on first read and kept. Loading probes copies each one with an object
  // spread, which reads this too, so even `ccfg probe list` spawns the hooks
  // once; a few subprocesses is an acceptable price in a hand-run harness.
  get userPrefix() {
    if (this.builtUserPrefix === undefined) {
      this.builtUserPrefix = {
        compact: `${COMPACTION_PREAMBLE}${readFixture("compaction-summary.md")}\n\n${hookOutput("compact", STATE_FILE)}`,
        "clear-state": hookOutput("clear", STATE_FILE),
        "clear-forgotten": hookOutput("clear", FORGOTTEN_STATE_FILE),
        "clear-captured": hookOutput("clear", capturedStateFile()),
      };
    }
    return this.builtUserPrefix;
  },
```

Export `hookOutput` alongside the other extras. Append to the header comment: `From the second run on, every arm except clear-bare is the real hooks' output (hookOutput); the baseline's clear-state used CLEAR_PREAMBLE directly and its compact arm the retired handoff. clear-forgotten against clear-captured is the keyword capture's test: capture stays only if it measurably helps.`

Check the generated text before spending anything:

```bash
node -e 'const probe = require(require("os").homedir() + "/.claude/probes/state-carryover.js"); for (const [arm, text] of Object.entries(probe.userPrefix)) console.log("== " + arm + "\n" + text.slice(0, 600) + "\n")'
```

Expected: `clear-state` opens with the clear preamble; `clear-forgotten` has an empty Instructions section; `clear-captured` has the two instruction sentences under Unconfirmed; `compact` holds the summary and then the "file wins" preamble.

- [ ] **Step 3: Run it (operator's go)**

Run: `node ~/.claude/tools/ccfg.js probe run state-carryover --dry-run` — expected `30 cells (5 arms x 2 tasks x 3 reps)`.
Run: `node ~/.claude/tools/ccfg.js probe run state-carryover --parallel 3`, then `node ~/.claude/tools/ccfg.js probe inspect state-carryover`, reading both ends of every arm.

- [ ] **Step 4: Apply the acceptance test**

The table compares every arm with `clear-bare`. Compute the other two comparisons from its counts:

```bash
node -e 'const stats = require(require("os").homedir() + "/.claude/tools/probe/stats.js"); const [a, b, c, d] = process.argv.slice(1).map(Number); console.log(stats.twoProportion(a, b, c, d))' <clear-state hits> <clear-state n> <compact hits> <compact n>
```

and the same for `clear-captured` against `clear-forgotten`.

- Accepted when `clear-state` has a lower hit rate than both `clear-bare` and `compact`. If it does not, stop: the spec says the design is revisited, not kept on faith.
- Keyword capture stays when `clear-captured` has a lower hit rate than `clear-forgotten`. If it does not, report that to the operator with the numbers and propose removing `hooks/constraint-capture.js` in its own change; do not remove it here.
- With 6 trials an arm, say plainly when a difference is not significant.

Record the table and both extra comparisons in the probe's header, dated, as in Task 2.

- [ ] **Step 5: Write the depth probe**

Filler goes in the appended system prompt, not on the user message: at 300K tokens it is about 1.2 MB, past the argument limit that `userPrefix` travels through. So the loaded state sits in a different position from the real hook's; the header says so.

`probes/state-carryover-depth.js`:

```js
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
// Filler is sized at 4 characters a token, an estimate; Step 6 of the plan
// records the real count for the largest arm.

const carryover = require("./state-carryover.js");

const DEPTHS = {
  "depth-0": 0,
  "depth-50k": 50000,
  "depth-100k": 100000,
  "depth-150k": 150000,
  "depth-200k": 200000,
  "depth-300k": 300000,
};
const CHARACTERS_PER_TOKEN = 4;
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
```

- [ ] **Step 6: Smoke the largest arm by hand (one model call; operator's go)**

```bash
DEPTH_SCRATCH=$(mktemp -d) && cd "$DEPTH_SCRATCH"
node -e 'require("fs").writeFileSync("arm.txt", require(require("os").homedir() + "/.claude/probes/state-carryover-depth.js").arms["depth-300k"])'
claude -p --safe-mode --output-format json --append-system-prompt-file arm.txt "Carry on with the export work: write the code for the next step." | node -e 'const reply = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(JSON.stringify(reply.usage), "\n", String(reply.result).slice(0, 400))'
```

Expected: a usage record whose input plus cache tokens is near 300K, and an answer rather than a length error. If the count is far off, adjust `CHARACTERS_PER_TOKEN` to match and rerun this step. If the call errors on length, drop `depth-300k` and record why.

- [ ] **Step 7: Run the depth probe (operator's go)**

Run: `node ~/.claude/tools/ccfg.js probe run state-carryover-depth --dry-run` — expected `18 cells (6 arms x 1 tasks x 3 reps)`.
Run: `node ~/.claude/tools/ccfg.js probe run state-carryover-depth --parallel 2`, then `inspect`.

- [ ] **Step 8: Set the zone numbers from the result**

- If some depth is significantly worse than `depth-0` (p < 0.05 in the table): set `AMBER_TOKENS` to the largest depth below the first one that is, and `RED_TOKENS` to that first depth. Both stay under the `autoCompactWindow` backstop of about 200K; if the result says otherwise, stop and ask the operator.
- If no depth differs: leave 120K and 200K, and record that 3 trials per arm found no drop up to the largest depth, which is not evidence that none exists.

When a number moves: update `hooks/lib/context-zones.js`, the gauge and gate test inputs that sit on the wrong side of the new line (the 150K amber and 250K red transcripts), and the numbers in the `docs/hooks.md` rows. Run the suite and the validator.

Record the table and the decision in the depth probe's header, dated.

- [ ] **Step 9: Checkpoint**

Stop. Show both tables and the decision. Files for the operator: `probes/state-carryover.js`, `probes/state-carryover-depth.js`, and, if the numbers moved, `hooks/lib/context-zones.js`, `tools/test-hooks.js`, `docs/hooks.md`. Suggested subjects, as two commits: `Measure state carryover through the real hooks` and `Set context zones from state-carryover-depth` (or, if nothing moved, fold the depth probe into the first as `Probe state carryover by context depth`).

### Task 11: The CLAUDE.md graphify paragraph (only if the operator agrees)

The setup banner now raises a missing graph on every start, which makes this paragraph redundant. Ask first; skip the task on a no.

**Files:**

- Modify: `CLAUDE.md` (the `# graphify` section)

- [ ] **Step 1: Ask the operator**

"The setup banner now names a missing knowledge graph on every session start. Remove the CLAUDE.md paragraph that tells Claude to offer `/graphify` when a project has no graph? The pointer to the graphify skill above it stays."

- [ ] **Step 2: Remove the paragraph**

In `CLAUDE.md`, delete the paragraph that begins `If a project has no \`graphify-out/graph.json\`, say so once per session`and the blank line before it. Keep the`# graphify` heading and the bullet naming the skill.

- [ ] **Step 3: Verify**

Run: `grep -n "graphify" ~/.claude/CLAUDE.md` — expected: the heading and the skill bullet only.
Run: `node ~/.claude/hooks/validate-config.js 2>&1 | tail -5` — expected: no failed checks.
Run: `node ~/.claude/tools/ccfg.js probe run corpus-fidelity` — expected: PASS (it checks the mode rules against `modes/SOURCE-SNAPSHOT.md`, which this section was never part of; a failure means that assumption is wrong).

- [ ] **Step 4: Checkpoint**

Stop. File for the operator: `CLAUDE.md`. Suggested subject: `Remove the CLAUDE.md graphify offer`.

---

## After rollout: checks no task can run

| Claim (spec section 5)                                             | How to settle it                                                                                                              | When                              |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Claude Code shows a hook's `systemMessage` banner at session start | Open a session in a repository with no state file and look for the `Repo setup:` line                                         | First session after Task 3        |
| `/resume` lists a session from before a `/clear`                   | Run `/clear` in a session, then `/resume`, and look for the earlier one                                                       | Once, by hand                     |
| graphify's `query` honours `--budget`                              | In the repository timed in Task 8, run `graphify query "where is the entry point" --budget 200` and check the output is short | During Task 8                     |
| A hook writing the state file does not disrupt Claude's edits      | The procedure at the end of Task 7                                                                                            | First session after Task 7        |
| Claude stops at a natural point in amber and suggests the clear    | Watch the first session that crosses 120K                                                                                     | First long session after Task 6   |
| The backstop fires near 200K                                       | `node ~/.claude/tools/context-report.js --since <Task 9 date>`, automatic median                                              | After a few automatic compactions |
| Turns above 200K and compactions per week both fall                | The same report, two weeks after Task 9, against the 2026-09-11 table                                                         | Two weeks after rollout           |
