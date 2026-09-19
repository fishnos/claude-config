# Context management: a state file, early clears, and graphify

Date: 2026-09-11
Status: approved 2026-09-11; implementation plan not yet written
Repo: `~/.claude` (public)
Supersedes: A2, A3, B1 and B2 of `2026-09-09-context-continuity-design.md` (the
compaction handoff and the keyword capture). Its A1 (the blocking commit-message
check), A4 and A5 are unaffected, and its B3 (measure before keeping) carries
into section 4 here.

## The problem, measured

Long sessions lose quality in two ways that stack.

1. Every turn carries the whole conversation. Quality falls as that history
   grows, long before anything is summarized.
2. Compaction replaces the history with a summary. A session that compacts
   repeatedly ends up summarizing its own summaries.

Measured on 2026-09-11 by reading the transcripts of the 2,861 sessions modified
since 2026-07-28:

| Largest context a session reached | Sessions |
| --------------------------------- | -------- |
| under 100K tokens                 | 2,728    |
| 100K to 200K                      | 72       |
| 200K to 400K                      | 59       |
| over 400K                         | 2        |

Eleven sessions compacted, most of them repeatedly: one 15 times, others 11, 9,
7, 6 and 5. The 48 automatic compactions fired between 365K and 383K tokens
(median 368K) under `autoCompactWindow: 400000`. The 17 compactions the user
started by hand had a median of 390K. So the worst sessions spent every turn at
200K to 368K tokens of history, and summarized their summaries up to 15 times.

The 2026-09-09 handoff does not reach this. It fired once in real use, on a
manual compaction, and its note carried the mode line, no captured instructions,
and placeholder text where decisions and open threads belonged. On 2026-09-11 the
keyword capture saved a statement of goals as if it were a standing rule.

The user named four losses, all of which matter: earlier decisions, rules and
instructions, where the work stands, and general sharpness. The last cannot be
fixed by saving anything. Only a smaller working context fixes it.

## Principle

Push what must always apply; pull what is needed only sometimes.

- **Pushed** into context at every session start: the goal, the user's
  instructions, decisions, rejected approaches, and progress. These cannot be
  looked up on demand, because the model only searches for what it knows it is
  missing, and a forgotten rule is never searched for.
- **Pulled** on demand: how the code works. That is graphify's job.

And clear early, at a natural stopping point, instead of compacting late in the
middle of a task. The 2026-09-09 spec already cites Anthropic's harness research
finding that fresh restarts outperform in-place compaction for long work.

## 1. How a clear fits into the work

### The state file

`.claude/state.md` at the repository root, gitignored. Its sections, from the
template described in 3.1:

| Section        | Holds                                                                             |
| -------------- | --------------------------------------------------------------------------------- |
| Goal           | one or two lines on what the current piece of work is for                         |
| Instructions   | the user's standing instructions for this work, word for word                     |
| Unconfirmed    | instructions captured by keyword, waiting to be confirmed (3.4)                   |
| Decisions      | settled choices, one line each, with the reason                                   |
| Rejected       | approaches tried or ruled out and why; the last error word for word if it matters |
| Progress       | done, in progress, next step                                                      |
| Hot files      | files being edited and why; these are re-read after a clear                       |
| Where to look  | graphify queries or node names for everything else                                |
| Open questions | anything waiting on the user                                                      |

Claude updates it at checkpoints: a decision made, an approach rejected, a phase
finished, before a commit, and before suggesting a clear. A few lines each time.

When loaded it is capped at 8,000 characters. This is a cap, not a budget, on the
same reasoning as `MAX_SECTION` in the retired pre-compact hook: a file that
large is being used as a log, and truncating with a visible note keeps it from
flooding the restored context while leaving the problem in view.

