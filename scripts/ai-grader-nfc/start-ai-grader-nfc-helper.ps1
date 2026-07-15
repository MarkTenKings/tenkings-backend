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
}
