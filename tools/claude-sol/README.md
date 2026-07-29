# claude-sol

runs claude code against an openrouter model (`openai/gpt-5.6-sol` by default) on any
machine, without the api key ever touching this git repository.

normal `claude` is untouched — it keeps using your anthropic login. `claude-sol` is a
separate command.

## new machine, one command

```sh
# if ~/.claude does not exist yet
git clone https://github.com/fishnos/claude-config.git ~/.claude

# if ~/.claude already exists (usual case: claude code created it)
cd ~/.claude
git init
git remote add origin https://github.com/fishnos/claude-config.git
git fetch origin
git checkout -f -B main origin/main
```

then:

| platform | bootstrap |
| --- | --- |
| macos / linux / wsl | `sh ~/.claude/tools/claude-sol/bootstrap.sh` |
| windows (powershell) | `powershell -ExecutionPolicy Bypass -File $env:USERPROFILE\.claude\tools\claude-sol\bootstrap.ps1` |

the bootstrap installs claude code only when it is missing, prompts once for the
openrouter key with hidden input, stores it in the best credential store the machine
has, installs the `claude-sol` launcher into a user-local bin directory, puts that
directory on PATH, offers to delete any old plaintext `alias claude-sol=`, and finishes
with a doctor check.

## where the key lives

| platform | store |
| --- | --- |
| macos | keychain — service `claude-sol`, account `openrouter-api-key` |
| linux / wsl with a keyring | secret service via `secret-tool`, same service and account |
| linux / wsl without a keyring | `~/.config/claude-sol/credentials`, file mode 600 in a 700 directory |
| windows | `%LOCALAPPDATA%\claude-sol\credentials.dpapi`, dpapi-encrypted for the current user, owner-only acl |

the key is never written into this repo, into `settings.json`, or into a shell rc file.
the `.gitignore` allowlist tracks only `tools/claude-sol/**`, so a stray credential file
inside the repo still could not be committed.

`CLAUDE_SOL_API_KEY` in the environment overrides every store — useful for ci or a
throwaway container.

the plaintext-file fallback is the weak link: anyone who can read your account (or root)
can read it. it is only used where no keyring exists.

## commands

```
claude-sol                  launch claude code against openrouter
claude-sol --sol-setup      store or replace the key
claude-sol --sol-doctor     show resolved config, key source, masked key, connectivity
claude-sol --sol-forget     delete the stored key from this machine
claude-sol --sol-help       usage
```

any other argument is passed to `claude` untouched, so `claude-sol --resume`,
`claude-sol -p "..."`, and friends all work.

## config

`config.defaults` in this directory is shared across machines and holds no secrets:

```
CLAUDE_SOL_BASE_URL=https://openrouter.ai/api
CLAUDE_SOL_MODEL=openai/gpt-5.6-sol
CLAUDE_SOL_DISABLE_EXPERIMENTAL_BETAS=1
CLAUDE_SOL_SMALL_MODEL=
CLAUDE_SOL_MAX_OUTPUT_TOKENS=
CLAUDE_SOL_KEY_VALIDATION_URL=https://openrouter.ai/api/v1/key
```

per-machine overrides go in `~/.config/claude-sol/config` (posix) or
`%LOCALAPPDATA%\claude-sol\config` (windows), same `KEY=value` shape. environment
variables of the same names win over both.

`CLAUDE_SOL_MAX_OUTPUT_TOKENS` caps claude code's requested output tokens. leave it
empty for claude's default (32000). set it when openrouter answers `402 this request
requires more credits, or fewer max_tokens` — that error is your key's remaining daily
limit, not a launcher problem; either raise the limit at openrouter or set this below
the affordable number.

`CLAUDE_SOL_SMALL_MODEL` is empty by default. set it to an openrouter model id if
claude code's background haiku calls start failing against openrouter.

## bootstrap flags

```
sh bootstrap.sh --replace-key           prompt for a new key even if one is stored
sh bootstrap.sh --no-install-claude     fail instead of installing claude code
sh bootstrap.sh --remove-legacy-alias   delete plaintext aliases without asking
sh bootstrap.sh --keep-legacy-alias     leave them alone
```

windows: `-ReplaceKey`, `-NoInstallClaude`.
