param(
    [ValidateRange(1024, 65535)][int]$Port = 18763,
    [ValidateRange(1, 120)][int]$TtlMinutes = 20,
    [string]$StatusDirectory = (Join-Path (Get-Location) '.szu-platform'),
    [string]$ConfigPath = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.bita\config.json'),
    [string]$Tenant = 'szdx',
    [string]$Product = 'heros'
)
$ErrorActionPreference = 'Stop'
$loginOrigin = "http://127.0.0.1:$Port"
$loginStatusDirectory = [IO.Path]::GetFullPath($StatusDirectory)
$loginConfigPath = [IO.Path]::GetFullPath($ConfigPath)
$loginConfigurationJson = ConvertTo-Json -InputObject @($TtlMinutes, $loginConfigPath, $loginStatusDirectory, $Tenant, $Product) -Compress
$loginHash = [System.Security.Cryptography.SHA256]::Create()
try {
    $loginConfigurationId = ([BitConverter]::ToString($loginHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($loginConfigurationJson)))).Replace('-', '').ToLowerInvariant()
} finally { $loginHash.Dispose() }
try {
    $loginHealth = Invoke-RestMethod -Uri "$loginOrigin/health" -TimeoutSec 2
} catch { $loginHealth = $null }
if ($loginHealth -and $loginHealth.kind -eq 'szu-local-credential-input' -and $loginHealth.ready) {
    if ($loginHealth.configuration_id -ne $loginConfigurationId) {
        throw 'A login service with different configuration is already running; finish or cancel that session first.'
    }
    Write-Output "Input service already running: $loginOrigin; session $($loginHealth.session_id); expires at $($loginHealth.expires_at)"
    return
}
$loginNode = (Get-Command node.exe -ErrorAction Stop).Source
$loginScript = Join-Path $PSScriptRoot 'login_local.cjs'
New-Item -ItemType Directory -Path $loginStatusDirectory -Force | Out-Null
$loginConfiguration = @{
    SZU_LOGIN_PORT = [string]$Port
    SZU_LOGIN_TTL_MINUTES = [string]$TtlMinutes
    SZU_LOGIN_STATUS_DIR = $loginStatusDirectory
    SZU_LOGIN_CONFIG = $loginConfigPath
    SZU_LOGIN_TENANT = $Tenant
    SZU_LOGIN_PRODUCT = $Product
}
$loginPreviousEnvironment = @{}
$loginRunTag = [Guid]::NewGuid().ToString('N')
$loginOutLog = Join-Path $loginStatusDirectory "login-$loginRunTag.out.txt"
$loginErrorLog = Join-Path $loginStatusDirectory "login-$loginRunTag.err.txt"
try {
    foreach ($entry in $loginConfiguration.GetEnumerator()) {
        $loginPreviousEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'Process')
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
    $loginProcess = Start-Process -FilePath $loginNode -ArgumentList ('"{0}"' -f $loginScript) `
        -WorkingDirectory $loginStatusDirectory -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $loginOutLog -RedirectStandardError $loginErrorLog
} finally {
    foreach ($entry in $loginPreviousEnvironment.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
}
$loginDeadline = [DateTime]::UtcNow.AddSeconds(8)
while ([DateTime]::UtcNow -lt $loginDeadline) {
    $loginProcess.Refresh()
    if ($loginProcess.HasExited) { throw "Login helper exited; inspect $loginErrorLog" }
    try {
        $loginHealth = Invoke-RestMethod -Uri "$loginOrigin/health" -TimeoutSec 1
        if ($loginHealth.kind -eq 'szu-local-credential-input' -and $loginHealth.ready) {
            Write-Output "LOCAL_INPUT_READY $loginOrigin"
            Write-Output "Session $($loginHealth.session_id); expires at $($loginHealth.expires_at); process $($loginProcess.Id)"
            Write-Output "Status directory: $loginStatusDirectory"
            Write-Output 'Open the address manually in a browser on this computer; no browser was launched.'
            return
        }
    } catch {}
    Start-Sleep -Milliseconds 200
}
throw "Login helper health check failed; inspect $loginErrorLog"
