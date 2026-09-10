# Context Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop long Claude Code sessions from silently dropping rules and decisions, by gating mechanically checkable violations at the point of action and carrying session state across compaction.

**Architecture:** Three new or changed hooks in `~/.claude/hooks/`. One turns an existing advisory commit-message check into a refusal. Two form a pair: a `PreCompact` hook writes a handoff file just before the conversation is summarized, and a `SessionStart` hook reads it back when the session resumes from that compaction. Phase B adds a fourth hook that records standing constraints as they are issued, which the handoff carries verbatim.

**Tech Stack:** Node.js (CommonJS, no dependencies), the existing `hooks/lib/hook-io.js` plumbing, `hooks/test-hooks.js` as the regression suite. Everything synchronous and failure-tolerant, matching the existing hooks.

**Spec:** `docs/superpowers/specs/2026-09-09-context-continuity-design.md`

## Global Constraints

- **Never commit and never push.** `hooks/git-guard.js` enforces this. Every task below ends by staging files and handing them to the operator, who commits with `/commit`. Do not use `CLAUDE_ALLOW_COMMIT=1` to commit on their behalf.
- **No new dependencies.** These hooks run on every tool call or session start; `require` only Node built-ins and files already in `hooks/lib/`.
- **A hook that throws must never block real work.** Wrap every hook body in `io.run()`, exactly as the existing hooks do.
- **Write to stdout only through `hooks/lib/hook-io.js`.** `process.stdout.write` is asynchronous on Windows and the payload will be lost.
- **Naming:** spell names out. `sessionIdentifier` not `sid`, `constraints` not `cons`. Loop counters `i`/`j` are the only abbreviations allowed.
- **Comments:** only non-obvious _why_. No banner comments, no comments restating what the line does.
- **Test runner:** `node ~/.claude/hooks/test-hooks.js`. It prints `[PASS]`/`[**FAIL**]` per case and a total. There is no watch mode.
- **Verdict vocabulary** returned by the suite's `run()` helper: `"DENY"`, `"warn"`, `"BLOCK"`, `"allow"`, `"?raw"`.

---

### Task 1: Make commit-subject violations block instead of warn

The checker already exists and is correct. Only its severity changes. Advisory
findings in the same function (tests missing, oversized diff, possible
credential) stay warnings — those need a human's read. A lint finding is a
violation of a convention that is written down, and warning about it was
measured at 0/36 compliance.

**Files:**

- Modify: `hooks/git-guard.js` — the `checkCommit` function (around lines 457-555) and the `io.run` body at the end of the file
- Test: `hooks/test-hooks.js`

**Interfaces:**

- Consumes: `commitMessage.extract(rawSegment, cwd)` and `commitMessage.lint(text)` from `hooks/lib/commit-message.js`, both unchanged. `lint` returns an array of human-readable strings; empty means clean.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing tests**

Add to `hooks/test-hooks.js`, after the existing `PreToolUse(Bash)` blocks:

```js
header("PreToolUse(Bash): commit subject is a gate, not a warning");

const ALLOW = "CLAUDE_ALLOW_COMMIT=1 ";
const VAGUE_OK = "CLAUDE_ALLOW_VAGUE_SUBJECT=1 ";

for (const [label, subject] of [
  ["placeholder noun", "Fix the login bug"],
  ["counted placeholder", "Repair three faults found while chasing one bug"],
  ["effect-led subject", "Stop warning about missing tests"],
  ["trailing period", "Widen the supabase token wait."],
]) {
  const command = ALLOW + 'git commit -m "' + subject + '"';
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check("blocks: " + label, verdict, "DENY", reason);
}

for (const [label, subject] of [
  ["names the symbol", "Widen the wait when supabase calls a token early"],
  ["names the component", "Line the queue cards up with the column"],
]) {
  const command = ALLOW + 'git commit -m "' + subject + '"';
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check("allows: " + label, verdict, "allow", reason);
}

{
  const command = VAGUE_OK + ALLOW + 'git commit -m "Fix the login bug"';
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check("escape downgrades to warn", verdict, "warn", reason);
}

{
  const command = 'git commit -m "Fix the login bug"';
  const { verdict, reason } = run(GUARD, bash(command, repo));
  check("unauthorized commit still denied first", verdict, "DENY", reason);
}
```

- [ ] **Step 2: Run the tests and watch them fail for the right reason**

