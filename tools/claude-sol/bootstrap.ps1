[CmdletBinding()]
param(
    [switch] $ReplaceKey,
    [switch] $NoInstallClaude
)

$ErrorActionPreference = 'Stop'

$toolDirectory = Split-Path -Parent $PSCommandPath

. (Join-Path $toolDirectory 'lib\SolCommon.ps1')

$configuration = Import-SolConfig -ToolDirectory $toolDirectory

function Write-SolStep {
    param([Parameter(Mandatory)][string] $Title)

    Write-Host ''
    Write-Host ('== {0}' -f $Title)
}

if (-not (Test-SolDpapiSupported)) {
    Write-Host 'this bootstrap is for windows. on macos, linux, or wsl run bootstrap.sh instead.'

    exit 1
}

Write-SolStep 'claude code'

$claudeCommand = Find-SolClaudeCommand

if ($claudeCommand) {
    Write-Host ('already installed: {0}' -f $claudeCommand)
}
elseif ($NoInstallClaude) {
    Write-Host 'claude code is missing and -NoInstallClaude was passed.'

    exit 1
}
else {
    Write-Host 'not found — installing claude code...'

    $installerScript = Invoke-RestMethod -Uri 'https://claude.ai/install.ps1' -UseBasicParsing

    Invoke-Expression $installerScript

    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machinePath, $userPath) | Where-Object { $_ }) -join ';'

    $claudeCommand = Find-SolClaudeCommand

    if (-not $claudeCommand) {
        Write-Host 'install finished but claude is still not on PATH — open a new terminal and rerun.'

        exit 1
    }

    Write-Host ('installed: {0}' -f $claudeCommand)
}

Write-SolStep 'openrouter credential'

$existingSource = Get-SolKeySource

if ($existingSource -ne 'none' -and -not $ReplaceKey) {
    Write-Host ('key already available from {0} (pass -ReplaceKey to change it).' -f $existingSource)
}
else {
    Write-Host 'the key will be encrypted with dpapi and readable only by this windows account on this machine.'

    $enteredKey = Read-SolApiKeyFromPrompt -Prompt 'enter openrouter api key (input hidden)'

    if (-not $enteredKey) {
        Write-Host 'no key entered — aborting.'

        exit 1
    }

    $validationResult = Test-SolApiKey -ApiKey $enteredKey -ValidationUrl $configuration.CLAUDE_SOL_KEY_VALIDATION_URL

    if ($validationResult -eq 'rejected') {
        Write-Host 'openrouter rejected that key (401/403) — nothing stored.'

        exit 1
    }

    if ($validationResult -eq 'valid') {
        Write-Host 'openrouter accepted the key.'
    }
    else {
        Write-Host 'could not verify the key against openrouter — storing it anyway.'
    }

    $credentialFile = Write-SolApiKey -ApiKey $enteredKey

    Write-Host ('stored at {0}' -f $credentialFile)
}

Write-SolStep 'launcher'

$shimDirectory = Join-Path $env:LOCALAPPDATA 'claude-sol\bin'

if (-not (Test-Path -LiteralPath $shimDirectory)) {
    New-Item -ItemType Directory -Path $shimDirectory -Force | Out-Null
}

$shimPath = Join-Path $shimDirectory 'claude-sol.cmd'
$repoLauncher = Join-Path $toolDirectory 'claude-sol.cmd'

$shimLines = @(
    '@echo off'
    ('"' + $repoLauncher + '" %*')
    'exit /b %ERRORLEVEL%'
)

Set-Content -LiteralPath $shimPath -Value $shimLines -Encoding ascii

Write-Host ('wrote shim {0} -> {1}' -f $shimPath, $repoLauncher)

Write-SolStep 'PATH'

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')

if (-not $userPath) {
    $userPath = ''
}

$pathEntries = $userPath.Split(';') | Where-Object { $_ }

if ($pathEntries -contains $shimDirectory) {
    Write-Host ('{0} already on the user PATH.' -f $shimDirectory)
}
else {
    $updatedPath = (@($pathEntries) + $shimDirectory) -join ';'

    [Environment]::SetEnvironmentVariable('Path', $updatedPath, 'User')

    Write-Host ('added {0} to the user PATH (open a new terminal to pick it up).' -f $shimDirectory)
}

$env:Path = $env:Path + ';' + $shimDirectory

Write-SolStep 'legacy plaintext launcher'

$profileCandidates = @($PROFILE.CurrentUserAllHosts, $PROFILE.CurrentUserCurrentHost) | Where-Object { $_ } | Select-Object -Unique
$legacyProfiles = @()

foreach ($profilePath in $profileCandidates) {
    if (-not (Test-Path -LiteralPath $profilePath)) {
        continue
    }

    $profileText = Get-Content -LiteralPath $profilePath -Raw

    if ($profileText -match 'claude-sol' -and $profileText -match 'ANTHROPIC_AUTH_TOKEN') {
        $legacyProfiles += $profilePath
    }
}

if ($legacyProfiles.Count -eq 0) {
    Write-Host 'no plaintext claude-sol launcher found in your powershell profiles.'
}
else {
    Write-Host 'these profiles appear to hold a bare api key — edit them by hand and delete the token:'

    foreach ($legacyProfile in $legacyProfiles) {
        Write-Host ('  {0}' -f $legacyProfile)
    }

    Write-Host 'rotate the key at openrouter afterwards if it was ever committed or shared.'
}

Write-SolStep 'verification'

& $shimPath '--sol-doctor'

exit $LASTEXITCODE
