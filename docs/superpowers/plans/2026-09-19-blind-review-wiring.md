# Blind review wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the blind review real: the main session dispatches a reviewer by run token, the dispatch hook writes a prompt holding only the diff, the reviewer's findings land in the run record, and a new `Stop` hook holds the main session's turn until every run that changed files is reviewed clean or justified.

**Architecture:** The review stops being a check on the implementer's report (which runs before any reviewer can exist) and becomes a check on the main session's turn end. The run record (`cache/crew/<session>.jsonl`, written through `hooks/lib/crew-record.js`) gains `review`, `stands` and `hold` lines; `hooks/agent-dispatch.js` builds the reviewer's prompt; `hooks/subagent-gate.js` writes the verdict; `hooks/review-hold.js` reads it all back at `Stop`.

**Tech Stack:** Node.js (CommonJS, no dependencies), git, the hook test suite `tools/test-hooks.js` (spawns each hook with `process.execPath` and a JSON payload on stdin).

**Spec:** `docs/superpowers/specs/2026-09-19-blind-review-wiring-design.md`. Read it first; this plan argues from it.

## Global Constraints

- Never commit, never push, never `--no-verify`. Each task ends at a commit boundary: stop, report, and the operator commits with `/commit`. Commit messages carry no trailers.
- Never stage `settings.json`: it holds the operator's own uncommitted edits.
- No new dependencies.
- Names spelled out (`findings`, not `fs`; `index`, not `i` outside loop counters). Comments say why, never what.
- No em dashes in any file written or edited. Use a colon, comma, full stop or parentheses.
- Every new test is watched failing for the right reason before the code that passes it is written. After each task: `node tools/ccfg.js test` exits 0 and `node hooks/validate-config.js` prints `ALL CHECKS PASSED`.
- `npx prettier --check` clean on every touched file.
- The diff cap is 60,000 characters (`MAX_DIFF_CHARACTERS`), a first guess, said so in its comment.
- A run is held at most twice (`MAX_HOLDS = 2`).
- The four finding labels are exactly `Blocking`, `Nit`, `Optional`, `FYI`; the clean line is exactly `Findings: none`; the justification line is `Stands <token>: <reason>`; the review request line is `Reviews: <token>[, <token>...]`.
- Any live dispatch or `claude -p` call spends real usage and waits for the operator's explicit go.

## File map

| File                                   | Responsibility                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks/lib/blind-review.js` (new)      | Everything about a review that is not I/O: the prompt, parsing findings, reading a verdict, building a diff.                           |
| `hooks/subagent/gates/review.js`       | Deleted (Task 1).                                                                                                                      |
| `hooks/lib/crew-record.js`             | New line kinds and one join helper.                                                                                                    |
| `hooks/subagent/gates/review-shape.js` | New gate: a reviewer report must be readable.                                                                                          |
| `hooks/subagent-gate.js`               | Writes the `review` line when a reviewer's report passes.                                                                              |
| `hooks/agent-dispatch.js`              | Records `verify`; replaces a reviewer dispatch's prompt with the blind one.                                                            |
| `hooks/lib/hook-io.js`                 | New `tell(systemMessage)`: speak to the operator from a `Stop` hook without blocking.                                                  |
| `hooks/review-hold.js` (new)           | The `Stop` hook that holds the turn.                                                                                                   |
| `modes/roles/reviewer.md`              | Finding line format; `gates: finish-shape, review-shape`.                                                                              |
| `tools/test-hooks.js`                  | Every new case, in new `header(...)` sections placed just above the final cleanup (`fs.rmSync(testedConfig` near the end of the file). |
| `docs/hooks.md`, the architecture spec | Documentation (Task 6).                                                                                                                |
| `settings.json`                        | One `Stop` entry (Task 6), left unstaged.                                                                                              |

---

### Task 1: Move the review module to `hooks/lib/blind-review.js` and add `parseFindings`

**Files:**

- Create: `hooks/lib/blind-review.js`
- Delete: `hooks/subagent/gates/review.js`
- Modify: `tools/test-hooks.js` (the section beginning `// The blind review gate.`, currently near line 6772)

**Interfaces:**

- Produces: `buildPrompt({ diff }) -> string`, `parseFindings(report: string) -> Array<{severity, text}> | null`, `interpret(review: {findings} | null) -> {ok: true} | {ok: false, reason: string}`, `isAdvisory(finding) -> boolean`, `ADVISORY: string[]`, `LABELS: string[]` (the four labels, `Blocking` first).

- [ ] **Step 1: Rewrite the existing test section against the new path and add the parser cases**

Replace the `require(path.join(HOOKS, "subagent", "gates", "review.js"))` line with:

```js
const blindReview = require(path.join(HOOKS, "lib", "blind-review.js"));
```

Rename every `reviewGate.` in that section to `blindReview.`. Delete the four cases that describe the module as a gate: `"the gate is named review"`, `"the review gate is off at verify: tested"`, the `typeof reviewGate.check` case, and `"a run carrying no review verdict does not pass"`. Then add, in the same section:

```js
check(
  "the review prompt asks for one finding per labelled line",
  blindReview.buildPrompt({ diff: "x" }).includes("`Blocking:`"),
  true,
);
check(
  "the review prompt names the clean line",
  blindReview.buildPrompt({ diff: "x" }).includes("Findings: none"),
  true,
);
check(
  "a Blocking line is read as a blocking finding",
  JSON.stringify(blindReview.parseFindings("Blocking: drops the error")),
  JSON.stringify([{ severity: "Blocking", text: "drops the error" }]),
);
check(
  "a lower-case label is read under its canonical spelling",
  JSON.stringify(blindReview.parseFindings("nit: rename rows")),
  JSON.stringify([{ severity: "Nit", text: "rename rows" }]),
);
check(
  "every finding line in a report is read",
  blindReview.parseFindings(
    "Intro.\nOptional: split it\nFYI: tests not read\nBlocking: leaks",
  ).length,
  3,
);
check(
  "Findings: none alone is a clean review",
  JSON.stringify(
    blindReview.parseFindings("Looked at all of it.\nFindings: none"),
  ),
  "[]",
);
check(
  "a finding line beside Findings: none still counts",
  blindReview.parseFindings("Findings: none\nBlocking: leaks").length,
  1,
);
check(
  "a report with no finding line and no clean line is unreadable",
  blindReview.parseFindings("Looks fine to me."),
  null,
);
check(
  "a report written only in an unknown label is unreadable",
  blindReview.parseFindings("Critical: this leaks"),
  null,
);
check(
  "a label in the middle of a sentence is not a finding",
  blindReview.parseFindings("I would call this Blocking: maybe."),
  null,
);
check(
  "a parsed clean review passes interpret",
  blindReview.interpret({
    findings: blindReview.parseFindings("Findings: none"),
  }).ok,
  true,
);
check(
  "a parsed blocking review fails interpret",
  blindReview.interpret({
    findings: blindReview.parseFindings("Blocking: leaks"),
  }).ok,
  false,
);
```

- [ ] **Step 2: Run the suite and watch it fail**

Run: `node tools/test-hooks.js 2>&1 | tail -5`
Expected: the run aborts with `Cannot find module '.../hooks/lib/blind-review.js'`.

- [ ] **Step 3: Create `hooks/lib/blind-review.js`**

Move the whole body of `hooks/subagent/gates/review.js` into it, then make these changes:

1. Header comment: keep the blindness paragraph and the AUROC paragraph verbatim. Replace the paragraph beginning `` `minimumVerify: "proven"` `` with:

```js
// This is not a gate. A gate checks a worker's report as it hands it back, and
// no reviewer can have run by then. The review is dispatched afterwards by the
// main session (hooks/agent-dispatch.js builds its prompt), its verdict is
// written into the run record (hooks/subagent-gate.js), and the main session's
// turn is held until the verdict is clean or answered (hooks/review-hold.js).
// It binds wherever the mode sets `verify: proven`.
```

2. After `const ADVISORY = ...` add:

```js
// Every label a finding line may open with. Blocking is the only one that stops
// a change, and it is spelled out rather than implied, so a reviewer never has
// to guess how to say "this cannot ship".
const LABELS = ["Blocking", ...ADVISORY];

// A finding sits on its own line with its label first. Matching at the start of
// a line is what keeps "I would call this Blocking: maybe" in a sentence from
// being read as a verdict.
const FINDING_LINE = new RegExp(
  `^[ \\t]*(${LABELS.join("|")}):[ \\t]*(.*)$`,
  "gim",
);
const CLEAN_LINE = /^[ \t]*Findings:[ \t]*none\b/im;
```

3. In `buildPrompt`, replace the two lines beginning `` `Label each finding with a severity. `` through `"good, not only what is wrong, and name any area you did not cover.",` with:

```js
    "Put each finding on its own line, opening with its label: `Blocking:` for",
    `anything the change cannot ship with, or ${ADVISORY.map((label) => `\`${label}:\``).join(", ")}`,
    "for anything it can. If you found nothing, write the line `Findings: none`.",
    "Say what is good, not only what is wrong, and name any area you did not cover.",
```

