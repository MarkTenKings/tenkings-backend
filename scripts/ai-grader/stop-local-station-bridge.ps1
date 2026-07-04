[CmdletBinding()]
param(
  [string]$TaskName = "TenKingsAiGraderLocalBridge",
  [switch]$KillProcess
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-local-bridge-common.ps1")

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

if ($KillProcess) {
  $repoRoot = Get-AiGraderRepoRoot
  $processes = Get-CimInstance Win32_Process |
    Where-Object {
      $_.CommandLine -and
      $_.CommandLine -like "*ai-grader-station-bridge*" -and
      ($_.CommandLine -like "*$repoRoot*" -or $_.CommandLine -like "*start-local-station-bridge.ps1*")
    }
  foreach ($process in $processes) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

[pscustomobject]@{
  ok = $true
  scheduledTaskStopped = [bool]$task
  processKillRequested = [bool]$KillProcess
} | ConvertTo-Json -Compress
