# Mode system design (v2)

Status: draft for review. Supersedes `2026-09-04-mode-system-design.md`.
Date: 2026-09-05. Target model: `claude-opus-5`.

v1 assumed a mode's job was to **select** rules -- load the relevant ones, drop
the rest -- and treated the adherence benefit as unmeasured. Both assumptions
were wrong. 1,218 trials later the mechanism is **ordering**, and the benefit is
measured. This version is rebuilt on that.

## What changed, and the evidence

**Position governs adherence; length does not.** 576 trials, six arms, twelve
tasks stratified by change size, deterministic grader
(`hooks/lib/commit-message.js`).

| arm | lines | relevant rules at | clean |
| --- | --- | --- | --- |
| bare | 0 | -- | 40% |
| full-noprose | 198 | buried | 50% |
| full | 211 | buried (line 145) | 59% |
| padded | 195 | top | 77% |
| scoped | 22 | top | 82% |
| full-first | 212 | top | **85%** |

`full-first` vs `full`: +26.0pp, p<0.0001. `full-first` vs `scoped`: +3.1pp,
p=0.56 -- indistinguishable. **Hoisting the relevant section to the top of the
full 211-line prompt fully recovers the benefit of a 22-line prompt, while
keeping every rule.** Replicated in a second domain (identifier naming under
priming): 29% violations buried vs 8% early, p=0.0089.

Burial is worse than absence for at least one rule: body-wrap violations ran
36-44% when the rule was buried, 21% with no rule at all, 8-15% when early.

**Rules are load-bearing, but only visible under pressure.** Neutral prompts
showed zero naming violations in every arm including `bare`, which reads as "the
rule is redundant". Under realistic pressure -- extend a file that already uses
`cfg`, `ctx`, `buf` -- `bare` violated 52% and `scoped` 8% (+43.8pp, p<0.0001).
In the commit domain, six of nine rules had never fired in 210 neutral trials;
targeted temptation showed `trailing-period` (100% -> 0%) and `body-too-long`
(63% -> 0%) both strongly load-bearing.

**Consequence for the design: a mode orders, it never deletes.** Nothing is
dropped, so a mode cannot silently disable a guardrail -- which was v1's main
risk. It also explains the config's history: CLAUDE.md degraded as it grew not
because of line count but because new sections pushed older ones into the middle.

**One caution carried forward.** A finding that a prohibition was causing the
behaviour it forbids was **retracted** after its verification probe: the rule was
working and the grader was misreading it (`2026-09-05-prompt-audit.md`, F1). Any
future claim that a rule is harmful needs a probe whose correct answer the grader
can actually recognise.

## The dials

Seven settings, three values each, plain English throughout. No numeric levels,
no coined vocabulary. One word for the concept: **mode**.

| Question it answers | Setting | Values |
| --- | --- | --- |
| How much proof before I say it works? | `verify` | `none` / `run-it` / `prove-it` |
| How do I label what I claim? | `claims` | `loose` / `labeled` / `sourced` |
| How many gates before code? | `process` | `skip` / `light` / `full` |
| How much do I check in before acting? | `autonomy` | `just-go` / `check-in` / `ask-first` |
| How good does the code have to be? | `code` | `rough` / `decent` / `polished` |
| How many subagents? | `subagents` | `none` / `few` / `many` |
| How do I talk? | `voice` | `caveman` / `normal` / `prose` |

`verify` and `claims` are independent on purpose: `verify: none, claims: labeled`
is the spike posture -- an explicitly unverified answer, honestly labelled.

## Rule corpus and rendering

Rules are atomic files. Each declares the setting that governs it and where on
that setting's scale it becomes **primary** -- `primary_at` for an ordered
setting, `only_at` for a categorical one.

Six of the seven settings are ordered least-to-most, so `primary_at: labeled`
means "at labeled or above". `voice` is the exception: three registers with no
ladder between them, so a voice rule declares `only_at: caveman` and is primary
in exactly that register. Building it without this, `voice: normal` still made
the caveman rules primary -- the opposite of what the mode says.

