[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [string]$TenantId = "ten-kings"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

if ($TenantId -cnotmatch '^[A-Za-z0-9._:-]{1,128}$') {
  throw "The tenant ID is invalid."
}
$config = Read-NfcConfig -Path $ConfigPath
if ($null -eq $config) { throw "Install the dedicated NFC helper before exporting its workstation public key." }
$dll = Join-Path ([string]$config.installDirectory) "TenKings.AiGrader.NfcHelper.dll"
if (-not (Test-Path -LiteralPath $dll)) { throw "The published NFC helper is missing." }

$env:TENKINGS_NFC_WORKSTATION_KEY_NAME = [string]$config.workstationKeyName
$env:TENKINGS_NFC_WORKSTATION_KEY_ID = [string]$config.workstationKeyId
try {
  $keyOutput = @(& dotnet $dll --export-workstation-attestation-public-key)
  if ($LASTEXITCODE -ne 0) { throw "The named NFC workstation public key could not be exported." }
} finally {
  Remove-Item Env:\TENKINGS_NFC_WORKSTATION_KEY_NAME -ErrorAction SilentlyContinue
  Remove-Item Env:\TENKINGS_NFC_WORKSTATION_KEY_ID -ErrorAction SilentlyContinue
}

$exported = ($keyOutput -join [Environment]::NewLine) | ConvertFrom-Json
if ([string]$exported.keyId -cne [string]$config.workstationKeyId -or
    $exported.algorithm -cne $script:NfcAttestationAlgorithm -or
    [string]::IsNullOrWhiteSpace([string]$exported.publicSpkiDerBase64)) {
  throw "The exported NFC workstation public-key metadata is inconsistent."
}
$spki = [Convert]::FromBase64String([string]$exported.publicSpkiDerBase64)
if ($spki.Length -lt 64 -or $spki.Length -gt 512) {
  throw "The exported NFC workstation public key is outside its size bound."
}
$sha = [Security.Cryptography.SHA256]::Create()
try {
  $computedKeyId = (($sha.ComputeHash($spki) | ForEach-Object { $_.ToString("x2") }) -join "")
} finally {
  $sha.Dispose()
  [Array]::Clear($spki, 0, $spki.Length)
}
if ($computedKeyId -cne [string]$exported.keyId) {
  throw "The exported NFC workstation key ID did not match the DER SPKI."
}

[pscustomobject]@{
  keyId = [string]$exported.keyId
  tenantId = $TenantId
  algorithm = [string]$exported.algorithm
  publicSpkiDerBase64 = [string]$exported.publicSpkiDerBase64
} | ConvertTo-Json -Depth 3