Amended 2026-09-18, after the file in the configuration repository reached
170,363 characters and a clear was loading only its first 8,000, which held
the Goal and part of Instructions but not Progress or Hot files. Three changes
followed. The cap now cuts by section, most needed first (Goal, Instructions,
Unconfirmed, Hot files, Where to look, Open questions, then Progress,
Decisions, Rejected), keeps the top of a section it has to cut because entries
are kept newest first, and names every section it cut or left out. The clear
gate holds a clear suggestion while the file is over the cap, so the file is
trimmed at the moment it is written rather than noticed at the next load.
Trimmed entries move word for word to `.claude/state.archive.md`, beside the
file, git-ignored the same way and never loaded, so a trim loses nothing.

The file covers one piece of work. When the user says the work is done, anything
worth keeping goes to auto-memory, which has been the single memory system since
2026-07-31, and the file resets to the template. It is a working record, not a
second memory system.

Each working tree has its own file, because the file is untracked and so does not
travel between worktrees. Two sessions in the same working tree share one file
and the last writer wins; that is accepted.

### Zones

Context size is the input, cache-read and cache-creation token counts of the
latest main-thread assistant turn, read from the end of the transcript. These are
the same fields the measurement above used.

| Zone  | Context      | Behaviour                                                                                                                                                                                                                                      |
| ----- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Green | under 120K   | Nothing shown to the user. If the state file has not changed in 8 turns, Claude gets one line giving its age.                                                                                                                                  |
| Amber | 120K to 200K | Each turn Claude gets the current size. At its next natural stopping point it brings the state file up to date and ends the reply with "good point to clear: `/clear`, then `go`". If ignored, it asks again at the next stop. Never mid-task. |
| Red   | about 200K   | Automatic compaction as the backstop, after which the state file is loaded.                                                                                                                                                                    |

All three numbers are starting guesses. The probe in section 4 sets them.

The amber zone works through a number delivered each turn rather than a standing
rule because of a local measurement, recorded in the header of
`hooks/mode-inject.js`: a rule buried behind about 6,600 tokens was followed 0
times in 36, even when restated, while new information delivered with the user's
message won 12 times in 12. A context size that changes every turn is new
information.

### Warm restart

After `/clear`, the restart hook loads the state file and tells Claude to carry
on from the next step without asking. Claude re-reads the hot files and pulls
anything else from graphify. The user types `/clear`, then `go`.

The old session is not destroyed. Its transcript stays on disk. Whether `/resume`
lists a session from before a clear is still to be checked once by hand
(section 5).

## 2. Setup check and graphify

### The session-start check

`hooks/lib/repo-audit.js` already flags a missing CLAUDE.md and a missing
knowledge graph (`graph`). It gains two findings:

- `state-file`: there is no `.claude/state.md`.
- `state-file-tracked`: the root `.gitignore` has no line covering
  `.claude/state.md` (the exact path, `/.claude/state.md`, `.claude/` or
  `/.claude/`). The hook stays filesystem-only, so this is an approximation; the
  `/repo-setup` skill confirms it with `git check-ignore`.

These two and the existing `graph` finding are marked urgent. `hooks/repo-setup.js`
shows urgent findings at every session start, as a banner the user sees (the
`systemMessage` field, through `announce` in `hooks/lib/hook-io.js`) plus one
line of context for Claude, until they are fixed or dismissed with the existing
per-repository dismissal. The other findings keep today's once-per-14-days
notice to Claude only.

As today, repositories under the config directory are skipped, and so are
folders that are not a git repository.

### One-step setup

The `/repo-setup` skill (`skills/repo-setup/`) gains a "context" action:

1. write `.claude/state.md` from the template;
2. append `.claude/state.md` to `.gitignore`;
3. build the code graph with `graphify update <root>`, which reads code only and
   makes no model calls;
4. offer, but not run, graphify's pass over documents, papers and images, which
   does spend model tokens.

Step 3 was checked on 2026-09-11 on a two-file project, with the API key
variables removed and `claude` on the PATH replaced by a script that records and
refuses any call. It exited 0, built `graph.json`, and made no calls. It also
built the graph from nothing, so no earlier graph is needed.

### Keeping the graph fresh

