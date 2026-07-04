[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-local-bridge.json",
  [string]$TaskName = "TenKingsAiGraderLocalBridge",
  [switch]$RestartBridge
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-local-bridge-common.ps1")

$repoRoot = Get-AiGraderRepoRoot
$config = Initialize-AiGraderBridgeConfig -Path $ConfigPath -Mode "real" -RotatePairingCode

if ($RestartBridge) {
  & (Join-Path $PSScriptRoot "stop-local-station-bridge.ps1") -TaskName $TaskName -KillProcess | Out-Null
}

$health = Get-AiGraderBridgeHealth -BridgeUrl ([string]$config.bridgeUrl)
if (-not $health) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Start-ScheduledTask -TaskName $TaskName
  } else {
    $startScript = Join-Path $repoRoot "scripts\ai-grader\start-local-station-bridge.ps1"
    $args = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -Real -ConfigPath `"$ConfigPath`""
    Start-Process -FilePath "powershell.exe" -ArgumentList $args -WindowStyle Hidden -WorkingDirectory $repoRoot
  }
  Start-Sleep -Seconds 3
}

Start-Process (Get-AiGraderBridgePairingUrl -Config $config) | Out-Null

[pscustomobject]@{
  ok = $true
  opened = $script:AiGraderStationUrl
  bridgeUrl = $config.bridgeUrl
  pairingCodeRedacted = $true
  pairingFingerprint = Get-AiGraderSecretFingerprint -Value ([string]$config.pairingCode)
  pairingExpiresAt = $config.pairingCodeExpiresAt
} | ConvertTo-Json -Compress