Run: `node ~/.claude/hooks/test-hooks.js 2>&1 | grep -A2 "commit subject is a gate"`

Expected: the four `blocks:` cases report `-> warn` where `DENY` was expected,
and `escape downgrades to warn` may pass by accident. Confirm the four failures
say `warn`, not `allow` — `allow` would mean `extract` is not finding the
message and the test is proving nothing.

- [ ] **Step 3: Add the escape flag to the dispatcher**

In `hooks/git-guard.js`, in the `io.run(() => { ... })` body, beside the existing
`commitAuthorized` line:

```js
const subjectOverride = command.includes("CLAUDE_ALLOW_VAGUE_SUBJECT=1");
```

and change the `checkCommit` call in the same body:

```js
for (const segment of segments)
  checkCommit(segment, cwd, commitAuthorized, subjectOverride);
```

- [ ] **Step 4: Make lint findings deny**

Change the `checkCommit` signature to accept the new parameter:

```js
function checkCommit(rawSegment, cwd, commitAuthorized, subjectOverride) {
```

Then replace the lint block near the end of that function:

```js
const message = commitMessage.extract(rawSegment, cwd);
if (message) {
  const problems = commitMessage.lint(message.text);
  // These findings are rule violations, not judgment calls: every convention
  // they check is written down. The advisory notes above stay warnings
  // because a human has to weigh them.
  if (problems.length > 0 && !subjectOverride) {
    io.deny(
      EVENT,
      "Blocked: this commit message breaks a convention you wrote down.\n" +
        problems.map((problem) => `- ${problem}`).join("\n") +
        "\n\nRewrite the message. See git-workflow. If the message is right " +
        "and the check is wrong, prefix this one invocation with:\n" +
        "  CLAUDE_ALLOW_VAGUE_SUBJECT=1 git commit ...",
    );
  }
  for (const problem of problems) {
    notes.push(`- ${problem} See git-workflow.`);
  }
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `node ~/.claude/hooks/test-hooks.js`

Expected: every new case passes, and the pre-existing total does not drop.
Compare the trailing `passed`/`failed` counts against a run from before Step 3.

- [ ] **Step 6: Stage and hand off**

```bash
git -C ~/.claude add hooks/git-guard.js hooks/test-hooks.js
```

Then stop and tell the operator the change is staged for them to commit.

---

### Task 2: Write a handoff file before compaction

**Files:**

- Create: `hooks/pre-compact.js`
- Modify: `settings.json` — add a `PreCompact` entry to `hooks`
- Test: `hooks/test-hooks.js`

**Interfaces:**

- Consumes: `io.readPayload()`, `io.configDir()`, `io.run()` from `hooks/lib/hook-io.js`.
- Produces: `cache/handoff/<session-id>.md`. Task 3 reads this path. Task 6 appends a section to the same file. The section headings written here (`## Mode`, `## Decisions`, `## Open threads`, `## Standing constraints`) are the contract.

- [ ] **Step 1: Write the failing test**

Add to `hooks/test-hooks.js`:

```js
header("PreCompact: writes a handoff file");

const PRECOMPACT = path.join(HOOKS, "pre-compact.js");
const handoffHome = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-"));

{
  const payload = {
    hook_event_name: "PreCompact",
    session_id: "test-session-1",
    trigger: "auto",
    cwd: repo,
  };
  run(PRECOMPACT, payload, { CLAUDE_CONFIG_DIR: handoffHome });
  const written = path.join(
    handoffHome,
    "cache",
    "handoff",
    "test-session-1.md",
  );
  const exists = fs.existsSync(written);
  check("handoff file created", exists ? "allow" : "missing", "allow", written);
  if (exists) {
    const text = fs.readFileSync(written, "utf8");
    for (const heading of [
      "## Mode",
      "## Decisions",
      "## Open threads",
      "## Standing constraints",
    ]) {
      check(
        "handoff has " + heading,
        text.includes(heading) ? "allow" : "missing",
        "allow",
        text.slice(0, 200),
      );
    }
  }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node ~/.claude/hooks/test-hooks.js 2>&1 | grep -A6 "PreCompact"`

Expected: `handoff file created -> missing`, because `hooks/pre-compact.js`
does not exist and `spawnSync` returns no stdout.

- [ ] **Step 3: Write the hook**

Create `hooks/pre-compact.js`:

