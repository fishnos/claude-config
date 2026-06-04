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

## Set up on a new machine

```sh
# fresh machine, no ~/.claude yet
git clone git@github.com:<you>/claude-config.git ~/.claude

# ~/.claude already exists (Claude Code already run)
cd ~/.claude
git init
git remote add origin git@github.com:<you>/claude-config.git
git fetch origin
git checkout -f main   # overwrites local config with repo version
```

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

## Avoiding merge conflicts

- Runtime files are untracked — machines never conflict over them.
- Conflicts can only happen in deliberately edited config. To stay safe:
  - `git pull` before editing config on any machine
  - commit + push right after editing
- If a conflict does happen, it is a normal text-file merge in `CLAUDE.md`/`settings.json` — resolve by hand.

## Rules

- **Never commit secrets.** No API keys, tokens, or credentials in any tracked file — this repo may be cloned anywhere.
- Credentials live in macOS Keychain / `.credentials.json` (ignored), never here.
- Before adding a new path to the allowlist, grep it for secrets first.
