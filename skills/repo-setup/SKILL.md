---
name: repo-setup
description: Audit and fix a repository's agent infrastructure — CLAUDE.md presence and whether git actually tracks it, the .claude/state.md working record and its ignore line, the graphify knowledge graph and its freshness, an origin remote for cloud routines, declared routines and their .mcp.json, and skills the stack needs that nothing can route to automatically. Use when the SessionStart notice says "Repo setup:", when someone asks whether a repo is set up for agents, when onboarding an unfamiliar repo, or when asked to snooze or dismiss one of those notices, or to set a repo up for early clears (the context action). Not for writing CLAUDE.md content itself — that is /init — and not for scheduling, which is /repo-schedule.
---

# Repo setup

Reports what a repository is missing for agent work, then hands each fix to the
skill that owns it. This skill diagnoses and delegates. Only the context action
writes to the repository, and only when the reader asks for it.

## Run the audit

```bash
node ~/.claude/skills/repo-setup/audit.js [<repo-path>]      # human-readable
node ~/.claude/skills/repo-setup/audit.js --json [<repo-path>]
```

With no path it audits the repository containing the working directory. Show the
reader the table as-is rather than paraphrasing it; the fix column is the part
they act on.

## What each finding means, and who fixes it

| Check                  | Meaning                                                              | Hand off to                                            |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| `instructions`         | No `CLAUDE.md` or `AGENTS.md` at the root                            | `/init`                                                |
| `instructions-ignored` | The file exists but git ignores it                                   | see below — fix here                                   |
| `graph`                | No `graphify-out/graph.json`, or it predates the newest commit       | `audit.js context`, or `/graphify --update` when stale |
| `state-file`           | No `.claude/state.md`, so nothing carries the work across a `/clear` | `audit.js context`                                     |
| `state-file-tracked`   | Git would track `.claude/state.md`                                   | `audit.js context`                                     |
| `remote`               | No `origin`, so no cloud routine can clone the repo                  | the reader adds a remote                               |
| `routines`             | What `.claude/routines/` declares                                    | `/repo-schedule`                                       |
| `routine-mcp`          | Routines declared with no `.mcp.json`                                | `/repo-schedule`                                       |
| `skill-overrides`      | The stack needs a skill no `paths:` rule can reach                   | see below — fix here                                   |

Two findings are resolved here because no other skill owns them.

**`instructions-ignored`** is the one that costs the most and shows the least.
A `CLAUDE.md` git ignores is invisible to every teammate and to every cloud
session, because routines and web sessions clone from the remote and never see
the working tree. The repo looks configured locally and is unconfigured
everywhere else. Fix it by removing the rule from `.gitignore` and committing
the file. If it is ignored on purpose because it holds something private, say so
plainly and suggest splitting the private part out rather than leaving the whole
file dark.

**`skill-overrides`** means the repository's dependencies call for a skill that
carries no `paths:` frontmatter, so nothing routes to it automatically. The fix
is a `skillOverrides` entry in `.claude/settings.local.json`, which promotes the
skill in that repository and nowhere else. The audit prints the exact object.

## The context action

    node ~/.claude/skills/repo-setup/audit.js context [<repo-path>]

Sets a repository up for early clears in one step: writes `.claude/state.md`
from `templates/state.md` (never over an existing one), appends
`.claude/state.md` to `.gitignore` unless git already ignores it, and builds the
code graph with `graphify update`, which reads code only and makes no model
calls. It does not start graphify's pass over documents, papers and images,
which spends model tokens: offer that, and run `/graphify` only on a yes.

The SessionStart banner raises `graph`, `state-file` and `state-file-tracked` on
every start until they are fixed or dismissed, because without them a `/clear`
loses the work.

## Silencing a finding

```bash
node ~/.claude/skills/repo-setup/audit.js snooze <check-id> [<repo-path>]   # 14 days
node ~/.claude/skills/repo-setup/audit.js dismiss <check-id> [<repo-path>]  # permanent
node ~/.claude/skills/repo-setup/audit.js reset [<repo-path>]              # clear both
```

State lives in `~/.claude/cache/repo-setup/`, never in the repository, so
declining a suggestion never dirties a working tree. Snooze when the work is
real but not now; dismiss when the check does not apply to this repository at
all. Prefer snooze — a dismissal is never raised again.

## Boundaries

Fix only what the reader agrees to. A repo missing four things is a menu, not a
work order, and running `/graphify` on a large repository is a long operation
nobody asked for. Report, recommend, wait.

The SessionStart hook (`~/.claude/hooks/repo-setup.js`) reads the same check
definitions from `~/.claude/hooks/lib/repo-audit.js`. Add a check there so both
the notice and this report gain it at once. Checks needing git or the network
belong in `audit.js`, since the hook runs in front of every session and must not
spawn anything.
