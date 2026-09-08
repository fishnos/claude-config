# Mode system design

Status: draft for review
Date: 2026-09-04

## Problem

`CLAUDE.md` encodes a single working posture and applies it to every task. It is
211 lines across 15 sections, and it has grown before: it was cut from 168 lines
to 63 on 2026-07-31 and has since accreted back past its original size. There is
no cost to adding a rule, so rules accumulate, and every one of them fires on
"what is in this file?" exactly as it fires on a schema migration.

Two capabilities are missing, not one. There is no way to dial the posture *down*
for a throwaway spike, and no way to dial it *up* for a paper submission where
every claim must carry a resolvable citation.

## Evidence base

**Instruction stacking degrades adherence non-linearly.** "Instruction Stacking
Collapse" (arXiv:2608.02639) stacks up to 24 verifier-checked instructions against
Claude Sonnet 4.6, GPT-5-mini and Gemini 2.5 Flash. Follow rate falls from ~96%
with a single instruction to as low as 20% under stacking. The mechanism is a
structured, reproducible set of pairwise conflicts rather than context length
alone, since one "output JSON" constraint is jointly unsatisfiable with nine others.

**The remedy is capability-dependent, and this cuts against the design.** The same
paper tests an instruction compiler that rewrites a stacked prompt in one call.
Weaker models recover up to +11 percentage points. Stronger models show
essentially no improvement. This config runs Opus 5. We should therefore expect a
*smaller* adherence gain from rule selection than the headline number suggests,
and possibly none.

This does not sink the design, because pairwise conflict is real, and rules written for
production code genuinely do conflict with rules for a throwaway spike. It does
mean the payoff must be measured rather than assumed, and that adherence may not
be where the win shows up. Latency, token cost, and the ability to reach postures
the current config cannot express at all are independent benefits that do not
depend on the adherence result.

**Mode errors are the known failure of modal systems.** The HCI literature is
consistent from Norman onward: the danger of a mode is not the mode, it is the
user acting on a stale belief about which mode is active. The mitigations that
work are unambiguous, continuously available state indication, and a system model
simple enough that the user can predict the mode. Experiments also show
non-visual feedback channels measurably reduce mode error. Design consequence:
the active mode must be visible at all times and must be re-asserted to the model
every turn, not announced once at switch time.

**Prior art for the layering.** `git config includeIf` (directory-conditional
config), `kubectl` contexts (a named, switchable active context), and `rustup`
profiles (named presets over a component set: minimal/default/complete) are the
closest analogues. All three share a property worth copying: the active selection
is a single named thing, cheap to query, and cheap to change. OPA contributes the
precedence discipline: specific rules override general ones, and conflicts are
resolved by an explicit documented order rather than file load order.

## Vocabulary

One word for the concept: **mode**. "Cartridge" appears only as flavour in the
switch banner, never in a command, file name, or key.

Seven settings, three values each. Every name answers a question in plain English;
no shorthand, no numeric levels.

| Question | Setting | Values |
| --- | --- | --- |
| How much proof before I say it works? | `verify` | `none` / `run-it` / `prove-it` |
| How do I label what I claim? | `claims` | `loose` / `labeled` / `sourced` |
| How many gates before code? | `process` | `skip` / `light` / `full` |
| How far do I go before asking? | `autonomy` | `ask-first` / `check-in` / `just-go` |
| How good does the code have to be? | `code` | `rough` / `decent` / `polished` |
| How many subagents? | `subagents` | `none` / `few` / `many` |
| How do I talk? | `voice` | `caveman` / `normal` / `prose` |

`verify` and `claims` are independent on purpose. `verify: none, claims: labeled`
is the spike posture, an explicitly unverified answer honestly labelled. No
single setting expresses that.

## Rule corpus

Rules are atomic files, not prose blocks. Each declares which setting governs it
and the minimum value at which it activates.

```markdown
---
id: claims-measured-vs-assumed
setting: claims
min: labeled
---
A claim about performance, runtime behaviour, or what code does is worth exactly
what produced it. Measured: a command ran and its output is in this
conversation. Assumed: read from code, inferred, or remembered. Say which.
```

The active rule set is computed, never authored. This is what makes modes
composable (a union of selected rules, not a merge of conflicting prose),
measurable (a single rule can be ablated), and safe for agents to extend (the
proposable unit is one rule, not a whole posture).

