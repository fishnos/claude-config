# claude-config

A version-controlled `~/.claude`: global instructions, 126 skills, thirteen hooks that
enforce an engineering standard, and a zero-dependency CLI to set it all up on a
machine that has nothing installed yet.

Tracks **config only**, never transcripts, history, caches, or credentials.

```sh
git clone https://github.com/fishnos/claude-config.git ~/.claude
node ~/.claude/tools/ccfg.js install
```

Already have a `~/.claude`? See [docs/install.md](docs/install.md) for the
adopt-in-place path and the Windows equivalents.

## Documentation

| Page                                 | What is in it                                                       |
| ------------------------------------ | ------------------------------------------------------------------- |
| [Install](docs/install.md)           | New machine, prerequisites, `claude-sol`, avoiding merge conflicts  |
| [Hooks](docs/hooks.md)               | All thirteen hooks, what the git guard blocks, portability, the suite    |
| [Security](docs/security.md)         | Where keys live, the credential broker, the evidence log            |
| [ccfg](docs/ccfg.md)                 | Command reference for the config CLI                                |
| [Skills](docs/skills.md)             | The engineering standards, and sharing skills via `~/.agents`       |

## Install the skills without the config

The skills here are published as a plugin marketplace, so you can take the parts
you want without adopting anyone else's `CLAUDE.md`:

```
/plugin marketplace add fishnos/claude-config
/plugin install google-engineering@fishnos
```

| Plugin                | Contains                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `google-engineering`  | `google-style`, `google-testing`, `google-code-review`, `google-cl-author`, `git-workflow` |
| `frontend-standards`  | `impeccable`, `react-testing`, `shape`                                                     |
| `repo-agent-setup`    | `graphify`, `repo-setup`, `repo-schedule`, `find-docs`                                     |

Each plugin under `marketplace/` is a self-contained root carrying its own copy
of the skills it advertises. That is not redundancy: Claude Code always scans a
plugin's own `skills/` directory and a manifest path can only widen that scan, so
a plugin rooted at this repository would publish all 126 skills no matter what it
claimed. Isolated roots are what make the advertised contents and the installed
contents the same thing.

The roots are generated. Edit `scripts/marketplace-plugins.json`, then:

```sh
node ~/.claude/scripts/build-marketplace.js
```

Only skills written here are offered. Anything vendored from someone else's
repository is listed in [NOTICE](NOTICE), and the build refuses to publish one.

## What is tracked

| Path                    | Purpose                                 |
| ----------------------- | --------------------------------------- |
| `CLAUDE.md`             | Global instructions                     |
| `settings.json`         | Permissions, hooks, plugins, statusline |
| `rules/`                | Global rule files                       |
| `skills/`               | Custom skills                           |
| `commands/`             | Slash commands                          |
| `hooks/`                | Hook scripts                            |
| `tools/`                | Portable launchers (see `claude-sol`)   |
| `docs/`                 | The pages linked above                  |
| `themes/`               | Terminal themes                         |
| `statusline-command.sh` | Statusline script                       |

Everything else is ignored via allowlist `.gitignore` (`*` first, then explicit `!` entries). New runtime files can never be committed by accident.

## Verifying a change

Two commands, both of which should pass before anything is committed:

```sh
node ~/.claude/tools/test-hooks.js       # 328 cases across the thirteen hooks
node ~/.claude/hooks/validate-config.js  # the config as a whole
```

The validator checks that every hook parses and runs through the real bootstrap,
that `settings.json` points only at files that exist, that the claims in these
docs match reality, and that no tracked file carries a credential. CI runs both
on every push.

## Licence

MIT for the work written here. The vendored reference material (Google's style
guides and engineering practices, and skills copied from other repositories)
keeps its own terms. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
