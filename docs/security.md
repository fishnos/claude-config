# Security

Where credentials live, what the agent can reach, and what gets recorded.

## Secrets

MCP servers that need an API key read it from the environment via a `${VAR}` placeholder in `~/.claude.json`, never as a literal. Values live in the macOS Keychain (service `ccfg`) or, on other platforms, in `~/.claude/secrets.env` at mode 0600. Both are git-ignored; `shell-init.sh` exports them into the shell that launches `claude`.

```sh
ccfg install               # shim, shell-init.sh, and the profile line, in one step
ccfg keys migrate          # move any plaintext keys out of ~/.claude.json
ccfg keys set CONTEXT7_API_KEY   # prompts; a value on the command line is refused
```

Migration is not rotation. A key that was ever plaintext on disk should be rotated at the provider first, then stored with `keys set`. `ccfg doctor` and the `SessionStart` hook both fail loudly while any plaintext key remains.

To manage a new server's key, add an entry to `MANAGED_SECRETS` in `tools/ccfg.js` — every command picks it up from there.


## The broker

The keychain protects a key from being copied off the machine. It does not protect it from this machine: anything running as your user can read it, and the agent runs as your user. `tools/ccfg-broker.js` closes that gap by moving the key somewhere your user cannot reach.

It is a loopback HTTP proxy meant to run as a dedicated service account under launchd. Claude Code points at `http://127.0.0.1:<port>/<route>` with no credential anywhere in its config; the broker adds the real key and forwards to an upstream pinned at config time. The agent keeps the capability — it can call the API — without the disclosure. Reading the key then requires root, and root requires your password.

What it enforces, each covered by a case in `tools/test-broker.js`:

- The caller cannot influence how the proxy authenticates. `Authorization`, `Cookie`, `x-api-key` and friends are stripped from every request, so a local process cannot supply its own credential or use a route as an open relay.
- The credential never travels back down. The same headers are stripped from the response, so an upstream that echoes the key cannot hand it to the caller through us.
- The caller names a route, never a URL. Upstreams are pinned in config and the daemon refuses to start on a non-https one, rather than discovering it per request.
- The `Host` header must be loopback. Binding to 127.0.0.1 alone does not stop DNS rebinding; checking the host does.
- Requests carry a shared token, compared in constant time.
- Logs record a route and a status. Never a body, a header, or a query string.

Install it with `ccfg broker install`. It creates the service account, copies the daemon and its interpreter somewhere root-owned, writes the config, loads the launchd job, waits for `/health`, and only then repoints `~/.claude.json`. Nothing is echoed: the keys go from the keychain into a 0600 file through a pipe.

```sh
ccfg broker install     # walks each step, asks before it changes anything
ccfg broker status      # is it running, and can this user still read the keys?
ccfg broker seal        # remove the keys from your login keychain
ccfg broker uninstall   # daemon, files and account
```

Two refusals are worth knowing about, because they are the difference between a boundary and a decoration:

**The interpreter must be untouchable.** Homebrew installs into a prefix owned by the logged-in user, so a daemon running `/opt/homebrew/bin/node` executes a binary that this user — and therefore the agent — can replace, and the replacement would run as the broker with the config open to it. The install checks the whole ancestor chain for user ownership and for group- or world-writable directories, and picks an interpreter that links only against system libraries so it can be copied somewhere root-owned and still start. If it cannot find one, it stops rather than installing something that only looks isolated.

**The keys have to leave your keychain.** Everything up to that point is inert: while the login keychain still holds them, anything running as you can read them and the broker is just an extra hop. That step is separate, prompted, and reported by `ccfg broker status`, which warns for as long as any managed key remains.

Twelve of the suite's cases cover the installer's own logic — the tamper check, route building, and the plist — but the install path itself has never run end to end here. `ccfg broker uninstall` is the rollback.


## Evidence

The failure this guards against: an unmeasured claim gets stated, repeated, summarised into a compaction, and read back afterwards as established fact — carrying whoever framed it rather than any evidence. Prose cannot be audited; a list of commands that really ran can be.

`hooks/evidence-log.js` records every shell command to `cache/evidence/<session>.jsonl`. `ccfg evidence` prints it, and the `Stop` hook names the count in its self-review reminder, so a report claiming more than the session observed is visibly doing so.

```sh
ccfg evidence              # most recent session
ccfg evidence 0ca7a916     # a specific one, by id prefix
```

**A recorded command means it ran, not that it succeeded.** This harness's `PostToolUse` response is `{stdout, stderr, interrupted, isImage, noOutputExpected}` — it carries no exit code, so status renders as `?` rather than `ok`. `interrupted` is the only failure signal available. The log stores no command output: provenance ("is there a command behind this claim?") does not need the bytes, and a log of everything printed would eventually hold a credential.


## Rules

- **Never commit secrets.** No API keys, tokens, or credentials in any tracked file — this repo may be cloned anywhere.
- Credentials live in the OS keychain (macOS Keychain, Windows Credential Manager, or libsecret on Linux) or `.credentials.json` (ignored), never here.
- Before adding a new path to the allowlist, grep it for secrets first.

---

[← Back to README](../README.md)
