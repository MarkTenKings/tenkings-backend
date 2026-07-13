[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [string]$TaskName = "TenKingsAiGraderNfcHelper",
  [switch]$RestartHelper
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

$config = Initialize-NfcConfig -Path $ConfigPath -RotateToken -RotatePairingCode
if ($RestartHelper) { Restart-NfcTask -TaskName $TaskName }
[pscustomobject]@{
  ok = $true
  tokenRotated = $true
  tokenFingerprint = Get-NfcSecretFingerprint -Value ([string]$config.workstationToken)
  pairingFingerprint = Get-NfcSecretFingerprint -Value ([string]$config.pairingCode)
  pairingExpiresAt = $config.pairingCodeExpiresAt
  helperRestarted = [bool]$RestartHelper
} | ConvertTo-Json
