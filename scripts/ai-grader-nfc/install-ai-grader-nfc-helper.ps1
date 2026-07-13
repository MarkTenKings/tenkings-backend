[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [string]$InstallDirectory = "C:\TenKings\tools\ai-grader-nfc-helper",
  [string]$TaskName = "TenKingsAiGraderNfcHelper",
  [switch]$StartNow,
  [switch]$CreateShortcut
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

$repoRoot = Get-NfcRepoRoot
$project = Join-Path $repoRoot "packages\ai-grader-nfc-helper\src\TenKings.AiGrader.NfcHelper\TenKings.AiGrader.NfcHelper.csproj"
$startScript = Join-Path $repoRoot "scripts\ai-grader-nfc\start-ai-grader-nfc-helper.ps1"
$openScript = Join-Path $repoRoot "scripts\ai-grader-nfc\open-ai-grader-nfc-workstation.ps1"
if (-not (Test-Path -LiteralPath $InstallDirectory)) {
  New-Item -ItemType Directory -Path $InstallDirectory -Force | Out-Null
}
& dotnet publish $project --configuration Release --self-contained false --output $InstallDirectory
if ($LASTEXITCODE -ne 0) { throw "The NFC helper publish failed; no task was installed." }

$config = Initialize-NfcConfig -Path $ConfigPath -RotatePairingCode
$config.installDirectory = $InstallDirectory
Save-NfcConfig -Config $config -Path $ConfigPath

$taskArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`" -ConfigPath `"$ConfigPath`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgs -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Dedicated loopback-only Ten Kings AI Grader NFC helper. Does not control camera or lighting hardware." -Force | Out-Null

if ($CreateShortcut) { New-NfcDesktopShortcut -OpenScript $openScript -ConfigPath $ConfigPath }
if ($StartNow) { Start-ScheduledTask -TaskName $TaskName }

[pscustomobject]@{
  ok = $true
  taskName = $TaskName
  helperUrl = $script:NfcHelperUrl
  allowedOrigin = $script:NfcAllowedOrigin
  tokenFingerprint = Get-NfcSecretFingerprint -Value ([string]$config.workstationToken)
  pairingFingerprint = Get-NfcSecretFingerprint -Value ([string]$config.pairingCode)
  pairingExpiresAt = $config.pairingCodeExpiresAt
  driverAction = "detection_only"
  started = [bool]$StartNow
  shortcutCreated = [bool]$CreateShortcut
} | ConvertTo-Json -Depth 4