4. Add after `isAdvisory`:

```js
/**
 * A reviewer's report as a list of findings.
 *
 * An empty list means the reviewer said `Findings: none`; null means it said
 * neither that nor any labelled line, and `interpret` reads null as a failure.
 * Finding lines win over a clean line, so a stray `none` can never hide a
 * `Blocking:` line written beside it.
 */
function parseFindings(report) {
  const text = typeof report === "string" ? report : "";
  const findings = [...text.matchAll(FINDING_LINE)].map((found) => ({
    severity: LABELS.find(
      (label) => label.toLowerCase() === found[1].toLowerCase(),
    ),
    text: found[2].trim(),
  }));
  if (findings.length > 0) return findings;
  return CLEAN_LINE.test(text) ? [] : null;
}
```

5. Replace the `module.exports` block with:

```js
module.exports = {
  buildPrompt,
  parseFindings,
  interpret,
  isAdvisory,
  ADVISORY,
  LABELS,
};
```

Then delete the file: `git rm -q --cached hooks/subagent/gates/review.js 2>/dev/null; rm hooks/subagent/gates/review.js` (the first half only unstages; nothing is committed).

- [ ] **Step 4: Run the suite and see it pass**

Run: `node tools/ccfg.js test`
Expected: exit 0, every case PASS.

- [ ] **Step 5: Break it and watch each new parser case fail**

Temporarily change `FINDING_LINE`'s `^[ \\t]*` to `[ \\t]*` and confirm `"a label in the middle of a sentence is not a finding"` fails; restore. Temporarily make `parseFindings` return `[]` in place of `null` and confirm both unreadable cases fail; restore. Confirm the file is byte-identical to Step 3's result with `git diff --stat`.

- [ ] **Step 6: Validate and stop for the commit**

Run: `node hooks/validate-config.js` (expect `ALL CHECKS PASSED`), `npx prettier --check hooks/lib/blind-review.js tools/test-hooks.js`.
Stop. Suggested subject for the operator: `Move the blind review into hooks/lib and parse findings`.

---

### Task 2: Give the run record `verify`, `reviews`, and review, stands and hold lines

**Files:**

- Modify: `hooks/lib/crew-record.js`
- Modify: `tools/test-hooks.js` (new section `header("The run record: review lines")`)

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces:
  - `openRun({ sessionId, token, role, scope, head, verify, reviews })`: the run line gains `verify: string | null` and `reviews: string[] | null` (null when empty or absent).
  - `appendReview(sessionId, { token, reviews, findings }) -> boolean` writes `{kind: "review", token, reviews, findings, at}`.
  - `appendStands(sessionId, { token, reason }) -> boolean` writes `{kind: "stands", token, reason, at}`.
  - `appendHold(sessionId, { token }) -> boolean` writes `{kind: "hold", token, at}`.
  - `agentForToken(sessionId, token) -> string | null`: the `agentId` of the newest `finish` line carrying that token.

- [ ] **Step 1: Write the failing tests**