```js
"use strict";

// PreCompact: write down what the summarizer is known to lose, so the pair
// hook can put it back.
//
// Compaction rewrites the transcript into a summary. Measured across seven
// model families, standing constraints survive that step about 17% of the
// time, and prohibited actions rise from 0% to 30% once they are gone
// (arXiv 2606.22528, 2608.11242). Nothing here tries to improve the summary.
// It copies the load-bearing lines out of the lossy path entirely.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");

const EVENT = "PreCompact";

// A cap, not a budget. An oversized handoff means something upstream is
// growing wrong, and truncating keeps that from flooding the restored context
// while leaving the overflow visible in the file itself.
const MAX_SECTION = 4000;

function handoffPath(sessionIdentifier) {
  const directory = path.join(io.configDir(), "cache", "handoff");
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, String(sessionIdentifier || "unknown") + ".md");
}

/** The active posture, read from the same lock the mode guard reads. */
function readMode() {
  try {
    const lock = JSON.parse(
      fs.readFileSync(path.join(io.configDir(), "mode.lock"), "utf8"),
    );
    const dials = lock.dials
      ? Object.entries(lock.dials)
          .map(([name, value]) => `${name}: ${value}`)
          .join(", ")
      : "";
    return [lock.mode, lock.codename, dials].filter(Boolean).join(" / ");
  } catch {
    return "";
  }
}

/** Constraints recorded during the session, copied verbatim (Task 6 fills this). */
function readConstraints(sessionIdentifier) {
  try {
    const file = path.join(
      io.configDir(),
      "cache",
      "constraints",
      String(sessionIdentifier) + ".md",
    );
    return fs.readFileSync(file, "utf8").slice(0, MAX_SECTION);
  } catch {
    return "";
  }
}

function render(payload) {
  const mode = readMode();
  const constraints = readConstraints(payload.session_id);
  return [
    "# Handoff across compaction",
    "",
    `Written at ${new Date().toISOString()} (trigger: ${payload.trigger || "unknown"}).`,
    "",
    "## Mode",
    "",
    mode || "No mode.lock could be read.",
    "",
    "## Standing constraints",
    "",
    constraints.trim() ||
      "None recorded. Constraints issued this session were not captured.",
    "",
    "## Decisions",
    "",
    "Fill from the transcript above: what was settled, and what was ruled out.",
    "",
    "## Open threads",
    "",
    "Fill from the transcript above: what was in progress when this fired.",
    "",
  ].join("\n");
}

io.run(() => {
  const payload = io.readPayload();
  fs.writeFileSync(handoffPath(payload.session_id), render(payload), "utf8");
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ~/.claude/hooks/test-hooks.js 2>&1 | grep -A6 "PreCompact"`

Expected: all five `PreCompact` cases pass.

- [ ] **Step 5: Wire the hook into settings.json**

Add to the `hooks` object in `settings.json`, matching the `node -e` bootstrap
form every other entry uses:

```json
"PreCompact": [
  {
    "matcher": "*",
    "hooks": [
      {
        "type": "command",
        "command": "node -e \"const p=require('path'),d=process.env.CLAUDE_CONFIG_DIR||p.join(require('os').homedir(),'.claude');require(p.join(d,'hooks','pre-compact.js'))\""
      }
    ]
  }
]
```

- [ ] **Step 6: Verify the wiring**

Run: `node ~/.claude/tools/ccfg.js probe run core-hooks-wired`

Expected: passes. If that probe does not know about `PreCompact`, run
`node -e "JSON.parse(require('fs').readFileSync('/Users/vtsyp/.claude/settings.json','utf8'))"`
to confirm the file is still valid JSON, and say in the handoff report that
the probe does not cover the new event.

- [ ] **Step 7: Stage and hand off**

```bash
git -C ~/.claude add hooks/pre-compact.js hooks/test-hooks.js settings.json
```

Then stop and tell the operator.

---

### Task 3: Read the handoff back after compaction

Task 2 without this is a file nobody reads. They ship together.

**Files:**

- Create: `hooks/handoff-restore.js`
- Modify: `settings.json` — append to the existing `SessionStart` hooks array
- Test: `hooks/test-hooks.js`

**Interfaces:**

- Consumes: `cache/handoff/<session-id>.md` written by Task 2.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing test**

Add to `hooks/test-hooks.js`:

