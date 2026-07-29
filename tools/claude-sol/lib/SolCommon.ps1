Set-StrictMode -Version Latest

function Get-SolConfigDirectory {
    if ($env:CLAUDE_SOL_CONFIG_DIR) {
        return $env:CLAUDE_SOL_CONFIG_DIR
    }

    return (Join-Path $env:LOCALAPPDATA 'claude-sol')
}

function Get-SolCredentialFile {
    return (Join-Path (Get-SolConfigDirectory) 'credentials.dpapi')
}

function Get-SolMachineConfigFile {
    return (Join-Path (Get-SolConfigDirectory) 'config')
}

function Import-SolConfig {
    param([Parameter(Mandatory)][string] $ToolDirectory)

    $configuration = [ordered]@{
        CLAUDE_SOL_BASE_URL                   = 'https://openrouter.ai/api'
        CLAUDE_SOL_MODEL                      = 'openai/gpt-5.6-sol'
        CLAUDE_SOL_DISABLE_EXPERIMENTAL_BETAS = '1'
        CLAUDE_SOL_SMALL_MODEL                = ''
        CLAUDE_SOL_MAX_OUTPUT_TOKENS          = ''
        CLAUDE_SOL_KEY_VALIDATION_URL         = 'https://openrouter.ai/api/v1/key'
        CLAUDE_SOL_BASELINE_LIMIT             = ''
        CLAUDE_SOL_KEY_HASH                   = ''
    }

    $configurationFiles = @(
        (Join-Path $ToolDirectory 'config.defaults')
        (Get-SolMachineConfigFile)
    )

    foreach ($configurationFile in $configurationFiles) {
        if (-not (Test-Path -LiteralPath $configurationFile)) {
            continue
        }

        foreach ($configurationLine in Get-Content -LiteralPath $configurationFile) {
            $trimmedLine = $configurationLine.Trim()

            if (-not $trimmedLine -or $trimmedLine.StartsWith('#') -or -not $trimmedLine.Contains('=')) {
                continue
            }

            $separatorIndex = $trimmedLine.IndexOf('=')
            $settingName = $trimmedLine.Substring(0, $separatorIndex).Trim()
            $settingValue = $trimmedLine.Substring($separatorIndex + 1).Trim()

            if ($settingName -like 'CLAUDE_SOL_*') {
                $configuration[$settingName] = $settingValue
            }
        }
    }

    foreach ($settingName in @($configuration.Keys)) {
        $environmentOverride = [Environment]::GetEnvironmentVariable($settingName)

        if ($environmentOverride) {
            $configuration[$settingName] = $environmentOverride
        }
    }

    return $configuration
}

function Test-SolDpapiSupported {
    return ($env:OS -eq 'Windows_NT')
}

function Read-SolApiKey {
    if ($env:CLAUDE_SOL_API_KEY) {
        return $env:CLAUDE_SOL_API_KEY
    }

    $credentialFile = Get-SolCredentialFile

    if (-not (Test-Path -LiteralPath $credentialFile)) {
        return $null
    }

    try {
        $encryptedText = (Get-Content -LiteralPath $credentialFile -Raw).Trim()

        if (-not $encryptedText) {
            return $null
        }

        $secureKey = ConvertTo-SecureString -String $encryptedText

        return (New-Object System.Net.NetworkCredential('', $secureKey)).Password
    }
    catch {
        Write-Warning "stored credential could not be decrypted by this windows account: $($_.Exception.Message)"

        return $null
    }
}

function Get-SolKeySource {
    if ($env:CLAUDE_SOL_API_KEY) {
        return 'environment (CLAUDE_SOL_API_KEY)'
    }

    $credentialFile = Get-SolCredentialFile

    if (Test-Path -LiteralPath $credentialFile) {
        return "dpapi-encrypted file ($credentialFile)"
    }

    return 'none'
}

