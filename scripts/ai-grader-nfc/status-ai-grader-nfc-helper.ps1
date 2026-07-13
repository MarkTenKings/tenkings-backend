[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [string]$TaskName = "TenKingsAiGraderNfcHelper"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

$config = Read-NfcConfig -Path $ConfigPath
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$result = $null
if ($config) {
  try {
    $headers = @{
      Origin = $script:NfcAllowedOrigin
      "x-tenkings-nfc-token" = [string]$config.workstationToken
    }
    $response = Invoke-RestMethod -Method Get -Uri "$($config.helperUrl)/status" -Headers $headers -TimeoutSec 3
    if ($response.ok) { $result = $response.result }
  } catch {
    $result = $null
  }
}

[pscustomobject]@{
  configured = [bool]$config
  tokenFingerprint = if ($config) { Get-NfcSecretFingerprint -Value ([string]$config.workstationToken) } else { $null }
  scheduledTaskInstalled = [bool]$task
  scheduledTaskState = if ($task) { $task.State } else { $null }
  helperReachable = [bool]$result
  helperProtocolVersion = if ($result) { $result.helperProtocolVersion } else { $null }
  workstationAttestationConfigured = [bool]($config -and
    [string]$config.workstationKeyName -ceq $script:NfcAttestationKeyName -and
    [string]$config.workstationKeyId -cmatch '^[a-f0-9]{64}$')
  readerConnected = if ($result) { $result.readerConnected } else { $false }
  pcscReady = if ($result) { $result.pcscReady } else { $false }
  tagState = if ($result) { $result.tagState } else { "unknown" }
  busy = if ($result) { $result.busy } else { $false }
  readerModel = if ($result) { $result.readerModel } else { $null }
  errorCode = if ($result) { $result.errorCode } else { "helper_unreachable" }
} | ConvertTo-Json -Depth 5
