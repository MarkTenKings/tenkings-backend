[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [string]$TaskName = "TenKingsAiGraderNfcHelper"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

$layout = Assert-NfcProductionLayout -ConfigPath $ConfigPath -TaskName $TaskName
$ConfigPath = $layout.ConfigPath
$TaskName = $layout.TaskName
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Assert-NfcScheduledTaskDefinition -TaskName $TaskName | Out-Null
  if ([string]$task.State -ceq "Running") {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  }
}
$config = Read-NfcConfig -Path $ConfigPath
$stopped = 0
if ($config) {
  foreach ($process in Get-NfcHelperProcess -Config $config) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    $stopped++
  }
}
[pscustomobject]@{ ok = $true; taskName = $TaskName; helperProcessesStopped = $stopped } | ConvertTo-Json
