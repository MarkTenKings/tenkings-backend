[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Authorization,
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [switch]$ConfirmOverwrite
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

$required = "I authorize Agent 4 to detect the ACR1552U, read one sacrificial NTAG215, write one non-production Ten Kings /nfc/test URL without locking it, verify readback, and have me test the tap with my phone. Do not program a real report tag."
if ($Authorization -cne $required) {
  throw "The exact separate Agent 4 sacrificial-tag authorization was not supplied."
}

$config = Read-NfcConfig -Path $ConfigPath
if ($null -eq $config) { throw "Install the dedicated NFC helper before the approved hardware gate." }
if ((Get-NfcHelperProcess -Config $config).Count -gt 0) {
  throw "Stop the dedicated NFC helper before running the approved one-shot hardware gate."
}
$dll = Join-Path ([string]$config.installDirectory) "TenKings.AiGrader.NfcHelper.dll"
if (-not (Test-Path -LiteralPath $dll)) { throw "The published NFC helper is missing." }

$env:TENKINGS_NFC_HARDWARE_GATE_CONFIRMED = "true"
$env:TENKINGS_NFC_HARDWARE_GATE_OVERWRITE_CONFIRMED = if ($ConfirmOverwrite) { "true" } else { "false" }
try {
  & dotnet $dll --hardware-gate-test
  exit $LASTEXITCODE
} finally {
  Remove-Item Env:\TENKINGS_NFC_HARDWARE_GATE_CONFIRMED -ErrorAction SilentlyContinue
  Remove-Item Env:\TENKINGS_NFC_HARDWARE_GATE_OVERWRITE_CONFIRMED -ErrorAction SilentlyContinue
}
