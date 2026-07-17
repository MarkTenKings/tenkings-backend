[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

$config = Read-NfcConfig -Path $ConfigPath
if ($null -eq $config) { throw "Install the dedicated NFC helper before starting it." }
$dll = Join-Path ([string]$config.installDirectory) "TenKings.AiGrader.NfcHelper.dll"
if (-not (Test-Path -LiteralPath $dll)) { throw "The published NFC helper is missing. Run the NFC helper installer." }

$env:TENKINGS_NFC_HELPER_TOKEN = [string]$config.workstationToken
$env:TENKINGS_NFC_PAIRING_CODE = [string]$config.pairingCode
$env:TENKINGS_NFC_PAIRING_EXPIRES_AT = [string]$config.pairingCodeExpiresAt
$env:TENKINGS_NFC_PAIRING_CONSUMPTION_PATH = [string]$config.pairingConsumptionPath
$env:TENKINGS_NFC_ALLOWED_ORIGIN = [string]$config.allowedOrigin
$env:TENKINGS_NFC_HELPER_PORT = [string]$config.port
$env:TENKINGS_NFC_BACKEND = "pcsc"
$env:TENKINGS_NFC_WORKSTATION_KEY_NAME = [string]$config.workstationKeyName
$env:TENKINGS_NFC_WORKSTATION_KEY_ID = [string]$config.workstationKeyId
if ($config.schemaVersion -eq "tenkings-ai-grader-nfc-helper-config-v3" -and [bool]$config.feijuF8215Enabled) {
  $env:TENKINGS_NFC_FEIJU_F8215_ENABLED = "true"
  $env:TENKINGS_NFC_GOTOTAGS_EXECUTABLE_PATH = [string]$config.goToTagsExecutablePath
  $env:TENKINGS_NFC_GOTOTAGS_TEMPLATE_PATH = [string]$config.goToTagsTemplatePath
  $env:TENKINGS_NFC_GOTOTAGS_TEMPLATE_SHA256 = [string]$config.goToTagsTemplateSha256
  $env:TENKINGS_NFC_GOTOTAGS_JOB_ROOT = [string]$config.goToTagsJobRoot
}

try {
  & dotnet $dll
  exit $LASTEXITCODE
} finally {
  Remove-Item Env:\TENKINGS_NFC_HELPER_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:\TENKINGS_NFC_PAIRING_CODE -ErrorAction SilentlyContinue
  Remove-Item Env:\TENKINGS_NFC_PAIRING_EXPIRES_AT -ErrorAction SilentlyContinue
  Remove-Item Env:\TENKINGS_NFC_PAIRING_CONSUMPTION_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:\TENKINGS_NFC_ALLOWED_ORIGIN -ErrorAction SilentlyContinue
  Remove-Item Env:\TENKINGS_NFC_HELPER_PORT -ErrorAction SilentlyContinue
  Remove-Item Env:\TENKINGS_NFC_BACKEND -ErrorAction SilentlyContinue
  Remove-Item Env:\TENKINGS_NFC_WORKSTATION_KEY_NAME -ErrorAction SilentlyContinue
  Remove-Item Env:\TENKINGS_NFC_WORKSTATION_KEY_ID -ErrorAction SilentlyContinue
  Remove-Item Env:\TENKINGS_NFC_FEIJU_F8215_ENABLED -ErrorAction SilentlyContinue
  Remove-Item Env:\TENKINGS_NFC_GOTOTAGS_EXECUTABLE_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:\TENKINGS_NFC_GOTOTAGS_TEMPLATE_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:\TENKINGS_NFC_GOTOTAGS_TEMPLATE_SHA256 -ErrorAction SilentlyContinue
  Remove-Item Env:\TENKINGS_NFC_GOTOTAGS_JOB_ROOT -ErrorAction SilentlyContinue
}