```js
header("The run record: review lines");
{
  const recordConfig = fs.mkdtempSync(
    path.join(os.tmpdir(), "crew-review-record-"),
  );
  const recordEnv = { CLAUDE_CONFIG_DIR: recordConfig };
  const recordModule = path.join(HOOKS, "lib", "crew-record.js");
  // The module reads CLAUDE_CONFIG_DIR when called, so each case runs in a child
  // process with its own environment rather than mutating this one.
  const inRecord = (body) => {
    const script = `const record = require(${JSON.stringify(recordModule)});\n${body}`;
    const result = spawnSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      env: { ...process.env, ...recordEnv },
    });
    return (result.stdout || "").trim();
  };
  const lastLine = () => {
    const lines = readTextOrEmpty(
      path.join(recordConfig, "cache", "crew", "r1.jsonl"),
    )
      .trim()
      .split("\n");
    return JSON.parse(lines[lines.length - 1]);
  };

  inRecord(
    `record.openRun({ sessionId: "r1", token: "aaaa0001", role: "implementer", scope: ["a.js"], head: "h", verify: "proven" });`,
  );
  check(
    "a run line keeps the posture it was dispatched under",
    lastLine().verify,
    "proven",
  );
  check("a run line with no reviews says null", lastLine().reviews, null);

  inRecord(
    `record.openRun({ sessionId: "r1", token: "bbbb0002", role: "reviewer", scope: [], head: "h", verify: "proven", reviews: ["aaaa0001"] });`,
  );
  check(
    "a reviewer run line keeps what it reviews",
    lastLine().reviews.join(","),
    "aaaa0001",
  );

  inRecord(
    `record.appendReview("r1", { token: "bbbb0002", reviews: ["aaaa0001"], findings: [{ severity: "Nit", text: "x" }] });`,
  );
  check("a review line has its kind", lastLine().kind, "review");
  check(
    "a review line keeps its findings",
    lastLine().findings[0].severity,
    "Nit",
  );

  inRecord(
    `record.appendStands("r1", { token: "aaaa0001", reason: "false alarm" });`,
  );
  check("a stands line keeps its reason", lastLine().reason, "false alarm");

  inRecord(`record.appendHold("r1", { token: "aaaa0001" });`);
  check(
    "a hold line names its run",
    lastLine().kind + " " + lastLine().token,
    "hold aaaa0001",
  );

  inRecord(
    `record.appendFinish("r1", { agentId: "agent-old", token: "aaaa0001" }); record.appendFinish("r1", { agentId: "agent-new", token: "aaaa0001" });`,
  );
  check(
    "a token joins to the newest worker that reported it",
    inRecord(
      `process.stdout.write(String(record.agentForToken("r1", "aaaa0001")));`,
    ),
    "agent-new",
  );
  check(
    "a token nobody reported joins to nothing",
    inRecord(
      `process.stdout.write(String(record.agentForToken("r1", "cccc0003")));`,
    ),
    "null",
  );

  fs.rmSync(recordConfig, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `node tools/test-hooks.js 2>&1 | grep -A1 FAIL | head -20`
Expected: `verify` reads `undefined`, and the three `append*` calls throw `record.appendReview is not a function` (the child prints nothing, so `lastLine()` repeats the previous line and the kind checks fail).

- [ ] **Step 3: Implement**

In `openRun`, take `verify` and `reviews` and add to the line:

```js
    verify: verify || null,
    // Only a reviewer's dispatch carries this. Null rather than an empty list
    // so a reader can test it for truth without also checking its length.
    reviews: Array.isArray(reviews) && reviews.length > 0 ? reviews : null,
```

Add after `appendFinish`:

```js
/** A reviewer's verdict on the runs it was dispatched to review. */
function appendReview(sessionId, { token, reviews, findings }) {
  return appendLine(sessionId, {
    kind: "review",
    token,
    reviews,
    findings,
    at: new Date().toISOString(),
  });
}

/**
 * The main session's written reason that a run's blocking findings stand.
 *
 * Kept here rather than read back from the transcript each time, because the
 * turn end that wrote it is gone by the next one.
 */
function appendStands(sessionId, { token, reason }) {
  return appendLine(sessionId, {
    kind: "stands",
    token,
    reason,
    at: new Date().toISOString(),
  });
}

/** One turn end held on a run, counted toward the two-hold bound. */
function appendHold(sessionId, { token }) {
  return appendLine(sessionId, {
    kind: "hold",
    token,
    at: new Date().toISOString(),
  });
}

/**
 * The worker a run token belongs to, or null.
 *
 * Only a `finish` line holds both halves of the join: the dispatch minted the
 * token before the worker had an agent id, and the trace hook records paths by
 * agent id alone. The newest wins, because a worker sent back reports again.
 */
