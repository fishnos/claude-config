# Context continuity for long Claude Code sessions

Date: 2026-09-09
Status: design, approved for phases A and B
Repo: `~/.claude` (public)

## The problem, stated concretely

Long sessions degrade. Rules loaded at session start stop being obeyed partway
through — the reported symptom is commit messages with vague subjects that the
repo's own written conventions forbid.

Two separate causes, and they need different fixes.

**Cause one: a warning is not a gate.** A commit-message checker already exists
(`hooks/lib/commit-message.js`, 8,113 bytes, including a `vagueClause` detector
built for exactly this). It runs from `hooks/git-guard.js` at the point a commit
is attempted. Its findings go out through `io.warn`, which is advisory — the
model reads the warning and can proceed anyway. The check is correct; its
severity is wrong.

**Cause two: nothing survives compaction.** No `PreCompact` hook exists, so when
the conversation is summarized, decisions made and constraints issued during the
session are summarized away with it.

## What the evidence rules out

The obvious fix — restate the rules more often — is already known not to work
here. The header comment of `hooks/mode-inject.js` records the measurement:

> buried behind ~6,600 tokens of history a naming rule was followed 0 times in
> 36, and re-stating it at the freshest position was also 0 in 36.

and the contrast:

> in 12 of 12 cells a register rule delivered on the user's message overrode the
> opposite rule sitting in the system prompt above the same burial. The
> difference is new information, not freshness.

