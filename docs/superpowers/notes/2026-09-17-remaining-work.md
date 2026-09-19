# Remaining work, and what finished means

Written 2026-09-17 at the operator's ask: "get this oriented and just properly
implement all remaining features so our system is nearly flawless or actually
flawless." This is the orientation document, not a build document. The build
steps for the subagent work already exist in
`docs/superpowers/plans/2026-09-16-subagent-architecture.md`, and this file does
not restate them.

Read this first, then that plan.

## What this configuration is trying to be

A Claude Code configuration whose rules hold because something checks them, not
because a session remembers to follow them. Three systems carry that:

1. **The mode system.** `ccfg mode` picks a posture and assembles the rules that
   posture wants into `rules/_active.md`. Built and committed.
2. **The context system.** A per-repository working record (`.claude/state.md`),
   a gauge that warns as a conversation fills, a gate that holds a clear
   suggestion until the record is updated, a restart hook that loads the record
   back. Built and committed.
3. **The subagent system.** A dispatched worker carries the active mode's rules,
   tool limits and proof requirements, enforced by hooks. Two of its thirteen
   tasks are built and committed; the rest is the bulk of the work below.

## Definition of finished

Six conditions. Each is checkable by a command, which is the point: "flawless"
has to be something a session can test rather than assert.

1. **Every task in the subagent plan is built and its boxes ticked.** Check:
   `grep -c '^- \[ \]'` on the plan returns 0.
2. **The whole suite is green and the validator passes.** Check:
   `node tools/ccfg.js test` exits 0 and `node hooks/validate-config.js` prints
   ALL CHECKS PASSED. The documented case count in `docs/hooks.md` is part of
   what the validator checks, so it cannot drift.
3. **Every new test has been watched fail for the right reason before its code
   existed.** Check: each task's own record of the deliberate break. This is the
   one condition no command can re-derive afterwards, which is why it is recorded
   as the work happens.
4. **No design element rests on an unmeasured claim about Claude Code itself.**
   Check: `ccfg crew conformance` (the reader built in plan Task 12) prints every
   harness assumption as confirmed, contradicted, or not yet observed, and
   nothing load-bearing sits in the third group. The operator chose on 2026-09-17
   to reach this passively, from real dispatches rather than paid probe runs, so
   this condition closes over days of ordinary use, not in one session.
5. **The spec, the plan and the code agree.** Check: the two known disagreements
   are gone (done 2026-09-17, below), and each later task reconciles its own
   deviations in the same commit rather than leaving them for a reader to find.
6. **Nothing private is tracked and nothing tracked is stale.** Check:
   `git check-ignore -v` on the writing samples and on `skills/synced/`, and
   `git status` clean apart from what the operator deliberately keeps local.

## The two disagreements, both settled 2026-09-17

The operator decided both, and both documents were edited in the same session so
no reader meets the contradiction again.

- **Checks in a mode that demands no proof.** They run and warn, never block.
  A gate whose `minimumVerify` sits above the mode's `verify` setting still runs
  and reports through `io.warn`, so the verdict stays `allow`. The plan's Task 8
  used to drop those gates; it no longer does. The reason the spec's version won:
  a gate that does not run leaves the conformance log with nothing to record.
- **Whether the main session's own edits are logged.** They are not. A payload
  with no `agent_id` is left alone, nothing recorded and nothing gated. The
  spec's checks list used to say recorded; it no longer does. The reason the
  plan's version won: the alternative appends a line for every edit in ordinary
  work, and no gate reads those lines.

## Remaining work, in order

### A. The subagent system, plan Tasks 3 to 13

Eleven tasks, 49 unticked steps, four commit boundaries (plan lines 620, 789,
1256, 2216). Run inline, test first, stopping at each boundary, as decided
2026-09-16. What each task is for, in one line:

- **Task 3, classify every rule for workers.** Each of the 25 rule files gains a
  field saying whether a worker gets the rule as prose, never sees it, or has it
  enforced by a named gate. This is what keeps a worker's brief short honestly.
- **Task 4, the dispatch hook.** Requires the dispatcher to name the files a
  worker may change, mints a run token, opens the run record.
- **Task 5, the guard.** A worker cannot write into the evidence or run record
  directories, whatever tool it reaches for. This is the one security property
  the design rests on the `agent_id` measurement for.
- **Task 6, the trace hook.** Records which files a worker touched, keyed on its
  `agent_id`.
- **Task 7, the brief hook.** Injects the mode's primary rule band and the
  four-line contract into the worker at start.
- **Task 8, the gate runner and `finish-shape`.** Runs the checks wherever a
  report arrives, and refuses a report that has no parseable shape.
- **Task 9, the scope gate.** Refuses a report whose touched files fall outside
  the declared scope without a named deviation.
- **Task 10, the evidence gate.** Refuses a behaviour claim with no command
  behind it.
- **Task 11, the blind review gate.** A reviewer that never saw the brief, under
  `verify: proven` only.
- **Task 12, the conformance log.** The passive record of what the harness
  actually did, which closes condition 4 above. This is the operator's standing
  request from 2026-09-15.
- **Task 13, wire it up and document it.** Settings, `docs/hooks.md`, and reading
  the log.

### B. The voice command system

Designed and accepted 2026-09-15; the full record is the Decisions section of
`.claude/state.md`. Owed next: the spec at
`docs/superpowers/specs/2026-09-15-voice-command-design.md`, then a plan. Nothing
is built. Independent of A, so it waits without cost.

### C. Small things, each its own change

- **The em dash sweep.** 209 sit in hand-written files, counted 2026-09-15 and
  not re-counted since. Deliberately not folded into any other work.
- **The `autoMode` block in `settings.json`.** Stays uncommitted by the
  operator's decision on 2026-09-17, because it names a storage bucket and this
  repository is public. It also describes this repository wrongly (no remote,
  zero tracked files, assume private), and the auto-mode classifier reads it.
  Correcting it locally is the operator's call, since it decides what that
  classifier trusts.
- **`~/Desktop/Stedo`.** Both large output directories are ignored there now and
  a working record exists, but that repository's own `.gitignore` edit is still
  uncommitted.

## What would still not be flawless at the end

Stated here so no later report has to pretend otherwise.

- **Condition 3 is a record, not a re-runnable check.** A future reader trusts
  that each test was watched red; only the session that wrote it saw that.
- **Condition 4 closes slowly and can reopen.** A Claude Code update can change
  which payload fields arrive. That is exactly why the log is passive and keeps
  running rather than being a one-off measurement.
- **The gates check shape and scope, not truth.** A worker can cite a real
  command that proves the wrong thing. The blind review gate narrows this under
  `verify: proven` and does not close it.