function agentForToken(sessionId, token) {
  let agentId = null;
  for (const entry of readLines(sessionId)) {
    if (entry.kind === "finish" && entry.token === token && entry.agentId)
      agentId = entry.agentId;
  }
  return agentId;
}
```

Export all four.

- [ ] **Step 4: Run the suite and see it pass**

Run: `node tools/ccfg.js test` (exit 0).

- [ ] **Step 5: Break and restore**

Make `agentForToken` return the first match instead of the last; confirm `"a token joins to the newest worker that reported it"` fails; restore. Drop the `reviews` null normalisation; confirm `"a run line with no reviews says null"` fails; restore.

- [ ] **Step 6: Validate and stop for the commit**

`node hooks/validate-config.js`, prettier on both files. Stop. Suggested subject: `Record reviews, stands and holds in crew-record`.

---

### Task 3: Refuse an unreadable review, and write the verdict when a review passes

**Files:**

- Create: `hooks/subagent/gates/review-shape.js`
- Modify: `hooks/subagent-gate.js` (the `if (refusal === null) {` block near the end)
- Modify: `modes/roles/reviewer.md`
- Modify: `tools/test-hooks.js` (new section `header("SubagentStop: the reviewer's verdict")`)

**Interfaces:**

- Consumes: `parseFindings` (Task 1), `appendReview` and the run line's `reviews` (Task 2).
- Produces: `review` lines in the record, which Task 5 reads.

- [ ] **Step 1: Write the failing tests**

The fixture copies the real reviewer role file, so these cases test the role as it ships.

```js
header("SubagentStop: the reviewer's verdict");
{
  const GATE_RUNNER = path.join(HOOKS, "subagent-gate.js");
  const verdictConfig = fs.mkdtempSync(path.join(os.tmpdir(), "crew-verdict-"));
  const verdictEnv = { CLAUDE_CONFIG_DIR: verdictConfig };
  fs.writeFileSync(
    path.join(verdictConfig, "mode.lock"),
    JSON.stringify({
      mode: "test",
      codename: "TESTER",
      settings: { verify: "proven", claims: "labeled" },
      deniedTools: [],
      subagents: null,
    }),
  );
  fs.mkdirSync(path.join(verdictConfig, "modes", "roles"), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, "..", "modes", "roles", "reviewer.md"),
    path.join(verdictConfig, "modes", "roles", "reviewer.md"),
  );
  const verdictRecord = path.join(verdictConfig, "cache", "crew", "v1.jsonl");
  fs.mkdirSync(path.dirname(verdictRecord), { recursive: true });
  fs.writeFileSync(
    verdictRecord,
    [
      {
        kind: "run",
        token: "1111aaaa",
        role: "implementer",
        scope: ["a.js"],
        verify: "proven",
        reviews: null,
      },
      {
        kind: "run",
        token: "2222bbbb",
        role: "reviewer",
        scope: ["(review)"],
        verify: "proven",
        reviews: ["1111aaaa"],
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n") + "\n",
  );
  const reviewLines = () =>
    readTextOrEmpty(verdictRecord)
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line))
      .filter((line) => line.kind === "review");
  const reviewerStop = (agentId, message) => ({
    hook_event_name: "SubagentStop",
    agent_id: agentId,
    agent_type: "reviewer",
    session_id: "v1",
    last_assistant_message: message,
    stop_hook_active: false,
  });
  const finishBlock =
    "\n\nRUN 2222bbbb\nSTATE done\nTOUCHED (none)\nEVIDENCE (none)";

  check(
    "a review with no readable findings is sent back",
    run(
      GATE_RUNNER,
      reviewerStop("rev-a", "Looks fine." + finishBlock),
      verdictEnv,
    ).verdict,
    "BLOCK",
  );
  check("a refused review writes no verdict", reviewLines().length, 0);
  check(
    "the refusal names the line form",
    run(
      GATE_RUNNER,
      reviewerStop("rev-b", "Looks fine." + finishBlock),
      verdictEnv,
    ).reason.includes("Findings: none"),
    true,
  );

  check(
    "a readable review passes",
    run(
      GATE_RUNNER,
      reviewerStop(
        "rev-c",
        "Blocking: leaks the handle\nNit: rename" + finishBlock,
      ),
      verdictEnv,
    ).verdict,
    "allow",
  );
  const written = reviewLines()[0] || {};
  check("a passing review writes one verdict", reviewLines().length, 1);
  check(
    "the verdict names the run it reviewed",
    (written.reviews || []).join(","),
    "1111aaaa",
  );
  check("the verdict names its reviewer run", written.token, "2222bbbb");
  check(
    "the verdict keeps the blocking finding",
    (written.findings || [])[0].severity,
    "Blocking",
  );

  check(
    "a passing report from a non-reviewer writes no verdict",
    (run(
      GATE_RUNNER,
      {
        ...reviewerStop(
          "impl-a",
          "Blocking: x\n\nRUN 1111aaaa\nSTATE done\nTOUCHED a.js\nEVIDENCE (none)",
        ),
        agent_type: "implementer",
      },
      verdictEnv,
    ),
    reviewLines().length),
    1,
  );

  fs.rmSync(verdictConfig, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `node tools/test-hooks.js 2>&1 | grep -B1 -A1 FAIL | head -30`
Expected: the unreadable review is `allow` (the role names only `finish-shape`), and `"a passing review writes one verdict"` reads 0.

- [ ] **Step 3: Create the gate**

`hooks/subagent/gates/review-shape.js`:

```js
"use strict";

// A reviewer's report must say what it found in a form the turn-end hold can
// read. Sent back here, at the hand-back, the reviewer fixes its format while it
// still has the diff in front of it; left to the turn end, the only remedy is a
// whole second review.

const blindReview = require("../../lib/blind-review");

module.exports = {
  id: "review-shape",
  // Refused at every posture. A reviewer's report is only ever read by the
  // hold, and a report the hold cannot read is a review that did not happen.
  minimumVerify: "none",
  check(run) {
    const report = run && run.finish ? run.finish.report : "";
    if (blindReview.parseFindings(report) !== null) return { ok: true };
    return {
      ok: false,
      reason:
        "this review lists no finding the hold can read. Put each finding on its " +
        "own line opening with `Blocking:`, `Nit:`, `Optional:` or `FYI:`, or " +
        "write the line `Findings: none` if there are none.",
    };
  },
};
```

- [ ] **Step 4: Name it in the role, and teach the role the line form**

In `modes/roles/reviewer.md` set `gates: finish-shape, review-shape`, and replace the paragraph beginning `Label severity so nothing optional reads as mandatory:` with:

```markdown
Put each finding on its own line, opening with its label: `Blocking:` for
anything the change cannot ship with, `Nit:`, `Optional:` or `FYI:` for anything
it can. If you found nothing, write the line `Findings: none`. Say what is good,
not only what is wrong. Name explicitly any area you did not cover.
```

- [ ] **Step 5: Write the verdict in the runner**

In `hooks/subagent-gate.js` add `const blindReview = require("./lib/blind-review");` beside the other requires, and immediately before `if (refusal === null) {` add:

```js
// A reviewer's report that passed is the verdict on the runs it was sent to
// review, and the turn-end hold (hooks/review-hold.js) reads nothing else.
// Written here, at the pass, because this is the one place that has both the
// report and the run it joins to. A report the parser cannot read writes
// nothing; review-shape has already refused it wherever proof is wanted.
if (refusal === null && matched && Array.isArray(matched.reviews)) {
  const findings = blindReview.parseFindings(finish.report);
  if (findings !== null)
    record.appendReview(payload.session_id, {
      token: matched.token,
      reviews: matched.reviews,
      findings,
    });
}
```

- [ ] **Step 6: Run the suite and see it pass**

Run: `node tools/ccfg.js test` (exit 0).

- [ ] **Step 7: Break and restore**

Remove `review-shape` from the role's `gates:` line; confirm the two refusal cases fail; restore. Delete the `Array.isArray(matched.reviews)` condition; confirm `"a passing report from a non-reviewer writes no verdict"` fails; restore.

- [ ] **Step 8: Validate and stop for the commit**

`node hooks/validate-config.js`, prettier on all four files. Stop. Suggested subject: `Record a reviewer's findings as the run's verdict`.

---

### Task 4: Build the blind prompt in the dispatch hook

**Files:**

- Modify: `hooks/lib/blind-review.js` (add `reviewDiff`)
- Modify: `hooks/agent-dispatch.js`
- Modify: `tools/test-hooks.js` (new section `header("PreToolUse(Agent): the blind reviewer's prompt")`)

**Interfaces:**

- Consumes: `record.findRun`, `record.agentForToken`, `record.pathsFor`, `openRun`'s `verify` and `reviews` (Task 2); `buildPrompt` (Task 1).
- Produces: `reviewDiff({ sessionId, tokens, cwd }) -> string`; `MAX_DIFF_CHARACTERS = 60000`; reviewer run lines carrying `reviews`, every run line carrying `verify`.

**A gap in the spec, closed here:** the spec does not say whether a reviewer dispatch needs a `Scope:` line. A reviewer's tools are read-only and its scope gate is not in its `gates:` list, so a dispatch carrying `Reviews:` is exempt from the scope denial and is recorded with scope `["(review)"]`.

- [ ] **Step 1: Write the failing tests**

```js
header("PreToolUse(Agent): the blind reviewer's prompt");
{
  const DISPATCH = path.join(HOOKS, "agent-dispatch.js");
  const blindConfig = fs.mkdtempSync(path.join(os.tmpdir(), "crew-blind-"));
  const blindEnv = { CLAUDE_CONFIG_DIR: blindConfig };
  fs.writeFileSync(
    path.join(blindConfig, "mode.lock"),
    JSON.stringify({
      mode: "test",
      codename: "TESTER",
      settings: { verify: "proven" },
      deniedTools: [],
      subagents: null,
    }),
  );
  const blindRepo = makeRepository("crew-blind-repo-");
  git(["config", "user.email", "t@t.t"], blindRepo);
  git(["config", "user.name", "T"], blindRepo);
  fs.writeFileSync(path.join(blindRepo, "tracked.js"), "const before = 1;\n");
  git(["add", "."], blindRepo);
  git(["commit", "-qm", "base"], blindRepo);
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: blindRepo,
    encoding: "utf8",
  }).stdout.trim();
  fs.writeFileSync(path.join(blindRepo, "tracked.js"), "const after = 2;\n");
  fs.writeFileSync(path.join(blindRepo, "fresh.js"), "const brandNew = 3;\n");

  const blindRecord = path.join(blindConfig, "cache", "crew", "b1.jsonl");
  fs.mkdirSync(path.dirname(blindRecord), { recursive: true });
  fs.writeFileSync(
    blindRecord,
    [
      {
        kind: "run",
        token: "3333cccc",
        role: "implementer",
        scope: ["tracked.js", "fresh.js"],
        head,
        verify: "proven",
        reviews: null,
      },
      { kind: "path", agentId: "impl-1", path: "tracked.js" },
      { kind: "path", agentId: "impl-1", path: "fresh.js" },
      { kind: "finish", agentId: "impl-1", token: "3333cccc" },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n") + "\n",
  );

  const reviewerDispatch = (prompt) => ({
    tool_name: "Agent",
    hook_event_name: "PreToolUse",
    session_id: "b1",
    cwd: blindRepo,
    tool_input: { prompt, subagent_type: "reviewer" },
  });
  const promptOf = (reply) =>
    ((reply.hookSpecificOutput || {}).updatedInput || {}).prompt || "";
  const blindPrompt = promptOf(
    runJson(
      DISPATCH,
      reviewerDispatch("Reviews: 3333cccc\nThe goal was BRIEF-SENTINEL-7731."),
      blindEnv,
    ),
  );

  check(
    "a reviewer dispatch with Reviews is allowed without a scope line",
    blindPrompt.length > 0,
    true,
  );
  check(
    "the reviewer never sees the dispatcher's text",
    blindPrompt.includes("BRIEF-SENTINEL-7731"),
    false,
  );
  check(
    "the reviewer sees the change to a tracked file",
    blindPrompt.includes("const after = 2;"),
    true,
  );
  check(
    "the reviewer sees an untracked new file",
    blindPrompt.includes("const brandNew = 3;"),
    true,
  );
  check(
    "the reviewer prompt still carries a run token",
    /RUN [0-9a-f]{8}/.test(blindPrompt),
    true,
  );
  check(
    "git's index is left alone",
    spawnSync("git", ["diff", "--cached", "--name-only"], {
      cwd: blindRepo,
      encoding: "utf8",
    }).stdout.trim(),
    "",
  );

  const lastRun = () =>
    readTextOrEmpty(blindRecord)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((line) => line.kind === "run")
      .pop();
  check(
    "the reviewer's run line records what it reviews",
    (lastRun().reviews || []).join(","),
    "3333cccc",
  );
  check("every run line records the posture", lastRun().verify, "proven");

  const unknownPrompt = promptOf(
    runJson(DISPATCH, reviewerDispatch("Reviews: 9999ffff"), blindEnv),
  );
  check(
    "an unknown token is named as not found",
    unknownPrompt.includes("9999ffff: not found in the run record"),
    true,
  );

  fs.writeFileSync(path.join(blindRepo, "fresh.js"), "x".repeat(70000) + "\n");
  const bigPrompt = promptOf(
    runJson(DISPATCH, reviewerDispatch("Reviews: 3333cccc"), blindEnv),
  );
  check("an oversized diff is cut", bigPrompt.length < 64000, true);
  check(
    "a cut diff names every file in it",
    bigPrompt.includes("truncated") &&
      bigPrompt.includes("tracked.js") &&
      bigPrompt.includes("fresh.js"),
    true,
  );

  const adHoc = promptOf(
    runJson(
      DISPATCH,
      reviewerDispatch("Scope: a.js\nLook over a.js please."),
      blindEnv,
    ),
  );
  check(
    "a reviewer dispatch without Reviews keeps its own text",
    adHoc.includes("Look over a.js please."),
    true,
  );

  fs.rmSync(blindConfig, { recursive: true, force: true });
  fs.rmSync(blindRepo, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `node tools/test-hooks.js 2>&1 | grep -B1 -A1 FAIL | head -40`
Expected: the first case fails (a dispatch with no `Scope:` is denied at `verify: proven`, so no prompt), and every prompt case after it fails.

- [ ] **Step 3: Add `reviewDiff` to `hooks/lib/blind-review.js`**

At the top add `const path = require("path");`, `const { spawnSync } = require("child_process");`, `const io = require("./hook-io");`, `const record = require("./crew-record");`. Then:

```js
// A first guess, not a measurement: large enough for any change a single worker
// should be making, small enough to leave the reviewer room to read around it.
const MAX_DIFF_CHARACTERS = 60000;

// `io.git` treats any non-zero exit as failure, and `git diff --no-index` exits
// 1 whenever the two sides differ, which for a new file is always.
function diffAgainstNothing(relative, root) {
  const result = spawnSync(
    "git",
    ["diff", "--no-index", "--", "/dev/null", relative],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    },
  );
  return result.status === 0 || result.status === 1 ? result.stdout || "" : "";
}

/**
 * The diff a blind reviewer is given: every file each named run's worker wrote,
 * against the commit that run started from.
 *
 * Read from the run record rather than from anything the dispatcher wrote, so
 * the main session cannot choose what the reviewer sees. A token the record
 * cannot resolve is named rather than dropped, so a review of nothing never
 * reads as a review of everything.
 */
function reviewDiff({ sessionId, tokens, cwd }) {
  const root = io.git(["rev-parse", "--show-toplevel"], cwd).trim() || cwd;
  const sections = [];
  const files = [];
  for (const token of tokens) {
    const run = record.findRun(sessionId, token);
    const agentId = run ? record.agentForToken(sessionId, token) : null;
    const paths = agentId
      ? [...new Set(record.pathsFor(sessionId, agentId))]
      : [];
    if (paths.length === 0) {
      sections.push(
        `${token}: not found in the run record, or it changed no file. Say so in your findings.`,
      );
      continue;
    }
    for (const filePath of paths) {
      const relative = path.isAbsolute(filePath)
        ? path.relative(root, filePath)
        : filePath;
      files.push(relative);
      const tracked = io.git(["ls-files", "--", relative], root).trim() !== "";
      sections.push(
        tracked
          ? io.git(["diff", run.head || "HEAD", "--", relative], root)
          : diffAgainstNothing(relative, root),
      );
    }
  }
  const diff = sections.join("\n");
  if (diff.length <= MAX_DIFF_CHARACTERS) return diff;
  return (
    diff.slice(0, MAX_DIFF_CHARACTERS) +
    `\n\n[diff truncated at ${MAX_DIFF_CHARACTERS} characters. Every file in it: ` +
    `${[...new Set(files)].join(", ")}. Open the rest with Read.]`
  );
}
```

Export `reviewDiff` and `MAX_DIFF_CHARACTERS`.

- [ ] **Step 4: Change the dispatch hook**

In `hooks/agent-dispatch.js`, add `const blindReview = require("./lib/blind-review");`, and:

```js
const REVIEWER_ROLE = "reviewer";
const REVIEW_SCOPE = "(review)";

/**
 * The run tokens a reviewer dispatch asks to review, from its `Reviews:` line.
 *
 * Only well-formed tokens survive, so a stray word cannot be read as a run.
 */
function reviewedTokens(prompt) {
  const line = /^[ \t]*Reviews:[ \t]*(.+)$/m.exec(prompt || "");
  if (line === null) return [];
  return line[1]
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^[0-9a-f]{8}$/.test(entry));
}
```

In the `io.run` body, after `const scope = declaredScope(prompt);` add:

```js
const reviews =
  input.subagent_type === REVIEWER_ROLE ? reviewedTokens(prompt) : [];
