# claude-config

Version-controlled `~/.claude` configuration. Tracks **config only** — never transcripts, history, caches, or credentials.

## What is tracked

| Path                    | Purpose                                 |
| ----------------------- | --------------------------------------- |
| `CLAUDE.md`             | Global instructions                     |
| `settings.json`         | Permissions, hooks, plugins, statusline |
| `rules/`                | Global rule files                       |
| `skills/`               | Custom skills                           |
| `hooks/`                | Hook scripts                            |
| `tools/`                | Portable launchers (see `claude-sol`)   |
| `statusline-command.sh` | Statusline script                       |

Everything else is ignored via allowlist `.gitignore` (`*` first, then explicit `!` entries). New runtime files can never be committed by accident.

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

### Engineering-standard hooks

Three additional hooks enforce the standards documented in [Engineering standards](#engineering-standards). Like the two above they are Node, invoked through the same `node -e` bootstrap, so they run identically on macOS, Windows, and Linux.

| Hook                          | Script                     | Behavior                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PreToolUse` (`Bash`)         | `hooks/git-guard.js`       | **Denies** `push`, force-push, `--no-verify`, `reset --hard`, `clean -f`, `git add -A` from the home directory, and staged credentials (AWS/GitHub/OpenAI/Anthropic/Slack/GitLab keys, private keys, JWTs). **Warns** on logic staged without tests, >1000 staged lines, and commit messages that break the subject, wrapping, or body-length conventions -- whether passed with `-m` or by file with `-F`. |
| `PostToolUse` (`Edit\|Write`) | `hooks/style-check.js`     | Flags style-guide violations a formatter cannot fix: `@ts-ignore`, `var`, `debugger`, `.only`, loose `==`, bare `except:`, mutable default arguments, wildcard imports.                                                                                                                                                                                                                                     |
| `Stop`                        | `hooks/review-reminder.js` | Requires one self-review pass before work is reported done. Fires at most once per session, and only when source files were edited.                                                                                                                                                                                                                                                                         |

`hooks/lib/` holds the parts all three share: `hook-io.js` for the stdin/stdout protocol, git invocation, and the fail-open wrapper; `paths.js` for path classification.

Four things make these portable rather than accidentally POSIX:

- **No `$HOME` and no `~`.** The `node -e` bootstrap resolves the config dir from `CLAUDE_CONFIG_DIR` or `os.homedir()`, so it works where `cmd.exe` performs no expansion.
- **Separators are normalized** before any path match. Windows hands over `src\__tests__\a.test.ts`, which would otherwise miss every `/`-anchored pattern and be misfiled as production logic.
- **Command splitting covers both shells** — `&&`, `||`, `;`, `|`, and the bare `&` that `cmd.exe` chains with.
- **CRLF is stripped** before content checks, so `$`-anchored rules keep matching on checkouts made with `autocrlf`.

Requires **Node ≥ 14.14** (`fs.rmSync`), well below the version the rest of this config already needs.

`hooks/test-hooks.js` is the regression suite for all three — 74 cases, including deliberate false-positive tests, a bypass test (`FOO=1 git push` must still be denied), Windows-shaped inputs (backslash paths, CRLF, `&` chaining), and a check that the suite itself never mutates live state. It is platform-neutral too: no shell invocation, and the hooks are spawned via `process.execPath`. Run it after any change:

```sh
node ~/.claude/hooks/test-hooks.js
```

`hooks/validate-config.js` checks the config as a whole rather than the hooks alone: every script parses and loads, `settings.json` points only at files that exist, the hooks behave correctly through the real bootstrap, the regression suite passes, the counts and claims in this README match reality, the skills resolve from both `~/.claude/skills` and `~/.agents/skills`, and no tracked file carries a credential. Run it on a new machine, or after changing anything here:

```sh
node ~/.claude/hooks/validate-config.js
```

Two caveats worth knowing:

- The style checks are **regex-based** and cannot distinguish code from a string literal or comment, so fixture data containing bad code will be flagged. The hook says so in its own output.
- `git-guard.js` denies **all** pushes by design. To push deliberately, set the escape variable (see [Pushing](#pushing)).

### Prerequisites

- **[Node.js](https://nodejs.org/)** (provides `node` + `npx`) — required by the hooks,
  the statusline (`npx ccstatusline`), and Prettier formatting.
  - macOS: `brew install node` · Windows: `winget install OpenJS.NodeJS` · Debian/Ubuntu: `sudo apt install nodejs npm` · Arch: `sudo pacman -S nodejs npm` · Fedora: `sudo dnf install nodejs`
- **Optional, for the Notification hook's extras** (each degrades gracefully if absent):
  - Linux: `notify-send` (libnotify) + any of `mpv` / `ffmpeg` / `pulseaudio-utils` / `pipewire`; optional `libcanberra`.
  - macOS / Windows: nothing extra — `osascript` / PowerShell ship with the OS.

## Set up on a new machine

```sh
# fresh machine, no ~/.claude yet — pick ONE remote form:
git clone https://github.com/<you>/claude-config.git ~/.claude   # HTTPS (works with `gh auth`)
git clone git@github.com:<you>/claude-config.git ~/.claude       # SSH

# ~/.claude already exists (Claude Code already run)
cd ~/.claude
git init
git remote add origin https://github.com/<you>/claude-config.git
git fetch origin
git checkout -f main   # overwrites TRACKED config with repo version; runtime files untouched
```

On **Windows**, run the same commands in PowerShell or Git Bash; `~` maps to `%USERPROFILE%`
(`git clone ... "$env:USERPROFILE\.claude"` in PowerShell). Machine-local preferences that
shouldn't sync (e.g. `theme`) go in `settings.local.json`, which is git-ignored.

Claude Code recreates all runtime files (history, sessions, plugin cache) on first launch. Plugins reinstall automatically from `enabledPlugins` + `extraKnownMarketplaces` in `settings.json`.

## Shared agent skills (~/.agents)

`~/.claude/skills/` is the **canonical** location for all skills. On this machine, `~/.agents/skills/<name>` entries are symlinks pointing here, so other AI agents share the same copies — no divergence.

To recreate those links on a new machine (only needed if other agents use `~/.agents/skills`):

```sh
mkdir -p ~/.agents/skills
for d in ~/.claude/skills/*/; do
  n=$(basename "$d")
  ln -sfn "$HOME/.claude/skills/$n" "$HOME/.agents/skills/$n"
done
```

If you install a new skill with `npx skills add`, it lands in `~/.agents/skills` as a real directory. To bring it under version control: move it into `~/.claude/skills/`, symlink back (as above), commit.

On **Windows**, use a directory junction instead of a POSIX symlink:

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.agents\skills\<name>" -Target "$env:USERPROFILE\.claude\skills\<name>"
```

## Engineering standards

`skills/` carries a set of skills that encode a single engineering bar, compiled from primary sources rather than summarized from memory. `CLAUDE.md` names the moment each one applies, so they trigger without being asked for.

| Skill                | Source                                                     | Applies when                                                    |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| `google-code-review` | google/eng-practices reviewer guide (7 pages, verbatim)    | Reviewing any diff — including self-review before claiming done |
| `google-cl-author`   | google/eng-practices CL author guide (3 pages, verbatim)   | Sizing a change, writing a description, answering review        |
| `google-style`       | google/styleguide — 10 language guides, full text          | Writing or editing code in any covered language                 |
| `google-testing`     | Software Engineering at Google, ch. 11–14                  | Writing or reviewing tests; choosing a test double              |
| `git-workflow`       | Conventional Commits 1.0.0, SemVer 2.0.0, Keep a Changelog | Commit messages, branching, merging, versioning, releases       |
| `react-testing`      | Testing Library + MSW v2 docs                              | React/Next.js tests                                             |
| `ros2-testing`       | ros2_documentation testing tutorials                       | ROS 2 unit, integration, simulation, and hardware-in-loop tests |

Each `SKILL.md` is the operational rules; `references/` holds the unabridged source for depth. `skills/google-style/references/` is ~1 MB of style-guide text — the bulk of this repo's size, and the reason it is worth having offline.

Where Google's rules collide with framework requirements, the skill states the exception rather than leaving it to be discovered: `google-style` documents that Next.js `page.tsx`/`layout.tsx`/`route.ts` **must** use default exports despite the guide's blanket ban.

## Pushing

`hooks/git-guard.js` denies `git push` unconditionally, matching `CLAUDE.md`'s "never commit, never push". That is deliberate: pushes should be a human decision.

Two ways through, both explicit:

```sh
! git push origin main                      # you run it, in your own shell
CLAUDE_ALLOW_PUSH=1 git push origin main    # per-invocation escape, when you asked for a push
```

The escape is read from **the command text, not the environment**, so it has to be typed for each push and cannot be exported once to disable the guard. Force-push stays blocked either way — use `--force-with-lease --force-if-includes`, and never on a shared branch.

## claude-sol (openrouter model, any machine)

`tools/claude-sol/` ships a `claude-sol` command that runs Claude Code against an
OpenRouter model instead of an Anthropic login. Plain `claude` is unaffected.

```sh
sh ~/.claude/tools/claude-sol/bootstrap.sh                       # macOS / Linux / WSL
powershell -ExecutionPolicy Bypass -File $env:USERPROFILE\.claude\tools\claude-sol\bootstrap.ps1
```

One command per machine: installs Claude Code only if missing, prompts once for the
OpenRouter key with hidden input, and stores it in the OS credential store — macOS
Keychain, Secret Service on Linux, DPAPI on Windows, falling back to a mode-600 file
only where no keyring exists. The key never enters this repo, `settings.json`, or a shell
rc file. Details and per-machine overrides: `tools/claude-sol/README.md`.

## Avoiding merge conflicts

- Runtime files are untracked — machines never conflict over them.
- Conflicts can only happen in deliberately edited config. To stay safe:
  - `git pull` before editing config on any machine
  - commit + push right after editing
- If a conflict does happen, it is a normal text-file merge in `CLAUDE.md`/`settings.json` — resolve by hand.

## Rules

- **Never commit secrets.** No API keys, tokens, or credentials in any tracked file — this repo may be cloned anywhere.
- Credentials live in the OS keychain (macOS Keychain, Windows Credential Manager, or libsecret on Linux) or `.credentials.json` (ignored), never here.
- Before adding a new path to the allowlist, grep it for secrets first.