The direction of the scale is load-bearing. `autonomy` originally ran
`ask-first -> just-go`, which put the most careful mode at the bottom of the
scale and made three restraint rules unreachable in every mode. Ordered the same
way as the others -- least of the thing, then most -- `ask-first` is the top and
the rules land where they are meant to.

```markdown
---
id: claims-measured-vs-assumed
setting: claims
primary_at: labeled
---
A claim about performance, runtime behaviour, or what code does is worth exactly
what produced it. Measured -- a command ran and its output is in this
conversation. Assumed -- read from code, inferred, or remembered. Say which.
```

**Rendering is a sort, not a filter.** `rules/_active.md` contains every rule,
in two bands:

1. **Primary** -- rules whose setting is at or above `primary_at` for the active
   mode. These go first, in the order the mode declares.
2. **Standing** -- everything else, unchanged, below.

Nothing is ever omitted. A mode changes which rules the model reads first, which
is the variable the experiments showed actually moves behaviour.

This also caps accretion without deleting anything: a new rule must name a
setting and a threshold, so it can no longer land at the top of every task by
default.

## What else a mode carries

Beyond rule order, a mode projects onto keys that already exist in
`settings.json`. Nothing new is invented as a substrate.

| Surface | What a mode sets | Why |
| --- | --- | --- |
| `rules/_active.md` | rule order (above) | the measured lever |
| `skillOverrides` | which skills are listed vs invocable-only | a mode's skills are the ones it routes to |
| `enabledPlugins`, MCP | capability set | `research` wants Zotero; `review` does not |
| `hooks` | mode-owned enforcement, over a core set | prose is guidance, hooks are guarantee |
| `model`, `effortLevel` | `spike` wants fast; `ship` wants max | cost and latency are per-posture |
| `permissions` | `review` denies Edit/Write outright | belt and braces with the hook |
| `statusLine` | shows the active mode at all times | mode-error prevention |

**Hooks are what make a mode more than a mood.** `review` blocks Edit and Write
at `PreToolUse`. `ship` blocks a completion claim at `Stop` until the test
command has run. `paper` resolves every DOI before a draft returns. `spike` runs
with most hooks off -- that is where its speed comes from, and it is honest
about the trade.

**Core hooks belong to no mode and no mode can remove them.** The git guard and
the staged-secrets check are active in `spike` exactly as in `ship`. `ccfg mode`
refuses to load a mode that disables a core hook; `ccfg doctor` fails if one is
missing. This is the safety boundary of the system.

## The ten modes

| mode | verify | claims | process | autonomy | code | subagents | voice |
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

`unattended` and `pair` differ only in `autonomy` and `voice` -- same task, same
skills, opposite postures. No capability toggle expresses that difference.

## Scope and resolution

Later layers win; the order is documented rather than emergent from file order.

1. **Core** -- rules and hooks belonging to no mode. Always active.
2. **Personal mode** -- `~/.claude/modes/<name>.yaml`
3. **Repo mode** -- `<repo>/.claude/modes/<name>.yaml`, overrides a personal mode of the same name
4. **Ad-hoc** -- `ccfg mode set verify=prove-it`, one setting, this session only

`<repo>/.claude/mode` names the repo's default, entered on session start. Repo
modes are committed files, so a team shares one posture.

## Application, and mode visibility

`CLAUDE.md` loads once per session, so file rewriting alone would need a restart
per switch. The `UserPromptSubmit` hook -- already registered here -- reads
`mode.lock` and injects the rendered rule set every turn.

Three consequences, all wanted: switches take effect immediately; the posture
survives compaction, unlike anything loaded once at session start; and the
primary band lands at the freshest position every turn, which is exactly the
lever the experiments identified.

For the human half of mode error, the mode renders in `statusLine` at all times.
Announcing it only at switch time is the documented failure of modal interfaces.

## Per-agent modes

An agent definition may declare `mode: research` in frontmatter; an `Agent` call
may override it. The subagent's rendered rule set is prepended to its prompt.

**Replace, do not inherit.** A subagent's rules are exactly its own mode's rules;
nothing leaks from the parent. Inheritance is how a search agent ends up carrying
commit-hygiene rules -- a live defect today.

## Agent-proposed rules

