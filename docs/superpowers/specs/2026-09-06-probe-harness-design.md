# `ccfg probe` -- a test harness for the config itself

Status: design. Date: 2026-09-06.

## The problem

`ccfg test` runs unit suites: hooks, ccfg, broker. Deterministic code, deterministic
answers. It says nothing about the questions this config actually turns on --
does a rule change behaviour, does a hook fire in a live session, does the harness
load a directory.

Those got answered this session by six hand-rolled harnesses in a scratchpad
directory, each with its own `run.sh`, `grade.js` and `stats.js`. The duplication
was not cosmetic. Two failures came directly out of it:

- **A rate-limit notice was graded as model output.** "You've hit your session
  limit" landed in the output files and scored as a clean trial. One run was 99%
  contaminated and produced a confident, wrong result that had already been
  reported before it was caught. The fix had to be applied to each `run.sh`
  separately, because there were six of them.
- **A grader that could not recognise the correct answer inverted a finding.**
  The commit-message grader classified the real violation under a different check
  than the one the probe was keyed on, so the arm that broke the rule scored as a
  pass. The reported conclusion -- that a rule caused the behaviour it forbade --
  was wrong and had to be retracted.

Both are harness bugs, not analysis mistakes, and both are the kind that produce
a confident answer rather than an error. That is what makes them worth designing
against.

## What it is

`ccfg probe` runs **behavioural** checks against this config, as opposed to
`ccfg test`, which runs unit suites. A probe asks one question and answers it
with evidence.

Three kinds, by cost:

| kind     | what it does                                         | cost                          | example                                                   |
| -------- | ---------------------------------------------------- | ----------------------------- | --------------------------------------------------------- |
| `oracle` | pure computation over the config on disk             | milliseconds                  | is the rule corpus faithful to its source in `CLAUDE.md`? |
| `live`   | one real invocation, deterministic answer            | seconds, one API call         | does the harness auto-load `rules/*.md`?                  |
| `model`  | arms x tasks x reps, graded, tested for significance | minutes to hours, real budget | does a mode change what the model does?                   |

Everything is a probe so everything shares one runner, one contamination guard,
one significance test, and one report format. A fix to the guard fixes it
everywhere, which is exactly what six copies of `run.sh` prevented.

## A probe is a module

`probes/<name>.js` exports a descriptor. Logic lives with the probe rather than
in a central switch, so adding a probe never means editing the runner.

```js
module.exports = {
  name: "rules-autoload",
  kind: "live",
  question:
    "Does the harness load ~/.claude/rules/*.md into the system prompt?",
  // Why the answer matters, in one line. Printed with the result, because a
  // probe whose stakes nobody remembers gets deleted the first time it is slow.
  why: "The mode corpus was moved out of rules/ on the assumption that it does.",
  async run(context) {
    return { pass: true, answer: "yes", evidence: "..." };
  },
};
```

A `model` probe additionally declares `arms`, `tasks`, `reps`, `grade`, and
`fixtures`.

## The three guards

These are the design. Everything else is plumbing.

**1. A rate-limit notice is not a model response.** The runner discards any
output matching a limit notice and leaves the cell unfilled rather than grading
it. Unfilled cells are counted and printed. A probe with any unfilled cell reports
`INCOMPLETE`, never a result. The failure this prevents is not a crash -- it is a
clean-looking table built from text the model never wrote.

**2. A grader must be shown to work before it is trusted.** Every `model` probe
ships `fixtures: {clean, violating}` -- one output that must grade clean and one
that must grade as a violation. The runner checks both **before spending any API
budget** and refuses to run if either is wrong. A grader that cannot tell the two
apart cannot produce a finding, only a number.

**A fixture must share the shape of real output, not the shape of the ideal
answer.** The first version of the commit probe used bare one-line strings. The
gate passed. Every real reply then arrived as a fenced block behind a paragraph
of preamble, the grader linted the preamble, and both arms scored 100% -- a
result that looked like a strong null and was entirely an artifact. Write the
fixture as the model would actually answer, fence and preamble included.

**3. A declined task is not a violation.** A grader returning `declined: true`
takes the cell out of the denominator and into its own column. This is not
bookkeeping: in the commit probe the ruled arm correctly refused to invent fault
names the prompt never supplied -- the rule working exactly as written -- and the
grader scored every refusal as a bad subject, making the rule look 45 points
weaker than it is. Once refusals were separated and the task was given the facts
it had been withholding, the same rule measured 66 points.

**4. Raw output is kept and shown.** `--inspect` dumps the actual model output
from the best and worst arms. The retracted finding survived three reports
because nobody read what the model actually wrote; the numbers looked fine. The
report prints a standing reminder to read them before acting on a delta.

## Reporting

Every `model` probe reports arm counts, rate, a two-proportion z-test against the
control arm, and a 95% confidence interval. Never a bare percentage.

Three verdicts, and no others:

- `RESULT` -- every cell filled, fixtures passed, p < 0.05.
- `NO EFFECT` -- every cell filled, fixtures passed, p >= 0.05. Reported with the
  interval, because "no effect" at n=12 and at n=576 are different claims.
- `INCOMPLETE` -- an unfilled cell, or a fixture failure. No numbers printed.
  A partial run is not a weak result; it is not a result.

`oracle` and `live` probes report `PASS` / `FAIL` / `UNKNOWN`, with the evidence
inline. `UNKNOWN` exists because "the probe could not tell" must be
distinguishable from "the answer is no" -- collapsing those is how an untested
assumption becomes a fact.

## Cost

Model probes spend real money. So:

- `--dry-run` prints the cell count and the command it would run, and spends nothing.
- A run over a threshold (default 100 cells) refuses without `--yes`.
- Runs are resumable: a filled cell is skipped, so an interrupted run is not a
  restart.

## CLI

```
ccfg probe                       list probes with their kind and last verdict
ccfg probe run <name>            run one
ccfg probe run --kind oracle     run every probe of a kind
ccfg probe run --all             everything, cheapest kind first
ccfg probe inspect <name>        raw output: violating and clean cells, per arm
ccfg probe clean <name>          discard results and start over
```

Cheapest first is deliberate: an `oracle` failure usually invalidates the
assumption a `model` probe was about to spend an hour testing.

## Layout

```
~/.claude/
  probes/<name>.js         probe definitions
  tools/probe/probes.js    load and validate descriptors
  tools/probe/runner.js    execute, guard, resume
  tools/probe/stats.js     two-proportion z-test, confidence intervals
  tools/probe/report.js    verdicts and formatting
  tools/probe/command.js   ccfg probe dispatch
  cache/probe/<name>/      raw output, one file per cell
  tools/test-probe.js      the harness's own regression suite
```

The harness gets its own tests, including a deliberately broken grader that the
fixture gate must reject and a captured rate-limit notice the contamination guard
must discard. Both are regression tests for failures that actually happened.

## What this does not do

- **It does not replace `ccfg test`.** Unit suites stay where they are.
- **It does not decide whether a finding is real.** It reports an interval and
  hands over the raw text. Three findings in this config have now passed every
  numeric check and been wrong; all three were obvious in a single cell of raw
  output. `inspect` prints violating *and* clean cells for every arm, because
  reading only the failures is how a grader that flags everything looks like a
  strong effect.

- **It does not sandbox the filesystem.** `--safe-mode` drops CLAUDE.md, skills,
  plugins, hooks and MCP, but not the working directory. Cells therefore run in a
  scratch directory: one probe run from the config repo read the operator's
  uncommitted diff and answered from that instead of from the task.