It also caps accretion structurally: a new rule must name a setting and a
threshold, so it can no longer tax every task by default.

## Resolution order

Later layers win. Documented, not emergent from file order.

1. **Core**: rules and hooks belonging to no mode. Always active.
2. **Personal mode**: `~/.claude/modes/<name>.yaml`
3. **Repo mode**: `<repo>/.claude/modes/<name>.yaml`, overrides a personal mode of the same name
4. **Ad-hoc override**: `ccfg mode set verify=prove-it`, one setting, current session only

`<repo>/.claude/mode` names the repo's default mode and is entered on session start.

## Modes

Ten named points in the setting space.

| Mode | verify | claims | process | autonomy | code | subagents | voice |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `spike` | none | labeled | skip | just-go | rough | none | caveman |
| `build` | run-it | labeled | light | check-in | polished | few | caveman |
| `ship` | prove-it | sourced | full | ask-first | polished | few | normal |
| `paper` | run-it | sourced | full | ask-first | rough | few | prose |
| `research` | run-it | sourced | light | check-in | rough | many | caveman |
| `review` | prove-it | sourced | skip | ask-first | polished | none | normal |
| `debug` | prove-it | labeled | light | check-in | decent | none | caveman |
| `design` | none | loose | light | check-in | decent | none | caveman |
| `unattended` | prove-it | sourced | full | just-go | polished | few | prose |
| `pair` | run-it | labeled | skip | ask-first | decent | none | caveman |

`unattended` and `pair` differ only in `autonomy` and `voice`. Same task, same
skills, opposite postures. No capability toggle can express that difference,
which is the clearest justification for settings over on/off switches.

## What a mode controls

Beyond the rule set, a mode projects onto keys that already exist in
`settings.json`: `skillOverrides`, `enabledPlugins`, `hooks`, `model`,
`effortLevel`, `permissions`, `statusLine`. Nothing new is invented as a
substrate.

**Hooks are the reason modes are more than a mood.** Prose rules are guidance;
hooks are enforcement. `review` blocks Edit and Write at `PreToolUse`. `ship`
blocks a completion claim at `Stop` until the test command has run. `paper`
resolves every DOI before a draft returns. `spike` runs with most hooks off,
which is where its speed comes from and is honest about the trade.

**Core hooks belong to no mode and no mode can remove them.** The git guard and
the staged-secrets check are active in `spike` exactly as in `ship`. `ccfg mode`
refuses to load a mode that disables a core hook; `ccfg doctor` fails if one is
missing. This is the safety boundary of the whole system.

## Per-agent modes

An agent definition may declare `mode: research` in frontmatter; an `Agent` call
may override it. The subagent's rendered rule set is prepended to its prompt.

**Replace, do not inherit.** A subagent's rules are exactly its own mode's rules.
Nothing leaks down from the parent. Inheritance is how a search agent ends up
carrying commit-hygiene rules it can never use, which is a live defect today. The cost is
that some rules are duplicated across modes; that is cheaper than debugging an
inherited gate nobody intended.

## Application, and mode visibility

`CLAUDE.md` loads once per session, so file rewriting alone would require a
restart per switch. Instead the `UserPromptSubmit` hook, already registered in
this config, reads `mode.lock` and injects the rendered rule set every turn.

Three consequences, all wanted. Switches take effect immediately. The posture
survives compaction, unlike anything loaded once at session start. And the mode is
re-asserted to the model continuously, which is the HCI literature's requirement
for the model half of the mode-error problem.

For the human half, the mode is rendered in `statusLine` at all times. Announcing
the mode only at switch time is precisely the failure Norman documents.

## Files

```
~/.claude/
  rules/<id>.md              atomic rules with setting frontmatter
  modes/<name>.yaml          personal modes
  modes/proposed/<id>.yaml   agent-writable; never auto-applied
  rules/_active.md           GENERATED: rendered rule set
  mode.lock                  active mode, resolved settings, backup ref
<repo>/.claude/
  modes/<name>.yaml          project modes
  mode                       the repo's default mode
```

`CLAUDE.md` shrinks to universal rules plus a pointer at the generated set.

## CLI

```
ccfg mode                    show active mode and resolved settings
ccfg mode <name>             switch
ccfg mode set verify=prove-it   override one setting for this session
ccfg mode diff <a> <b>       compare two modes
ccfg mode list               available modes, personal and repo
ccfg mode proposals          list agent-authored proposals
ccfg mode accept <id>        promote a proposal after showing its diff
ccfg mode prove <name>       run the mode's eval suite
```

