[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-local-bridge.json",
  [string]$TaskName = "TenKingsAiGraderLocalBridge"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-local-bridge-common.ps1")

$config = Read-AiGraderBridgeConfig -Path $ConfigPath
$bridgeUrl = if ($config -and $config.bridgeUrl) { [string]$config.bridgeUrl } else { $script:AiGraderBridgeUrl }
$health = Get-AiGraderBridgeHealth -BridgeUrl $bridgeUrl
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue } else { $null }
$startupShortcutPath = Get-AiGraderBridgeStartupShortcutPath
$startupShortcutInstalled = Test-Path -LiteralPath $startupShortcutPath
$autoStartInstalled = [bool]($task -or $startupShortcutInstalled)

[pscustomobject]@{
  configPath = $ConfigPath
  configExists = [bool]$config
  bridgeUrl = $bridgeUrl
  tokenConfigured = [bool]($config -and $config.stationToken)
  tokenFingerprint = if ($config -and $config.stationToken) { Get-AiGraderSecretFingerprint -Value ([string]$config.stationToken) } else { $null }
  pairingConfigured = [bool]($config -and $config.pairingCode)
  pairingFingerprint = if ($config -and $config.pairingCode) { Get-AiGraderSecretFingerprint -Value ([string]$config.pairingCode) } else { $null }
  pairingExpiresAt = if ($config) { $config.pairingCodeExpiresAt } else { $null }
  scheduledTaskInstalled = [bool]$task
  scheduledTaskState = if ($task) { $task.State } else { $null }
  lastTaskResult = if ($taskInfo) { $taskInfo.LastTaskResult } else { $null }
  nextRunTime = if ($taskInfo) { $taskInfo.NextRunTime } else { $null }
  startupShortcutInstalled = $startupShortcutInstalled
  startupShortcutPath = if ($startupShortcutInstalled) { $startupShortcutPath } else { $null }
  autoStartInstalled = $autoStartInstalled
  autoStartMethod = if ($task) { "scheduledTask" } elseif ($startupShortcutInstalled) { "startupShortcut" } else { $null }
  bridgeRunning = [bool]$health
  bridgeHealth = if ($health) {
    [pscustomobject]@{
      ok = $health.ok
      mode = $health.mode
      localOnly = $health.localOnly
      tokenRequired = $health.tokenRequired
      pairingAvailable = $health.pairingAvailable
      hardwareActionsEnabled = $health.hardwareActionsEnabled
      allowedOrigins = $health.allowedOrigins
    }
  } else {
    $null
  }
} | ConvertTo-Json -Depth 6
