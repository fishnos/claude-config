# Install

Getting this config onto a machine that does not have it yet.

## Prerequisites

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

Then run the setup tool:

```sh
node ~/.claude/tools/ccfg.js install
```


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

---

[← Back to README](../README.md)