function Protect-SolFileAcl {
    param([Parameter(Mandatory)][string] $FilePath)

    try {
        $fileAcl = Get-Acl -LiteralPath $FilePath
        $fileAcl.SetAccessRuleProtection($true, $false)

        foreach ($existingRule in @($fileAcl.Access)) {
            $fileAcl.RemoveAccessRule($existingRule) | Out-Null
        }

        $currentUserName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $ownerOnlyRule = New-Object System.Security.AccessControl.FileSystemAccessRule($currentUserName, 'FullControl', 'Allow')

        $fileAcl.AddAccessRule($ownerOnlyRule)

        Set-Acl -LiteralPath $FilePath -AclObject $fileAcl
    }
    catch {
        Write-Warning "could not tighten permissions on ${FilePath}: $($_.Exception.Message)"
    }
}

function Write-SolApiKey {
    param([Parameter(Mandatory)][string] $ApiKey)

    if (-not (Test-SolDpapiSupported)) {
        throw 'dpapi is only available on windows — use the posix launcher on this platform.'
    }

    $configDirectory = Get-SolConfigDirectory

    if (-not (Test-Path -LiteralPath $configDirectory)) {
        New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
    }

    $credentialFile = Get-SolCredentialFile
    $secureKey = ConvertTo-SecureString -String $ApiKey -AsPlainText -Force
    $encryptedText = ConvertFrom-SecureString -SecureString $secureKey

    Set-Content -LiteralPath $credentialFile -Value $encryptedText -NoNewline -Encoding ascii

    Protect-SolFileAcl -FilePath $credentialFile

    return $credentialFile
}

function Remove-SolApiKey {
    $credentialFile = Get-SolCredentialFile

    if (Test-Path -LiteralPath $credentialFile) {
        Remove-Item -LiteralPath $credentialFile -Force

        return $true
    }

    return $false
}

function Read-SolApiKeyFromPrompt {
    param([string] $Prompt = 'enter openrouter api key')

    $secureKey = Read-Host -Prompt $Prompt -AsSecureString

    return (New-Object System.Net.NetworkCredential('', $secureKey)).Password
}

function Format-SolMaskedKey {
    param([Parameter(Mandatory)][string] $ApiKey)

    if ($ApiKey.Length -le 12) {
        return '****'
    }

    return ('{0}...{1}' -f $ApiKey.Substring(0, 7), $ApiKey.Substring($ApiKey.Length - 4))
}

function Test-SolApiKey {
    param(
        [Parameter(Mandatory)][string] $ApiKey,
        [Parameter(Mandatory)][string] $ValidationUrl
    )

    try {
        $response = Invoke-WebRequest -Uri $ValidationUrl -Headers @{ Authorization = "Bearer $ApiKey" } -TimeoutSec 15 -UseBasicParsing

        if ($response.StatusCode -eq 200) {
            return 'valid'
        }

        return 'unknown'
    }
    catch {
        $statusCode = $null

        if ($_.Exception.Response) {
            $statusCode = [int] $_.Exception.Response.StatusCode
        }

        if ($statusCode -eq 401 -or $statusCode -eq 403) {
            return 'rejected'
        }

        return 'unknown'
    }
}

function Find-SolClaudeCommand {
    if ($env:CLAUDE_SOL_CLAUDE_BIN -and (Test-Path -LiteralPath $env:CLAUDE_SOL_CLAUDE_BIN)) {
        return $env:CLAUDE_SOL_CLAUDE_BIN
    }

    $resolvedCommand = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1

    if ($resolvedCommand) {
        return $resolvedCommand.Source
    }

    $candidatePaths = @(
        (Join-Path $env:USERPROFILE '.local\bin\claude.exe')
        (Join-Path $env:LOCALAPPDATA 'Programs\claude\claude.exe')
        (Join-Path $env:APPDATA 'npm\claude.cmd')
    )

    foreach ($candidatePath in $candidatePaths) {
        if (Test-Path -LiteralPath $candidatePath) {
            return $candidatePath
        }
    }

    return $null
}

