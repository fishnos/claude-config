# ccfg

`tools/ccfg.js` manages this configuration. Zero dependencies on purpose — it has to run on a machine where nothing is installed yet, which is exactly when setup tooling is most needed. `install` puts a `ccfg` shim in `~/.local/bin`.

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

---

[← Back to README](../README.md)
