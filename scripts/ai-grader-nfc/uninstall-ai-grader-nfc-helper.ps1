[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [string]$TaskName = "TenKingsAiGraderNfcHelper",
  [switch]$RemovePublishedHelper,
  [switch]$RemoveConfig
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

$layout = Assert-NfcProductionLayout -ConfigPath $ConfigPath -TaskName $TaskName
$ConfigPath = $layout.ConfigPath
$TaskName = $layout.TaskName
$config = Read-NfcConfig -Path $ConfigPath
$shortcut = Get-NfcDesktopShortcutPath
$shortcutExisted = Test-Path -LiteralPath $shortcut
if ($shortcutExisted) {
  # Validate every dedicated artifact before the first maintenance mutation so an
  # unrelated or replaced desktop shortcut is never deleted by this command.
  Assert-NfcDesktopShortcutDefinition
}
& (Join-Path $PSScriptRoot "stop-ai-grader-nfc-helper.ps1") -ConfigPath $ConfigPath -TaskName $TaskName | Out-Null
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Assert-NfcScheduledTaskDefinition -TaskName $TaskName | Out-Null
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
}
if ($shortcutExisted) {
  Assert-NfcDesktopShortcutDefinition
  Remove-Item -LiteralPath $shortcut -Force -ErrorAction Stop
}
if ($RemovePublishedHelper -and (Test-Path -LiteralPath $script:NfcInstallDir)) {
  Remove-NfcSafeTree -Path $script:NfcInstallDir -AllowedRoot $script:NfcToolsRoot
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
  shortcutRemoved = [bool]$shortcutExisted
  publishedHelperRemoved = [bool]$RemovePublishedHelper
  configRemoved = [bool]$RemoveConfig
  workstationAttestationKeyPreserved = $true
} | ConvertTo-Json
