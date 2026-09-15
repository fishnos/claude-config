# Making subagents follow standing rules: what already exists

Date: 2026-09-14
Status: research notes, no design decided yet
Why: subagents in this configuration break standing rules (a naming rule, a scope
boundary) and claim verifications they did not run. The operator's diagnosis, in
their words: "the input is ultimately not the same." They also want it tested
that subagents can follow the mode system at all.

## The mechanism inventory, confirmed against build 2.1.270

Measured 2026-09-14 by grepping the installed binary
`~/.local/share/claude/versions/2.1.270`: `SubagentStart` (20 hits),
`SubagentStop` (30), `updatedInput` (103), `disallowedTools` (59). Presence of
the identifiers only; behaviour not exercised.

| Mechanism                                        | What it gives                                                                                              | The catch                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Agent definition files (`~/.claude/agents/*.md`) | A body of instructions, `tools:`/`disallowedTools:` allowlists, a `skills:` preload field, per-agent hooks | None exist in this configuration today                                   |
| `SubagentStart` hook                             | Fires on spawn; carries agent type and id                                                                  | Does **not** carry the subagent's prompt, so it cannot inspect the brief |
| `SubagentStop` hook                              | Fires on finish; can refuse the completion                                                                 | Post-hoc; sees the result, not the instructions                          |
| `PreToolUse` deny on the `Agent` tool            | Can reject a dispatch and state why                                                                        | Cannot rewrite it                                                        |
| `PreToolUse` `updatedInput`                      | Rewrites a tool's arguments before it runs                                                                 | **Silently ignored for the `Agent` tool** — anthropics/claude-code#44412 |

The last row kills the obvious fix. Constraints cannot be stapled onto a
subagent prompt behind the dispatcher's back; they have to arrive another way.

## What this configuration does today

- No hook can tell it is running inside a subagent. No hook payload field
  (`is_subagent`, `agent_type`, `parent_tool_use_id`) is read anywhere.
  `hooks/lib/transcript-tail.js` reads `isSidechain` out of transcript entries,
  but that is historical transcript content, not a live signal.
- `hooks/style-check.js` (`PostToolUse` on `Edit|Write|MultiEdit`) checks seven
  regexes: `@ts-ignore`, `var`, `debugger`, `.only`, loose `==`, bare `except:`,
  mutable default arguments, wildcard imports. **None inspects identifier names.**
  A rename of `position_weight` to `pos_w` would not fire it. The naming rule is
  enforced nowhere mechanical.
- `hooks/mode-guard.js:53-60` is the only subagent-aware enforcement: it denies
  the `Agent`/`Task` tool outright when the active mode sets `subagents: "none"`.
  That is a switch, not a supervisor.
- `docs/superpowers/plans/2026-09-05-mode-system.md:2015` specified a path guard
  denying writes to `modes/`, `rules/` and `settings.json` "when the payload says
  a subagent is acting". **Never implemented.**
- `SubagentStop` is wired nowhere.
- `hooks/lib/skill-index.js:23-25` only scans `~/.claude/skills`, so every
  plugin-sourced skill is missing from `SKILL-INDEX.md` despite that file
  claiming to catalogue every skill on the machine.

## The five mechanisms worth stealing

Each is a design to re-implement and verify, not a verified component: the
surveying agent read READMEs and documentation, never implementation source.

1. **Declared scope checked against the actual diff.** The worker emits a literal
   protocol line naming the file patterns it intends to touch; a `Stop`-time hook
   diffs what actually changed against that set and blocks on anything outside it
   unless a deviation line names it with a reason. From `harness-toolkit`
   (https://github.com/tech-leads-club/harness-toolkit, 255 stars, pushed
   2026-09-13). Their load-bearing insight, quoted: _"A gate that fires on
   free-English 'done' fires on the word, not the claim."_ This is the direct
   answer to scope creep and needs no model cooperation beyond one line.

2. **A completion claim that must cite evidence covering the paths it touched.**
   A finish is only accepted as a structured claim, and when runtime paths
   changed the gate requires a recent passing artifact covering exactly those
   paths, written somewhere the worker cannot reach. Same repository. This is the
   answer to "claimed a verification it never ran".

3. **An independent reviewer that never sees the task brief.** It receives only
   the diff plus untracked file bodies, launched with `Read`/`Grep`/`Glob` and
   nothing else, with the user's own settings, hooks and plugins _not_ loaded,
   and exits with a distinct code when no reviewer is available rather than
   letting the working agent review itself. From `claude-code-guardrails`
   (https://github.com/tillmeier/claude-code-guardrails, 51 stars, pushed
   2026-09-09). Not seeing the brief is the point: it stops the reviewer
   rationalising toward the stated goal.