const isBlindReview = reviews.length > 0;
```

Change the denial condition to `if (scope.length === 0 && !isBlindReview && STRICT_VERIFY.includes(verify))`. Change `effectiveScope` to:

```js
const effectiveScope = isBlindReview
  ? [REVIEW_SCOPE]
  : scope.length > 0
    ? scope
    : [UNDECLARED];
```

Pass `verify` and `reviews` to `record.openRun`. Replace the `io.rewrite(...)` call's prompt value with a variable built before it:

```js
// A blind review keeps none of the dispatcher's words: the diff is the whole
// prompt, which is what makes "the reviewer never sees the brief" true of the
// code rather than of whoever wrote the dispatch.
const body = isBlindReview
  ? blindReview.buildPrompt({
      diff: blindReview.reviewDiff({
        sessionId: payload.session_id,
        tokens: reviews,
        cwd: payload.cwd,
      }),
    })
  : `${scopeLine}${prompt}`;
```

and pass `prompt: \`${contract(token, effectiveScope)}\n\n${body}\``. The operator message keeps its current condition but uses `scope.length > 0 || isBlindReview`.

- [ ] **Step 5: Run the suite and see it pass**

Run: `node tools/ccfg.js test` (exit 0). The older dispatch section's cases must still pass unchanged.

