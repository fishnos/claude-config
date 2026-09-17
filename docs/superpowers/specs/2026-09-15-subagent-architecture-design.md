# Subagents that carry the mode: a rendered crew, a declared scope, and gates that read evidence

Date: 2026-09-15
Status: approved in outline 2026-09-15 (architecture A); this is the design spec.
Amended 2026-09-16 after re-measuring on 2.1.273: the gates now answer at two
points, because auto mode delivers a worker's report before `SubagentStop` fires
(section 4). The operator chose that design on 2026-09-16.
Implementation plan: `docs/superpowers/plans/2026-09-16-subagent-architecture.md`.
Nothing built.
Repo: `~/.claude` (public)
Builds on: `docs/superpowers/notes/2026-09-14-subagent-reliability-survey.md` (the
five mechanisms and the measurement literature) and the feasibility spike of
2026-09-15 recorded in `.claude/state.md`.

## The problem, stated concretely

A subagent is a second Claude session this one starts to do a piece of work. It
gets a written brief and returns a prose report. Two things go wrong with it in
this configuration.

1. **The standing rules do not reach it.** The operator's words: "the input is
   ultimately not the same." The file that holds the active rules
   (`rules/_active.md`, assembled by `ccfg mode`) is loaded for the session that
   starts it, not for the worker it spawns.
2. **It reports verifications it did not run.** Across tasks 1 to 7 of the
   context-management build the reviewers found no naming violation and no scope
   creep, so briefing works. What failed was different in kind: one implementer's
   report asserted a test outcome that the reviewer disproved by re-running the
   exact command.

The operator's framing for the fix, 2026-09-15: "the whole cyberpunk mode thing
is meant for subagents to use." A dispatch should run a worker _in a mode_, and
the mode should carry the rules, the tool denials, the hidden skills and the
spawn policy. Their requirement on top: the whole thing must be extremely easy to
modify, extend and use.

## Principle

**A rule leaves a worker's prose brief only when a gate has taken it over.**

The existing renderer states the opposite principle for the main session, and
says why in its own header (`tools/modes/render.js:3-12`): a mode re-sorts the
25-rule corpus and never removes from it, because a guardrail disabled in silence
would make the mode system a liability.

