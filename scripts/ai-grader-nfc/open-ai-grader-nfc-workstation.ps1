[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [string]$TaskName = "TenKingsAiGraderNfcHelper"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

$layout = Assert-NfcProductionLayout -ConfigPath $ConfigPath -TaskName $TaskName
$ConfigPath = $layout.ConfigPath
$TaskName = $layout.TaskName
$config = Read-NfcConfig -Path $ConfigPath
if (-not $config) { throw "The NFC helper is not installed. Run the dedicated installer first." }
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) { throw "The dedicated NFC helper Scheduled Task is not installed." }
Assert-NfcScheduledTaskDefinition -TaskName $TaskName | Out-Null
$helperStarted = $false
if (@(Get-NfcHelperProcess -Config $config).Count -eq 0 -and [string]$task.State -cne "Running") {
  Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $helperStarted = $true
}

$pairingConsumed = $false
$pairingStatePath = [string]$config.pairingConsumptionPath
if (Test-Path -LiteralPath $pairingStatePath -PathType Leaf) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $digest = (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$config.pairingCode)) |
      ForEach-Object { $_.ToString("x2") }) -join "")
    $pairingConsumed = ((Get-Content -LiteralPath $pairingStatePath -Raw).Trim() -ceq $digest)
  } finally {
    $sha.Dispose()
  }
}

$url = [string]$config.programmingUrl
if (-not $pairingConsumed) {
  $expiry = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse([string]$config.pairingCodeExpiresAt, [ref]$expiry) -or
      $expiry -le [DateTimeOffset]::UtcNow) {
    throw "The one-time NFC pairing code expired. Use rotate-ai-grader-nfc-helper-token.ps1 -RotatePairingCode -RestartHelper explicitly."
  }
  $url = "$url#aiGraderNfcPair=$([uri]::EscapeDataString([string]$config.pairingCode))"
}
Start-Process $url | Out-Null
[pscustomobject]@{
  ok = $true
  pairingRequired = -not $pairingConsumed
  helperStarted = $helperStarted
  helperRestarted = $false
  programmingPageOpened = $true
} | ConvertTo-Json
