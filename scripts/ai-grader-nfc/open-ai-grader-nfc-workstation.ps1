[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [string]$TaskName = "TenKingsAiGraderNfcHelper"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

$config = Initialize-NfcConfig -Path $ConfigPath -RotatePairingCode
Restart-NfcTask -TaskName $TaskName
$url = "$($config.programmingUrl)#aiGraderNfcPair=$([uri]::EscapeDataString([string]$config.pairingCode))"
Start-Process $url | Out-Null
[pscustomobject]@{
  ok = $true
  pairingFingerprint = Get-NfcSecretFingerprint -Value ([string]$config.pairingCode)
  pairingExpiresAt = $config.pairingCodeExpiresAt
  helperRestarted = $true
  programmingPageOpened = $true
} | ConvertTo-Json