- [ ] **Step 6: Break and restore**

Make `body` use `${prompt}` for the blind case too; confirm `"the reviewer never sees the dispatcher's text"` fails; restore. Replace `diffAgainstNothing(...)` with `io.git(["diff", "--no-index", "--", "/dev/null", relative], root)`; confirm `"the reviewer sees an untracked new file"` fails (the exit 1 is swallowed); restore.

- [ ] **Step 7: Validate and stop for the commit**

`node hooks/validate-config.js`, prettier on the three files. Stop. Suggested subject: `Build the blind reviewer's prompt from the run record`.

---

### Task 5: Hold the main session's turn in `hooks/review-hold.js`

**Files:**

- Modify: `hooks/lib/hook-io.js` (add `tell`)
- Create: `hooks/review-hold.js`
- Modify: `tools/test-hooks.js` (new section `header("Stop: the blind review hold")`)

**Interfaces:**

- Consumes: `readLines`, `appendStands`, `appendHold` (Task 2); `interpret` (Task 1); `review` lines (Task 3); run lines' `verify` and `reviews` (Task 4); `transcriptTail.latestAssistantText(transcriptPath)`.
- Produces: `io.tell(systemMessage)`, which emits `{systemMessage}` and exits 0. The hook's contract with the harness: `{"decision":"block","reason"}` to hold, `{systemMessage}` to warn the operator, nothing to pass.

- [ ] **Step 1: Write the failing tests**

Each case builds its own session file so no case depends on another's leftovers.

