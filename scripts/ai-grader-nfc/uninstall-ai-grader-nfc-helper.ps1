[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [string]$TaskName = "TenKingsAiGraderNfcHelper",
  [switch]$RemovePublishedHelper,
  [switch]$RemoveConfig
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

$config = Read-NfcConfig -Path $ConfigPath
& (Join-Path $PSScriptRoot "stop-ai-grader-nfc-helper.ps1") -ConfigPath $ConfigPath -TaskName $TaskName | Out-Null
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
$shortcut = Get-NfcDesktopShortcutPath
if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut -Force }
if ($RemovePublishedHelper -and (Test-Path -LiteralPath $script:NfcInstallDir)) {
  Remove-Item -LiteralPath $script:NfcInstallDir -Recurse -Force
}
if ($RemoveConfig -and (Test-Path -LiteralPath $ConfigPath)) {
  Remove-Item -LiteralPath $ConfigPath -Force
}
if ($RemoveConfig -and $config -and (Test-Path -LiteralPath ([string]$config.pairingConsumptionPath))) {
  Remove-Item -LiteralPath ([string]$config.pairingConsumptionPath) -Force
}
[pscustomobject]@{
  ok = $true
  taskRemoved = $true
  shortcutRemoved = $true
  publishedHelperRemoved = [bool]$RemovePublishedHelper
  configRemoved = [bool]$RemoveConfig
} | ConvertTo-Json
