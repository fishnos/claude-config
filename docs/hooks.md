# Hooks

Fifteen hooks, all Node, all behaving the same on macOS, Windows, and Linux.

## Cross-platform

This config runs on **macOS, Windows, and any Linux/BSD distro**. Platform-specific
behavior lives in `hooks/` as Node scripts (not shell one-liners), so a single tracked
config works everywhere:

| Hook           | Script            | Behavior                                                                                                                                                                                                       |
| -------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Notification` | `hooks/notify.js` | Desktop notification + sound. macOS → `osascript`/`afplay`; Windows → PowerShell balloon + beep; Linux → `notify-send` + first available player (`mpv`/`ffplay`/`paplay`/`pw-play`), else `canberra-gtk-play`. |
| `PostToolUse`  | `hooks/format.js` | Formats the edited file with `npx prettier --write`.                                                                                                                                                           |

Every external call is **best-effort**: a missing notifier, sound player, or Prettier
degrades silently instead of failing the hook. The hook commands resolve the config dir
via Node (`CLAUDE_CONFIG_DIR` or `~/.claude`), so they work under both POSIX shells and
Windows `cmd.exe` without relying on shell-specific `~`/`$HOME` expansion.

## Engineering-standard hooks

Thirteen additional hooks enforce the standards documented in [Engineering standards](skills.md#engineering-standards). Like the two above they are Node, invoked through the same `node -e` bootstrap, so they run identically on macOS, Windows, and Linux.

| Hook                          | Script                        | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PreToolUse` (`Bash`)         | `hooks/git-guard.js`          | **Denies** `commit`, `push`, force-push, `--no-verify`, `reset --hard`, `clean -f`, `git add -A` from the home directory, staged credentials (AWS/GitHub/OpenAI/Anthropic/Slack/GitLab keys, private keys, JWTs), and the outward-facing non-git commands below. **Warns** on logic staged without tests, >1000 staged lines, and commit messages that break the subject, wrapping, or body-length conventions, including a subject that opens on the effect (`Stop ...`) instead of the work that produced it, whether passed with `-m` or by file with `-F`. |
| `PostToolUse` (`Edit\|Write`) | `hooks/style-check.js`        | Flags style-guide violations a formatter cannot fix: `@ts-ignore`, `var`, `debugger`, `.only`, loose `==`, bare `except:`, mutable default arguments, wildcard imports.                                                                                                                                                                                                                                                                                                                                                                                        |
| `Stop`                        | `hooks/review-reminder.js`    | Requires one self-review pass before work is reported done. Fires at most once per session, and only when source files were edited.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SessionStart`                | `hooks/config-sentinel.js`    | Cheap drift check: `settings.json` parses, every hook it references exists, and no MCP credential sits in `~/.claude.json` as plaintext. Silent when clean.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `UserPromptSubmit`            | `hooks/repo-context.js`       | Injects branch, uncommitted count, upstream drift, and package manager. Emitted only when that state changes, so identical context is never repeated.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `PostToolUse` (`Bash`)        | `hooks/evidence-log.js`       | Records every shell command that ran, to `cache/evidence/<session>.jsonl`. Command text, output length and interruption only, never command output, which would eventually capture a credential.                                                                                                                                                                                                                                                                                                                                                               |
| `SessionStart`                | `hooks/repo-setup.js`         | Names the agent infrastructure a repository is missing: `CLAUDE.md`, a knowledge graph, `.claude/state.md` and its ignore line, declared routines, skills the stack needs that nothing routes to. Filesystem-only so it cannot stall a session start. The graph and the state file show as a banner on every start until fixed or dismissed; the rest speak at most once a fortnight per repository, and again as soon as that set changes.                                                                                                                    |
| `SessionStart`                | `hooks/skill-index.js`        | Rebuilds `SKILL-INDEX.md` from what is actually installed. Never blocks and never speaks: `CLAUDE.md` sends Claude to that catalog before it concludes no skill applies, and a stale one answers confidently from a list that no longer matches `settings.json`.                                                                                                                                                                                                                                                                                               |
| `SessionStart`                | `hooks/state-restore.js`      | Loads `.claude/state.md` by how the session started: after `/clear`, continue from its next step; after compaction, the file wins over the summary and Claude catches it up; at startup, a "Resuming: \<goal\>. Next: \<step\>" banner and Claude confirms first. Silent on resume and fork, without a file, and for an untouched template. Capped at 8,000 characters.                                                                                                                                                                                        |
| `UserPromptSubmit`            | `hooks/constraint-capture.js` | Heuristically detects a sentence that scopes an instruction beyond the current turn (`never`, `from now on`, ...) and adds it under the Unconfirmed section of `.claude/state.md`, where it survives a clear and Claude confirms or deletes it at the next checkpoint. Reads only what the user typed: task notifications, slash-command echoes and bash blocks arrive in the same position, and their prose is a subagent's or a command's, not an instruction. Does nothing in a repository without that file. Never speaks.                                 |
| `UserPromptSubmit`            | `hooks/context-gauge.js`      | Reads the context size from the transcript tail. From 120K tokens it tells Claude the size each turn and asks it to update `.claude/state.md` and suggest `/clear` at its next stopping point; below that, one line when the state file has not changed in 8 turns. Silent in a repository with no state file.                                                                                                                                                                                                                                                 |
| `Stop`                        | `hooks/clear-gate.js`         | From 120K tokens, holds a reply that suggests `/clear` once, with "update .claude/state.md before suggesting a clear", when the state file has not changed since the prompt arrived (the Unconfirmed section aside). Two independent guards stop it holding twice: the harness's `stop_hook_active` flag, and a held-turn marker it writes into the gauge's per-session record — and it holds only once that marker is on disk, so a record it cannot write degrades to letting the suggestion through.                                                        |
| `SessionStart`                | `hooks/graph-refresh.js`      | When `graphify-out/graph.json` is older than `.git/logs/HEAD`, starts `graphify update` detached and returns at once, logging to `cache/graph-refresh/`. Code only, no model calls. Silent, including when graphify is not installed. The clear gate starts the same rebuild when it lets a clear suggestion through.                                                                                                                                                                                                                                          |

**Outward-facing commands.** Everything that publishes or destroys state off this machine is denied with a per-family escape, never one blanket switch:

| Blocked                                                                                                                                            | Escape                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `gh repo delete\|archive\|rename\|transfer`, `gh pr merge`, `gh release create\|delete`, mutating `gh api`                                         | `CLAUDE_ALLOW_GH=1`                                                                                                            |
| `npm\|pnpm\|yarn\|bun publish`                                                                                                                     | `CLAUDE_ALLOW_PUBLISH=1`                                                                                                       |
| `vercel env add\|rm`, `vercel promote\|rollback`, any `vercel --prod`                                                                              | `CLAUDE_ALLOW_DEPLOY=1`                                                                                                        |
| `supabase db push\|reset`, `supabase migration repair`                                                                                             | `CLAUDE_ALLOW_DB=1`                                                                                                            |
| `git commit`                                                                                                                                       | `CLAUDE_ALLOW_COMMIT=1`                                                                                                        |
| Any blocking commit-message finding from `git-guard.js` (a vague subject, but also a missing blank second line, an over-wide body line, and so on) | `CLAUDE_ALLOW_VAGUE_SUBJECT=1` (narrower name than effect: it clears every blocking finding at once, not only a vague subject) |

Read-only forms stay unblocked on purpose: `gh repo view`, a default-GET `gh api`, `vercel env ls`, `vercel build --prod`, and `supabase migration list` all run without a prompt. `gh pr create` and `gh repo create` warn rather than block.

Two bypasses the guard closes that a permission rule cannot: leading env assignments (`FOO=1 git push`) and git's global options (`git -C /repo push`, `git --no-pager push`). A `settings.json` deny rule matches a literal prefix, so both walk straight past it; the hook normalizes the command before matching.

**Credential reads.** `permissions.deny` binds the Read tool only, and `cat ~/.ssh/id_ed25519` reaches the file anyway. The guard closes that by matching credential _paths_ anywhere in a Bash command, which covers every reader at once rather than enumerating them: `cat`, `less`, `grep`, `base64`, `strings`, `tar`, stdin redirection, and interpreters like `node -e` / `python3 -c`. Also blocked: whole-environment dumps (`env`, `printenv`) and expanding any `*_API_KEY` / `*_TOKEN` / `*_SECRET` variable, since after `shell-init.sh` runs those hold live MCP keys.

Covered: `.ssh`, `.aws`, `.gnupg`, `.docker`, `.config/gcloud`, `.config/gh`, `.config/21st`, `.netrc`, `.npmrc`, `.pem`/`.p12`/`.pfx`, `credentials.json`, `secrets.env`, and any non-template `.env`. Escape: `CLAUDE_ALLOW_SECRET_READ=1`.

Deliberate exemptions, because over-blocking gets a guard switched off: `.env.example`/`.sample`/`.template` stay readable, `process.env.FOO` in JavaScript is not a dotenv path, and `env NODE_ENV=test npm run build` is not an environment dump. `vercel env pull .env.local` **is** blocked, because it is read-only against Vercel but writes every live production secret to local disk.

This is a floor, not a boundary. Anything with code execution as this user can eventually reach these files; what it buys is that it cannot happen by accident, in passing, or without a visible refusal.

`hooks/lib/` holds what the hooks share rather than duplicate: `hook-io.js` for the stdin/stdout protocol, git invocation, and the fail-open wrapper, which seven of them use; `paths.js` for path classification; `commit-message.js` for the subject and body rules, which the validator also lints prepared messages with; `repo-audit.js` for the checks the SessionStart notice and the `/repo-setup` skill have to agree on; `transcript-tail.js` for reading the context size from the end of a transcript, which `tools/context-report.js` also uses; `skill-index.js` for rebuilding the catalog; `graph-refresh.js` for staleness-checking `graphify-out/graph.json` against `.git/logs/HEAD` and starting `graphify update` in the background, which both `hooks/graph-refresh.js` and `hooks/clear-gate.js` call; and `mcp-secrets.js` for deciding whether an MCP credential is exposed or brokered, which `ccfg` reads from too so the sentinel and the doctor cannot reach different verdicts.

Four things make these portable rather than accidentally POSIX:

- **No `$HOME` and no `~`.** The `node -e` bootstrap resolves the config dir from `CLAUDE_CONFIG_DIR` or `os.homedir()`, so it works where `cmd.exe` performs no expansion.
- **Separators are normalized** before any path match. Windows hands over `src\__tests__\a.test.ts`, which would otherwise miss every `/`-anchored pattern and be misfiled as production logic.
- **Command splitting covers both shells**: `&&`, `||`, `;`, `|`, and the bare `&` that `cmd.exe` chains with.
- **CRLF is stripped** before content checks, so `$`-anchored rules keep matching on checkouts made with `autocrlf`.

Requires **Node ≥ 14.14** (`fs.rmSync`), well below the version the rest of this config already needs.

`tools/test-hooks.js` is the regression suite for all of them, covering 435 cases, including deliberate false-positive tests, bypass tests (`FOO=1 git push` and `git -C /repo push` must both still be denied), Windows-shaped inputs (backslash paths, CRLF, `&` chaining), and a check that the suite itself never mutates live state. It is platform-neutral too: no shell invocation, and the hooks are spawned via `process.execPath`. Run it after any change:

```sh
node ~/.claude/tools/test-hooks.js
```

`hooks/validate-config.js` checks the config as a whole rather than the hooks alone: every script parses and loads, `settings.json` points only at files that exist, the hooks behave correctly through the real bootstrap, the regression suite passes, the counts and claims in this README match reality, the skills resolve from both `~/.claude/skills` and `~/.agents/skills`, and no tracked file carries a credential. Run it on a new machine, or after changing anything here:

```sh
node ~/.claude/hooks/validate-config.js
```

Two caveats worth knowing:

- The style checks are **regex-based** and cannot distinguish code from a string literal or comment, so fixture data containing bad code will be flagged. The hook says so in its own output.
- `git-guard.js` denies **all** pushes by design. To push deliberately, set the escape variable (see [Pushing](#pushing)).

## Pushing

`hooks/git-guard.js` denies `git push` unconditionally, matching `CLAUDE.md`'s "never commit, never push". That is deliberate: pushes should be a human decision.

Two ways through, both explicit:

```sh
! git push origin main                      # you run it, in your own shell
CLAUDE_ALLOW_PUSH=1 git push origin main    # per-invocation escape, when you asked for a push
```

The escape is read from **the command text, not the environment**, so it has to be typed for each push and cannot be exported once to disable the guard. Force-push stays blocked either way. Use `--force-with-lease --force-if-includes`, and never on a shared branch.

---

[← Back to README](../README.md)
