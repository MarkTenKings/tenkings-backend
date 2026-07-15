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

$layout = Assert-NfcProductionLayout -ConfigPath $ConfigPath -InstallDirectory $InstallDirectory -TaskName $TaskName
$ConfigPath = $layout.ConfigPath
$InstallDirectory = $layout.InstallDirectory
$TaskName = $layout.TaskName
$shortcutPath = Get-NfcDesktopShortcutPath
$pairingStateExisted = Test-Path -LiteralPath $script:NfcPairingConsumptionPath
$shortcutExisted = Test-Path -LiteralPath $shortcutPath
if ((Test-Path -LiteralPath $ConfigPath) -or
    (Test-Path -LiteralPath $InstallDirectory) -or
    (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
  throw "An NFC helper installation already exists. Use update-ai-grader-nfc-helper.ps1; installer reruns never replace a live install."
}
if ($CreateShortcut -and $shortcutExisted) {
  throw "The Ten Kings NFC workstation shortcut already exists; first install will not overwrite it."
}

$rootState = [pscustomobject]@{
  ToolsRootCreated = -not (Test-Path -LiteralPath $script:NfcToolsRoot)
  ConfigRootCreated = -not (Test-Path -LiteralPath $script:NfcConfigRoot)
}
$repoRoot = Get-NfcRepoRoot
$project = Join-Path $repoRoot "packages\ai-grader-nfc-helper\src\TenKings.AiGrader.NfcHelper\TenKings.AiGrader.NfcHelper.csproj"
$stagingDirectory = Join-Path (Split-Path -Parent $InstallDirectory) ".ai-grader-nfc-helper-install-$([Guid]::NewGuid().ToString('N'))"
Assert-NfcPathWithinRoot -Path $stagingDirectory -AllowedRoot $script:NfcToolsRoot | Out-Null
$taskCreated = $false
$shortcutCreated = $false
$shortcutCreationStarted = $false
$configCreationStarted = $false
$installActivationStarted = $false
$config = $null

try {
  Initialize-NfcFilesystemRoots | Out-Null
  New-Item -ItemType Directory -Path $stagingDirectory -ErrorAction Stop | Out-Null
  & dotnet publish $project --configuration Release --self-contained false --output $stagingDirectory
  if ($LASTEXITCODE -ne 0) { throw "The NFC helper publish failed; no task was installed." }
  Copy-NfcStableMaintenancePayload -SourceDirectory $PSScriptRoot -DestinationInstallDirectory $stagingDirectory
  Protect-NfcTree -Path $stagingDirectory -AllowedRoot $script:NfcToolsRoot
  $stagedDll = Join-Path $stagingDirectory "TenKings.AiGrader.NfcHelper.dll"
  $verificationOutput = @(& dotnet $stagedDll --verify-build)
  if ($LASTEXITCODE -ne 0) { throw "The NFC helper failed hardware-free build verification." }
  $verification = ($verificationOutput -join [Environment]::NewLine) | ConvertFrom-Json
  if (-not $verification.ok -or
      $verification.helperVersion -cne "tenkings-ai-grader-nfc-helper-v2" -or
      $verification.helperProtocolVersion -cne "tenkings-ai-grader-nfc-loopback-v2" -or
      $verification.attestationSchemaVersion -cne "ai-grader-nfc-helper-attestation-v1" -or
      $verification.attestationAlgorithm -cne $script:NfcAttestationAlgorithm -or
      [bool]$verification.hardwareAccessed -or
      [bool]$verification.productionKeyAccessed) {
    throw "The NFC helper build verification returned an incompatible or unsafe result."
  }

  # Key provisioning occurs only on first install. Any key created here is deliberately
  # preserved if a later filesystem/config/task step rolls back.
  $keyOutput = @(& dotnet $stagedDll --ensure-workstation-attestation-key)
  if ($LASTEXITCODE -ne 0) { throw "The named current-user NFC workstation attestation key could not be created or reopened." }
  $keyMetadata = ($keyOutput -join [Environment]::NewLine) | ConvertFrom-Json
  if ($keyMetadata.keyName -cne $script:NfcAttestationKeyName -or
      $keyMetadata.algorithm -cne $script:NfcAttestationAlgorithm -or
      [string]$keyMetadata.keyId -cnotmatch '^[a-f0-9]{64}$') {
    throw "The NFC helper returned invalid workstation attestation-key metadata."
  }

  Move-Item -LiteralPath $stagingDirectory -Destination $InstallDirectory -ErrorAction Stop
  $installActivationStarted = $true
  Assert-NfcProtectedTree -Path $InstallDirectory -AllowedRoot $script:NfcToolsRoot
  $configCreationStarted = $true
  $config = Initialize-NfcConfig `
    -Path $ConfigPath `
    -WorkstationKeyName ([string]$keyMetadata.keyName) `
    -WorkstationKeyId ([string]$keyMetadata.keyId)
  $config.installDirectory = $InstallDirectory
  Save-NfcConfig -Config $config -Path $ConfigPath
  Assert-NfcProtectedAcl -Path (Split-Path -Parent $ConfigPath)
  Assert-NfcProtectedAcl -Path $ConfigPath

  $taskArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script:NfcStableStartScript`" -ConfigPath `"$ConfigPath`""
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgs -WorkingDirectory $InstallDirectory
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Dedicated loopback-only Ten Kings AI Grader NFC helper. Does not control camera or lighting hardware." | Out-Null
  $taskCreated = $true
  Assert-NfcScheduledTaskDefinition -TaskName $TaskName | Out-Null

  if ($CreateShortcut) {
    $shortcutCreationStarted = $true
    New-NfcDesktopShortcut -OpenScript $script:NfcStableOpenScript -ConfigPath $ConfigPath
    $shortcutCreated = $true
  }
  if ($StartNow) { Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop }

  [pscustomobject]@{
    ok = $true
    taskName = $TaskName
    helperUrl = $script:NfcHelperUrl
    allowedOrigin = $script:NfcAllowedOrigin
    tokenFingerprint = Get-NfcSecretFingerprint -Value ([string]$config.workstationToken)
    pairingFingerprint = Get-NfcSecretFingerprint -Value ([string]$config.pairingCode)
    pairingExpiresAt = $config.pairingCodeExpiresAt
    workstationAttestationConfigured = $true
    workstationAttestationAlgorithm = $script:NfcAttestationAlgorithm
    stableLaunchersInstalled = $true
    driverAction = "detection_only"
    started = [bool]$StartNow
    shortcutCreated = [bool]$CreateShortcut
  } | ConvertTo-Json -Depth 4
} catch {
  $installFailure = $_
  $rollbackFailures = @()
  try {
    if ($taskCreated) {
      Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      if ($config) {
        foreach ($process in @(Get-NfcHelperProcess -Config $config)) {
          Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        }
      }
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    }
  } catch { $rollbackFailures += "task" }
  try {
    if ($shortcutCreationStarted -and -not $shortcutExisted -and (Test-Path -LiteralPath $shortcutPath)) {
      Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction Stop
    }
  } catch { $rollbackFailures += "shortcut" }
  try {
    if ($configCreationStarted -and -not $pairingStateExisted -and (Test-Path -LiteralPath $script:NfcPairingConsumptionPath)) {
      Remove-Item -LiteralPath $script:NfcPairingConsumptionPath -Force -ErrorAction Stop
    }
    if ($configCreationStarted -and (Test-Path -LiteralPath $ConfigPath)) {
      Remove-Item -LiteralPath $ConfigPath -Force -ErrorAction Stop
    }
  } catch { $rollbackFailures += "config" }
  try {
    if ($installActivationStarted -and (Test-Path -LiteralPath $InstallDirectory)) {
      Remove-NfcSafeTree -Path $InstallDirectory -AllowedRoot $script:NfcToolsRoot
    }
    if (Test-Path -LiteralPath $stagingDirectory) {
      Remove-NfcSafeTree -Path $stagingDirectory -AllowedRoot $script:NfcToolsRoot
    }
  } catch { $rollbackFailures += "binaries" }
  try {
    if ($rootState.ConfigRootCreated) { Remove-NfcNewEmptyRoot -Path $script:NfcConfigRoot -ExpectedRoot $script:NfcConfigRoot }
    if ($rootState.ToolsRootCreated) { Remove-NfcNewEmptyRoot -Path $script:NfcToolsRoot -ExpectedRoot $script:NfcToolsRoot }
  } catch { $rollbackFailures += "roots" }

  if ($rollbackFailures.Count -gt 0) {
    throw "NFC helper first install failed and cleanup was incomplete ($($rollbackFailures -join ',')). The named non-exportable CNG key, if created, was preserved. $($installFailure.Exception.Message)"
  }
  throw "NFC helper first install failed; newly created files/config/task/shortcut were removed. The named non-exportable CNG key, if created, was preserved. $($installFailure.Exception.Message)"
} finally {
  if (Test-Path -LiteralPath $stagingDirectory) {
    try { Remove-NfcSafeTree -Path $stagingDirectory -AllowedRoot $script:NfcToolsRoot } catch { }
  }
}
