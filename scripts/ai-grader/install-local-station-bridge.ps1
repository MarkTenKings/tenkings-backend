[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-local-bridge.json",
  [string]$TaskName = "TenKingsAiGraderLocalBridge",
  [switch]$StartNow,
  [switch]$CreateShortcut
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-local-bridge-common.ps1")

$repoRoot = Get-AiGraderRepoRoot
$startScript = Join-Path $repoRoot "scripts\ai-grader\start-local-station-bridge.ps1"
$openScript = Join-Path $repoRoot "scripts\ai-grader\open-local-station.ps1"
$config = Initialize-AiGraderBridgeConfig -Path $ConfigPath -Mode "real" -RotatePairingCode

$taskArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`" -Real -ConfigPath `"$ConfigPath`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgs -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

$scheduledTaskInstalled = $false
$scheduledTaskInstallError = $null
$startupShortcutPath = Get-AiGraderBridgeStartupShortcutPath
$startupShortcutInstalled = $false

try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Ten Kings AI Grader local loopback hardware bridge. Token is read from protected local config, not task arguments." -Force -ErrorAction Stop | Out-Null
  $scheduledTaskInstalled = $true
  Remove-Item -LiteralPath $startupShortcutPath -Force -ErrorAction SilentlyContinue
} catch {
  $scheduledTaskInstallError = $_.Exception.Message
  Write-Warning "Could not register AI Grader Scheduled Task for this Windows user. Installing per-user Startup fallback instead."
  New-AiGraderPowerShellShortcut `
    -Path $startupShortcutPath `
    -ScriptPath $startScript `
    -WorkingDirectory $repoRoot `
    -ScriptArguments "-Real -ConfigPath `"$ConfigPath`"" `
    -Description "Start Ten Kings AI Grader local bridge at Windows logon" `
    -Hidden
  $startupShortcutInstalled = $true
}

if ($CreateShortcut) {
  New-AiGraderPowerShellShortcut `
    -Path (Get-AiGraderStationDesktopShortcutPath) `
    -ScriptPath $openScript `
    -WorkingDirectory $repoRoot `
    -ScriptArguments "-ConfigPath `"$ConfigPath`" -RestartBridge" `
    -Description "Open Ten Kings AI Grader Station" `
    -Hidden
}

$started = $false
if ($StartNow) {
  if ($scheduledTaskInstalled) {
    Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $started = $true
  } else {
    Start-Process -FilePath "powershell.exe" -ArgumentList $taskArgs -WindowStyle Hidden -WorkingDirectory $repoRoot
    $started = $true
  }
}

[pscustomobject]@{
  ok = $true
  taskName = $TaskName
  configPath = $ConfigPath
  configCreated = $true
  tokenFingerprint = Get-AiGraderSecretFingerprint -Value ([string]$config.stationToken)
  pairingFingerprint = Get-AiGraderSecretFingerprint -Value ([string]$config.pairingCode)
  pairingExpiresAt = $config.pairingCodeExpiresAt
  scheduledTaskInstalled = $scheduledTaskInstalled
  scheduledTaskInstallError = if ($scheduledTaskInstallError) { "redacted: scheduled task registration denied or unavailable" } else { $null }
  startupShortcutInstalled = $startupShortcutInstalled
  startupShortcutPath = if ($startupShortcutInstalled) { $startupShortcutPath } else { $null }
  started = $started
  shortcutCreated = [bool]$CreateShortcut
  normalStationUrl = $script:AiGraderStationUrl
} | ConvertTo-Json -Depth 4
