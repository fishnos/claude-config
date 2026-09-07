# Rule adherence: what the experiments found

Date: 2026-09-04. Model: Opus 5. 1,218 valid trials across three suites.

## Method

Substrate: `claude -p --safe-mode --max-turns 1`, which disables CLAUDE.md,
skills, plugins, hooks and MCP, so the injected rule set is the only independent
variable. Arms are supplied with `--append-system-prompt-file`.

Graders are deterministic. Commit domain uses the config's own
`hooks/lib/commit-message.js` `lint()`. Naming domain splits each identifier on
camelCase and requires every segment to be an English word (`/usr/share/dict/words`)
or an accepted technical term, excluding identifiers already present in the
fixture. No LLM judge anywhere.

## Finding 1: position dominates, not volume and not conflict

576 trials. Six arms crossed with 12 tasks stratified by change size.

| arm | lines | relevant rules at | clean |
| --- | --- | --- | --- |
| bare | 0 | -- | 40% |
| full-noprose | 198 | buried | 50% |
| full | 211 | buried (line 145) | 59% |
| padded | 195 | top | 77% |
| scoped | 22 | top | 82% |
| full-first | 212 | top | **85%** |

- `full-first` vs `full`: **+26.0pp, p<0.0001**
- `full-first` vs `scoped`: +3.1pp, p=0.56 -- indistinguishable

Hoisting the relevant section to the top of the full 211-line prompt fully
recovers scoped-level adherence while keeping every rule. Length is not the
problem; burial is. The mechanism is visible in one check: body-wrap failures run
36-44% when the rule is buried and 8-15% when it is early -- burial makes a rule
obeyed *less often than having no rule at all* (bare: 21%).

Replicated independently in the naming domain: 29% violation buried vs 8% early,
p=0.0089.

## Finding 2: a rule is not redundant until it has been tested under pressure

Neutral prompts showed zero naming violations in every arm, including `bare`,
which reads as "the rule is redundant". That reading was an artifact of an easy
test. Re-run with the model asked to add a function to a file that already uses
`cfg`, `ctx`, `buf`, `thr`:

| arm | abbreviation violations |
| --- | --- |
| bare | 52% |
| full (rule buried) | 29% |
| scoped (rule early) | 8% |

- `bare` vs `scoped`: **+43.8pp, p<0.0001**
- `bare` vs `full`: +22.9pp, p=0.022

The naming rule is strongly load-bearing. It is invisible in a neutral test and
decisive under the conditions that actually occur in a repository.

Same pattern in the commit domain, where six of nine rules had never fired in 210
neutral trials. Under targeted temptation:

| rule | bare | with rule | verdict |
| --- | --- | --- | --- |
| trailing-period | 100% | 0% | load-bearing |
| body-too-long | 63% | 0% | load-bearing |
| counted-placeholder | 0% | 25-63% | **backwards** |
| effect-led | 0% | 0% | still untested |
| non-imperative | 0% | 0% | still untested |
| no-blank-line | 0% | 0% | still untested |

## Finding 3: one rule causes the behaviour it forbids

The counted-placeholder rule reads, in part: *"Counting is the worst version of
this -- if you knew there were three, you knew what they were, so name them or
split the commit."*

Given four unrelated fixes sharing no common noun, the model **never** produced a
counted placeholder with no rules loaded. With the rule present it did so 25-63%
of the time, in every arm carrying the rule. Naming the forbidden pattern appears
to make it available; the prohibition is supplying the failure.

This is the clearest actionable defect the experiments found. The rule should be
rewritten to state the requirement positively -- name the thing -- without
exhibiting the pattern it bans.

## Finding 4: hypotheses that did not survive

- **The Explaining section causes wrap failures.** Refuted. Removing it made
  things worse (-9.4pp, p=0.19) and produced the worst wrap rate in the study.
- **Volume degrades adherence.** Not supported: 195 lines performed like 22
  (-5.2pp, p=0.37). Caveat: that arm also had its rules early, so it confounds
  volume with position and does not independently clear volume.
- **The penalty is specific to trivial changes.** Partly. Trivial +29.2pp
  (p=0.002), substantial +16.7pp (p=0.059) -- larger on small changes, present in
  both. `full-first` was 100% clean on substantial changes.

## What this changes about the mode system

**A mode should reorder rules by relevance, not remove them.** Position accounts
for the whole effect, so a mode can put the right rules first and keep everything
else below. Nothing is ever dropped, which removes the system's main risk -- a
mode silently disabling a guardrail. The `UserPromptSubmit` injection is the
right vehicle because it re-asserts the active ordering at the freshest position
every turn.

It also explains the config's history: CLAUDE.md degraded as it grew not because
of line count but because new sections pushed older ones into the middle.

## An integrity note

The first pressure run was 37% contaminated and the first naming run 99%
contaminated by rate-limit notices captured as model output; the grader scored a
notice with no code as a clean trial. Every number here is from a re-run verified
at 0% contamination. `run.sh` now deletes any output containing a limit notice
and exits non-zero, so an unfilled cell stays unfilled rather than becoming data.

Two grader defects were also found and fixed: a blocklist that could not catch
novel abbreviations (`wSum`, `getWtdAvgPos`), and a dictionary lacking plurals and
participles that flagged `groups` and `flushed` as violations.

## Still open

`effect-led`, `non-imperative` and `no-blank-line` never fired at baseline even
under deliberate temptation. Either they are unnecessary on this model or the
temptation was too weak; the two cannot be separated without harsher prompts.

Generalisation beyond commit messages and identifier naming is untested.