That principle cannot survive being copied to a worker. The measurement
literature in the survey is blunt about it: adherence "uniformly approaches zero
as the number of guardrails increases" past roughly five
(https://arxiv.org/html/2502.12197v1, peer-reviewed), and across 707 real agent
prompts averaging 11.9 constraints the rate at which _every_ constraint held was
27.2% (https://arxiv.org/html/2505.16944v1). Handing a worker all twenty-five
rules predicts partial compliance with an unpredictable subset, which is worse
than a short brief because nobody can say which subset.

So a worker gets a short brief, and the rules that leave the brief are not
dropped: they move from prose into deterministic enforcement, which is the one
intervention with strong numbers (over 90% of unsafe executions prevented, at
about 3 milliseconds against a 25-second agent step,
https://arxiv.org/html/2503.18666v2). Section 6 makes that swap checkable rather
than a promise.

## What is already measured, and on which build

The feasibility spike of 2026-09-15 ran two headless sessions on build 2.1.270 and
settled the mechanics. **It was re-run on 2.1.273, the build this machine now
runs, on 2026-09-16** (four headless sessions, $0.58), and the column on the right
is that re-run. The next Claude Code update reopens all of it, which is the drift
section 7 exists to catch.

| Mechanism                                                 | 2.1.270                                                                                                                                                                       | 2.1.273                                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| An agent definition file's body reaches the worker        | Yes, token `BODY-SEEN-4471` returned                                                                                                                                          | Yes                                                                                                                                       |
| `SubagentStart` can inject text into the worker's context | Yes, via `additionalContext`                                                                                                                                                  | Yes                                                                                                                                       |
| `SubagentStart` can read the dispatch brief               | **No.** Its payload carries `agent_id`, `agent_type`, `cwd`, `prompt_id`, `session_id`, `transcript_path` and not the prompt                                                  | Not re-checked                                                                                                                            |
| `PreToolUse` `updatedInput` rewrites an `Agent` dispatch  | **Yes.** The survey's central blocker (anthropics/claude-code#44412, closed as a duplicate 2026-04-10) did not reproduce                                                      | Yes                                                                                                                                       |
| Payloads fired inside a worker name the worker            | **Yes** on `PreToolUse`: `agent_id` and `agent_type`                                                                                                                          | Yes on `PreToolUse`, `PostToolUse`, `SubagentStart` and `SubagentStop`                                                                    |
| `PostToolUse` fires inside a worker                       | Not observed                                                                                                                                                                  | Yes for `Write` and `Bash`; not for a call a hook denied                                                                                  |
| Two parallel workers keep separate identities             | Not tested                                                                                                                                                                    | Yes, each write carried its own worker's `agent_id`                                                                                       |
| Frontmatter `tools:` restricts the worker's tool list     | Yes by two signals, though no denial error was observed, so "harness-enforced rather than model-honoured" is the reading and not the observation                              | A `tools: Read` worker listed its tools as exactly `Read` though nothing it was shown names them; harness filtering is inferred from that |
| Frontmatter `skills:` and `omitClaudeMd:`                 | Not tested                                                                                                                                                                    | `skills:` injects the full skill text, plugin-qualified names included; `omitClaudeMd: true` keeps `CLAUDE.md` out of a custom agent      |
| `SubagentStop` can refuse a finish and the retry lands    | Yes, with `{decision:"block",reason:...}`; payload carries `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, `stop_hook_active`, `permission_mode` | Yes outside auto mode. **Not in auto mode**, see below. New payload keys: `background_tasks`, `session_crons`, `effort`                   |
| The run token is recoverable when the worker omits it     | Not tested                                                                                                                                                                    | Yes: one worker left it out of its report; the first `user` line of its own transcript is the dispatch prompt, token included             |

**Auto mode moves where a report arrives, measured on Sonnet** (Haiku cannot run
auto mode: the debug log says so and falls back to the default mode). The worker
reports by calling a tool named `SubagentHandback`, whose `tool_input.message`
holds the whole report. The report reaches the parent at that call, before
`SubagentStop` fires, and `last_assistant_message` at `SubagentStop` is only
"Task complete and handed back to caller." A `SubagentStop` block still sends the
worker back, but its second hand-back returns `success: false` with "Nothing was
sent: your report was already delivered (SubagentHandback delivers one report)",
so the parent keeps the unchecked first report. What does work: a `PreToolUse`
deny on `SubagentHandback` withholds the report, the worker corrects it and hands
back again, and the parent receives the corrected one. A delivered hand-back then
fires `PostToolUse` with `tool_response.success: true`. The one worker measured
wrote the finish block on a single line, fields separated by commas.

Two constraints from the official subagent documentation, fetched 2026-09-15,
that shape the design: a subagent's own frontmatter `hooks:` block is skipped for
project-level agents until the workspace trust dialog is accepted, and a headless
`-p` session never counts as trusted, while **user-level agents in
`~/.claude/agents/` run their hooks without that step**. And `permissionMode` in
frontmatter is silently dropped whenever it would widen the inherited permission
mode (the binary carries the warning text and the telemetry event
`tengu_agent_frontmatter_mode_widening_carry_ignored`). Narrowing is unaffected.

## 1. The crew: roles rendered per mode

A **role** is what kind of worker this is: one that writes code, one that only
reads, one that reviews. It is a file. `modes/roles/implementer.md`,
`modes/roles/investigator.md`, `modes/roles/reviewer.md`.

The file format is the one `modes/rules/` already uses: a `---` header of a few
fixed keys read by regular expression rather than YAML (the parser lives at
`tools/modes/rules.js:20-71` and exists because this tool set has no
dependencies), then a body of prose.

```
---
id: implementer
description: Writes code against a written brief. Picked for build tasks.
tools: Read, Grep, Glob, Edit, Write, Bash, TodoWrite
skills: superpowers:test-driven-development
gates: finish-shape, scope, evidence
---

<the role's standing instruction, in prose>
```

`ccfg mode` gains a second output beside `rules/_active.md`: it writes
`~/.claude/agents/<id>.md` for every role, rendered against the mode in force.
That path is the user-level one, which is what makes per-agent frontmatter hooks
available should they ever be needed (see the trust rule above). The renderer
lives at `tools/modes/crew.js` and is called from `applyMode`
(`tools/modes/apply.js:217`) right where `renderTo` already writes the rules
file, so one command keeps both outputs in step and a mode switch regenerates
both.

What the mode contributes to each rendered agent file:

- **`tools:`** is the role's allowlist minus the mode's denied tools
  (`glitch.tools.deny`, already parsed at `tools/modes/glitch.js:82-97`). An
  allowlist is used rather than `disallowedTools:` because the allowlist is the
  one the spike exercised.
- **`skills:`** is the role's own list, capped at two entries. The documentation
  is explicit that `skills:` injects the full skill content and not the
  description, so a generous list would spend the worker's context before it
  reads its brief.
- **`effort:`** is the mode's pinned effort level (`mode.projects.effortLevel`),
  so a release posture buys a worker the same thinking the session gets.
- **`model:`** is left unset. The mode system freezes model choice at session
  start by design (`tools/modes/glitch.js:6-16`), and a worker inheriting the
  session model keeps that one rule.
- **The body** is the role's prose, then the scope-of-consent sentence
  (section 2), then the short rule band (section 6).

A mode that sets `subagents: "none"` renders no crew at all, because
`hooks/mode-guard.js:53-60` already denies the `Agent` and `Task` tools outright
in that posture. Nothing new is needed there.

Adding a role is one file. That is the whole extension story.

## 2. The dispatch: a scope line and a run token

Stripping the sentence that states the scope of consent out of otherwise
identical prompts took Claude Code from 0.0% to 17.1% out-of-scope actions
(p = 2.4 x 10^-4, https://arxiv.org/html/2605.18583v1, preprint). That is the
strongest prompt-level result in the whole survey and it costs one sentence.

`hooks/agent-dispatch.js` runs on `PreToolUse` for the `Agent` and `Task` tools
and does three things.

1. **It requires a scope line from the dispatcher.** A literal line in the
   dispatch prompt naming the file patterns the worker may change:
   `Scope: hooks/state-restore.js, tools/test-hooks.js`. Missing at
   `verify: proven` or `verify: tested` is a denial that says exactly what to
   add. At `verify: none` it is a warning, and the hook staples
   `Scope: (undeclared)` on instead.
2. **It mints a run token** (eight hex characters) and staples it plus the
   contract onto the prompt through `updatedInput`, which the spike proved works
   on this tool. The contract is four lines: touch only the scope, end with a
   finish block, name a terminal state, cite a command for any claim about
   behaviour.
3. **It opens a run record** at `cache/crew/<session_id>.jsonl` holding the
   token, the declared scope, the role, and the repository's `HEAD` at dispatch.

The run token exists to solve a join. `SubagentStart` and `SubagentStop` know the
worker by `agent_id`; the dispatch hook fires before the worker exists and never
sees an `agent_id`. Rather than guess at a shared identifier, the token travels
**through the prompt** and comes back in the worker's report: the text of its
final message outside auto mode (`last_assistant_message` at `SubagentStop`), or
the `message` of its `SubagentHandback` call in auto mode. The join is then exact,
and it needs no payload field beyond the ones the spike observed. A worker that
leaves the token out of its report can still be joined: the first `user` line of
its own transcript is the dispatch prompt, token included.

The finish block the contract asks for is deliberately four short lines at the
very end, after whatever prose the worker wants to write:

```
RUN a1b2c3d4
STATE done
TOUCHED hooks/state-restore.js, tools/test-hooks.js
EVIDENCE node tools/test-hooks.js
```

The same four fields on one line, separated by commas, parse the same way,
because that is how the one measured auto-mode worker wrote them.

`STATE` takes one of four words borrowed from the Agent2Agent protocol: `done`,
`blocked`, `rejected`, `input-required`. The last two matter because the largest
single failure mode in the MAST taxonomy is "fail to ask for clarification" at
11.65%, and a worker reporting only in prose has no way to say it declined the
work or needs an answer.

**The tradeoff, named rather than hidden:** format restriction measurably
degrades reasoning (https://arxiv.org/pdf/2408.02442, peer-reviewed). That is why
the structure is four lines at the end and not a schema the whole reply must fit.

## 3. The run record: what a worker actually touched

`hooks/subagent-trace.js` runs on `PostToolUse` for `Edit`, `Write` and `Bash`,
and appends the path a call touched to the run record **keyed on the `agent_id`
in the payload**. The spike measured that field arriving inside a worker; this is
the one design element that rests on it.

This is what makes the scope gate precise instead of approximate. Diffing the
repository at finish would attribute to one worker whatever a sibling worker
changed in the same checkout at the same time. Attributing per `agent_id`
attributes correctly, and a payload carrying no `agent_id` is the main session
acting, which is recorded and never gated.

The record is in `cache/`, which `.gitignore:115` already excludes, so nothing
here reaches the public repository.

## 4. The gates

`hooks/subagent-gate.js` is the gate runner. It loads the gate modules from
`hooks/subagent/gates/`, runs the ones the role named, and refuses on the first
failure with a reason that says what is missing and what to do about it. One file
per gate, the directory is the registry, the same shape as `modes/rules/`.

**It answers at two points, because a report arrives at one of two places**
(measured, see "What is already measured" above):

- **In auto mode, on `PreToolUse` for `SubagentHandback`.** The report is
  `tool_input.message`, and a refusal is a deny. A deny withholds the report, so
  the parent never receives an unchecked one.
- **Otherwise, on `SubagentStop`.** The report is `last_assistant_message`, and a
  refusal is a block.
- **On `PostToolUse` for `SubagentHandback`, it only takes notes.** When
  `tool_response.success` is true, it records in the run record that this
  `agent_id` delivered its report. A later `SubagentStop` for that `agent_id` is
  allowed without running any gate: the report already reached the parent, and a
  block there only sends the worker back to a hand-back the harness refuses.

Gating only at `SubagentStop` is what the measurement ruled out: in auto mode it
fires after the parent has the report. Gating only at the hand-back would miss
every worker outside auto mode, which never calls that tool. Marking delivery at
`PostToolUse` rather than at an allowed `PreToolUse` keeps one case honest: if
another hook denies the hand-back after the gate passed it, nothing was
delivered, and the stop that follows is still gated.

Each gate module exports `{ id, minimumVerify, check(run) }` and returns either
`{ ok: true }` or `{ ok: false, reason }`.

**`finish-shape`.** The report carries the run token and a `STATE` word.
Nothing semantic, just the shape, so every later gate has something checkable to
read. A worker that returns prose only is refused, and the refusal shows the
template.

**`scope`.** Every path in the run record matches the declared scope, or a
deviation line in the finish block names it with a reason. This is the direct
answer to scope creep and needs no cooperation from the model beyond one line.

**`evidence`.** When the traced paths include runtime code and the finish block
claims `STATE done`, the run must cite a command that actually ran after the last
write to those paths. The citation is checked against
`cache/evidence/<session>.jsonl`, which `hooks/evidence-log.js` writes from real
`Bash` calls.

That last gate is the whole answer to "claimed a verification it never ran", and
it is worth being precise about why it works. The evidence log is not the
worker's account of what it did. It is written by a hook from tool calls that
really happened. The survey's mechanism 4 calls this making the verification
record a policy surface no worker may write. Half the plumbing already exists.

**And the log has to be genuinely unreachable, or the gate is theatre.** A tool
allowlist does not deliver that on its own: the `implementer` role carries `Bash`
and `Write`, so a shell redirect, a heredoc or a node one-liner reaches
`cache/evidence/` however the allowlist is drawn. So a second hook,
`hooks/agent-guard.js`, runs on `PreToolUse` for every tool and does one thing:
**when the payload carries an `agent_id`, any call whose target resolves under
`cache/evidence/` or `cache/crew/` is denied.** For `Edit` and
`Write` that is the file path; for `Bash` it is a match against the command text,
which is a weaker check and is stated as weaker here. The main session is
unaffected, because its payloads carry no `agent_id`. This is the one place the
design depends on the spike's `agent_id` measurement for a security property
rather than for bookkeeping, and section 10 lists it as such.

**`review` (only at `verify: proven`).** A reviewer worker receives the diff and
nothing else, launched from the `reviewer` role whose `tools:` is `Read`, `Grep`,
`Glob`. It never sees the brief, which is the point: a reviewer that knows the
goal rationalises toward it.

**What the reviewer is not for, and this is the sharpest finding in the survey.**
On false completion claims, where an agent asserts a success the environment
contradicts, no LLM-judge configuration exceeded AUROC 0.65, because judges
anchor on confident closing language, which is exactly what a false success
produces (https://arxiv.org/html/2606.09863). The best frontier model scores 11%
at localising errors in agent traces (https://arxiv.org/abs/2505.08638). So the
reviewer judges code quality, and the `evidence` gate judges claims. Never the
other way round.

**Bounded retry.** A refusal hands the reason back and the worker gets another
turn, which the re-run confirmed lands at both points. The runner stops after two
of its own refusals per `agent_id`, **counted in the run record across both
points**, so a worker denied twice at hand-back is not blocked a third time at
`SubagentStop`. The count lives in the record because `stop_hook_active` only
says a stop hook is already running (the harness overrides a stop hook after
more than eight blocks in a row: `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP ?? 8` in the
program text of 2.1.273 and 2.1.274), and no cap on hand-back denials was
observed at all. The
second reason is more specific than the first: the first names the gate, the
second quotes the exact `RUN` line the worker should have written, read from its
transcript when its report left the token out.

## 5. Strictness comes from the dials already there

No new dial. A mode declares seven settings and the renderer sorts the corpus
from them (`tools/modes/render.js:22-40`); two of them already mean exactly what
a gate needs.

| Mode dial         | What it already means       | What the gates do with it                                            |
| ----------------- | --------------------------- | -------------------------------------------------------------------- |
| `verify: none`    | no proof required           | gates warn, never block; the scope line is optional                  |
| `verify: tested`  | a command ran               | `finish-shape` and `scope` block; `evidence` blocks on runtime paths |
| `verify: proven`  | evidence cited              | all of the above, plus the blind `review` gate                       |
| `claims: loose`   | unlabelled                  | `EVIDENCE` may be absent                                             |
| `claims: labeled` | measured against assumed    | `EVIDENCE` present or `STATE` is not `done`                          |
| `claims: sourced` | a command behind each claim | the cited command must appear in the evidence log                    |

So RECON (the exploratory posture, `verify: none`, `subagents: none`) spawns no
workers at all, RUNNER (the daily posture, `verify: tested`) blocks on scope and
evidence, and FIXER (the release posture, `verify: proven`, `claims: sourced`)
adds the blind reviewer. Nobody edits a gate to change any of that.

## 6. The rule corpus gets one new field

The principle in section 1 is only worth something if it is checkable. Each of
the 25 rule files in `modes/rules/` gains one header field:

```
worker: brief          # goes into every worker's prose brief
worker: gate:scope     # a gate enforces this; it leaves the prose
worker: n/a            # meaningless to a worker (session-length rules, for example)
```

`hooks/validate-config.js` gains a check that every rule carries one of the
three, and that every `gate:<id>` names a gate module that exists. A rule cannot
quietly fall out of a worker's brief without someone writing down where it went.

The expected split, to be settled during the build rather than assumed here:
`asking-touch-only-what-was-named` and `claims-end-with-the-split` become
`gate:scope` and `gate:evidence`; `verify-not-delegable` and
`subagents-never-self-verify` become `n/a` for a worker that cannot spawn;
`voice-caveman` and the naming rules stay `brief` because no gate reads prose
style. Target for the brief band: **five rules or fewer**, which is where the
guardrail-count evidence puts the ceiling.

## 7. The conformance log

This is the operator's standing request, in their words: "is there a way to just
test this in actual usage? i dont want to spend extra tokens right now. i think
thats actually useful for any future updates to this config." It is folded in
here rather than specified separately because it is this design's drift detector:
the jump from 2.1.270 to 2.1.273 moved where an auto-mode report arrives, and only
a paid re-run caught it. Split it out if that reads as scope creep.

Every hook above already writes a run record. The conformance log is one extra
line per record naming which assumptions held: did `updatedInput` actually reach
the worker (the run token came back, in the report or in the worker's
transcript), did `agent_id` appear in the inner `PostToolUse` payloads, did a
report reach a gate at either point, was a denied hand-back retried and then
delivered, did the worker's transcript sit where the hand-back fallback looked for
it. `ccfg conformance` reads the log and prints each assumption as **confirmed**,
**contradicted**, or **not yet observed**, with the build number it was last seen
on. The build comes from the `version` field that every line of a worker's
transcript carried on 2.1.273.

It costs nothing, because it rides dispatches the operator was going to make
anyway, and it is the thing that notices when a Claude Code upgrade moves a field
out from under this design.

## 8. Components

| File                        | Event                                                                | What it does                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `modes/roles/*.md`          | none                                                                 | The role corpus. New file adds a worker type.                                                                                |
| `tools/modes/roles.js`      | none                                                                 | Parses a role file. Mirrors `tools/modes/rules.js`.                                                                          |
| `tools/modes/crew.js`       | none                                                                 | Renders `~/.claude/agents/*.md` from roles plus the mode.                                                                    |
| `tools/modes/apply.js`      | none                                                                 | Changed: calls the crew renderer beside `renderTo`.                                                                          |
| `hooks/agent-dispatch.js`   | `PreToolUse` on `Agent`, `Task`                                      | Requires the scope line, staples the contract and run token, opens the run record.                                           |
| `hooks/agent-guard.js`      | `PreToolUse` on every tool                                           | Denies any call from a worker whose target is the evidence log or the run record.                                            |
| `hooks/subagent-brief.js`   | `SubagentStart`                                                      | Injects the brief band and the contract as `additionalContext`.                                                              |
| `hooks/subagent-trace.js`   | `PostToolUse` on `Edit`, `Write`, `Bash`                             | Records which paths this `agent_id` touched.                                                                                 |
| `hooks/subagent-gate.js`    | `SubagentStop`; `PreToolUse` and `PostToolUse` on `SubagentHandback` | Runs the gates wherever the report arrives, blocks or denies with a reason, records a delivered hand-back, bounds the retry. |
| `hooks/subagent/gates/*.js` | none                                                                 | One gate per file. The directory is the registry.                                                                            |
| `hooks/validate-config.js`  | none                                                                 | Changed: every rule carries a `worker:` classification.                                                                      |
| `tools/ccfg.js`             | none                                                                 | Changed: `ccfg crew` prints the rendered crew, `ccfg conformance` prints the assumption table.                               |

`~/.claude/agents/*.md` is generated and committed, the way `rules/_active.md`
and `SKILL-INDEX.md` already are. `cache/crew/` is ignored.

## 9. Testing

Hook cases go in `tools/test-hooks.js` beside the existing 467, each watched red
before its code exists. The ones that carry the design:

- A dispatch with no scope line is denied at `verify: tested` and allowed with a
  warning at `verify: none`.
- A dispatch prompt comes back from `updatedInput` carrying a run token that was
  not in the original.
- A finish block whose token matches the record joins; one whose token does not
  is not attributed to that run.
- A `PostToolUse` payload carrying no `agent_id` is recorded as the main session
  and never gated.
- A worker that wrote outside its declared scope is blocked, and the same worker
  with a deviation line naming the file is allowed.
- A `STATE done` citing a command absent from the evidence log is blocked at
  `claims: sourced` and allowed at `claims: labeled`.
- The second refusal on one `agent_id` quotes the exact `RUN` line, and there is
  no third, whichever point the first two came from.
- A hand-back whose message has no finish block is denied, and one that has it is
  allowed.
- A `SubagentStop` for a worker whose hand-back was delivered is allowed without
  gating, even though its last message carries no finish block; a hand-back that
  came back `success: false` does not count as delivered.
- A finish block on one comma-separated line is allowed exactly as the four-line
  form is.
- A missing worker transcript leaves the second refusal naming the template, and
  never crashes the runner.
- A rule file with no `worker:` field fails the validator.
- A role whose `tools:` names a tool the mode denies renders without it.
- A `Write` to `cache/evidence/` is denied when the payload carries an `agent_id`
  and allowed when it does not, and the same for a `Bash` command that names that
  path through a redirect, a heredoc and a node one-liner.

Two counterweights, because a gate that never passes is as bad as one that never
fires: a clean run through every gate must come back allowed, and deliberately
over-tightening each gate must turn a passing case red.

**Live check, no extra spend.** Dispatch one real investigator worker from an
auto-mode session on a model that supports auto mode (Haiku does not), so the
hand-back point is the one exercised, and read `ccfg conformance`. It is also the
first run that loads a crew agent from `~/.claude/agents/`, which nothing has
measured yet (section 10).

## 10. Not yet verified

Stated plainly because the whole design leans on them.

- **Everything above was re-measured on 2.1.273 except where the table in "What
  is already measured" or this list says otherwise.** The next Claude Code
  update reopens it; section 7 is how that gets noticed for free. The `claude`
  command here moved to 2.1.274 on 2026-09-16. Its program text still carries
  `SubagentHandback`, `stop_hook_active` and the same block cap, but no session
  was run on it.
- **Loading an agent from `~/.claude/agents/` has never been measured.** Both
  spike runs used project-level agents in a scratch directory. A headless run
  that loads only project and local settings (`--setting-sources project,local`)
  reported a user-level agent as not available, and the retry with user settings
  loaded was refused by the auto-mode permission check and did not run. The live
  check in section 9 is the first run that settles it.
- Six frontmatter fields have never been exercised here and are documentation
  only: `disallowedTools:`, `maxTurns:`, `permissionMode:`, `isolation:`,
  `memory:`, `mcpServers:`. The renderer writes none of them.
- **The worker transcript's location is observed, not documented.** At a
  hand-back, the payload's `transcript_path` is the parent's; the worker's own
  transcript sat at `<parent transcript directory>/<session_id>/subagents/agent-<agent_id>.jsonl`.
  The runner reads that path for the build number, and for the token when the
  report left it out; a missing file leaves the build unknown and degrades the
  second refusal to the template rather than failing. Reading the first line is
  enough: across 200 worker transcripts on this machine the first line was
  always the dispatch prompt as plain text, and every line carried `version`.
  The largest, 2.1 megabytes, read whole in 3.4 milliseconds.
- Whether `tools:` is enforced by the harness or honoured by the model is still
  inferred. On 2.1.273 a `tools: Read` worker listed exactly `Read` when nothing
  it was shown names its tools, which points to filtering by the harness; no API
  request was inspected to confirm it.
- `PostToolUse` inside a worker was measured for `Write`, `Bash` and
  `SubagentHandback`. `Edit` is assumed to behave the same. `MultiEdit` is not a
  tool on 2.1.273: the name survives only in permission-rule lists, and the tool
  list of the session that wrote this does not offer it.
- **`agent_id` carries a security property, not only bookkeeping.** The guard in
  section 4 is the only thing keeping a worker out of the evidence log, and it
  fires on a payload field measured on 2.1.270 and 2.1.273. A build that stops
  sending `agent_id` turns that denial off silently, and the `evidence` gate
  becomes theatre without failing. The conformance log is what notices, which is
  why phase 6 of the build order is not a formality.
- The `Bash` half of that guard matches command text, so it is a weaker check
  than the path check for `Edit` and `Write`, and a determined worker could
  spell the path in a way the match misses.
- Two parallel workers kept separate `agent_id`s in one measured run, one write
  each. Heavier concurrency has not been tried.
- Which setting sends a worker to the background is not separated. The eight
  dispatches that came back `async_launched` (Haiku) left `run_in_background`
  out, and the two that came back `completed` (Sonnet, auto mode) set it to
  `false`; model, mode and flag changed together. No gate depends on it: all
  eight background workers still fired `SubagentStop`.

## 11. What this does not do

- It does not police the brief. Task 8 of the context-management build failed
  because its brief was stale, telling an implementer to overwrite a fix written
  the day before. The implementer followed it exactly. None of the five
  mechanisms would have caught that, and neither does this.
- It does not check naming. No gate reads identifier style, so the naming rule
  stays prose in the brief band. `hooks/style-check.js` checks seven regular
  expressions and none of them inspects an identifier.
- It does not tell apart a rule that never reached a worker from one that reached
  it and decayed. The survey names those as separate causes with separate fixes,
  and the probe that would separate them is declined for now.
- It does not make a worker ask rather than guess. It gives a worker the words to
  say it is stuck (`STATE input-required`), which is not the same thing.

## 12. Build order

Each phase ends somewhere the configuration is whole and every test passes.

1. **The role corpus and the renderer.** `modes/roles/`, `tools/modes/roles.js`,
   `tools/modes/crew.js`, the call from `applyMode`, `ccfg crew`. Nothing
   dispatches differently yet; the only visible change is that
   `~/.claude/agents/` now has files in it and a mode switch rewrites them.
2. **The rule classification.** The `worker:` field on all 25 rules, the
   validator check, the brief band assembled and capped at five.
3. **The dispatch hook.** Scope line, run token, contract, run record. At this
   point a dispatch is shaped correctly and nothing is gated.
4. **The trace hook and the guard.** Path attribution by `agent_id`
   (`hooks/subagent-trace.js`), the denial that keeps a worker out of the
   evidence log (`hooks/agent-guard.js`), and the conformance line written from
   here on. Still nothing gated, but the log starts filling and the record it
   will be read from is protected before anything reads it.
5. **The gates, in order of how much they rest on:** the runner answering at
   both report points first, with `finish-shape`, then `scope`, then
   `evidence`, then `review`.
6. **Read the conformance log** before trusting any of it on 2.1.273.

Phase 6 is not a formality. Phases 3 through 5 rest on measurements re-taken on
2.1.273, which the next Claude Code update makes stale, and on one thing never
measured at all: a crew agent loading from `~/.claude/agents/`.