Published work agrees. In a white-box coding-agent study, a detailed external
checklist passed 10/10 runs where a generic self-check passed 5/10 (p = 0.0325)
([2607.17937](https://arxiv.org/abs/2607.17937)). Anthropic's own harness research
found that full context _resets_ outperform in-place compaction for long-running
work. And Imbue measured that giving a reviewer _richer_ context made the
resulting code worse — 46 lines changed on average with full detail versus 19
with summaries, at higher regression risk.

The design therefore does not add standing rules and does not inject more
context. It puts constraints at the moment of the action, and preserves only
what compaction would otherwise destroy.

## Phase A — point-of-action gates

### A1. Make the commit-message check block

`hooks/git-guard.js:552` currently collects lint findings into `notes` and emits
them with `io.warn`. Change lint findings specifically to deny the tool call
(exit 2), so a commit with a vague subject cannot land.

Constraints on the change:

- Only _lint_ findings block. The existing advisory notes in the same function
  (staged logic without tests, oversized diff, possible credential) stay
  warnings; they are judgment calls, not rule violations.
- A typed per-invocation escape follows the established pattern in this file
  (`CLAUDE_ALLOW_COMMIT=1`), read from the command text rather than the
  environment so it cannot be exported once and forgotten.
- The block message names the specific failing rule and quotes the offending
  subject, so the rewrite is obvious without opening a doc.

Note the interaction with the existing guard: commits are already blocked
outright unless `CLAUDE_ALLOW_COMMIT=1` is typed. So the lint gate only fires on
a commit that was deliberately authorized, which is exactly where a bad subject
would otherwise slip through.

### A2. Add a `PreCompact` hook

New file `hooks/pre-compact.js`. Before compaction runs, write a handoff file
capturing what the summarizer is known to drop:

- active mode and the dials in force
- constraints the user issued during this session
- decisions reached and, separately, approaches ruled out
- open threads — what was in progress when compaction fired

Written to `cache/handoff/<session-id>.md`. Bounded in size, on the same
principle as `MAX_INJECTED` in `mode-inject.js`: a cap, not a budget, so an
oversized render is visible rather than silently flooding context.

### A3. Read the handoff back after compaction

A `SessionStart` branch matching `source: "compact"` renders
`cache/handoff/<session-id>.md` back into context. A2 without A3 is a file
nobody reads; they ship together.

This is the pairing the research points at, and it is the config's single
largest gap.

### A4. Raise the effort level

`settings.json`: `effortLevel` from `"high"` to `"xhigh"`.

`xhigh` is Claude Code's default for coding work; the current setting is below
default. On the GDPval leaderboard, the same model at `max` scores 114 Elo above
itself at `high` — a wider gap than most model-to-model gaps.

### A5. Repository hygiene

- Add `bash-commands.log` and `cost-tracker.log` to `.gitignore`. Both are ~2 MB,
  untouched since 2026-08-03, and have no writer — superseded by
  `cache/evidence/`. They are untracked today but a future `git add -A` in a
  public repo would catch them. Then delete both.
- Prune `plugins/` (1.4 GB) of cache and data for plugins set to `false` in
  `enabledPlugins` — `ecc` and `claude-mem`. Both were disabled deliberately;
  only their disk footprint is in question, not the decision.
- Drop the five `extraKnownMarketplaces` entries with no enabled plugin behind
  them: `ui-ux-pro-max-skill`, `claude-code-nano-banana`, `playwright-skill`,
  `claude-code-plugins`, and `thedotmack`.
- Move `modes/SOURCE-SNAPSHOT.md` (24,983 bytes) into `docs/`. It is the frozen
  prose that `ccfg probe run corpus-fidelity` checks against, so it must not be
  deleted, but it does not belong beside the live mode definitions.

Corrections to an earlier audit pass, recorded so they are not re-litigated:
`.DS_Store` is already covered by `.gitignore:83` and is not tracked, and
`ccfg clean` ran on 2026-09-09.

## Phase B — constraint registry

A registry of the session's own standing constraints, kept outside the lossy path.

### B1. Capture

A `UserPromptSubmit` hook classifies whether the user's message contains a
constraint meant to hold for the rest of the session — "don't touch the auth
module until I say", "stop using pnpm here" — and appends any hit to
`cache/constraints/<session-id>.md`.

This is a reimplementation of the idea in
[2608.11242](https://arxiv.org/abs/2608.11242), not of its code; that repository
is a research evaluation harness. Its measured effect: standing-constraint
retention across compaction rises from 17% to over 90%, without modifying the
compactor.

The classifier question is a single one, asked per user turn: if three turns from
now the user asks about something unrelated, would this instruction still apply?

### B2. Re-render

`hooks/pre-compact.js` from A2 reads `cache/constraints/<session-id>.md` and
copies its contents verbatim into the handoff file as a distinct section, rather
than summarizing or referencing it. Verbatim matters: the whole point is that
these lines never pass through a lossy step.

Constraints therefore return after compaction through A3, the single read-back
path, rather than through a second injection of their own. If B is later removed,
A2 and A3 keep working with that section empty.

### B3. Measure it

This config owns something almost nobody has: a behavioral probe harness
(`probes/`, run via `ccfg probe run`) with probes already written for exactly
this question — `standing-band.js`, `dormant-rules.js`, `injection-cadence.js`.

Run them before and after B1/B2. If retention does not move, B is removed rather
than kept on faith. The per-turn classifier call is a real cost and has to earn
it.

## Phase C and beyond — backlog

Captured so nothing is silently dropped. Ordered roughly by expected value.

**Continuity**

1. `SessionEnd` hook writing a session summary into `projects/*/memory/`. That
   directory holds 116 files across 65 projects, but only 12 have been touched
   since 2026-08-01 — the infrastructure exists and is going stale because
   nothing writes it except the model remembering to.
2. `SessionStart` read-back of the current project's `MEMORY.md`, so memory that
   exists is actually surfaced.
3. A cross-session index over `cache/evidence/` (48 sessions of every Bash
   command run, already queryable via `ccfg evidence`), answering "what did I do
   in this repo last week" without grepping 628 MB of transcripts.

**Context budget**

4. Run `/skill-doctor` — reports cost per skill, 7-day invocation counts, and
   never-used warnings. The 69 always-listed skills cost 25,889 bytes of
   descriptions every session; this says which earn it. Re-tier the rest to
   `user-invocable-only`.
5. Enforce a startup-cost budget in `ccfg doctor`. It already reports the number;
   nothing fails when it regresses.
6. `skillListingMaxDescChars` / `skillListingBudgetFraction` in `settings.json` as
   a second lever on the same cost.
7. `subagentPromptCacheTtl: "1h"`. Subagent prompt caches default to five
   minutes, so every subagent re-reads its prefix.
8. `--exclude-dynamic-system-prompt-sections` (needs v2.1.260+; running 2.1.266)
   moves working directory, git state, and environment out of the cached prefix
   so the cached portion stays stable across sessions.
9. `bashOutputMaxChars` — currently the 30,000-character default.
10. Schedule `ccfg clean`. `cache/mode-inject/` (100 files), `cache/mode-session/`
    (110), `cache/evidence/` (4.7 MB), and now `cache/handoff/` and
    `cache/constraints/` from this branch all grow one file per session
    forever. Checked directly: the age-based pruner in `tools/ccfg.js` (the
    loop around line 1074) only walks `file-history`, `paste-cache`, `debug`,
    `session-data`, and `session-env`; it does not visit `cache/` at all.
    Scheduling `ccfg clean` as it stands today would therefore reclaim none of
    this — the pruner would need extending to cover `cache/` first.

**Newly available, unevaluated**

11. `/advisor` — a stronger model consulted at decision points.
12. Agent Teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). Evaluate against the
    finding that at matched inference cost multi-agent does not beat a single
    agent ([2609.04217](https://arxiv.org/abs/2609.04217)), and Cognition's
    reversal to a single-writer rule. The defensible uses are read-only fan-out
    and clean-context review, which is where their measured gain was — roughly
    two bugs caught per pull request, 58% of them severe.
13. New hook events not yet used: `PostCompact`, `SessionEnd`, `FileChanged`,
    `InstructionsLoaded`, `PreModelSwitch` / `PostModelSwitch`, `TaskCreated` /
    `TaskCompleted`, `WorktreeCreate` / `WorktreeRemove`.
14. Evaluate `projectmem` (SQLite-backed MCP server recording issues, attempts,
    fixes; warns before a known bug is repeated). The only survey candidate that
    is both maintained and appropriately scoped — mem0's MCP server is archived,
    Letta and Zep are server runtimes rather than sidecars, LangGraph
    checkpointers are the wrong layer, and SIx Harness has zero stars and two
    days of commit history despite its paper.

**Correctness and hygiene**

15. Fix or remove the `21st` and `citecheck` MCP servers; both failed to connect
    on 2026-09-09.
16. Vendor or cache `ccstatusline` — `hooks/statusline.js` spawns
    `npx -y ccstatusline@2.2.27` every ten seconds, which is latency plus a
    supply-chain surface on a timer.
17. Move `hooks/test-hooks.js` (57,039 bytes, 29% of `hooks/`) to `tools/`. It
    never fires as a hook.
18. Add `AGENTS.md` to public repos. Now at 60k+ repositories and read by 20+
    agents, stewarded by the Linux Foundation alongside MCP. A sibling to
    `CLAUDE.md`, not a replacement.
19. Trial natural-language tool descriptions over JSON schemas. Across 14 models
    and 8,560 trials: +14.9 percentage points accuracy and 93% fewer critical
    errors ([2607.03953](https://arxiv.org/abs/2607.03953)).
20. Anthropic's `cache-diagnosis-2026-04-07` beta, for visibility into cache
    misses.

## Testing

Every hook change gets a case in `hooks/test-hooks.js`, written before the hook
and watched to fail for the right reason before the implementation exists.

Phase B additionally gets a before-and-after probe run. B3 is the acceptance
criterion for B, not a nice-to-have.

## What this design does not do

- It does not install a memory system. The survey found no candidate worth the
  dependency.
- It does not raise `autoCompactWindow` from 400,000. Effective context capacity
  runs well below nominal, and a coding agent measured 8/10 passes at 11K
  characters against 3/10 at 299K with the task held fixed. The goal is to reach
  the threshold less often, not to move it.
- It does not treat a new standing rule as the fix for a mechanically checkable
  violation. The governing principle: if a machine can check it, gate it; if only
  judgment can check it, write it as a rule. A commit subject is checkable, and
  the checker already exists, so it becomes a gate. "Judge whether this change
  improves overall code health" is not checkable and correctly stays a rule.

  The local 0/36 measurement supports this narrowly and should not be read
  further than it goes: one rule, one burial condition, n = 36. It shows that
  repeating an already-present rule does not rescue it once buried. It does not
  show that standing rules are ineffective in general — the existing corpus
  demonstrably works most of the time.
