# ccfg

`tools/ccfg.js` manages this configuration. Zero dependencies on purpose, because it has to run on a machine where nothing is installed yet, which is exactly when setup tooling is most needed. `install` puts a `ccfg` shim in `~/.local/bin`.

| Command                     | Does                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `ccfg doctor`               | Health check: secrets, hooks, permissions, startup cost, disk. Exits non-zero on a problem.         |
| `ccfg install`              | Installs the shim, writes `shell-init.sh`, wires your shell profile, lists what is missing.         |
| `ccfg keys list`            | Every managed secret, and whether its value comes from the keychain, a file, or the env.            |
| `ccfg keys set`             | Stores a secret in the macOS Keychain, or `secrets.env` (mode 0600) elsewhere.                      |
| `ccfg keys migrate`         | Replaces plaintext keys in `~/.claude.json` with `${VAR}`, saving the values first.                 |
| `ccfg keys scrub`           | Finds managed secrets sitting in plaintext under `backups/`. Dry run unless `--yes`.                |
| `ccfg shell-init`           | Prints the profile line; `--write` adds it to your profile for you (idempotent).                    |
| `ccfg clean`                | Gzips idle logs, prunes caches older than 30 days. Dry run unless `--yes`.                          |
| `ccfg test`                 | Runs the hook, ccfg and broker regression suites.                                                   |
| `ccfg validate`             | Runs the full config validator.                                                                     |
| `ccfg backup`               | Snapshots `settings.json`, `CLAUDE.md`, `hooks/`, and `~/.claude.json`.                             |
| `ccfg evidence`             | Prints the shell commands a session actually ran. See [Security](security.md#evidence).             |
| `ccfg broker …`             | `install`, `status`, `seal`, `uninstall`. See [Security](security.md#the-broker).                   |
| `ccfg mode`                 | The mode in force, its seven settings, and whether the files on disk still match it.                |
| `ccfg mode list`            | Every mode, with what each one gates.                                                               |
| `ccfg mode NAME`            | Switches mode. Inside a git repository, for that repository only; outside one, the machine default. |
| `ccfg mode NAME --global`   | Switches the machine default, from anywhere.                                                        |
| `ccfg mode revert`          | Takes this repository's own mode off, or the machine's mode outside a repository.                   |
| `ccfg mode revert --global` | Takes the machine's mode off, from anywhere.                                                        |
| `ccfg mode list --repos`    | Every repository with a mode of its own.                                                            |
| `ccfg mode diff A B`        | What working under mode B would change relative to mode A.                                          |
| `ccfg voice`                | Writing-voice skills: list them, make one, choose the one in force                                  |
| `ccfg crew`                 | Each subagent role the mode in force renders, with its tools and its gates.                         |
| `ccfg conformance`          | What real subagent runs have confirmed about how Claude Code behaves.                               |
| `ccfg probe …`              | `list`, `run <name>`, `run --all`, `inspect <name>`, `clean <name>`. See [Probes](#probes).         |

## Modes

A mode is a named working posture: how much proof a claim needs, how often to stop and ask, how polished the code must be, how many subagents to use, and how to talk. Seven settings describe it (`verify`, `claims`, `process`, `asking`, `code`, `subagents`, `voice`), and each mode in `modes/*.json` is one choice of all seven. There are eleven; `build` is the everyday one.

The rules themselves never change between modes. Twenty-five of them live one per file in `modes/rules/`, and each file says which setting governs it. Switching the machine default re-sorts them into `rules/_active.md`, the rules that mode cares about most first and the rest below; a repository switch writes that repository's sorted rules to its own record directory under `modes/repos/` instead. Nothing is dropped. A mode can also gate tools and skills and carry its own slash commands.

Rules and tool gates change the moment you switch. The skill list, model and effort level are fixed when a session starts, so those follow at the next session; until then `ccfg mode` reports the state as corrupted.

A switch made inside a git repository stays in that repository. Its mode is recorded on this machine, under `modes/repos/`, and never inside the repository, so a cloned repository cannot bring a mode with it. Every repository without a mode of its own follows the machine default, which `ccfg mode NAME --global` sets. `ccfg mode` says which scope it answered from, `ccfg mode list --repos` lists every repository with a mode of its own, and the status line marks a repository's own mode with `(repo)`. The machine-wide rules file is loaded into every session regardless, so at session start a repository's own rules are sent on top of it, under a sentence saying they replace the machine-wide ones. That happens only when the repository's rules differ from the machine-wide file, and again after a clear or a compaction.

`~/.claude` is itself a git repository, so `ccfg mode NAME` run from there changes that repository only, and `--global` is needed to set the machine default from there.

`ccfg mode revert` takes a mode off. Outside any repository it takes off the machine mode. Inside a repository with a mode of its own it takes off that mode. Inside a repository with none it refuses with an error (exit status 2) and points at `--global`, so a stray revert cannot take the machine's mode off.

A record outlives its repository when the repository's directory is moved or deleted, and nothing removes it. `ccfg mode list --repos` marks such a record and names the directory under `modes/repos/` to delete by hand.

A repository switch writes three things into the repository's own `.claude/` directory: `settings.local.json` (the settings file Claude Code reads for this checkout only), the mode's slash commands, and the subagent role files. It lists them in `.git/info/exclude` (the repository's private ignore list, which is never committed), so they stay out of `git status`. If `.git/info/exclude` is itself a symbolic link, the switch does not write to it and prints a notice instead, and the files it wrote then show in `git status`. It refuses, and writes nothing, in three cases: git already tracks one of them; `.claude`, `.claude/commands`, `.claude/agents`, `.claude/settings.local.json` or any other file it would write is a symbolic link; or `settings.local.json` holds something that cannot be merged into (text that is not valid JSON, a value that is not a JSON object, or `permissions`, `permissions.deny` or `skillOverrides` of the wrong type).

The switch merges into the live `settings.local.json` and never replaces it. Like revert, it writes the file with two-space indentation, so a hand-formatted file is reformatted.

For each setting the mode wrote, revert puts back the value that stood there before the switch, or removes the setting if none did. It leaves everything else in place, such as the permission entries Claude Code appends as you approve commands. A setting that already held the mode's value when the switch ran is not recorded, so revert leaves it alone. A setting you change by hand after the switch is left alone too, unless you changed it to exactly the value the mode wrote: that cannot be told from the mode's own, so revert treats it as the mode's and puts back the earlier value or removes it. The same holds for entries the mode added to `permissions.deny`. The file is deleted only when the switch created it and nothing else is in it.

Revert also removes the slash commands and the role files the switch recorded writing, and the repository's record and rules under `modes/repos/`. A role file in `.claude/agents/` that the switch did not write is never removed, even one that carries the "Generated by `ccfg mode`" comment, so a role file the project committed stays. A record written before role files were recorded names none, so reverting such a record leaves its role files in place to delete by hand. Revert leaves the lines the switch added to `.git/info/exclude`.

Revert checks four paths for a symbolic link that appeared after the switch, and prints a notice for each one it skips. If `.claude` is a link, the settings file is left as found and no command or role file is removed. If `settings.local.json` is a link, it is left as found. If `.claude/commands` is a link, no command is removed. If `.claude/agents` is a link, no role file is removed. The record and rules under `modes/repos/` are removed either way, and `ccfg mode revert` says how many paths it left. A single command or role file that has itself become a link gets no notice: revert deletes the link and never the file it points at. For a role file it deletes the link only when the file it points at carries the generated comment, and otherwise leaves the link too.

Independence between a repository and the machine has a limit, in two places. A repository switch hides or shows skills relative to the machine mode in force at that moment, so a later `--global` switch that hides other skills reaches new sessions in that repository too. And a list of denied tools written by the machine mode still applies inside a repository that is in another mode: the `review` mode denies Edit, Write and NotebookEdit, and a repository in `build` on a machine in `review` cannot use them. That second point follows from how Claude Code merges its settings files, where a deny entry in any of them applies; this project has not measured it.

A record is tied to a path. If a different repository is later created at the same path, it picks the old record up, so remove a stale record by hand. A nested directory with its own `.git`, such as a submodule or a clone inside a clone, is its own repository, and the outer repository's mode does not reach it.

## Voice

A writing-voice skill is a skill that makes a session write prose the way one
named person writes. It is any `skills/<name>-voice/` whose `SKILL.md` says
`kind: voice` under `metadata:`, so the skills directory is the list.

| Command                                             | What it does                                                        |
| :-------------------------------------------------- | :------------------------------------------------------------------ |
| `ccfg voice` (or `ccfg voice list`)                 | Every voice, its owner and version, and which is in force here      |
| `ccfg voice new NAME --owner "Full Name" [--from DIR\|FILE...]` | Scaffold an empty `skills/NAME-voice/` and copy samples in |
| `ccfg voice use NAME`                               | Turn NAME on and the others off, for the repository you are in      |
| `ccfg voice use NAME --global`                      | The same, machine-wide                                              |
| `ccfg voice use --none`                             | Drop this repository's own choice; the machine's applies again      |
| `ccfg voice add NAME FILE...`                       | Copy more writing samples in                                        |
| `ccfg voice learn NAME [--slug SLUG]`               | Start the next before-and-after file and print its path             |
| `ccfg voice register NAME --owner "Full Name"`      | Mark a hand-built skill as a voice (up to four frontmatter keys, nothing else) |

A new skill is empty and says so. The rules are written inside a Claude
session by `/voice-build NAME`, which reads the samples and interviews you;
`ccfg` itself never calls a model. A new voice starts switched on, so two can
be in force at once until `ccfg voice use NAME` picks one. If `ccfg voice new`
fails partway, it leaves `skills/NAME-voice` behind and a retry says it already
exists; delete that directory first.

The choice is layered like `ccfg mode` and like git's config: inside a git
repository a plain `use` writes that repository's `.claude/settings.local.json`
and is kept out of its `git status`; `--global` writes the machine's
`settings.json`, which every repository without its own choice inherits.
`~/.claude` is itself a repository, so use `--global` there to set the machine.
A choice takes effect at the next session.

Samples are private writing: `skills/*-voice/references/samples/` is ignored by
git.

## The crew

The crew is the set of subagent roles a mode provides. Each role is defined in `modes/roles/` and rendered into `agents/` on every switch (for a repository switch, into that repository's `.claude/agents/`): `implementer` writes code, `investigator` reads and reports, `reviewer` judges a diff without seeing the brief that asked for it.

A subagent's report passes through gates before it is accepted. A gate is a check that can refuse the report: one that it has a readable shape, one that the files it touched fall inside the scope it was given, one that a claim of working code names a command that ran. `ccfg crew` shows which gates apply to which role. It shows the crew of the mode in force where it is run: inside a repository with a mode of its own, that mode's roles as rendered in the repository's `.claude/agents/`; anywhere else, the machine mode's.

Those gates depend on details of Claude Code that an update could change, such as whether a subagent's tool calls carry its id. `ccfg conformance` reads the records of ordinary runs and reports each such assumption as confirmed, contradicted, or not yet seen.

## Probes

A probe is a scripted experiment that answers one question about what this configuration actually does. Each lives in `probes/` and states its question and why the answer matters. `ccfg probe list` prints all of them.

There are three kinds, cheapest first:

- **oracle** reads the files on disk and costs nothing. Example: `corpus-fidelity` checks that every rule is still the exact text it was cut from.
- **live** calls the installed Claude Code, which spends usage.
- **model** runs the same task under different arrangements many times and grades the output. These spend real usage; a large run asks before it starts.

`ccfg probe run --kind oracle` runs only the free ones.

---

[← Back to README](../README.md)
