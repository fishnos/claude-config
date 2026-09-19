# Wiring the blind review: the main session dispatches it, the run record keeps the verdict, the turn end holds for it

Date: 2026-09-19
Status: approved in three parts in conversation on 2026-09-19; this is the design spec.
Implementation plan: not yet written.
Repo: `~/.claude` (public)
Builds on: `docs/superpowers/specs/2026-09-15-subagent-architecture-design.md`
(the architecture spec), sections 2, 3 and 4. This spec replaces what that one
says about the `review` gate.

## The problem, stated concretely

A subagent is a second Claude session this one starts to do a piece of work. In
the postures that set `verify: proven` (FIXER for releases, TRACE for debugging,
APPRAISER for review, AUTOPILOT for unattended runs), the architecture spec
promises one more check than the daily posture has: a second subagent, the
reviewer, reads the diff without being told what the change was for, and a
change it will not ship does not ship.

That check is written (`hooks/subagent/gates/review.js`) and can never pass, for
two reasons that no amount of wiring inside the current shape fixes:

1. A hook is a plain script. It cannot start a subagent; only the main session
   can.
2. The gate runs on the implementer's own report, at the moment the implementer
   hands it back. No reviewer has run at that moment, so no verdict can exist to
   read.

So the review cannot be a check on the implementer's report. It has to be a
check on the main session, later, once there has been a chance to run it. The
gate's own header comment also says it binds "under FIXER and nowhere else",
which is wrong: four modes set `verify: proven`.

## Decisions the operator made

- **The main session runs the reviewer**, rather than a hook starting a headless
  `claude -p`. No usage is spent where the operator cannot see it, no hook waits
  minutes on a model, and blocking findings reach the one party able to order a
  fix.
- **On a blocking finding, fix or justify.** The main session may end its turn
  once every blocking finding is either fixed and re-reviewed clean, or stated
  in writing as standing, with a reason. This matches what the gate already
  tells a worker: "Fix it, or say in the report why it stands."

## 1. Starting a review

**The request.** The main session dispatches the `reviewer` role with a line
naming the runs to review:

```
Reviews: a1b2c3d4, e5f6a7b8
```

Each value is a run token, the eight hexadecimal characters the dispatch hook
minted for an earlier worker. Several tokens mean one combined review: an
original change and its fix are reviewed together, as one diff.

**The dispatch hook writes the whole prompt.** When `hooks/agent-dispatch.js`
sees a dispatch whose `subagent_type` is `reviewer` and whose prompt carries a
`Reviews:` line, it discards everything else the main session wrote and puts the
output of `buildPrompt({ diff })` in its place, below the usual contract lines.
The main session cannot leak the brief into the reviewer's prompt, because none
of its text survives. Blindness becomes a property of the code rather than of
the dispatcher's discipline, which is what the existing `buildPrompt` comment
already asks for. The reviewer's run line records `reviews: [tokens]`.

A `reviewer` dispatch with no `Reviews:` line passes through as it does today:
the role is still usable for an ad hoc review the operator asks for, and such a
review records no verdict.

**The diff.** For each token, the hook finds the worker's agent id through that
run's `finish` line, collects that agent's `path` lines, and runs `git diff
<head> -- <paths>` against the `head` the run line recorded at dispatch. A path
git does not track yet is diffed against an empty file with `git diff
--no-index /dev/null <path>`, which leaves the index alone. The diffs of all
listed tokens are joined in token order.

A diff over 60,000 characters is cut at that length and ends with a line telling
the reviewer the diff was truncated and naming every file in it, so it can open
the rest with `Read`. The cap is a first guess sized to leave the reviewer room
to work, not a measurement, and is stated as such in the code.

**A token the hook cannot resolve** (no run line, no `finish` line, or no path
lines) is named in the prompt as "not found in the run record" rather than
silently dropped, and the reviewer is told to say so in its findings.

**Which runs need a review.** A run needs one when all of these hold:

- its run line was written while the lock said `verify: proven` (the run line
  gains a `verify` field at dispatch, so switching posture mid-session does not
  demand reviews of work done under another one);
- it is not itself a reviewer run;
- its worker has a `finish` line joining it to an agent id, and that agent has
  at least one `path` line.

This does not depend on the role, so a built-in `general-purpose` worker that
edits files is covered too. A worker that never finished (still running in the
background, or crashed before reporting) has no `finish` line and is not
required; the hold names it only once it reports.

