[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $ClaudeArguments
)

$ErrorActionPreference = 'Stop'

$toolDirectory = Split-Path -Parent $PSCommandPath

. (Join-Path $toolDirectory 'lib\SolCommon.ps1')

$configuration = Import-SolConfig -ToolDirectory $toolDirectory

function Show-SolHelp {
    @'
claude-sol — claude code driven by an openrouter model

usage:
  claude-sol [claude args...]     launch claude code against openrouter
  claude-sol --sol-setup          store or replace the openrouter api key
  claude-sol --sol-doctor         show resolved config and credential state
  claude-sol --sol-forget         delete the stored key from this machine
  claude-sol --sol-help           this message

everything else is passed through to claude untouched.

config: tools\claude-sol\config.defaults   (shared, non-secret)
        %LOCALAPPDATA%\claude-sol\config    (per-machine overrides)
'@ | Write-Host
}

function Invoke-SolSetup {
    $existingSource = Get-SolKeySource

    if ($existingSource -ne 'none') {
        Write-Host "existing key found in $existingSource — it will be replaced."
    }

    $enteredKey = Read-SolApiKeyFromPrompt

    if (-not $enteredKey) {
        Write-Host 'no key entered, nothing stored.'

        return 1
    }

    $validationResult = Test-SolApiKey -ApiKey $enteredKey -ValidationUrl $configuration.CLAUDE_SOL_KEY_VALIDATION_URL

    if ($validationResult -eq 'rejected') {
        Write-Host 'openrouter rejected that key (401/403). nothing stored.'

        return 1
    }

    if ($validationResult -eq 'valid') {
        Write-Host 'key accepted by openrouter.'
    }
    else {
        Write-Host 'could not reach openrouter to verify the key — storing it anyway.'
    }

    $credentialFile = Write-SolApiKey -ApiKey $enteredKey

    Write-Host "stored dpapi-encrypted (current windows user only) at $credentialFile"

    return 0
}

function Invoke-SolDoctor {
    $claudeCommand = Find-SolClaudeCommand
    $keySource = Get-SolKeySource

    $claudeCommandLabel = 'NOT FOUND'

    if ($claudeCommand) {
        $claudeCommandLabel = $claudeCommand
    }

    $smallModelLabel = '(claude default)'

    if ($configuration.CLAUDE_SOL_SMALL_MODEL) {
        $smallModelLabel = $configuration.CLAUDE_SOL_SMALL_MODEL
    }

    $maxOutputTokensLabel = '(claude default)'

    if ($configuration.CLAUDE_SOL_MAX_OUTPUT_TOKENS) {
        $maxOutputTokensLabel = $configuration.CLAUDE_SOL_MAX_OUTPUT_TOKENS
    }

    Write-Host ('platform          windows {0}' -f $env:PROCESSOR_ARCHITECTURE)
    Write-Host ('launcher          {0}' -f $PSCommandPath)
    Write-Host ('claude binary     {0}' -f $claudeCommandLabel)
    Write-Host ('base url          {0}' -f $configuration.CLAUDE_SOL_BASE_URL)
    Write-Host ('model             {0}' -f $configuration.CLAUDE_SOL_MODEL)
    Write-Host ('small model       {0}' -f $smallModelLabel)
    Write-Host ('max output tokens {0}' -f $maxOutputTokensLabel)
    Write-Host ('credential store  dpapi (current windows user)')
    Write-Host ('key source        {0}' -f $keySource)

    if ($keySource -eq 'none') {
        Write-Host 'key               missing — run claude-sol --sol-setup'

        return 1
    }

    $apiKey = Read-SolApiKey

    if (-not $apiKey) {
        Write-Host 'key               present but undecryptable by this account — run claude-sol --sol-setup'

        return 1
    }

    Write-Host ('key               {0}' -f (Format-SolMaskedKey -ApiKey $apiKey))

    $validationResult = Test-SolApiKey -ApiKey $apiKey -ValidationUrl $configuration.CLAUDE_SOL_KEY_VALIDATION_URL

    if ($validationResult -eq 'valid') {
        Write-Host 'openrouter        reachable, key valid'
    }
    elseif ($validationResult -eq 'rejected') {
        Write-Host 'openrouter        key rejected (401/403) — run claude-sol --sol-setup'

        return 1
    }
    else {
        Write-Host 'openrouter        unreachable or unexpected response (not necessarily a key problem)'
    }

    if (-not $claudeCommand) {
        return 1
    }

    return 0
}

$firstArgument = ''

if ($ClaudeArguments -and $ClaudeArguments.Count -gt 0) {
    $firstArgument = $ClaudeArguments[0]
}

switch ($firstArgument) {
    '--sol-help' {
        Show-SolHelp

        exit 0
    }
    '--sol-setup' {
        exit (Invoke-SolSetup)
    }
    '--sol-doctor' {
        exit (Invoke-SolDoctor)
    }
    '--sol-forget' {
        if (Remove-SolApiKey) {
            Write-Host 'stored key removed from this machine.'
        }
        else {
            Write-Host 'no stored key found.'
        }

        exit 0
    }
}

$claudeCommand = Find-SolClaudeCommand

if (-not $claudeCommand) {
    Write-Host 'claude code is not installed or not on PATH.'
    Write-Host ('run: powershell -ExecutionPolicy Bypass -File {0}\bootstrap.ps1' -f $toolDirectory)

    exit 127
}

$apiKey = Read-SolApiKey

if (-not $apiKey) {
    Write-Host 'no usable openrouter api key on this machine.'
    Write-Host 'run: claude-sol --sol-setup'

    exit 78
}

$env:ANTHROPIC_BASE_URL = $configuration.CLAUDE_SOL_BASE_URL
$env:ANTHROPIC_AUTH_TOKEN = $apiKey
$env:ANTHROPIC_API_KEY = ''
$env:ANTHROPIC_MODEL = $configuration.CLAUDE_SOL_MODEL
$env:CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = $configuration.CLAUDE_SOL_DISABLE_EXPERIMENTAL_BETAS

if ($configuration.CLAUDE_SOL_SMALL_MODEL) {
    $env:ANTHROPIC_DEFAULT_HAIKU_MODEL = $configuration.CLAUDE_SOL_SMALL_MODEL
    $env:ANTHROPIC_SMALL_FAST_MODEL = $configuration.CLAUDE_SOL_SMALL_MODEL
}

if ($configuration.CLAUDE_SOL_MAX_OUTPUT_TOKENS) {
    $env:CLAUDE_CODE_MAX_OUTPUT_TOKENS = $configuration.CLAUDE_SOL_MAX_OUTPUT_TOKENS
}

$passthroughArguments = @()

if ($ClaudeArguments) {
    $passthroughArguments = $ClaudeArguments
}

& $claudeCommand @passthroughArguments

exit $LASTEXITCODE