```js
header("Stop: the blind review hold");
{
  const HOLD = path.join(HOOKS, "review-hold.js");
  const holdConfig = (verify) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), `crew-hold-${verify}-`),
    );
    fs.writeFileSync(
      path.join(directory, "mode.lock"),
      JSON.stringify({
        mode: "test",
        codename: "TESTER",
        settings: { verify },
        deniedTools: [],
        subagents: null,
      }),
    );
    return directory;
  };
  const provenHold = holdConfig("proven");
  const testedHold = holdConfig("tested");
  const seed = (directory, sessionId, lines) => {
    const file = path.join(directory, "cache", "crew", `${sessionId}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    );
  };
  const changedRun = [
    {
      kind: "run",
      token: "4444dddd",
      role: "implementer",
      scope: ["a.js"],
      verify: "proven",
      reviews: null,
    },
    { kind: "path", agentId: "impl-h", path: "a.js" },
    { kind: "finish", agentId: "impl-h", token: "4444dddd" },
  ];
  const blockingReview = {
    kind: "review",
    token: "5555eeee",
    reviews: ["4444dddd"],
    findings: [{ severity: "Blocking", text: "leaks the handle" }],
  };
  const cleanReview = {
    kind: "review",
    token: "6666ffff",
    reviews: ["4444dddd"],
    findings: [],
  };
  const stop = (sessionId, message) => ({
    hook_event_name: "Stop",
    session_id: sessionId,
    last_assistant_message: message || "Done.",
    stop_hook_active: false,
  });
  const holdLines = (directory, sessionId) =>
    readTextOrEmpty(path.join(directory, "cache", "crew", `${sessionId}.jsonl`))
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));

  seed(testedHold, "h1", changedRun);
  check(
    "nothing is held at verify: tested",
    run(HOLD, stop("h1"), { CLAUDE_CONFIG_DIR: testedHold }).verdict,
    "allow",
  );

  seed(provenHold, "h2", changedRun);
  const unreviewed = run(HOLD, stop("h2"), { CLAUDE_CONFIG_DIR: provenHold });
  check(
    "an unreviewed run that changed files holds the turn",
    unreviewed.verdict,
    "BLOCK",
  );
  check(
    "the hold says how to request the review",
    String(unreviewed.reason).includes("Reviews: 4444dddd"),
    true,
  );

  seed(provenHold, "h3", [changedRun[0], changedRun[2]]);
  check(
    "a run that changed nothing is not held",
    run(HOLD, stop("h3"), { CLAUDE_CONFIG_DIR: provenHold }).verdict,
    "allow",
  );

  seed(provenHold, "h4", [
    { ...changedRun[0], verify: "tested" },
    changedRun[1],
    changedRun[2],
  ]);
  check(
    "a run dispatched under another posture is not held",
    run(HOLD, stop("h4"), { CLAUDE_CONFIG_DIR: provenHold }).verdict,
    "allow",
  );

  seed(provenHold, "h5", [...changedRun, cleanReview]);
  check(
    "a clean review releases the turn",
    run(HOLD, stop("h5"), { CLAUDE_CONFIG_DIR: provenHold }).verdict,
    "allow",
  );

  seed(provenHold, "h6", [...changedRun, blockingReview]);
  const blocked = run(HOLD, stop("h6"), { CLAUDE_CONFIG_DIR: provenHold });
  check("a blocking review holds the turn", blocked.verdict, "BLOCK");
  check(
    "the hold quotes the blocking finding",
    String(blocked.reason).includes("leaks the handle"),
    true,
  );

  seed(provenHold, "h7", [...changedRun, blockingReview, cleanReview]);
  check(
    "the newest review wins",
    run(HOLD, stop("h7"), { CLAUDE_CONFIG_DIR: provenHold }).verdict,
    "allow",
  );

  seed(provenHold, "h8", [...changedRun, blockingReview]);
  check(
    "a Stands line with a reason releases a blocking review",
    run(
      HOLD,
      stop(
        "h8",
        "Wrapped up.\nStands 4444dddd: the handle is closed by the caller",
      ),
      { CLAUDE_CONFIG_DIR: provenHold },
    ).verdict,
    "allow",
  );
  check(
    "the reason is kept in the record",
    holdLines(provenHold, "h8").some(
      (line) =>
        line.kind === "stands" && line.reason.includes("closed by the caller"),
    ),
    true,
  );
  check(
    "a recorded Stands still counts at the next turn end",
    run(HOLD, stop("h8"), { CLAUDE_CONFIG_DIR: provenHold }).verdict,
    "allow",
  );

  seed(provenHold, "h9", [...changedRun, blockingReview]);
  check(
    "a Stands line with no reason does not release",
    run(HOLD, stop("h9", "Stands 4444dddd:"), { CLAUDE_CONFIG_DIR: provenHold })
      .verdict,
    "BLOCK",
  );

  seed(provenHold, "h10", [
    ...changedRun,
    { kind: "stands", token: "4444dddd", reason: "old" },
    blockingReview,
  ]);
  check(
    "a Stands older than the verdict does not count",
    run(HOLD, stop("h10"), { CLAUDE_CONFIG_DIR: provenHold }).verdict,
    "BLOCK",
  );

  seed(provenHold, "h11", changedRun);
  run(HOLD, stop("h11"), { CLAUDE_CONFIG_DIR: provenHold });
  run(HOLD, stop("h11"), { CLAUDE_CONFIG_DIR: provenHold });
  const third = runJson(HOLD, stop("h11"), { CLAUDE_CONFIG_DIR: provenHold });
  check("the third turn end is not held", third.decision, undefined);
  check(
    "the third turn end warns the operator",
    String(third.systemMessage).includes("4444dddd"),
    true,
  );

  seed(provenHold, "h12", changedRun);
  const fullRecord = path.join(provenHold, "cache", "crew", "h12.jsonl");
  fs.appendFileSync(
    fullRecord,
    JSON.stringify({ kind: "pad", text: "x".repeat(520 * 1024) }) + "\n",
  );
  const full = runJson(HOLD, stop("h12"), { CLAUDE_CONFIG_DIR: provenHold });
  check("a full record never holds", full.decision, undefined);
  check(
    "a full record says why it let the turn go",
    String(full.systemMessage).includes("size ceiling"),
    true,
  );

  fs.rmSync(provenHold, { recursive: true, force: true });
  fs.rmSync(testedHold, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `node tools/test-hooks.js 2>&1 | grep -B1 -A1 FAIL | head -40`
Expected: every hold case fails, because `hooks/review-hold.js` does not exist (the child exits with an error and prints nothing, which `run` reads as `allow`). The `allow` cases pass for the wrong reason at this point; Step 6 is what proves them.

- [ ] **Step 3: Add `tell` to `hooks/lib/hook-io.js`**

```js
/**
 * Say something to the operator and nothing to the model, and let the turn end.
 *
 * The one output a `Stop` hook has for "this is not being held, but you should
 * know": `block` would hold, and `additionalContext` is not read at `Stop`.
 */
function tell(systemMessage) {
  emit({ systemMessage });
  process.exit(0);
}
```

Export it.

- [ ] **Step 4: Create `hooks/review-hold.js`**

```js
"use strict";

// Stop: hold the main session's turn until every run that changed files under a
// `verify: proven` posture has a blind review that is clean or answered.
//
// The review cannot be a gate on the worker's own report, because no reviewer
// can have run when that report arrives. It is checked here instead, at the
// main session's turn end, which is the first moment the main session has had
// the chance to dispatch one (hooks/agent-dispatch.js builds the reviewer's
// prompt; hooks/subagent-gate.js writes its verdict into the run record).
//
// A blocking verdict is settled by a fix reviewed clean, or by a line in the
// final message saying why it stands, which is the rule the gate always gave a
// worker. Each run is held at most twice, counted in the run record rather than
// through `stop_hook_active`: this hold has to fire again after the main session
// has gone off and dispatched the reviewer, and that flag would stop it.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");
const record = require("./lib/crew-record");
const blindReview = require("./lib/blind-review");
const transcriptTail = require("./lib/transcript-tail");

const MAX_HOLDS = 2;
const STANDS_LINE = /^[ \t]*Stands[ \t]+([0-9a-f]{8})[ \t]*:[ \t]*(.*)$/gim;

function readLock() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(io.configDir(), "mode.lock"), "utf8"),
    );
  } catch {
    return null;
  }
}

/**
 * The tokens of every run that owes a review.
 *
 * Dispatched under `verify: proven`, not itself a review, and joined through a
 * finish line to a worker that wrote at least one file. A worker still running
 * has no finish line yet and is not owed until it reports.
 */
function runsOwingReview(lines) {
  const agentsThatWrote = new Set(
    lines
      .filter((entry) => entry.kind === "path")
      .map((entry) => entry.agentId),
  );
  const agentForToken = new Map();
  for (const entry of lines) {
    if (entry.kind === "finish" && entry.token && entry.agentId)
      agentForToken.set(entry.token, entry.agentId);
  }
  return lines
    .filter(
      (entry) =>
        entry.kind === "run" &&
        entry.verify === "proven" &&
        !entry.reviews &&
        agentsThatWrote.has(agentForToken.get(entry.token)),
    )
    .map((entry) => entry.token);
}

/**
 * Where one run stands. Order in the file is the clock: the record is append
 * only, and two lines written in the same millisecond would tie on `at`.
 */
function standing(lines, token) {
  let verdict = null;
  let verdictIndex = -1;
  let standsIndex = -1;
  let holds = 0;
  lines.forEach((entry, index) => {
    if (
      entry.kind === "review" &&
      Array.isArray(entry.reviews) &&
      entry.reviews.includes(token)
    ) {
      verdict = entry;
      verdictIndex = index;
    }
    if (entry.kind === "stands" && entry.token === token) standsIndex = index;
    if (entry.kind === "hold" && entry.token === token) holds += 1;
  });
  if (verdict === null) return { settled: false, blocking: false, holds };
  const result = blindReview.interpret({ findings: verdict.findings });
  if (result.ok || standsIndex > verdictIndex) return { settled: true };
  return { settled: false, blocking: true, holds, reason: result.reason };
}

function holdText(token, state) {
  if (!state.blocking)
    return (
      `Run ${token} changed files and nobody has reviewed it. Dispatch a ` +
      `\`reviewer\` with the line \`Reviews: ${token}\`; the hook writes its prompt.`
    );
  return (
    `Run ${token}: ${state.reason} Fix it and review the fix together with this ` +
    `run (\`Reviews: ${token}, <fix token>\`), or write \`Stands ${token}: <reason>\` ` +
    "in your final message."
  );
}