**The module moves.** `buildPrompt`, `interpret`, `isAdvisory` and `ADVISORY`
move to `hooks/lib/blind-review.js`, and `hooks/subagent/gates/review.js` is
deleted. The gate runner loads every file in that folder as a check on a
worker's report, and this one never will be one again.

## 2. Recording the verdict

**What the reviewer writes.** Every finding on its own line, opening with its
severity label:

```
Blocking: parseFindings accepts a label with no text after it
Nit: `rows` would read better as `findingLines`
FYI: did not read the test file, only the module
Findings: none
```

`Findings: none` is how a clean review says so. A report carrying both it and
finding lines is read by its finding lines, so a stray `none` can never hide a
`Blocking:` line. The rule goes into `modes/roles/reviewer.md` and into the text
`buildPrompt` produces, which already ask for severity labels; only the line
form is new.

**Reading it.** `parseFindings(report)` in `hooks/lib/blind-review.js` returns:

- a list of `{ severity, text }`, one per line opening with `Blocking:`, `Nit:`,
  `Optional:` or `FYI:` (matched regardless of case), when there is at least one;
- an empty list for `Findings: none` with no finding lines;
- `null` when the report has neither. `interpret` already reads a missing list
  as a failure, never as a clean review.

Only those four labels are recognised as openings of a finding line. A label
the parser does not know is not a finding line at all, so a report written only
in unknown labels is `null` and is sent back by `review-shape` below; it never
passes as clean.

**A reviewer that ignores the format is sent back.** A new gate,
`hooks/subagent/gates/review-shape.js` (`minimumVerify: "none"`), refuses a
report for which `parseFindings` returns `null`. The reviewer role's `gates:`
line becomes `finish-shape, review-shape`. The existing refusal machinery does
the rest: the report is sent back with the reason, at most twice.

**Where the verdict lands.** When a reviewer's report passes all its gates, and
its run line carries `reviews`, `hooks/subagent-gate.js` appends one line to the
run record through a new `crew-record` function, `appendReview`:

```
{ "kind": "review", "token": "<reviewer's run token>", "reviews": ["a1b2c3d4"],
  "findings": [{ "severity": "Blocking", "text": "..." }], "at": "<ISO time>" }
```

It is written when the report passes, not when delivery is confirmed. In auto
mode that is at `PreToolUse` on `SubagentHandback`, one step before delivery; a
different hook denying the hand-back after this one passed it would leave a
verdict whose report the parent never saw. The findings are still what the
reviewer wrote about the diff, so the verdict stays true.

**The newest verdict wins.** For a given token, its verdict is the newest
`review` line whose `reviews` list contains it. That is how a fix reviewed
together with the original replaces the original's blocking verdict.

**Who can write the line.** `hooks/agent-guard.js` already denies any worker a
write to the run record, so an implementer cannot forge its own approval. It
does not cover the main session, the party Part 3 holds, which could append a
forged line with a shell command. Closing that is out of scope here and listed
under section 6.

## 3. Holding the turn

**A new `Stop` hook, `hooks/review-hold.js`,** wired beside
`hooks/review-reminder.js` and `hooks/clear-gate.js`. It does nothing unless the
lock says `verify: proven`. Otherwise it walks every run that needs a review
(section 1) and settles each one:

| The run's state                                    | Settled?                         |
| -------------------------------------------------- | -------------------------------- |
| no verdict                                         | no                               |
| newest verdict unreadable (`interpret` fails)      | no                               |
| newest verdict has no blocking finding             | yes                              |
| newest verdict blocks, and a `stands` line exists  | yes                              |
| newest verdict blocks, and no `stands` line exists | no                               |
| held twice already                                 | yes, with a warning that says so |

A `stands` line only counts when it is newer than the verdict it answers: a
justification of an old finding does not excuse a new one.

**The hold message** names each unsettled run and what settles it:

- no verdict: "run a1b2c3d4 changed files and nobody has reviewed it. Dispatch
  a `reviewer` with `Reviews: a1b2c3d4`."
- blocking findings: the findings themselves, up to the five `interpret`
  already names, then "Fix them and review the fix together with this run
  (`Reviews: a1b2c3d4, <fix token>`), or write `Stands a1b2c3d4: <reason>` in
  your final message."

