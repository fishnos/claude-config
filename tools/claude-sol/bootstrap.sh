#!/usr/bin/env sh
set -eu

script_real_path=$0

while [ -L "$script_real_path" ]; do
    link_target=$(readlink "$script_real_path")

    case $link_target in
        /*) script_real_path=$link_target ;;
        *) script_real_path=$(dirname "$script_real_path")/$link_target ;;
    esac
done

tool_directory=$(cd "$(dirname "$script_real_path")" && pwd)

. "$tool_directory/lib/sol-common.sh"

sol_load_config "$tool_directory"

replace_stored_key=0
install_claude_when_missing=1
remove_legacy_alias=ask
user_bin_directory=${CLAUDE_SOL_BIN_DIR:-$HOME/.local/bin}

while [ $# -gt 0 ]; do
    case $1 in
        --replace-key) replace_stored_key=1 ;;
        --no-install-claude) install_claude_when_missing=0 ;;
        --keep-legacy-alias) remove_legacy_alias=no ;;
        --remove-legacy-alias) remove_legacy_alias=yes ;;
        --help|-h)
            cat <<'HELP'
claude-sol bootstrap — make claude-sol work on this machine

  sh bootstrap.sh [options]

  --replace-key           prompt for a new openrouter key even if one is stored
  --no-install-claude     fail instead of installing claude code when missing
  --remove-legacy-alias   delete any plaintext `alias claude-sol=` from shell rc files
  --keep-legacy-alias     leave legacy aliases alone
HELP

            exit 0
            ;;
        *)
            printf 'unknown option: %s\n' "$1" >&2

            exit 64
            ;;
    esac

    shift
done

step() {
    printf '\n== %s\n' "$1"
}

step 'claude code'

claude_binary=$(sol_find_claude_binary || true)

if [ -n "$claude_binary" ]; then
    printf 'already installed: %s\n' "$claude_binary"
elif [ "$install_claude_when_missing" -eq 0 ]; then
    printf 'claude code is missing and --no-install-claude was passed.\n' >&2

    exit 1
else
    printf 'not found — installing claude code...\n'

    if sol_has_command curl; then
        if sol_has_command bash; then
            curl -fsSL https://claude.ai/install.sh | bash
        else
            curl -fsSL https://claude.ai/install.sh | sh
        fi
    elif sol_has_command npm; then
        npm install -g @anthropic-ai/claude-code
    else
        printf 'neither curl nor npm is available — install claude code manually, then rerun.\n' >&2

        exit 1
    fi

    PATH=$HOME/.local/bin:$PATH
    export PATH

    claude_binary=$(sol_find_claude_binary || true)

    if [ -z "$claude_binary" ]; then
        printf 'install finished but claude is still not on PATH — open a new shell and rerun.\n' >&2

        exit 1
    fi

    printf 'installed: %s\n' "$claude_binary"
fi

step 'openrouter credential'

existing_source=$(sol_key_source || true)

if [ "$existing_source" != none ] && [ "$replace_stored_key" -eq 0 ]; then
    printf 'key already available from %s (pass --replace-key to change it).\n' "$existing_source"
else
    preferred_backend=$(sol_preferred_backend)

    case $preferred_backend in
        keychain) printf 'this machine will use the macos keychain.\n' ;;
        secret-service) printf 'this machine will use the desktop keyring (secret service).\n' ;;
        file) printf 'no secure keyring detected — falling back to a mode-600 file at %s\n' "$(sol_credentials_file)" ;;
    esac

    entered_key=$(sol_prompt_key 'enter openrouter api key (input hidden): ')

    if [ -z "$entered_key" ]; then
        printf 'no key entered — aborting.\n' >&2

        exit 1
    fi

    validation_status=0
    sol_validate_key "$entered_key" || validation_status=$?

    if [ "$validation_status" -eq 0 ]; then
        printf 'openrouter accepted the key.\n'
    elif [ "$validation_status" -eq 1 ]; then
        printf 'openrouter rejected that key (401/403) — nothing stored.\n' >&2

        exit 1
    else
        printf 'could not verify the key against openrouter — storing it anyway.\n'
    fi

    chosen_backend=$(sol_write_key "$entered_key")

    printf 'stored via backend: %s\n' "$chosen_backend"
fi

step 'launcher'

mkdir -p "$user_bin_directory"

launcher_target=$tool_directory/claude-sol
launcher_link=$user_bin_directory/claude-sol

chmod +x "$launcher_target" 2>/dev/null || true

if ln -sfn "$launcher_target" "$launcher_link" 2>/dev/null; then
    printf 'symlinked %s -> %s\n' "$launcher_link" "$launcher_target"
else
    printf '#!/usr/bin/env sh\nexec "%s" "$@"\n' "$launcher_target" > "$launcher_link"
    chmod +x "$launcher_link"

    printf 'wrote exec shim %s\n' "$launcher_link"
fi

step 'PATH'

case ":$PATH:" in
    *":$user_bin_directory:"*)
        printf '%s already on PATH.\n' "$user_bin_directory"
        ;;
    *)
        shell_name=$(basename "${SHELL:-/bin/sh}")

        case $shell_name in
            zsh) shell_rc=$HOME/.zshrc ;;
            bash)
                if [ "$(uname -s 2>/dev/null)" = Darwin ] && [ -f "$HOME/.bash_profile" ]; then
                    shell_rc=$HOME/.bash_profile
                else
                    shell_rc=$HOME/.bashrc
                fi
                ;;
            *) shell_rc=$HOME/.profile ;;
        esac

        if [ -f "$shell_rc" ] && grep -q 'claude-sol bootstrap: user bin' "$shell_rc" 2>/dev/null; then
            printf '%s already carries the PATH line.\n' "$shell_rc"
        else
            printf '\n# claude-sol bootstrap: user bin\nexport PATH="%s:$PATH"\n' "$user_bin_directory" >> "$shell_rc"

            printf 'added %s to PATH in %s (open a new shell to pick it up).\n' "$user_bin_directory" "$shell_rc"
        fi

        PATH=$user_bin_directory:$PATH
        export PATH
        ;;
esac

step 'legacy plaintext alias'

legacy_files=''

for candidate_rc in "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
    [ -f "$candidate_rc" ] || continue

    if grep -qE '^[[:space:]]*alias[[:space:]]+claude-sol=' "$candidate_rc" 2>/dev/null; then
        legacy_files="$legacy_files $candidate_rc"
    fi
done

if [ -z "$legacy_files" ]; then
    printf 'no plaintext claude-sol alias found.\n'
else
    printf 'plaintext alias (holding a bare api key) found in:%s\n' "$legacy_files"

    if [ "$remove_legacy_alias" = ask ]; then
        if [ -t 0 ]; then
            printf 'remove it? the old key stays readable in a mode-600 backup. [y/N] '
            IFS= read -r alias_answer

            case $alias_answer in
                y|Y|yes|YES) remove_legacy_alias=yes ;;
                *) remove_legacy_alias=no ;;
            esac
        else
            remove_legacy_alias=no
        fi
    fi

    if [ "$remove_legacy_alias" = yes ]; then
        backup_directory=$HOME/.claude-sol-backups

        mkdir -p "$backup_directory"
        chmod 700 "$backup_directory" 2>/dev/null

        backup_stamp=$(date +%Y%m%d%H%M%S)

        for legacy_file in $legacy_files; do
            backup_path=$backup_directory/$(basename "$legacy_file").$backup_stamp

            previous_umask=$(umask)
            umask 077
            cp "$legacy_file" "$backup_path"
            umask "$previous_umask"
            chmod 600 "$backup_path" 2>/dev/null

            awk '
                skipping == 1 { if ($0 !~ /\\$/) { skipping = 0 } next }
                /^[[:space:]]*alias[[:space:]]+claude-sol=/ { if ($0 ~ /\\$/) { skipping = 1 } next }
                { print }
            ' "$legacy_file" > "$legacy_file.claude-sol-tmp"

            mv "$legacy_file.claude-sol-tmp" "$legacy_file"

            printf 'cleaned %s (backup: %s)\n' "$legacy_file" "$backup_path"
        done

        printf 'the old key is still in shell history and in that backup — rotate it at openrouter if you want it dead.\n'
    else
        printf 'left in place. your key stays in plaintext on disk until you remove it.\n'
    fi
fi

step 'verification'

"$launcher_link" --sol-doctor