```js
header("SessionStart: restores the handoff after compaction");

const RESTORE = path.join(HOOKS, "handoff-restore.js");

{
  const directory = path.join(handoffHome, "cache", "handoff");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "test-session-2.md"),
    "# Handoff across compaction\n\n## Mode\n\nbuild / RUNNER\n",
    "utf8",
  );

  const compacted = {
    hook_event_name: "SessionStart",
    source: "compact",
    session_id: "test-session-2",
  };
  const restored = run(RESTORE, compacted, { CLAUDE_CONFIG_DIR: handoffHome });
  check("restores on compact", restored.verdict, "warn", restored.reason);
  check(
    "carries the mode",
    String(restored.reason).includes("RUNNER") ? "allow" : "missing",
    "allow",
    restored.reason,
  );

  const fresh = {
    hook_event_name: "SessionStart",
    source: "startup",
    session_id: "test-session-2",
  };
  const quiet = run(RESTORE, fresh, { CLAUDE_CONFIG_DIR: handoffHome });
  check("silent on a fresh start", quiet.verdict, "allow", quiet.reason);

  const missing = {
    hook_event_name: "SessionStart",
    source: "compact",
    session_id: "no-such-session",
  };
  const absent = run(RESTORE, missing, { CLAUDE_CONFIG_DIR: handoffHome });
  check(
    "silent when no handoff exists",
    absent.verdict,
    "allow",
    absent.reason,
  );
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node ~/.claude/hooks/test-hooks.js 2>&1 | grep -A5 "restores the handoff"`

Expected: `restores on compact -> allow` where `warn` was expected, because the
script does not exist.

- [ ] **Step 3: Write the hook**

Create `hooks/handoff-restore.js`:

```js
"use strict";

// SessionStart(source: compact): put the handoff back.
//
// Silent on every other source. A fresh session already loads CLAUDE.md and
// the generated rules file from disk, and re-stating them would only say the
// same thing twice; the measurement behind mode-inject.js found that repeating
// an already-present rule buys nothing. This hook exists for the one case
// where the text is genuinely gone.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");

const EVENT = "SessionStart";

io.run(() => {
  const payload = io.readPayload();
  if (payload.source !== "compact") return;

  const file = path.join(
    io.configDir(),
    "cache",
    "handoff",
    String(payload.session_id || "unknown") + ".md",
  );

  let handoff = "";
  try {
    handoff = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  if (!handoff.trim()) return;

  io.warn(
    EVENT,
    "This session was just compacted. The summary above is lossy. " +
      "The following was written down before it ran and is authoritative " +
      "where the two disagree:\n\n" +
      handoff,
  );
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ~/.claude/hooks/test-hooks.js 2>&1 | grep -A5 "restores the handoff"`

Expected: all four cases pass.

- [ ] **Step 5: Wire it into settings.json**

Append to the existing `SessionStart` matcher's `hooks` array in
`settings.json`, after `mode-session.js`:

```json
{
  "type": "command",
  "command": "node -e \"const p=require('path'),d=process.env.CLAUDE_CONFIG_DIR||p.join(require('os').homedir(),'.claude');require(p.join(d,'hooks','handoff-restore.js'))\""
}
```

- [ ] **Step 6: Verify end to end by hand**

The pair cannot be proven by unit tests alone — only a real compaction shows
whether the harness delivers `source: "compact"` with the same `session_id`
the `PreCompact` hook saw.

Run a throwaway session, force a compaction with `/compact`, and check that a
file appeared under `~/.claude/cache/handoff/` and that its contents came back.
Report the result plainly. **If the session identifiers do not match, say so
and stop** — the whole pair depends on that assumption and it has not yet been
verified against a live compaction.

- [ ] **Step 7: Stage and hand off**

```bash
git -C ~/.claude add hooks/handoff-restore.js hooks/test-hooks.js settings.json
```

---

### Task 4: Raise the effort level and clear the dead weight

**Files:**

- Modify: `settings.json`
- Modify: `.gitignore`
- Delete: `bash-commands.log`, `cost-tracker.log`

**Interfaces:** none.

- [ ] **Step 1: Confirm the two logs are genuinely dead**

Run:

```bash
grep -rln "bash-commands.log\|cost-tracker.log" ~/.claude/hooks ~/.claude/tools ~/.claude/scripts
```

Expected: only `tools/ccfg.js` (its `clean` subcommand) and
`hooks/test-hooks.js`. **If any hook writes either file, stop and report it** —
the spec's claim that they have no writer would be wrong.

