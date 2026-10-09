# ccfg

`tools/ccfg.js` manages this configuration. Zero dependencies on purpose, because it has to run on a machine where nothing is installed yet, which is exactly when setup tooling is most needed. `install` puts a `ccfg` shim in `~/.local/bin`.

| Command             | Does                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `ccfg doctor`       | Health check: secrets, hooks, permissions, startup cost, disk. Exits non-zero on a problem. |
| `ccfg install`      | Installs the shim, writes `shell-init.sh`, wires your shell profile, lists what is missing. |
| `ccfg keys list`    | Every managed secret, and whether its value comes from the keychain, a file, or the env.    |
| `ccfg keys set`     | Stores a secret in the macOS Keychain, or `secrets.env` (mode 0600) elsewhere.              |
| `ccfg keys migrate` | Replaces plaintext keys in `~/.claude.json` with `${VAR}`, saving the values first.         |
| `ccfg keys scrub`   | Finds managed secrets sitting in plaintext under `backups/`. Dry run unless `--yes`.        |
| `ccfg shell-init`   | Prints the profile line; `--write` adds it to your profile for you (idempotent).            |
| `ccfg clean`        | Gzips idle logs, prunes caches older than 30 days. Dry run unless `--yes`.                  |
| `ccfg test`         | Runs the hook, ccfg and broker regression suites.                                           |
| `ccfg validate`     | Runs the full config validator.                                                             |
| `ccfg backup`       | Snapshots `settings.json`, `CLAUDE.md`, `hooks/`, and `~/.claude.json`.                     |
| `ccfg evidence`     | Prints the shell commands a session actually ran. See [Security](security.md#evidence).     |
| `ccfg broker …`     | `install`, `status`, `seal`, `uninstall`. See [Security](security.md#the-broker).           |
| `ccfg mode`         | The mode in force, its seven settings, and whether the files on disk still match it.        |
| `ccfg mode list`    | Every mode, with what each one gates.                                                       |
| `ccfg mode NAME`    | Switches mode. Also `mode diff A B` and `mode revert`.                                      |
| `ccfg crew`         | Each subagent role the mode in force renders, with its tools and its gates.                 |
| `ccfg conformance`  | What real subagent runs have confirmed about how Claude Code behaves.                       |
| `ccfg probe …`      | `list`, `run <name>`, `run --all`, `inspect <name>`, `clean <name>`. See [Probes](#probes). |

## Modes

A mode is a named working posture: how much proof a claim needs, how often to stop and ask, how polished the code must be, how many subagents to use, and how to talk. Seven settings describe it (`verify`, `claims`, `process`, `asking`, `code`, `subagents`, `voice`), and each mode in `modes/*.json` is one choice of all seven. There are eleven; `build` is the everyday one.

The rules themselves never change between modes. Twenty-five of them live one per file in `modes/rules/`, and each file says which setting governs it. Switching a mode re-sorts them into `rules/_active.md`, the rules that mode cares about most first and the rest below. Nothing is dropped. A mode can also gate tools and skills and carry its own slash commands.

Rules and tool gates change the moment you switch. The skill list, model and effort level are fixed when a session starts, so those follow at the next session; until then `ccfg mode` reports the state as corrupted. A mode is machine-wide: switching in one terminal switches every session.

## The crew

The crew is the set of subagent roles a mode provides. Each role is defined in `modes/roles/` and rendered into `agents/` on every switch: `implementer` writes code, `investigator` reads and reports, `reviewer` judges a diff without seeing the brief that asked for it.

A subagent's report passes through gates before it is accepted. A gate is a check that can refuse the report: one that it has a readable shape, one that the files it touched fall inside the scope it was given, one that a claim of working code names a command that ran. `ccfg crew` shows which gates apply to which role.

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
