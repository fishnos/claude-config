#!/usr/bin/env sh

CLAUDE_SOL_SERVICE_NAME=claude-sol
CLAUDE_SOL_ACCOUNT_NAME=openrouter-api-key

sol_config_directory() {
    if [ -n "${XDG_CONFIG_HOME:-}" ]; then
        printf '%s/claude-sol\n' "$XDG_CONFIG_HOME"
    else
        printf '%s/.config/claude-sol\n' "$HOME"
    fi
}

sol_credentials_file() {
    printf '%s/credentials\n' "$(sol_config_directory)"
}

sol_machine_config_file() {
    printf '%s/config\n' "$(sol_config_directory)"
}

sol_resolve_real_path() {
    resolved_path=$1

    while [ -L "$resolved_path" ]; do
        link_target=$(readlink "$resolved_path")

        case $link_target in
            /*) resolved_path=$link_target ;;
            *) resolved_path=$(dirname "$resolved_path")/$link_target ;;
        esac
    done

    printf '%s\n' "$resolved_path"
}

sol_load_config() {
    tool_directory=$1
    seen_setting_names=''

    for config_file in "$tool_directory/config.defaults" "$(sol_machine_config_file)"; do
        [ -f "$config_file" ] || continue

        while IFS= read -r config_line || [ -n "$config_line" ]; do
            case $config_line in
                ''|'#'*) continue ;;
            esac

            config_name=${config_line%%=*}
            config_value=${config_line#*=}

            case $config_name in
                CLAUDE_SOL_*) ;;
                *) continue ;;
            esac

            case " $seen_setting_names " in
                *" $config_name "*) ;;
                *)
                    seen_setting_names="${seen_setting_names}${config_name} "

                    eval "environment_value=\${$config_name:-}"
                    eval "SOL_ENVIRONMENT_SNAPSHOT_$config_name=\$environment_value"
                    ;;
            esac

            eval "$config_name=\$config_value"
        done < "$config_file"
    done

    remaining_setting_names=$seen_setting_names

    while [ -n "$remaining_setting_names" ]; do
        config_name=${remaining_setting_names%% *}
        remaining_setting_names=${remaining_setting_names#"$config_name" }

        if [ -z "$config_name" ]; then
            break
        fi

        eval "environment_value=\$SOL_ENVIRONMENT_SNAPSHOT_$config_name"

        if [ -n "$environment_value" ]; then
            eval "$config_name=\$environment_value"
        fi
    done

    : "${CLAUDE_SOL_BASE_URL:=https://openrouter.ai/api}"
    : "${CLAUDE_SOL_MODEL:=openai/gpt-5.6-sol}"
    : "${CLAUDE_SOL_DISABLE_EXPERIMENTAL_BETAS:=1}"
    : "${CLAUDE_SOL_SMALL_MODEL:=}"
    : "${CLAUDE_SOL_MAX_OUTPUT_TOKENS:=}"
    : "${CLAUDE_SOL_KEY_VALIDATION_URL:=https://openrouter.ai/api/v1/key}"
    : "${CLAUDE_SOL_BASELINE_LIMIT:=}"
    : "${CLAUDE_SOL_KEY_HASH:=}"
}

sol_has_command() {
    command -v "$1" >/dev/null 2>&1
}

sol_keychain_available() {
    [ "$(uname -s 2>/dev/null)" = Darwin ] && sol_has_command security
}

sol_secret_service_available() {
    sol_has_command secret-tool || return 1
    [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] || return 1

    secret-tool lookup claude-sol-probe availability >/dev/null 2>&1
    probe_status=$?

    [ "$probe_status" -le 1 ]
}

sol_preferred_backend() {
    if sol_keychain_available; then
        printf 'keychain\n'
    elif sol_secret_service_available; then
        printf 'secret-service\n'
    else
        printf 'file\n'
    fi
}

sol_read_key() {
    if [ -n "${CLAUDE_SOL_API_KEY:-}" ]; then
        printf '%s\n' "$CLAUDE_SOL_API_KEY"

        return 0
    fi

    if sol_keychain_available; then
        keychain_key=$(security find-generic-password -s "$CLAUDE_SOL_SERVICE_NAME" -a "$CLAUDE_SOL_ACCOUNT_NAME" -w 2>/dev/null)

        if [ -n "$keychain_key" ]; then
            printf '%s\n' "$keychain_key"

            return 0
        fi
    fi

    if sol_has_command secret-tool; then
        secret_service_key=$(secret-tool lookup service "$CLAUDE_SOL_SERVICE_NAME" account "$CLAUDE_SOL_ACCOUNT_NAME" 2>/dev/null)

        if [ -n "$secret_service_key" ]; then
            printf '%s\n' "$secret_service_key"

            return 0
        fi
    fi

    credentials_path=$(sol_credentials_file)

    if [ -f "$credentials_path" ]; then
        file_key=$(sed -n 's/^OPENROUTER_API_KEY=//p' "$credentials_path" | head -n 1)

        if [ -n "$file_key" ]; then
            printf '%s\n' "$file_key"

            return 0
        fi
    fi

    return 1
}

sol_key_source() {
    if [ -n "${CLAUDE_SOL_API_KEY:-}" ]; then
        printf 'environment (CLAUDE_SOL_API_KEY)\n'

        return 0
    fi

    if sol_keychain_available && security find-generic-password -s "$CLAUDE_SOL_SERVICE_NAME" -a "$CLAUDE_SOL_ACCOUNT_NAME" -w >/dev/null 2>&1; then
        printf 'macos keychain\n'

        return 0
    fi

    if sol_has_command secret-tool && [ -n "$(secret-tool lookup service "$CLAUDE_SOL_SERVICE_NAME" account "$CLAUDE_SOL_ACCOUNT_NAME" 2>/dev/null)" ]; then
        printf 'secret service keyring\n'

        return 0
    fi

    credentials_path=$(sol_credentials_file)

    if [ -f "$credentials_path" ] && grep -q '^OPENROUTER_API_KEY=' "$credentials_path" 2>/dev/null; then
        printf 'restricted file (%s)\n' "$credentials_path"

        return 0
    fi

    printf 'none\n'

    return 1
}

sol_write_key() {
    api_key=$1
    backend=${2:-}

    [ -n "$backend" ] || backend=$(sol_preferred_backend)

    case $backend in
        keychain)
            security add-generic-password -U -s "$CLAUDE_SOL_SERVICE_NAME" -a "$CLAUDE_SOL_ACCOUNT_NAME" -D 'claude-sol openrouter key' -w "$api_key" >/dev/null 2>&1 || return 1
            ;;
        secret-service)
            printf '%s' "$api_key" | secret-tool store --label='claude-sol openrouter key' service "$CLAUDE_SOL_SERVICE_NAME" account "$CLAUDE_SOL_ACCOUNT_NAME" >/dev/null 2>&1 || return 1
            ;;
        file)
            config_directory=$(sol_config_directory)
            credentials_path=$(sol_credentials_file)

            mkdir -p "$config_directory" || return 1
            chmod 700 "$config_directory" 2>/dev/null

            previous_umask=$(umask)
            umask 077

            if ! printf 'OPENROUTER_API_KEY=%s\n' "$api_key" > "$credentials_path"; then
                umask "$previous_umask"

                return 1
            fi

            umask "$previous_umask"
            chmod 600 "$credentials_path" 2>/dev/null
            ;;
        *)
            return 1
            ;;
    esac

    printf '%s\n' "$backend"
}

sol_delete_key() {
    deleted_any=1

    if sol_keychain_available && security delete-generic-password -s "$CLAUDE_SOL_SERVICE_NAME" -a "$CLAUDE_SOL_ACCOUNT_NAME" >/dev/null 2>&1; then
        deleted_any=0
    fi

    if sol_has_command secret-tool && secret-tool clear service "$CLAUDE_SOL_SERVICE_NAME" account "$CLAUDE_SOL_ACCOUNT_NAME" >/dev/null 2>&1; then
        deleted_any=0
    fi

    credentials_path=$(sol_credentials_file)

    if [ -f "$credentials_path" ] && rm -f "$credentials_path"; then
        deleted_any=0
    fi

    return $deleted_any
}

sol_prompt_key() {
    prompt_text=${1:-'enter openrouter api key: '}

    printf '%s' "$prompt_text" >&2

    if [ -t 0 ]; then
        stty_state=$(stty -g 2>/dev/null)
        stty -echo 2>/dev/null
        IFS= read -r entered_key
        [ -n "$stty_state" ] && stty "$stty_state" 2>/dev/null
        printf '\n' >&2
    else
        IFS= read -r entered_key
    fi

    printf '%s\n' "$entered_key"
}

sol_mask_key() {
    api_key=$1
    key_length=${#api_key}

    if [ "$key_length" -le 12 ]; then
        printf '****\n'
    else
        printf '%s...%s\n' "$(printf '%s' "$api_key" | cut -c1-7)" "$(printf '%s' "$api_key" | tail -c 5)"
    fi
}

sol_validate_key() {
    api_key=$1
    validation_url=${2:-$CLAUDE_SOL_KEY_VALIDATION_URL}

    sol_has_command curl || return 2

    http_status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H "Authorization: Bearer $api_key" "$validation_url" 2>/dev/null)

    case $http_status in
        200) return 0 ;;
        401|403) return 1 ;;
        *) return 2 ;;
    esac
}

sol_find_claude_binary() {
    if [ -n "${CLAUDE_SOL_CLAUDE_BIN:-}" ] && [ -x "$CLAUDE_SOL_CLAUDE_BIN" ]; then
        printf '%s\n' "$CLAUDE_SOL_CLAUDE_BIN"

        return 0
    fi

    resolved_claude=$(command -v claude 2>/dev/null)

    if [ -n "$resolved_claude" ]; then
        printf '%s\n' "$resolved_claude"

        return 0
    fi

    for candidate_path in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" /usr/local/bin/claude /opt/homebrew/bin/claude; do
        if [ -x "$candidate_path" ]; then
            printf '%s\n' "$candidate_path"

            return 0
        fi
    done

    return 1
}

CLAUDE_SOL_PROVISIONING_ACCOUNT_NAME=openrouter-provisioning-key

sol_provisioning_credentials_file() {
    printf '%s/provisioning-credentials\n' "$(sol_config_directory)"
}

sol_limit_state_file() {
    printf '%s/limit-state.json\n' "$(sol_config_directory)"
}

sol_read_provisioning_key() {
    if [ -n "${CLAUDE_SOL_PROVISIONING_KEY:-}" ]; then
        printf '%s\n' "$CLAUDE_SOL_PROVISIONING_KEY"

        return 0
    fi

    if sol_keychain_available; then
        keychain_value=$(security find-generic-password -s "$CLAUDE_SOL_SERVICE_NAME" -a "$CLAUDE_SOL_PROVISIONING_ACCOUNT_NAME" -w 2>/dev/null)

        if [ -n "$keychain_value" ]; then
            printf '%s\n' "$keychain_value"

            return 0
        fi
    fi

    if sol_has_command secret-tool; then
        secret_service_value=$(secret-tool lookup service "$CLAUDE_SOL_SERVICE_NAME" account "$CLAUDE_SOL_PROVISIONING_ACCOUNT_NAME" 2>/dev/null)

        if [ -n "$secret_service_value" ]; then
            printf '%s\n' "$secret_service_value"

            return 0
        fi
    fi

    provisioning_path=$(sol_provisioning_credentials_file)

    if [ -f "$provisioning_path" ]; then
        file_value=$(sed -n 's/^OPENROUTER_PROVISIONING_KEY=//p' "$provisioning_path" | head -n 1)

        if [ -n "$file_value" ]; then
            printf '%s\n' "$file_value"

            return 0
        fi
    fi

    return 1
}

sol_write_provisioning_key() {
    provisioning_key=$1
    backend=$(sol_preferred_backend)

    case $backend in
        keychain)
            security add-generic-password -U -s "$CLAUDE_SOL_SERVICE_NAME" -a "$CLAUDE_SOL_PROVISIONING_ACCOUNT_NAME" -D 'claude-sol openrouter provisioning key' -w "$provisioning_key" >/dev/null 2>&1 || return 1
            ;;
        secret-service)
            printf '%s' "$provisioning_key" | secret-tool store --label='claude-sol openrouter provisioning key' service "$CLAUDE_SOL_SERVICE_NAME" account "$CLAUDE_SOL_PROVISIONING_ACCOUNT_NAME" >/dev/null 2>&1 || return 1
            ;;
        file)
            config_directory=$(sol_config_directory)
            provisioning_path=$(sol_provisioning_credentials_file)

            mkdir -p "$config_directory" || return 1
            chmod 700 "$config_directory" 2>/dev/null

            previous_umask=$(umask)
            umask 077

            if ! printf 'OPENROUTER_PROVISIONING_KEY=%s\n' "$provisioning_key" > "$provisioning_path"; then
                umask "$previous_umask"

                return 1
            fi

            umask "$previous_umask"
            chmod 600 "$provisioning_path" 2>/dev/null
            ;;
        *)
            return 1
            ;;
    esac

    printf '%s\n' "$backend"
}

sol_find_node() {
    for candidate_command in node nodejs; do
        resolved_node=$(command -v "$candidate_command" 2>/dev/null)

        if [ -n "$resolved_node" ]; then
            printf '%s\n' "$resolved_node"

            return 0
        fi
    done

    return 1
}

sol_run_limit_command() {
    tool_directory=$1
    shift

    node_binary=$(sol_find_node) || {
        printf 'limit management needs node on PATH.\n' >&2

        return 1
    }

    SOL_BASE_URL=$CLAUDE_SOL_BASE_URL
    SOL_INFERENCE_KEY=$(sol_read_key || printf '')
    SOL_PROVISIONING_KEY=$(sol_read_provisioning_key || printf '')
    SOL_STATE_FILE=$(sol_limit_state_file)
    SOL_BASELINE_LIMIT=$CLAUDE_SOL_BASELINE_LIMIT
    SOL_KEY_HASH=$CLAUDE_SOL_KEY_HASH

    export SOL_BASE_URL SOL_INFERENCE_KEY SOL_PROVISIONING_KEY SOL_STATE_FILE SOL_BASELINE_LIMIT SOL_KEY_HASH

    "$node_binary" "$tool_directory/lib/sol-limit.js" "$@"
}

sol_limit_reset_is_due() {
    state_path=$(sol_limit_state_file)

    [ -f "$state_path" ] || return 1

    reset_on=$(sed -n 's/.*"reset_on"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$state_path" | head -n 1)

    [ -n "$reset_on" ] || return 1

    today_number=$(date -u +%Y%m%d)
    reset_number=$(printf '%s' "$reset_on" | tr -d -)

    case $reset_number in
        ''|*[!0-9]*) return 1 ;;
    esac

    [ "$today_number" -ge "$reset_number" ]
}
