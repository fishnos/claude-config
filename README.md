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
| `statusline-command.sh` | Statusline script                       |

Everything else is ignored via allowlist `.gitignore` (`*` first, then explicit `!` entries). New runtime files can never be committed by accident.

## Cross-platform

This config runs on **macOS, Windows, and any Linux/BSD distro**. Platform-specific
behavior lives in `hooks/` as Node scripts (not shell one-liners), so a single tracked
config works everywhere:

| Hook               | Script            | Behavior                                                                                       |
| ------------------ | ----------------- | ---------------------------------------------------------------------------------------------- |
| `Notification`     | `hooks/notify.js` | Desktop notification + sound. macOS → `osascript`/`afplay`; Windows → PowerShell balloon + beep; Linux → `notify-send` + first available player (`mpv`/`ffplay`/`paplay`/`pw-play`), else `canberra-gtk-play`. |
| `PostToolUse`      | `hooks/format.js` | Formats the edited file with `npx prettier --write`.                                            |

Every external call is **best-effort**: a missing notifier, sound player, or Prettier
degrades silently instead of failing the hook. The hook commands resolve the config dir
via Node (`CLAUDE_CONFIG_DIR` or `~/.claude`), so they work under both POSIX shells and
Windows `cmd.exe` without relying on shell-specific `~`/`$HOME` expansion.

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
