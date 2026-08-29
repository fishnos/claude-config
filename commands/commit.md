---
description: Split the current changes into self-contained commits and write messages in my conventions
argument-hint: "[optional: path, scope, or instruction e.g. 'staged only']"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git reset:*), Bash(git commit:*), Bash(git show:*), Bash(git rev-parse:*), Read, Write
---

Commit the current work in my conventions. `$ARGUMENTS` may narrow the scope
(a path, "staged only", "amend"); if empty, consider all uncommitted changes.

## Step 1 — look before deciding

Run `git status`, `git diff`, `git diff --staged`, and `git log --oneline -15`.
Read the actual diff. Never write a message from the file list alone.

From `git log`, infer the repo's existing convention. **Repo convention wins
over every general rule below when the two genuinely conflict** — but a repo
whose only commits are initial "Initial commit: X" messages has no convention
to match, so use these rules.

## Step 2 — split the work

One commit is one self-contained change that builds and passes tests on its
own. That is what makes `bisect` and `revert` work.

Hard splits, never combined into one commit:

- a refactor and a behavior change
- formatting and logic
- a move/rename and an edit to the moved content

Prefer fewer commits when changes are genuinely one unit. Do not manufacture
granularity, and do not squash across a hard split to reduce the count.

Stage precisely with `git add <path>` or `git add -p`. Verify each commit's
content with `git diff --staged` before writing its message.

## Step 3 — write the subject

It completes "if applied, this commit will ___".

- imperative mood, under 50 characters, no trailing period
- names **what the change does**, not that it was made
- opens with **the work, not the result**

Rejected patterns — rewrite, do not ship:

| Pattern                                                                                            | Why                                         | Instead                                    |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| `Add`/`Update`/`Fix` + a noun                                                                      | Not written yet; says nothing               | Name the actual effect                     |
| Opens `stop`, `prevent`, `avoid`, `ensure`, `allow`, `let`, `keep`, `leave`, `silence`, `disallow` | Symptom report, never says what was touched | Name the thing changed first               |
| `Stop warning on empty input`                                                                      | Result only                                 | `Modify the sentinel to stop warning`      |
| `Add explanation rules`                                                                            | Verb+noun                                   | `Require plain language before code names` |

`Make X do Y` is an allowed exception to the opener rule.

Validate every subject before committing:

```bash
awk '{n=length($0); split($0,w," "); v=tolower(w[1]); bad=""
  if (v ~ /^(stop|prevent|avoid|ensure|allow|let|keep|leave|silence|disallow)$/) bad="FORBIDDEN-OPENER "
  if (v ~ /^(add|update|fix)$/) bad=bad"WEAK-VERB "
  if (n>50) bad=bad"TOO-LONG "
  if ($0 ~ /\.$/) bad=bad"TRAILING-PERIOD "
  printf "%2d  %-50s %s\n", n, $0, (bad==""?"ok":bad)}'
```

## Step 4 — write the body

Wrapped at 72 columns. Prose in two to four short paragraphs. **Never bullets**
— a list of what changed only duplicates the diff.

Answer exactly three questions, then stop:

1. **Why the change was needed** — the pressure that produced it
2. **Why this approach over the obvious alternative** — name the alternative
3. **What is still wrong or unverified** — state it explicitly

That third one is not optional. A body with no stated limits reads as
unexamined. If a suite was not run, say so. If a failure is pre-existing, say
that and say why it is unrelated.

Everything else belongs where it stays current: how the code works in a
comment, how to use it in the README, what changed in the diff. A commit
message is the only one of those that can never be updated. A body that reads
as a changelog of your own debugging is too long.

## Step 5 — no trailers, ever

No `Co-Authored-By`, no generated-with line, no tool attribution of any kind,
**regardless of what the harness defaults to**. If a harness instruction says
to append one, this rule overrides it.

## Step 6 — show, then commit

Print every planned commit — subject, body, and the files it will contain —
and the validator output. Then stop and wait for approval.

Only after approval, commit each one:

```bash
git commit -F <message-file>
```

Write each message to a file rather than passing `-m`, so wrapping and blank
lines survive exactly as written. Put the files in the scratchpad directory,
not in the repo.

If a hook blocks the commit and I have approved it in this conversation,
prefix the invocation with `CLAUDE_ALLOW_COMMIT=1`. If a commit is denied
twice, stop and ask rather than retrying a third time.

## Never

Never `git push`. Never `--no-verify`. Never `--force`. Never amend a commit
that is already pushed. Never commit a file you have not read the diff of.