A new hook, `hooks/graph-refresh.js` (SessionStart), checks whether
`graphify-out/graph.json` is older than `.git/logs/HEAD`, which changes on every
commit and checkout. If it is, the hook starts `graphify update <root>` detached
and returns at once, writing to one log file per repository under
`cache/graph-refresh/`, overwritten on each run. It is silent when graphify is
not on the PATH.

It is a separate hook so that `repo-setup.js` stays filesystem-only, as its
header promises. The clear gate (3.3) starts the same refresh when it lets a
clear suggestion through, so a fresh session reads a current graph. Since
staleness fixes itself at no cost, only a missing graph needs the user.

The state file's "Where to look" section holds graphify queries. After a clear,
Claude runs them through graphify's command-line tool with a token cap, and never
through the 713-line `/graphify` skill, whose runbook would refill the context
this design exists to keep small.

## 3. Components

### 3.1 State-file template

`skills/repo-setup/templates/state.md`: the sections from section 1, each with one
line of guidance on what belongs there.

### 3.2 Context gauge (new: `hooks/context-gauge.js`, UserPromptSubmit)

- Reads the last 256 KB of the transcript to find the latest main-thread
  assistant usage.
- Keeps per-session state in `cache/context-gauge/<session-id>.json`: the turn
  count, the state file's last-seen modification time, the turn on which that
  last changed, and the time the current turn started.
- Emits at most one line of context per turn: the amber line or the green
  staleness line. Otherwise silent, including in repositories with no state file,
  where the setup banner already speaks.

### 3.3 Clear gate (new: `hooks/clear-gate.js`, Stop)

- In the amber or red zone, when the final assistant message suggests `/clear`,
  it checks that `.claude/state.md` changed during this turn. If it did not, it
  blocks the stop once, with "update .claude/state.md before suggesting a clear".
  It honours `stop_hook_active`, so it can never loop. This uses the same
  blocking mechanism as `hooks/review-reminder.js`, observed blocking a stop on
  2026-09-11.
- When it lets a suggestion through, it starts the graph refresh.

This is a mechanical gate because a clear made with an out-of-date file is the one
way this design loses work outright. It follows the 2026-09-09 principle: if a
machine can check it, gate it.

### 3.4 Keyword capture (changed: `hooks/constraint-capture.js`)

Writes each candidate into the state file's Unconfirmed section instead of
`cache/constraints/<session-id>.md`, so that it survives a clear. At the next
checkpoint Claude moves it into Instructions or deletes it. Without a state file,
it behaves as it does today.

It is still unmeasured. The probe runs with it and without it, and it is removed
if it does not help, as the 2026-09-09 spec's B3 required.

One risk to check during the build: the hook writes a file Claude also edits, so
Claude's next edit to it may need a fresh read first.

### 3.5 Restart (changed: `hooks/handoff-restore.js`, renamed `hooks/state-restore.js`)

Claude Code 2.1.268 reports how a session started as one of `startup`, `resume`,
`clear`, `compact` or `fork`; this was confirmed by reading the program on
2026-09-11. The hook loads `.claude/state.md` according to that value:

