[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-local-bridge.json",
  [string]$TaskName = "TenKingsAiGraderLocalBridge",
  [switch]$RemoveConfig,
  [switch]$RemoveShortcut,
  [switch]$KillProcess
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-local-bridge-common.ps1")

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$startupShortcutPath = Get-AiGraderBridgeStartupShortcutPath
$startupShortcutExisted = Test-Path -LiteralPath $startupShortcutPath
Remove-Item -LiteralPath $startupShortcutPath -Force -ErrorAction SilentlyContinue

if ($KillProcess) {
  & (Join-Path $PSScriptRoot "stop-local-station-bridge.ps1") -TaskName $TaskName -KillProcess | Out-Null
}

if ($RemoveShortcut) {
  $shortcutPath = Get-AiGraderStationDesktopShortcutPath
  Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
}

if ($RemoveConfig) {
  Remove-Item -LiteralPath $ConfigPath -Force -ErrorAction SilentlyContinue
}

[pscustomobject]@{
  ok = $true
  taskRemoved = [bool]$task
  startupShortcutRemoved = $startupShortcutExisted
  configRemoved = [bool]$RemoveConfig
  shortcutRemoved = [bool]$RemoveShortcut
  processKillRequested = [bool]$KillProcess
} | ConvertTo-Json -Compress