function Get-SolProvisioningCredentialFile {
    return (Join-Path (Get-SolConfigDirectory) 'provisioning-credentials.dpapi')
}

function Get-SolLimitStateFile {
    return (Join-Path (Get-SolConfigDirectory) 'limit-state.json')
}

function Read-SolProvisioningKey {
    if ($env:CLAUDE_SOL_PROVISIONING_KEY) {
        return $env:CLAUDE_SOL_PROVISIONING_KEY
    }

    $credentialFile = Get-SolProvisioningCredentialFile

    if (-not (Test-Path -LiteralPath $credentialFile)) {
        return $null
    }

    try {
        $encryptedText = (Get-Content -LiteralPath $credentialFile -Raw).Trim()

        if (-not $encryptedText) {
            return $null
        }

        $secureKey = ConvertTo-SecureString -String $encryptedText

        return (New-Object System.Net.NetworkCredential('', $secureKey)).Password
    }
    catch {
        Write-Warning "stored provisioning key could not be decrypted by this windows account: $($_.Exception.Message)"

        return $null
    }
}

function Write-SolProvisioningKey {
    param([Parameter(Mandatory)][string] $ProvisioningKey)

    if (-not (Test-SolDpapiSupported)) {
        throw 'dpapi is only available on windows — use the posix launcher on this platform.'
    }

    $configDirectory = Get-SolConfigDirectory

    if (-not (Test-Path -LiteralPath $configDirectory)) {
        New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
    }

    $credentialFile = Get-SolProvisioningCredentialFile
    $secureKey = ConvertTo-SecureString -String $ProvisioningKey -AsPlainText -Force
    $encryptedText = ConvertFrom-SecureString -SecureString $secureKey

    Set-Content -LiteralPath $credentialFile -Value $encryptedText -NoNewline -Encoding ascii

    Protect-SolFileAcl -FilePath $credentialFile

    return $credentialFile
}

function Find-SolNodeCommand {
    $resolvedCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1

    if ($resolvedCommand) {
        return $resolvedCommand.Source
    }

    return $null
}

function Test-SolLimitResetDue {
    $statePath = Get-SolLimitStateFile

    if (-not (Test-Path -LiteralPath $statePath)) {
        return $false
    }

    try {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    }
    catch {
        return $false
    }

    if (-not $state.reset_on) {
        return $false
    }

    $today = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')

    return ($today -ge $state.reset_on)
}

function Invoke-SolLimitCommand {
    param(
        [Parameter(Mandatory)][string] $ToolDirectory,
        [Parameter(Mandatory)] $Configuration,
        [Parameter(Mandatory)][string] $Command,
        [string] $Argument
    )

    $nodeCommand = Find-SolNodeCommand

    if (-not $nodeCommand) {
        Write-Host 'limit management needs node on PATH.'

        return 1
    }

    $inferenceKey = Read-SolApiKey
    $provisioningKey = Read-SolProvisioningKey

    $env:SOL_BASE_URL = $Configuration.CLAUDE_SOL_BASE_URL
    $env:SOL_INFERENCE_KEY = if ($inferenceKey) { $inferenceKey } else { '' }
    $env:SOL_PROVISIONING_KEY = if ($provisioningKey) { $provisioningKey } else { '' }
    $env:SOL_STATE_FILE = Get-SolLimitStateFile
    $env:SOL_BASELINE_LIMIT = $Configuration.CLAUDE_SOL_BASELINE_LIMIT
    $env:SOL_KEY_HASH = $Configuration.CLAUDE_SOL_KEY_HASH

    $scriptPath = Join-Path $ToolDirectory 'lib\sol-limit.js'

    if ($Argument) {
        & $nodeCommand $scriptPath $Command $Argument
    }
    else {
        & $nodeCommand $scriptPath $Command
    }

    return $LASTEXITCODE
}
