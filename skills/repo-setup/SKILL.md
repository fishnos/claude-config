---
name: repo-setup
description: Audit and fix a repository's agent infrastructure — CLAUDE.md presence and whether git actually tracks it, the graphify knowledge graph and its freshness, an origin remote for cloud routines, declared routines and their .mcp.json, and skills the stack needs that nothing can route to automatically. Use when the SessionStart notice says "Repo setup:", when someone asks whether a repo is set up for agents, when onboarding an unfamiliar repo, or when asked to snooze or dismiss one of those notices. Not for writing CLAUDE.md content itself — that is /init — and not for scheduling, which is /repo-schedule.
---

# Repo setup

Reports what a repository is missing for agent work, then hands each fix to the
skill that owns it. This skill diagnoses and delegates. It writes nothing to the
repository itself.

## Run the audit

```bash
node ~/.claude/skills/repo-setup/audit.js [<repo-path>]      # human-readable
node ~/.claude/skills/repo-setup/audit.js --json [<repo-path>]
```

With no path it audits the repository containing the working directory. Show the
reader the table as-is rather than paraphrasing it; the fix column is the part
they act on.

## What each finding means, and who fixes it

| Check | Meaning | Hand off to |
|---|---|---|
| `instructions` | No `CLAUDE.md` or `AGENTS.md` at the root | `/init` |
| `instructions-ignored` | The file exists but git ignores it | see below — fix here |
| `graph` | No `graphify-out/graph.json`, or it predates the newest commit | `/graphify`, or `/graphify --update` when stale |
| `remote` | No `origin`, so no cloud routine can clone the repo | the reader adds a remote |
| `routines` | What `.claude/routines/` declares | `/repo-schedule` |
| `routine-mcp` | Routines declared with no `.mcp.json` | `/repo-schedule` |
| `skill-overrides` | The stack needs a skill no `paths:` rule can reach | see below — fix here |

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
