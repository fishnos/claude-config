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

Seven additional hooks enforce the standards documented in [Engineering standards](#engineering-standards). Like the two above they are Node, invoked through the same `node -e` bootstrap, so they run identically on macOS, Windows, and Linux.

| Hook                          | Script                     | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PreToolUse` (`Bash`)         | `hooks/git-guard.js`       | **Denies** `commit`, `push`, force-push, `--no-verify`, `reset --hard`, `clean -f`, `git add -A` from the home directory, staged credentials (AWS/GitHub/OpenAI/Anthropic/Slack/GitLab keys, private keys, JWTs), and the outward-facing non-git commands below. **Warns** on logic staged without tests, >1000 staged lines, and commit messages that break the subject, wrapping, or body-length conventions -- including a subject that opens on the effect (`Stop ...`) instead of the work that produced it -- whether passed with `-m` or by file with `-F`. |
| `PostToolUse` (`Edit\|Write`) | `hooks/style-check.js`     | Flags style-guide violations a formatter cannot fix: `@ts-ignore`, `var`, `debugger`, `.only`, loose `==`, bare `except:`, mutable default arguments, wildcard imports.                                                                                                                                                                                                                                                                                                                                                                                            |
| `Stop`                        | `hooks/review-reminder.js` | Requires one self-review pass before work is reported done. Fires at most once per session, and only when source files were edited.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `SessionStart`                | `hooks/config-sentinel.js` | Cheap drift check: `settings.json` parses, every hook it references exists, and no MCP credential sits in `~/.claude.json` as plaintext. Silent when clean.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `UserPromptSubmit`            | `hooks/repo-context.js`    | Injects branch, uncommitted count, upstream drift, and package manager. Emitted only when that state changes, so identical context is never repeated.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `PostToolUse` (`Bash`)        | `hooks/evidence-log.js`    | Records every shell command that ran, to `cache/evidence/<session>.jsonl`. Command text, output length and interruption only — never command output, which would eventually capture a credential.                                                                                                                                                                                                                                                                                                                                                                  |

**Outward-facing commands.** Everything that publishes or destroys state off this machine is denied with a per-family escape, never one blanket switch:

| Blocked                                                                                                    | Escape                   |
| ---------------------------------------------------------------------------------------------------------- | ------------------------ |
| `gh repo delete\|archive\|rename\|transfer`, `gh pr merge`, `gh release create\|delete`, mutating `gh api` | `CLAUDE_ALLOW_GH=1`      |
| `npm\|pnpm\|yarn\|bun publish`                                                                             | `CLAUDE_ALLOW_PUBLISH=1` |
| `vercel env add\|rm`, `vercel promote\|rollback`, any `vercel --prod`                                      | `CLAUDE_ALLOW_DEPLOY=1`  |
| `supabase db push\|reset`, `supabase migration repair`                                                     | `CLAUDE_ALLOW_DB=1`      |
| `git commit`                                                                                               | `CLAUDE_ALLOW_COMMIT=1`  |

Read-only forms stay unblocked on purpose — `gh repo view`, a default-GET `gh api`, `vercel env ls`, `vercel build --prod`, and `supabase migration list` all run without a prompt. `gh pr create` and `gh repo create` warn rather than block.

Two bypasses the guard closes that a permission rule cannot: leading env assignments (`FOO=1 git push`) and git's global options (`git -C /repo push`, `git --no-pager push`). A `settings.json` deny rule matches a literal prefix, so both walk straight past it; the hook normalizes the command before matching.

**Credential reads.** `permissions.deny` binds the Read tool only — `cat ~/.ssh/id_ed25519` reaches the file anyway. The guard closes that by matching credential _paths_ anywhere in a Bash command, which covers every reader at once rather than enumerating them: `cat`, `less`, `grep`, `base64`, `strings`, `tar`, stdin redirection, and interpreters like `node -e` / `python3 -c`. Also blocked: whole-environment dumps (`env`, `printenv`) and expanding any `*_API_KEY` / `*_TOKEN` / `*_SECRET` variable, since after `shell-init.sh` runs those hold live MCP keys.

Covered: `.ssh`, `.aws`, `.gnupg`, `.docker`, `.config/gcloud`, `.config/gh`, `.config/21st`, `.netrc`, `.npmrc`, `.pem`/`.p12`/`.pfx`, `credentials.json`, `secrets.env`, and any non-template `.env`. Escape: `CLAUDE_ALLOW_SECRET_READ=1`.

Deliberate exemptions, because over-blocking gets a guard switched off: `.env.example`/`.sample`/`.template` stay readable, `process.env.FOO` in JavaScript is not a dotenv path, and `env NODE_ENV=test npm run build` is not an environment dump. `vercel env pull .env.local` **is** blocked — it is read-only against Vercel but writes every live production secret to local disk.

This is a floor, not a boundary. Anything with code execution as this user can eventually reach these files; what it buys is that it cannot happen by accident, in passing, or without a visible refusal.

`hooks/lib/` holds the parts all three share: `hook-io.js` for the stdin/stdout protocol, git invocation, and the fail-open wrapper; `paths.js` for path classification; `mcp-secrets.js` for deciding whether an MCP credential is exposed or brokered, which `ccfg` reads from too so the sentinel and the doctor cannot reach different verdicts.

Four things make these portable rather than accidentally POSIX:

- **No `$HOME` and no `~`.** The `node -e` bootstrap resolves the config dir from `CLAUDE_CONFIG_DIR` or `os.homedir()`, so it works where `cmd.exe` performs no expansion.
- **Separators are normalized** before any path match. Windows hands over `src\__tests__\a.test.ts`, which would otherwise miss every `/`-anchored pattern and be misfiled as production logic.
- **Command splitting covers both shells** — `&&`, `||`, `;`, `|`, and the bare `&` that `cmd.exe` chains with.
- **CRLF is stripped** before content checks, so `$`-anchored rules keep matching on checkouts made with `autocrlf`.

Requires **Node ≥ 14.14** (`fs.rmSync`), well below the version the rest of this config already needs.

`hooks/test-hooks.js` is the regression suite for all seven — 264 cases, including deliberate false-positive tests, bypass tests (`FOO=1 git push` and `git -C /repo push` must both still be denied), Windows-shaped inputs (backslash paths, CRLF, `&` chaining), and a check that the suite itself never mutates live state. It is platform-neutral too: no shell invocation, and the hooks are spawned via `process.execPath`. Run it after any change:

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

Then run the setup tool:

```sh
node ~/.claude/tools/ccfg.js install
```

## ccfg

`tools/ccfg.js` manages this configuration. Zero dependencies on purpose — it has to run on a machine where nothing is installed yet, which is exactly when setup tooling is most needed. `install` puts a `ccfg` shim in `~/.local/bin`.

| Command             | Does                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `ccfg doctor`       | Health check: secrets, hooks, permissions, startup cost, disk. Exits non-zero on a problem. |
| `ccfg install`      | Installs the shim, writes `shell-init.sh`, wires your shell profile, lists what is missing. |
| `ccfg keys list`    | Every managed secret, and whether its value comes from the keychain, a file, or the env.    |
| `ccfg keys set`     | Stores a secret in the macOS Keychain, or `secrets.env` (mode 0600) elsewhere.              |
| `ccfg keys migrate` | Replaces plaintext keys in `~/.claude.json` with `${VAR}`, saving the values first.         |
| `ccfg shell-init`   | Prints the profile line; `--write` adds it to your profile for you (idempotent).            |
| `ccfg clean`        | Gzips idle logs, prunes caches older than 30 days. Dry run unless `--yes`.                  |
| `ccfg test`         | Runs the hook, ccfg and broker regression suites.                                           |
| `ccfg validate`     | Runs the full config validator.                                                             |
| `ccfg backup`       | Snapshots `settings.json`, `CLAUDE.md`, `hooks/`, and `~/.claude.json`.                     |

### Evidence

The failure this guards against: an unmeasured claim gets stated, repeated, summarised into a compaction, and read back afterwards as established fact — carrying whoever framed it rather than any evidence. Prose cannot be audited; a list of commands that really ran can be.

`hooks/evidence-log.js` records every shell command to `cache/evidence/<session>.jsonl`. `ccfg evidence` prints it, and the `Stop` hook names the count in its self-review reminder, so a report claiming more than the session observed is visibly doing so.

```sh
ccfg evidence              # most recent session
ccfg evidence 0ca7a916     # a specific one, by id prefix
```

**A recorded command means it ran, not that it succeeded.** This harness's `PostToolUse` response is `{stdout, stderr, interrupted, isImage, noOutputExpected}` — it carries no exit code, so status renders as `?` rather than `ok`. `interrupted` is the only failure signal available. The log stores no command output: provenance ("is there a command behind this claim?") does not need the bytes, and a log of everything printed would eventually hold a credential.

### Secrets

MCP servers that need an API key read it from the environment via a `${VAR}` placeholder in `~/.claude.json`, never as a literal. Values live in the macOS Keychain (service `ccfg`) or, on other platforms, in `~/.claude/secrets.env` at mode 0600. Both are git-ignored; `shell-init.sh` exports them into the shell that launches `claude`.

```sh
ccfg install               # shim, shell-init.sh, and the profile line, in one step
ccfg keys migrate          # move any plaintext keys out of ~/.claude.json
ccfg keys set CONTEXT7_API_KEY   # prompts; a value on the command line is refused
```

Migration is not rotation. A key that was ever plaintext on disk should be rotated at the provider first, then stored with `keys set`. `ccfg doctor` and the `SessionStart` hook both fail loudly while any plaintext key remains.

To manage a new server's key, add an entry to `MANAGED_SECRETS` in `tools/ccfg.js` — every command picks it up from there.

### The broker

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