4. **The verification record is a policy surface no worker may write.** Workers
   are structurally denied every route to the file that records whether work
   passed — write tools, shell redirect, interpreter, heredoc — while reads stay
   open through a fixed list of provable readers. From `foreman`
   (https://github.com/VisionForge-OU/foreman, 443 stars, pushed 2026-06-29) and
   `harness-toolkit`. Removes self-certification as a class.

5. **Bounded retry that hands the failure back, getting more specific each time.**
   A validator returns `(false, reason)`, the reason goes back to the worker, and
   the task retries a named number of times, with an output schema enforced first
   so the completion record has a checkable shape before any semantic check runs.
   From `crewAI` (https://github.com/crewAIInc/crewAI) plus harness-toolkit's
   escalating-detail variant.

Cheap and just outside the five: hash every rule source at session start and
refuse the next acting call if one changed without a sanctioned command behind
it. For a configuration whose `rules/_active.md` is assembled by `ccfg mode`,
this catches both tampering and a stale assembly, at one hash per file.

## Two vocabulary items worth adopting

- **A task's terminal state should be named, not narrated.** The Agent2Agent
  protocol (https://github.com/a2aproject/A2A) gives eight states, of which
  `REJECTED` — the agent declined the work — is one a prose-reporting subagent
  has no way to express. Its `artifacts` are structurally separate from
  `history`, so deliverables are not buried in conversation.
- **Deterministic triggers versus keyword triggers.** OpenHands splits skill
  frontmatter into `triggers:` (keywords in a message) and `paths:` (file
  patterns, applied deterministically). This configuration already uses path
  gating; the borrowable part is that the same rule can be reachable both ways,
  with different reliability.

## Evidence from this repository's own practice

The current context-management build dispatched one subagent per task with a
written brief and an independent reviewer. Across tasks 1-7 the reviewers found
**no naming violation and no scope creep** — every review that mentions naming
praises full compliance. The failures were of a different kind: one implementer's
report asserted a verification outcome that the reviewer disproved by re-running
the exact command.

So the briefed pipeline is not where this user's problem lives. What the briefs
do have is a structural weakness worth fixing: the standing constraints live in a
separate `global-constraints.md`, and **no task brief for tasks 1 through 7
contains any pointer to it.** A rule stated once in another file, never
re-referenced inside the 372-line document the subagent works through
step-by-step, is the shape most likely to fall out.

## What happened while writing these notes

Task 8's brief told its implementer to overwrite the clear gate's tail with code
the plan had written on 2026-09-13 — before the Task 6 fix of 2026-09-14 added
two loop guards to that same tail. The implementer followed the brief exactly and
silently reverted the fix; two tests went red. The subagent did nothing wrong.
**The brief was stale, and no mechanism existed to notice.** Worth holding onto:
mechanisms 1 through 5 above all police the worker, and none of them would have
caught this.

## What the measurement literature says, and where it cuts against the diagnosis

Added 2026-09-14 from a second research pass. Every figure below is from a
published source; the strongest ones are unreviewed 2026 preprints, flagged.

**The operator's diagnosis is half right, and the half it misses may be bigger.**
A factorial experiment over 1,650 Claude Code sessions (16,050 function-level
observations, Sonnet 4.6, two TypeScript codebases) varied four structural
properties of the instruction file — its size from 25 to 500 lines, where the
rule sat inside it, monolithic versus modular imports, and whether adjacent files
contradicted it. **None of the four produced a detectable effect**, with
affirmative statistical support for the size and contradiction nulls. The one
reproducible effect was within-session decay: roughly **5.6% lower odds of
compliance per additional function the agent generates**
(https://arxiv.org/abs/2605.10039, preprint, unreviewed, single trivial
compliance target, effect discovered in analysis rather than predicted).

So "the subagent gets different input" explains the case where a rule never
arrived. It does not explain a rule that arrived and was dropped 40 minutes in.
Both of the operator's reported failures could be either, and nothing currently
records which — that is the first thing worth instrumenting.

Corroborating the decay direction: SysBench (ICLR 2025) measured adherence inside
one session falling from 84.8% at round one to 33.7% by round five, with only
54.4% of sessions holding every constraint throughout
(https://arxiv.org/html/2408.10943v1). "LLMs Get Lost in Multi-Turn
Conversation" (15 models, 200,000+ conversations) found an average 39% drop from
single-turn to multi-turn, almost all of it unreliability rather than lost
ability (https://arxiv.org/pdf/2505.06120).

**The harness matters more than the prompt, and one sentence of scope matters a
lot.** OverEager-Bench (500 scenarios, ~7,500 runs) defines an overeager action
as one outside the authorised scope. The same Sonnet 4.6 ran at **1.1% under
OpenHands and 27.7% under Claude Code** — a 26.6-point swing from the harness
alone. And stripping the explicit "scope of consent" sentence out of otherwise
identical prompts took Claude Code from **0.0% to 17.1%** out-of-scope actions
(p = 2.4 × 10⁻⁴), replicating across every base model
(https://arxiv.org/html/2605.18583v1, preprint). This is the strongest evidence
found anywhere that a prompt-level scope statement changes behaviour, and it is
nearly free to adopt.

**Rule count is a budget, and this configuration is over it.** Real-world system
prompts average 5.1 guardrails, and adherence "uniformly approaches zero as the
number of guardrails increases" past roughly five
(https://arxiv.org/html/2502.12197v1, peer-reviewed). AgentIF, over 707 real
agent prompts averaging 11.9 constraints: best-model constraint satisfaction
59.8%, but the rate at which *every* constraint in a prompt held was **27.2%**,
and past 6,000 words of instruction it is near zero
(https://arxiv.org/html/2505.16944v1). OctoBench, which includes Claude Code as a
scaffold, found the same shape: 79.75-85.64% per constraint, but only
9.66-28.11% of instances where all constraints held
(https://arxiv.org/html/2601.10343v1).

The implication for the mode corpus is uncomfortable and concrete: handing a
worker all twenty-five rules predicts partial compliance with an unpredictable
subset. A subagent rendering of the corpus should be a **short** selection, not a
reformatted whole.

**Deterministic enforcement is the only intervention with strong numbers.**
AgentSpec — rules shaped as trigger, predicate, enforcement, evaluated at the
tool-call boundary before the call runs — prevented **over 90%** of unsafe
executions across 24 of 25 categories, at about 3 milliseconds against a
25-second agent step (https://arxiv.org/html/2503.18666v2). That is structurally
the same thing as a `PreToolUse` hook, which runs outside the model and cannot be
argued with. Subagent definitions accept their own `hooks` field, so this is
reachable per agent.

**The two patterns the operator is most likely to reach for are the two with the
weakest evidence.**

- *Making the worker declare its compliance in structured output.* Format
  restriction measurably degrades reasoning
  (https://arxiv.org/pdf/2408.02442, peer-reviewed), and there is a documented
  gap between a model articulating a constraint and satisfying it. No controlled
  test of "require a compliance field, measure whether compliance improves"
  appears to exist.
- *Asking a reviewing model whether the worker complied.* On false completion
  claims — the agent asserts success the environment contradicts, at rates from
  13% (GPT-5.2) to 79% (Qwen3-Max-Thinking) — **no LLM-judge configuration
  exceeded AUROC 0.65**, because judges anchor on confident closing language,
  which is exactly what a false success produces. A plain word-frequency
  classifier over the trace reached 0.825-0.953
  (https://arxiv.org/html/2606.09863). Separately, the best frontier model scores
  **11%** at localising errors in agent traces (https://arxiv.org/abs/2505.08638).

**What does have evidence, in order:** deterministic enforcement at the tool
boundary (>90%); adding a verification *architecture* rather than a verification
*prompt* (+15.6% versus +9.4% for better role wording, in the MAST intervention
studies, https://arxiv.org/abs/2503.13657); checklists generated from the
instruction (+7.8 and +6.3 points absolute, https://arxiv.org/abs/2410.03608);
and restating the constraint **in the input**, adjacent to the work — the
self-reminder result cut jailbreak success from 67.21% to 19.34% and is published
in Nature Machine Intelligence
(https://www.nature.com/articles/s42256-023-00765-8). Note the direction: the
evidence supports repeating the rule *into* the prompt, not asking the model to
repeat it back *out*.

**The failure taxonomy, for naming what we are fixing.** MAST (peer-reviewed,
NeurIPS 2025, 150 traces, inter-rater agreement 0.92) puts the operator's two
incidents at: "disobey task specification" **10.98%** of all observed failures,
and "task derailment" **7.15%**. The largest single mode in the whole taxonomy is
"fail to ask for clarification" at **11.65%** — a worker that guesses rather than
asking. Only one protocol surveyed has a first-class way for a worker to say it
is unsure: the Agent2Agent `input-required` task state.

## Where this leaves the design

Three things are now worth separating, and the probe the operator asked for
should tell them apart rather than assume:

1. A rule that **never reached** the worker (fixable by what the worker is given).
2. A rule that reached it and **decayed** over a long run (fixable only by shorter
   delegations, or by re-stating the rule adjacent to the work).
3. A rule that reached it, held, and was **overridden by model prior** — the
   naming rule is the likely case here, since the training distribution is full
   of `idx`, `cfg`, `tmp` (fixable only by a deterministic check).

Nothing measured distinguishes these today. That is the gap the probe should
close first, before any rules file is written for subagents.