`--plain` strips styling for CI and scripts. Exit non-zero on unknown mode or on
a mode that would disable a core hook.

### Switch banner

The banner is a diff, so the flavour and the information are the same object.

```
+- BREACH PROTOCOL --------------------------------+
|  CARTRIDGE SWAP                                  |
+--------------------------------------------------+

     build -------------> SPIKE

     verify         run-it -> none
     claims                  labeled
     process         light -> skip
     autonomy     check-in -> just-go
     code         polished -> rough
     subagents         few -> none
     voice                   caveman

     hooks    git-guard, secrets-guard        [2 core]
              -verify-before-done, -self-review  [2 off]
     skills   -google-*, -impeccable            [12 off]
     model    opus -> opus     effort  high -> low

     POWERING UP
```

Rows that do not change render without an arrow, so the eye lands only on what
moved. ANSI colour and block-character shading in the real renderer; no emoji,
per the config's own rule. `ccfg mode` with no argument renders the same table without
arrows.

## Agent-proposed rules

Agents may write only to `modes/proposed/`. A `PreToolUse` hook denies agent
writes to `modes/`, `rules/`, and `settings.json`.

A proposal is rejected by `ccfg mode accept` unless it carries an eval case that
would demonstrate the rule. An agent cannot propose a rule without proposing how
to falsify it.

Self-switching follows the same boundary: an agent may propose a mode change and
must not apply one. Silently lowering `verify` because a task felt small is the
exact failure the system exists to make visible.

## Measurement

Each mode carries an eval suite. `ccfg mode prove <name>` wraps
`claude plugin eval --ablation with-without --runs N`, which supplies the baseline
arm, per-case repeats, JSON output, and a cost ceiling.

Because settings are ordinal, the interesting run is not an A/B but a
**dose-response curve**: hold a task set fixed, sweep `verify` across its three
values, and find where rigour stops paying. That is the question this config has
never been able to ask.

Graders must be deterministic wherever possible: did the named command run, did
every DOI resolve, did the ledger file appear, did the skill fire. An LLM judge
stacks its own variance on top of the agent's.

Baselines are recorded **before** any rule is migrated. A baseline collected after
the fact is worthless.

## Testing

Extends the existing `ccfg test` suite, which already sandboxes via
`CLAUDE_CONFIG_DIR`.

- Rule rendering: a corpus at a given setting produces exactly the expected rule ids
- Resolution order: repo mode overrides personal; ad-hoc override wins over both
- Core hook protection: a mode disabling a core hook is refused
- Round trip: switch, then revert, restores `settings.json` byte-for-byte
- Proposal boundary: an agent-path write to `modes/` is denied
- Banner: `--plain` output is stable and parseable
- `ccfg doctor` fails when `mode.lock` and `settings.json` disagree

## Risks

**The adherence gain may be small or absent on Opus 5.** Stated in the evidence
section and load-bearing. Phase 1 measures it before the migration is finished.

**Rule migration is the real work and the real risk.** Turning 211 lines into
atomic tagged rules is judgment, not mechanics. A wrong setting assignment
produces a mode that silently misbehaves. Mitigation: migrate one section, render
it at three settings, review, then continue.

**Mode error.** Mitigated by permanent status-line display plus per-turn
re-assertion, per the HCI literature. Residual risk accepted.

**Seven settings and ten modes is a large surface with no evidence behind it
yet.** Phase 1 ships two modes and two settings.

## Open questions

1. Can `case.yaml` vary the system prompt per case? Decides whether setting
   values can be ablated directly or need one plugin per value.
2. Does `ccfg mode` write `settings.json` directly, or a generated file that
   `settings.json` includes? The latter is cleaner to revert; needs a check that
   Claude Code supports an include.
3. Should `code` and `process` collapse? They may correlate in practice; the
   dose-response run will show it.

## Phasing

1. Rule format, renderer, and `claims` section migrated. Two settings (`verify`,
   `claims`), two modes (`spike`, `ship`). Baseline eval recorded first.
2. `ccfg mode` switch, revert, lockfile, status line, banner. Tests.
3. Remaining settings and the other eight modes, each with an eval suite.
4. Repo-level modes and repo defaults.
5. Per-agent modes.
6. Proposals.