- [ ] **Step 2: Raise the effort level**

In `settings.json`, change `"effortLevel": "high"` to `"effortLevel": "xhigh"`.

- [ ] **Step 3: Ignore then remove the dead logs**

Add to `.gitignore`, beside the existing entries:

```
bash-commands.log
cost-tracker.log
```

Then:

```bash
rm ~/.claude/bash-commands.log ~/.claude/cost-tracker.log
```

- [ ] **Step 4: Drop the orphaned marketplace entries**

In `settings.json`, remove these five keys from `extraKnownMarketplaces`. Each
has no entry in `enabledPlugins` pointing at it:

`ui-ux-pro-max-skill`, `claude-code-nano-banana`, `playwright-skill`,
`claude-code-plugins`, `thedotmack`.

Leave `ecc` alone: it is disabled but the operator disabled it deliberately.

- [ ] **Step 5: Verify the config still loads**

Run: `node ~/.claude/tools/ccfg.js validate && node ~/.claude/tools/ccfg.js doctor`

Expected: both pass. `doctor` reports a startup cost; write the number down,
it is the baseline for backlog item 5.

- [ ] **Step 6: Stage and hand off**

```bash
git -C ~/.claude add settings.json .gitignore
```

---

### Task 5: Record standing constraints as they are issued (Phase B)

A standing constraint is an instruction meant to bind for the rest of the
session — "don't touch the auth module until I say so" — as opposed to a
request for the current turn.

Detection is a deterministic heuristic, not a model call. A classifier on every
prompt would add seconds of latency to every turn, and the value of the whole
registry is unproven until Task 7 measures it. If Task 7 shows the heuristic
missing real constraints, replacing it with a model call is a separate change
with its own evidence.

**Files:**

- Create: `hooks/constraint-capture.js`
- Modify: `settings.json` — append to the existing `UserPromptSubmit` hooks array
- Test: `hooks/test-hooks.js`

**Interfaces:**

- Produces: `cache/constraints/<session-id>.md`, one `- ` bullet per captured
  line. Task 2's `readConstraints` already reads this exact path.

- [ ] **Step 1: Write the failing test**

Add to `hooks/test-hooks.js`:

```js
header("UserPromptSubmit: captures standing constraints");

const CAPTURE = path.join(HOOKS, "constraint-capture.js");

function capture(prompt, sessionIdentifier) {
  run(
    CAPTURE,
    {
      hook_event_name: "UserPromptSubmit",
      session_id: sessionIdentifier,
      prompt,
    },
    { CLAUDE_CONFIG_DIR: handoffHome },
  );
  try {
    return fs.readFileSync(
      path.join(handoffHome, "cache", "constraints", sessionIdentifier + ".md"),
      "utf8",
    );
  } catch {
    return "";
  }
}

for (const [label, prompt] of [
  ["from now on", "From now on use pnpm, never npm"],
  ["until I confirm", "Don't delete any files until I confirm"],
  ["for the rest of", "For the rest of this session stay off the main branch"],
  ["never", "Never edit files under vendor/"],
]) {
  const text = capture(prompt, "constraint-" + label.replace(/\s+/g, "-"));
  check(
    "captures: " + label,
    text.includes(prompt) ? "allow" : "missing",
    "allow",
    text,
  );
}

for (const [label, prompt] of [
  ["plain request", "Add a test for the parser"],
  ["question", "What does this function do?"],
]) {
  const text = capture(prompt, "ignore-" + label.replace(/\s+/g, "-"));
  check("ignores: " + label, text === "" ? "allow" : "captured", "allow", text);
}

{
  const first = capture("Never edit files under vendor/", "accumulate-1");
  const second = capture("From now on use pnpm", "accumulate-1");
  const bullets = second.split("\n").filter((line) => line.startsWith("- "));
  check(
    "accumulates across turns",
    bullets.length === 2 ? "allow" : String(bullets.length),
    "allow",
    second,
  );
  check(
    "keeps the first",
    first.trim() !== "" ? "allow" : "empty",
    "allow",
    first,
  );
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node ~/.claude/hooks/test-hooks.js 2>&1 | grep -A10 "captures standing constraints"`

Expected: every `captures:` case reports `missing`.

- [ ] **Step 3: Write the hook**

