[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-local-bridge.json",
  [string]$TaskName = "TenKingsAiGraderLocalBridge",
  [switch]$RestartBridge
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-local-bridge-common.ps1")

$config = Initialize-AiGraderBridgeConfig -Path $ConfigPath -Mode "real" -RotateToken -RotatePairingCode

if ($RestartBridge) {
  & (Join-Path $PSScriptRoot "stop-local-station-bridge.ps1") -TaskName $TaskName -KillProcess | Out-Null
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Start-ScheduledTask -TaskName $TaskName
  }
}

[pscustomobject]@{
  ok = $true
  configPath = $ConfigPath
  tokenRotated = $true
  tokenFingerprint = Get-AiGraderSecretFingerprint -Value ([string]$config.stationToken)
  pairingFingerprint = Get-AiGraderSecretFingerprint -Value ([string]$config.pairingCode)
  pairingExpiresAt = $config.pairingCodeExpiresAt
  restartRequested = [bool]$RestartBridge
} | ConvertTo-Json -Depth 4
