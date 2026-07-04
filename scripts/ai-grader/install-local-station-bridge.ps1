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

$taskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -Real -ConfigPath `"$ConfigPath`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgs -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel LeastPrivilege
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Ten Kings AI Grader local loopback hardware bridge. Token is read from protected local config, not task arguments." -Force | Out-Null

if ($CreateShortcut) {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $shortcutPath = Join-Path $desktop "Ten Kings AI Grader Station.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$openScript`" -ConfigPath `"$ConfigPath`" -RestartBridge"
  $shortcut.WorkingDirectory = $repoRoot
  $shortcut.Description = "Open Ten Kings AI Grader Station"
  $shortcut.Save()
}

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
}

[pscustomobject]@{
  ok = $true
  taskName = $TaskName
  configPath = $ConfigPath
  configCreated = $true
  tokenFingerprint = Get-AiGraderSecretFingerprint -Value ([string]$config.stationToken)
  pairingFingerprint = Get-AiGraderSecretFingerprint -Value ([string]$config.pairingCode)
  pairingExpiresAt = $config.pairingCodeExpiresAt
  scheduledTaskInstalled = $true
  started = [bool]$StartNow
  shortcutCreated = [bool]$CreateShortcut
  normalStationUrl = $script:AiGraderStationUrl
} | ConvertTo-Json -Depth 4