io.run(() => {
  const payload = io.readPayload();
  const lock = readLock();
  if (!lock || !lock.settings || lock.settings.verify !== "proven") return;

  const sessionId = payload.session_id;
  const owing = runsOwingReview(record.readLines(sessionId));
  if (owing.length === 0) return;

  const message =
    typeof payload.last_assistant_message === "string"
      ? payload.last_assistant_message
      : transcriptTail.latestAssistantText(payload.transcript_path);
  const ignored = [];
  for (const found of String(message || "").matchAll(STANDS_LINE)) {
    const token = found[1].toLowerCase();
    const reason = found[2].trim();
    const state = standing(record.readLines(sessionId), token);
    if (!owing.includes(token) || !state.blocking) {
      ignored.push(
        `\`Stands ${token}\` was ignored: that run has no blocking finding to answer.`,
      );
    } else if (reason === "") {
      ignored.push(`\`Stands ${token}\` was ignored: it gives no reason.`);
    } else {
      record.appendStands(sessionId, { token, reason });
    }
  }

  const lines = record.readLines(sessionId);
  const held = [];
  const givenUp = [];
  for (const token of owing) {
    const state = standing(lines, token);
    if (state.settled) continue;
    if (state.holds >= MAX_HOLDS) givenUp.push(token);
    else held.push({ token, state });
  }

  if (held.length === 0) {
    if (givenUp.length > 0)
      io.tell(
        `Blind review: run${givenUp.length > 1 ? "s" : ""} ${givenUp.join(", ")} ` +
          "ended unreviewed or unresolved after two holds.",
      );
    return;
  }

  // The bound is counted from the record, so a record at its ceiling cannot
  // count it. Holding anyway risks a loop nothing stops, so the turn ends and
  // the operator is told why.
  for (const { token } of held) {
    if (!record.appendHold(sessionId, { token })) {
      io.tell(
        "Blind review: the run record has reached its size ceiling, so holds can " +
          `no longer be counted and the turn was let go. Owed: ${held.map((entry) => entry.token).join(", ")}.`,
      );
    }
  }

  io.block(
    [
      ...held.map(({ token, state }) => holdText(token, state)),
      ...ignored,
    ].join("\n\n"),
  );
});
```

- [ ] **Step 5: Run the suite and see it pass**

Run: `node tools/ccfg.js test` (exit 0).

- [ ] **Step 6: Break and restore, one at a time**

Each of these must turn the named case red; restore after each and confirm `git diff --stat` shows only the intended files.

1. Return early unconditionally at the top of `io.run`: every `BLOCK` case fails.
2. Remove `entry.verify === "proven" &&`: `"a run dispatched under another posture is not held"` fails.
3. Change `standsIndex > verdictIndex` to `standsIndex >= 0`: `"a Stands older than the verdict does not count"` fails.
4. Take the first review instead of the newest (add `&& verdict === null` to the review condition): `"the newest review wins"` fails.
5. Set `MAX_HOLDS = 3`: `"the third turn end is not held"` fails.
6. Remove the `reason === ""` branch: `"a Stands line with no reason does not release"` fails.

- [ ] **Step 7: Validate and stop for the commit**

`node hooks/validate-config.js`, prettier on the three files. Stop. Suggested subject: `Hold the turn in review-hold until a run is reviewed`.

---

### Task 6: Wire it in, document it, and run it once for real

**Files:**

- Modify: `settings.json` (never staged)
- Modify: `docs/hooks.md`
- Modify: `docs/superpowers/specs/2026-09-15-subagent-architecture-design.md`
- Local only: `agents/reviewer.md` (git-ignored, re-rendered)

- [ ] **Step 1: Add the `Stop` entry**

In `settings.json`, in the existing `Stop` group, add a third command after `clear-gate.js`, in the same form as its neighbours:

```
node -e "const p=require('path'),d=process.env.CLAUDE_CONFIG_DIR||p.join(require('os').homedir(),'.claude');require(p.join(d,'hooks','review-hold.js'))"
```

Run: `node hooks/validate-config.js` (expect `ALL CHECKS PASSED`) and `git diff settings.json | grep review-hold` (one added line). Do not stage it.

- [ ] **Step 2: Re-render the crew**

Run: `node tools/ccfg.js mode RUNNER` (re-applies the mode already in force, which re-renders the git-ignored worker files in `agents/`), then `node tools/ccfg.js crew` (the reviewer should list both gates) and `grep -c "Findings: none" agents/reviewer.md` (expect 1). If `ccfg mode` reports anything other than the mode being applied, stop and report it rather than retrying.

- [ ] **Step 3: Update `docs/hooks.md`**

Replace the case count with the number `node tools/ccfg.js test` prints for the hook suite. Add a `Stop` row for `hooks/review-hold.js`, after the `clear-gate.js` row, saying in plain words: under `verify: proven`, holds the main session's turn while a run that changed files has no blind review, or has blocking findings nobody fixed or answered with `Stands <token>: <reason>`; the reviewer is dispatched with `Reviews: <token>`, and the dispatch hook replaces its prompt with the diff alone; at most two holds per run, then an operator warning. Update the dispatch hook's and the gate runner's rows to mention the reviewer prompt and the verdict line.

- [ ] **Step 4: Point the architecture spec here**

In `docs/superpowers/specs/2026-09-15-subagent-architecture-design.md`, replace the paragraph beginning `**`review`(only at`verify: proven`).**` with:

```markdown
**`review` (only at `verify: proven`).** Not a gate on the worker's report: no
reviewer can have run by the time that report arrives. The main session
dispatches a `reviewer` by run token, the dispatch hook replaces its prompt with
the diff alone, the verdict is written into the run record, and a `Stop` hook
holds the main session's turn until it is clean or answered. The design is
`docs/superpowers/specs/2026-09-19-blind-review-wiring-design.md`.
```

Add rows for `hooks/review-hold.js`, `hooks/lib/blind-review.js` and `hooks/subagent/gates/review-shape.js` to section 8's table. Run prettier on both docs.

- [ ] **Step 5: Final verification**

Run: `node tools/ccfg.js test` (exit 0, record the per-suite counts), `node hooks/validate-config.js`, `npx prettier --check` on every file this plan touched, and `grep -c "—"` on each (expect 0 added). Stop. Suggested subject for the docs and role commit: `Document the blind review hold in hooks.md`.

- [ ] **Step 6: One live run, only on the operator's go**

Ask the operator first; it spends real usage. Then, in a scratch directory that is git-ignored (`scratch/live-review/`), under a `verify: proven` mode applied for the test: dispatch an implementer to write one small file, end the turn and confirm the hold names its token, dispatch `reviewer` with `Reviews: <token>`, confirm a `review` line lands in `cache/crew/<session>.jsonl`, and confirm the next turn end passes (or holds on a blocking finding, then passes after a `Stands` line). Record what was measured in `.claude/state.md`, then re-apply the operator's own mode.
