[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [string]$TaskName = "TenKingsAiGraderNfcHelper",
  [switch]$RotateToken,
  [switch]$RotatePairingCode,
  [switch]$RestartHelper
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

$layout = Assert-NfcProductionLayout -ConfigPath $ConfigPath -TaskName $TaskName
if (-not $RotateToken -and -not $RotatePairingCode) {
  throw "Credential rotation requires -RotateToken, -RotatePairingCode, or both. Ordinary update rotates neither."
}
if ($RotateToken -and -not $RotatePairingCode) {
  throw "Rotating the workstation token also requires -RotatePairingCode so browser trust can be paired again."
}
$initialize = @{ Path = $layout.ConfigPath }
if ($RotateToken) { $initialize.RotateToken = $true }
if ($RotatePairingCode) { $initialize.RotatePairingCode = $true }
$config = Initialize-NfcConfig @initialize
if ($RestartHelper) { Restart-NfcTask -TaskName $TaskName }
[pscustomobject]@{
  ok = $true
  tokenRotated = [bool]$RotateToken
  tokenFingerprint = if ($RotateToken) { Get-NfcSecretFingerprint -Value ([string]$config.workstationToken) } else { $null }
  pairingCodeRotated = [bool]$RotatePairingCode
  pairingFingerprint = if ($RotatePairingCode) { Get-NfcSecretFingerprint -Value ([string]$config.pairingCode) } else { $null }
  pairingExpiresAt = if ($RotatePairingCode) { $config.pairingCodeExpiresAt } else { $null }
  helperRestarted = [bool]$RestartHelper
} | ConvertTo-Json