Create `hooks/constraint-capture.js`:

```js
"use strict";

// UserPromptSubmit: keep a copy of the session's standing constraints outside
// the transcript, so compaction cannot summarize them away.
//
// Says nothing to the model. The constraint is already in front of it on the
// turn it was issued, and re-stating a rule that is already present measured
// 0/36 (see mode-inject.js). The file exists for pre-compact.js to copy
// verbatim into the handoff.
//
// Detection is a heuristic on purpose. A model call per turn would tax every
// prompt, and whether the registry helps at all is unmeasured until the
// standing-band probe runs against it.

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook-io");

// Phrases that scope an instruction beyond the current turn. Matched against
// the whole prompt, so "never" inside a sentence still counts.
const PERSISTENCE = [
  /\bfrom now on\b/i,
  /\bfor the rest of\b/i,
  /\buntil I\b/i,
  /\bgoing forward\b/i,
  /\bevery time\b/i,
  /\bnever\b/i,
  /\balways\b/i,
  /\bstop\s+(?:using|doing|touching)\b/i,
  /\bdon'?t\b.*\buntil\b/i,
];

const MAX_LINE = 400;
const MAX_FILE = 4000;

function constraintsPath(sessionIdentifier) {
  const directory = path.join(io.configDir(), "cache", "constraints");
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, String(sessionIdentifier || "unknown") + ".md");
}

io.run(() => {
  const payload = io.readPayload();
  const prompt = String(payload.prompt || "").trim();
  if (!prompt) return;
  if (!PERSISTENCE.some((pattern) => pattern.test(prompt))) return;

  const file = constraintsPath(payload.session_id);
  let existing = "";
  try {
    existing = fs.readFileSync(file, "utf8");
  } catch {
    existing = "";
  }
  if (existing.length > MAX_FILE) return;

  const line = "- " + prompt.replace(/\s+/g, " ").slice(0, MAX_LINE);
  if (existing.includes(line)) return;

  fs.writeFileSync(file, existing + line + "\n", "utf8");
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ~/.claude/hooks/test-hooks.js 2>&1 | grep -A10 "captures standing constraints"`

Expected: all nine cases pass.

- [ ] **Step 5: Wire it into settings.json**

Append to the existing `UserPromptSubmit` matcher's `hooks` array, after
`mode-inject.js`:

```json
{
  "type": "command",
  "command": "node -e \"const p=require('path'),d=process.env.CLAUDE_CONFIG_DIR||p.join(require('os').homedir(),'.claude');require(p.join(d,'hooks','constraint-capture.js'))\""
}
```

- [ ] **Step 6: Confirm it stays silent**

Run: `echo '{"hook_event_name":"UserPromptSubmit","session_id":"x","prompt":"Never edit vendor/"}' | node ~/.claude/hooks/constraint-capture.js`

Expected: **no output at all**. Any stdout would inject text into every prompt
that matches, which is the thing the 0/36 measurement rules out.

- [ ] **Step 7: Stage and hand off**

```bash
git -C ~/.claude add hooks/constraint-capture.js hooks/test-hooks.js settings.json
```

---

### Task 6: Carry the constraints through the handoff

Task 2 already calls `readConstraints`. This task proves the two halves meet,
which nothing has tested yet.

**Files:**

- Test: `hooks/test-hooks.js`
- Modify: `hooks/pre-compact.js` only if the test finds a mismatch

**Interfaces:**

- Consumes: `cache/constraints/<session-id>.md` from Task 5, `cache/handoff/<session-id>.md` from Task 2.

- [ ] **Step 1: Write the failing test**

Add to `hooks/test-hooks.js`:

```js
header("PreCompact carries constraints verbatim");

{
  const sessionIdentifier = "carry-1";
  const directory = path.join(handoffHome, "cache", "constraints");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, sessionIdentifier + ".md"),
    "- Never edit files under vendor/\n- From now on use pnpm\n",
    "utf8",
  );

  run(
    PRECOMPACT,
    {
      hook_event_name: "PreCompact",
      session_id: sessionIdentifier,
      trigger: "auto",
    },
    { CLAUDE_CONFIG_DIR: handoffHome },
  );

  const text = fs.readFileSync(
    path.join(handoffHome, "cache", "handoff", sessionIdentifier + ".md"),
    "utf8",
  );
  check(
    "handoff carries the first constraint",
    text.includes("Never edit files under vendor/") ? "allow" : "missing",
    "allow",
    text,
  );
  check(
    "handoff carries the second constraint",
    text.includes("From now on use pnpm") ? "allow" : "missing",
    "allow",
    text,
  );
  check(
    "constraints sit under their heading",
    text.indexOf("## Standing constraints") < text.indexOf("Never edit files")
      ? "allow"
      : "misplaced",
    "allow",
    text,
  );
}
```