**Justifying.** The hook reads the main session's final message the way
`clear-gate.js` does: the payload's `last_assistant_message`, falling back to
the transcript's tail (`hooks/lib/transcript-tail.js`). Each line of the form
`Stands <token>: <reason>` with a non-empty reason, for a token that currently
needs one, is copied into the run record as `{ "kind": "stands", "token",
"reason", "at" }`, so it still counts at every later turn end. A `Stands` line
with no reason, or for a token that is not blocked, is ignored, and the hold
message says why.

**Bounds, so it cannot trap a session.** Each run is held at most twice,
counted by `hold` marks in the run record. The two existing `Stop` hooks leave
after one hold per turn through `stop_hook_active`, but this hold must be able
to fire again after the main session has gone off and dispatched the reviewer,
so it counts per run instead, and the harness's own cap on consecutive stop
blocks (eight, on 2.1.273) stays as the backstop. After the second hold the
turn ends, and the hook's warning names the run as unreviewed or unresolved, so
the gap is visible rather than hidden. A record at its size ceiling cannot count
holds, so the hook then warns and never holds, the rule `subagent-gate.js`
already follows for its refusals.

## 4. Components

| File                                   | Change                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `hooks/lib/blind-review.js`            | New. `buildPrompt`, `interpret`, `isAdvisory`, `ADVISORY` moved here; `parseFindings` added.                 |
| `hooks/subagent/gates/review.js`       | Deleted.                                                                                                     |
| `hooks/subagent/gates/review-shape.js` | New gate: refuses a reviewer report `parseFindings` cannot read.                                             |
| `hooks/lib/crew-record.js`             | `openRun` takes `verify` and `reviews`; new `appendReview`, `appendStands`, `reviewsFor`, `standsFor`.       |
| `hooks/agent-dispatch.js`              | For a `reviewer` dispatch with `Reviews:`, builds the diff and replaces the prompt; records `verify` always. |
| `hooks/subagent-gate.js`               | Appends the `review` line when a reviewer's report with `reviews` passes.                                    |
| `hooks/review-hold.js`                 | New `Stop` hook: holds the main session's turn (section 3).                                                  |
| `modes/roles/reviewer.md`              | Finding line form; `gates: finish-shape, review-shape`. `agents/reviewer.md` re-rendered by `ccfg mode`.     |
| `settings.json`                        | One `Stop` entry for `review-hold.js`. The operator's own edits sit in this file; it is never staged.        |
| `docs/hooks.md`                        | Hook count, the new hook's row, the reviewer flow.                                                           |
| the architecture spec                  | Section 4's `review` paragraph and section 8's table point here.                                             |

## 5. Testing

Every case below goes in `tools/test-hooks.js`, is written before the code, and
is watched failing for the right reason before it passes.

- The dispatch hook: a `reviewer` dispatch with `Reviews:` gets a prompt that
  contains the diff and none of the main session's text (the blindness case
  plants a unique sentence in the dispatcher's prompt and asserts it is absent);
  the diff covers an untracked file; a diff over the cap is cut and ends with
  the truncation line naming the files; an unknown token is named as not found;
  a `reviewer` dispatch without `Reviews:` is left as it is today; every run line
  carries `verify`.
- `parseFindings`: each of the four labels, case ignored; `Findings: none`
  alone is an empty list; a report with neither is `null`; a report written only
  in an unknown label is `null`.
- `review-shape`: refuses an unreadable report, passes a clean one.
- The gate runner: a passing reviewer report writes one `review` line with the
  right tokens and findings; a refused one writes none.
- The hold: no hold at `verify: tested`; a hold for an unreviewed run that
  changed files; no hold for a run that changed nothing; the newest verdict wins;
  a blocking verdict holds; a `Stands` line with a reason settles it and is
  recorded; one without a reason does not; a `stands` older than the verdict
  does not count; the third turn end passes with the warning; a full record
  warns and never holds.

Then one live run under a `verify: proven` posture: an implementer changes a
scratch file, the turn end holds, a reviewer is dispatched, its verdict lands,
the turn ends. That spends real usage and waits for the operator's go.

## 6. Not decided here

- **The main session can forge a verdict.** `hooks/agent-guard.js` guards the
  run record against workers only. Extending it to the main session is its own
  change.
- **Findings in unknown labels are invisible.** Section 2 recognises four
  labels. A reviewer that invents a fifth severity for a real problem, beside at
  least one recognised line, has that finding dropped rather than counted as
  blocking. The role file and the prompt both name the four labels, which is
  the only mitigation here.
- **The diff cap of 60,000 characters** is a first guess, not a measurement.