| Session started by | Behaviour                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clear`            | Load the file; tell Claude to continue from the next step without asking.                                                                                                                                                |
| `compact`          | Load the file; tell Claude a summary replaced earlier history, that the file wins where the two disagree, and how many minutes before the compaction the file was last updated, so it can bring the file up to date now. |
| `startup`          | Load the file; show the user a banner: "Resuming: <goal>. Next: <next step> (updated <age> ago)". Claude confirms with the user before continuing.                                                                       |
| `resume`, `fork`   | Nothing; the conversation comes back with the file already in it.                                                                                                                                                        |

### 3.6 Retired

- `hooks/pre-compact.js` and its `PreCompact` entry in `settings.json`. The
  restart hook works out how stale the file is on its own, and the mode line the
  old handoff saved is already re-sent every turn by `hooks/mode-inject.js`.
- `cache/handoff/` and `cache/constraints/`, which nothing writes any more.
- `hooks/lib/session-cache.js` stays if another hook still uses it.

### 3.7 Settings and documentation

- `autoCompactWindow` goes from 400000 to 220000. At 400K, automatic compaction
  fired at a median of 368K, and the same ratio puts the backstop near 200K; the
  compaction records after the change confirm or correct that. This reverses the
  2026-09-09 decision not to move the threshold, which was made when nothing
  carried state across a compaction.
- The two new hooks are wired in `settings.json`, and the table in
  `docs/hooks.md` is updated.

### 3.8 CLAUDE.md

The paragraph telling Claude to offer `/graphify` when a project has no graph
becomes redundant with the banner. It is proposed for removal in its own commit,
at the user's discretion.

## 4. Testing

### Hook tests

Every hook change gets cases in `tools/test-hooks.js`, each written before the
code and watched to fail for the right reason first.

- Context gauge: the right zone from synthetic transcripts at 50K, 150K and
  250K; the staleness line after 8 unchanged turns; silence without a state file.
- Clear gate: blocks a clear suggestion when the file did not change this turn;
  lets it through when it did; never blocks twice in a row.
- Restart: the right output for each way a session starts; truncation at the
  cap; silence without a file.
- Audit: each new finding present and absent; urgent findings shown on every
  start; dismissal respected.
- Graph refresh: starts only when the graph is stale and graphify is on the PATH,
  checked with a fake `graphify` script that records its arguments (a fake, not a
  mock).
- Keyword capture: writes into Unconfirmed when a state file exists, and behaves
  as before when none does.

### Probe

A new probe, `probes/state-carryover.js`, in the `ccfg probe` harness. A scripted
session sets up decisions, instructions, a rejected approach and progress, then
the work continues in a fresh context under three conditions: a clear with the
state file, a clear without it, and a compaction. The score counts whether the
rejected approach is proposed again (it should never be), whether the
instructions are followed, and whether the correct next step is taken.

It runs once before the build, as a baseline with today's hooks, and once after.
The acceptance test is that the state-file condition beats both of the others.
If it does not, the design is revisited rather than kept on faith.

A second run adds filler context at 50K, 100K, 150K, 200K and 300K tokens to find
where adherence drops. That sets the zone numbers.

Both runs spend real usage, so they wait for a weekly reset and start with a small
sample.

### In real use

Two weeks after rollout, the 2026-09-11 transcript measurement is repeated: turns
spent above 200K and compactions per week should both fall. The measurement
script is kept as `tools/context-report.js` and run by hand.

## 5. Not yet verified

| Claim                                                                                              | What settles it                              |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `/resume` lists a session from before a `/clear`                                                   | trying it once by hand                       |
| `graphify update` is quick on a full-size repository                                               | timing it once; no model calls               |
| graphify's command line accepts `query` with a token cap                                           | running it once; only the skill documents it |
| Claude Code shows a hook's `systemMessage` banner at session start                                 | the first session after the build            |
| the backstop fires near 200K at `autoCompactWindow: 220000`                                        | the compaction records after the change      |
| where the Stop hook finds the final assistant message: in the payload or the end of the transcript | the hooks documentation, during the build    |
| the zone numbers, and where quality actually drops                                                 | the probe's second run                       |
| that the design improves what carries over                                                         | the probe                                    |
| a hook writing into the state file does not disrupt Claude's own edits                             | a hook test during the build (3.4)           |

## 6. What this does not do

- It does not add a memory system. Auto-memory stays the only one.
- No hook makes a model call. Everything the hooks do is local file work plus
  graphify's pass over code.
- It does not clear automatically. The user types `/clear`.
- It does not summarize transcripts or try to improve the compaction summary.

## 7. Build order

Each step is one self-contained commit with its tests.

1. The probe, and its baseline run.
2. The template, the audit findings, the banner, and the `/repo-setup` action.
3. The restart hook, replacing the handoff restore and retiring the pre-compact
   hook.
4. The context gauge and the clear gate.
5. The keyword capture writing into Unconfirmed.
6. The graph refresh hook.
7. The `autoCompactWindow` change.
8. The probe's second run, and the zone numbers tuned from it.
9. If the user agrees, removing the graphify paragraph from CLAUDE.md.