- [ ] **Step 2: Run the test**

Run: `node ~/.claude/hooks/test-hooks.js 2>&1 | grep -A4 "carries constraints verbatim"`

Expected: passes on the first run if Task 2 was implemented as written. **If it
passes immediately, say so rather than pretending it was red first** — this
task exists to catch a mismatch between two independently written halves, and
finding none is a real result.

If it fails, the bug is in `readConstraints` in `hooks/pre-compact.js`: check
that the directory name is `constraints` and the filename is
`<session-id>.md` with no prefix.

- [ ] **Step 3: Stage and hand off**

```bash
git -C ~/.claude add hooks/test-hooks.js
```

---

### Task 7: Measure whether Phase B earns its place

Phase B is kept or deleted on this result. It is not optional and it is not a
formality.

**Files:**

- Modify: none expected
- Read: `probes/standing-band.js`, `probes/dormant-rules.js`

**Interfaces:** none.

- [ ] **Step 1: Read the two probes before running them**

Run: `sed -n '1,40p' ~/.claude/probes/standing-band.js` and the same for
`dormant-rules.js`.

Establish what each measures and what its pass condition is. **If neither probe
actually measures constraint survival across a compaction, stop and say so** —
then the honest report is that Phase B is unmeasured, not that it works.

- [ ] **Step 2: Capture a baseline with the capture hook disabled**

Temporarily remove the `constraint-capture.js` entry from `UserPromptSubmit` in
`settings.json`, then:

```bash
node ~/.claude/tools/ccfg.js probe run standing-band
node ~/.claude/tools/ccfg.js probe run dormant-rules
```

Record both results verbatim.

- [ ] **Step 3: Re-enable the hook and re-run**

Restore the `settings.json` entry, then run the same two probe commands.
Record both results verbatim.

- [ ] **Step 4: Report the comparison, then stop**

Write both sets of numbers side by side and state plainly whether retention
moved. Do not average, do not round in a favourable direction, and do not
describe an unchanged result as promising.

If retention did not move, the recommendation is to delete
`hooks/constraint-capture.js` and its `settings.json` entry, keep Tasks 2 and 3,
and record in the spec that the registry was tried and measured flat.

Hand the numbers to the operator and let them decide.

---

## Self-Review

**Spec coverage.** A1 → Task 1. A2 → Task 2. A3 → Task 3. A4 and A5 → Task 4,
except two A5 items deliberately deferred and called out below. B1 → Task 5.
B2 → Tasks 2 and 6. B3 → Task 7.

**Deferred from A5, with reasons.** Pruning `plugins/` (1.4 GB) touches an
installed plugin tree and is a delete of something the operator may want to
re-enable, so it wants its own confirmation rather than riding along in a task
about a settings key. Moving `modes/SOURCE-SNAPSHOT.md` changes a path that
`ccfg probe run corpus-fidelity` depends on, so it needs that probe re-run and
possibly a path update inside `tools/`; it is a separate change. Both stay in
the spec's backlog. Say this in the handoff rather than letting them look
forgotten.

**Type consistency.** `handoffPath` and `constraintsPath` build
`cache/handoff/<id>.md` and `cache/constraints/<id>.md`; Tasks 3, 5 and 6 all
read those exact shapes. `io.warn`, `io.deny`, `io.run`, `io.configDir` and
`io.readPayload` are used with the signatures in `hooks/lib/hook-io.js`.
`commitMessage.lint` returns an array of strings, which Task 1 maps over.
The suite's `run()` returns `{verdict, reason, code}`, and every `check()`
above compares against `"allow"`, `"warn"` or `"DENY"`.

**Known-unverified assumption, carried deliberately.** The Task 2 / Task 3 pair
assumes the harness delivers `PreCompact` and then a `SessionStart` with
`source: "compact"` carrying the same `session_id`. Task 3 Step 6 is the only
place that can check it, and it is a manual step with an explicit instruction to
stop if the identifiers do not match.