Agents may write only to `modes/proposed/`. A `PreToolUse` hook denies agent
writes to `modes/`, `rules/`, and `settings.json`.

`ccfg mode accept` rejects a proposal that does not carry an eval case
demonstrating the rule. An agent cannot propose a rule without proposing how to
falsify it.

Self-switching follows the same boundary: an agent may propose a mode change and
must not apply one.

## Files

```
~/.claude/
  modes/rules/<id>.md        atomic rules with setting frontmatter
  modes/<name>.json          personal modes
  modes/proposed/<id>.json   agent-writable; never auto-applied
  modes/_active.md           GENERATED -- all rules, primary band first
  mode.lock                  active mode, resolved settings, backup ref
<repo>/.claude/
  modes/<name>.json          project modes
  mode                       the repo's default mode
```

**The corpus does not live in `rules/`.** The harness auto-loads every
`~/.claude/rules/*.md` into the system prompt as global instructions. A corpus
placed there would load in full, in fixed order, in every session, whatever the
mode -- which is precisely the behaviour this design exists to replace. It also
would have doubled every rule against the hook's injection. Everything the mode
system owns sits under `modes/`, and reaches the model only through the hook.

Modes are JSON rather than the YAML this document first specified. `ccfg` has no
dependencies on purpose; a hand-rolled YAML subset is a parser to maintain in
exchange for syntax nobody asked for, and every other config file here is
already JSON.

`CLAUDE.md` keeps the universal rules and points at the generated file.

## CLI

```
ccfg mode                    show active mode and resolved settings
ccfg mode <name>             switch
ccfg mode set verify=prove-it   override one setting, this session
ccfg mode diff <a> <b>       compare two modes
ccfg mode list               available modes, personal and repo
ccfg mode proposals          list agent-authored proposals
ccfg mode accept <id>        promote a proposal after showing its diff
ccfg mode prove <name>       run the mode's eval suite
```

`--plain` strips styling for CI. Exit non-zero on an unknown mode or one that
would disable a core hook.

### Switch banner

The banner is a diff, so the flavour and the information are the same object.
Rows that do not change render without an arrow.

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

     rules    9 primary, 47 standing      (none dropped)
     hooks    git-guard, secrets-guard        [2 core]
              -verify-before-done              [1 off]
     model    opus -> opus    effort  high -> low

     POWERING UP
```

ANSI colour and block shading in the real renderer; no emoji, per the config's
own rule. `ccfg mode` with no argument renders the same table without arrows.

## Testing

Extends `ccfg test`, which already sandboxes via `CLAUDE_CONFIG_DIR`.

- Rendering: a corpus at a given setting puts exactly the expected ids in the primary band
- **No rule is unreachable**: every rule leads in at least one of the ten modes
- **No rule is ever dropped**: primary + standing always equals the full corpus
- Resolution order: repo overrides personal; ad-hoc overrides both
- Core hook protection: a mode disabling a core hook is refused
- Round trip: switch then revert restores `settings.json` byte-for-byte
- Proposal boundary: an agent-path write to `modes/` is denied
- Banner: `--plain` output is stable and parseable
- `ccfg doctor` fails when `mode.lock` and `settings.json` disagree

## Measurement

`ccfg mode prove <name>` wraps `claude plugin eval --ablation with-without
--runs N`. Because settings are ordinal, the informative run is a dose-response
sweep rather than an A/B.

Two rules learned the hard way, both now enforced in the harness:

- **A rate-limit notice is not a model response.** The runner deletes any output
  matching a limit notice and exits non-zero, so an unfilled cell stays unfilled
  instead of being graded as data. An earlier run was 99% contaminated and
  produced a confident, wrong result.
- **A grader that cannot recognise the correct answer produces inverted
  findings.** Before trusting a result, read the raw outputs of both the best and
  worst arms.

## Phasing

1. Rule format, renderer, `ccfg mode` show/switch/revert, lockfile, two modes
   (`spike`, `ship`). Tests.
2. `UserPromptSubmit` injection, statusLine, banner.
3. Remaining settings and the other eight modes.
4. Hooks per mode, over the protected core set.
5. Repo-level modes and repo defaults.
6. Per-agent modes.
7. Proposals.
