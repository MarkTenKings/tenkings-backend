[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [string]$InstallDirectory = "C:\TenKings\tools\ai-grader-nfc-helper",
  [string]$TaskName = "TenKingsAiGraderNfcHelper"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

function Invoke-NfcBuildVerification {
  param([Parameter(Mandatory = $true)][string]$DllPath)
  $output = @(& dotnet $DllPath --verify-build)
  if ($LASTEXITCODE -ne 0) { throw "The NFC helper build verification command failed." }
  $result = ($output -join [Environment]::NewLine) | ConvertFrom-Json
  if (-not $result.ok -or
      $result.helperVersion -cne "tenkings-ai-grader-nfc-helper-v3" -or
      $result.helperProtocolVersion -cne "tenkings-ai-grader-nfc-loopback-v2" -or
      $result.attestationSchemaVersion -cne "ai-grader-nfc-helper-attestation-v1" -or
      $result.multiProfileAttestationSchemaVersion -cne "ai-grader-nfc-helper-attestation-v2" -or
      $result.attestationAlgorithm -cne $script:NfcAttestationAlgorithm -or
      [bool]$result.hardwareAccessed -or
      [bool]$result.productionKeyAccessed) {
    throw "The NFC helper build verification returned an incompatible or unsafe result."
  }
}

function Assert-NfcInstalledKeyIdentity {
  param(
    [Parameter(Mandatory = $true)][string]$DllPath,
    [Parameter(Mandatory = $true)]$Config
  )
  $output = @(Invoke-NfcWithWorkstationKeyEnvironment `
    -KeyName ([string]$Config.workstationKeyName) `
    -KeyId ([string]$Config.workstationKeyId) `
    -ArgumentList @($DllPath) `
    -Action {
      param($candidateDll)
      $result = @(& dotnet $candidateDll --export-workstation-attestation-public-key)
      if ($LASTEXITCODE -ne 0) { throw "The existing NFC workstation public key could not be validated." }
      return $result
    })
  $exported = ($output -join [Environment]::NewLine) | ConvertFrom-Json
  if ([string]$exported.keyId -cne [string]$Config.workstationKeyId -or
      [string]$exported.algorithm -cne $script:NfcAttestationAlgorithm) {
    throw "The existing NFC workstation key identity changed. Ordinary update never rotates it."
  }
  $spki = [Convert]::FromBase64String([string]$exported.publicSpkiDerBase64)
  if ($spki.Length -lt 64 -or $spki.Length -gt 512) { throw "The NFC workstation public key is outside its size bound." }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $computed = (($sha.ComputeHash($spki) | ForEach-Object { $_.ToString("x2") }) -join "")
  } finally {
    $sha.Dispose()
    [Array]::Clear($spki, 0, $spki.Length)
  }
  if ($computed -cne [string]$Config.workstationKeyId) {
    throw "The NFC workstation public key digest no longer matches the protected key ID."
  }
}

function Stop-NfcUpdateProcess {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [Parameter(Mandatory = $true)][string]$TaskName
  )
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  foreach ($process in @(Get-NfcHelperProcess -Config $Config)) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  }
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if (@(Get-NfcHelperProcess -Config $Config).Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "The dedicated NFC helper did not stop within the maintenance timeout."
}

function Wait-NfcUpdateReady {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [int]$Attempts = 40,
    [switch]$RequireIdle
  )
  $headers = @{
    Origin = $script:NfcAllowedOrigin
    "x-tenkings-nfc-token" = [string]$Config.workstationToken
  }
  for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
    try {
      $response = Invoke-RestMethod -Method Get -Uri "$($Config.helperUrl)/status" -Headers $headers -TimeoutSec 2
      if ($response.ok -and
          $response.result.helperProtocolVersion -ceq "tenkings-ai-grader-nfc-loopback-v2" -and
          (-not $RequireIdle -or -not [bool]$response.result.busy)) { return }
    } catch {
      # Readiness retries expose no secret or device detail.
    }
    if ($attempt + 1 -lt $Attempts) { Start-Sleep -Milliseconds 250 }
  }
  throw "The dedicated NFC helper did not return the expected loopback protocol after maintenance."
}

$layout = Assert-NfcProductionLayout -ConfigPath $ConfigPath -InstallDirectory $InstallDirectory -TaskName $TaskName
$ConfigPath = $layout.ConfigPath
$InstallDirectory = $layout.InstallDirectory
$TaskName = $layout.TaskName
$config = Read-NfcConfig -Path $ConfigPath
if ($null -eq $config) { throw "Install the dedicated NFC helper before using ordinary update." }
if (-not (Test-Path -LiteralPath $InstallDirectory -PathType Container)) { throw "The current NFC helper install is missing." }
Assert-NfcProtectedTree -Path $InstallDirectory -AllowedRoot $script:NfcToolsRoot
Assert-NfcProtectedAcl -Path (Split-Path -Parent $ConfigPath)
Assert-NfcProtectedAcl -Path $ConfigPath
$task = Assert-NfcScheduledTaskDefinition -TaskName $TaskName
Assert-NfcDesktopShortcutDefinition

$repoRoot = Get-NfcRepoRoot
$project = Join-Path $repoRoot "packages\ai-grader-nfc-helper\src\TenKings.AiGrader.NfcHelper\TenKings.AiGrader.NfcHelper.csproj"
$liveDll = Join-Path $InstallDirectory "TenKings.AiGrader.NfcHelper.dll"
if (-not (Test-Path -LiteralPath $liveDll -PathType Leaf)) { throw "The current NFC helper executable is missing." }
Invoke-NfcBuildVerification -DllPath $liveDll
Assert-NfcInstalledKeyIdentity -DllPath $liveDll -Config $config

$wasRunning = $task.State -eq "Running" -or @(Get-NfcHelperProcess -Config $config).Count -gt 0
if ($wasRunning) { Wait-NfcUpdateReady -Config $config -Attempts 4 -RequireIdle }

$nonce = [Guid]::NewGuid().ToString("N")
$installParent = Split-Path -Parent $InstallDirectory
$stagingDirectory = Join-Path $installParent ".ai-grader-nfc-helper-update-$nonce"
$backupDirectory = Join-Path $installParent ".ai-grader-nfc-helper-backup-$nonce"
Assert-NfcPathWithinRoot -Path $stagingDirectory -AllowedRoot $script:NfcToolsRoot | Out-Null
Assert-NfcPathWithinRoot -Path $backupDirectory -AllowedRoot $script:NfcToolsRoot | Out-Null
$replacementSucceeded = $false
$backupRemoved = $false

try {
  New-Item -ItemType Directory -Path $stagingDirectory -ErrorAction Stop | Out-Null
  & dotnet publish $project --configuration Release --self-contained false --output $stagingDirectory
  if ($LASTEXITCODE -ne 0) { throw "The staged NFC helper publish failed; the running helper was not stopped." }
  Copy-NfcStableMaintenancePayload -SourceDirectory $PSScriptRoot -DestinationInstallDirectory $stagingDirectory
  Protect-NfcTree -Path $stagingDirectory -AllowedRoot $script:NfcToolsRoot
  Assert-NfcProtectedTree -Path $stagingDirectory -AllowedRoot $script:NfcToolsRoot
  $stagedDll = Join-Path $stagingDirectory "TenKings.AiGrader.NfcHelper.dll"
  Invoke-NfcBuildVerification -DllPath $stagedDll
  Assert-NfcInstalledKeyIdentity -DllPath $stagedDll -Config $config

  # Everything above is hardware-free and completes before the working helper is stopped.
  Stop-NfcUpdateProcess -Config $config -TaskName $TaskName
  $preserved = Get-NfcPreservedStateSnapshot -Config $config -ConfigPath $ConfigPath -TaskName $TaskName

  Invoke-NfcInstallDirectoryReplacement `
    -InstallDirectory $InstallDirectory `
    -StagingDirectory $stagingDirectory `
    -BackupDirectory $backupDirectory `
    -AllowedRoot $script:NfcToolsRoot `
    -ValidateReplacement {
      param($activatedInstall)
      Assert-NfcProtectedTree -Path $activatedInstall -AllowedRoot $script:NfcToolsRoot
      $activatedDll = Join-Path $activatedInstall "TenKings.AiGrader.NfcHelper.dll"
      Invoke-NfcBuildVerification -DllPath $activatedDll
      Assert-NfcInstalledKeyIdentity -DllPath $activatedDll -Config $config
      Assert-NfcPreservedState -Expected $preserved -Config $config -ConfigPath $ConfigPath -TaskName $TaskName
      if ($wasRunning) {
        Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        Wait-NfcUpdateReady -Config $config
      }
    } `
    -BeforeRollback {
      param($failedInstall)
      Stop-NfcUpdateProcess -Config $config -TaskName $TaskName
    } `
    -AfterRollback {
      param($restoredInstall)
      Assert-NfcProtectedTree -Path $restoredInstall -AllowedRoot $script:NfcToolsRoot
      $restoredDll = Join-Path $restoredInstall "TenKings.AiGrader.NfcHelper.dll"
      Invoke-NfcBuildVerification -DllPath $restoredDll
      Assert-NfcInstalledKeyIdentity -DllPath $restoredDll -Config $config
      Assert-NfcPreservedState -Expected $preserved -Config $config -ConfigPath $ConfigPath -TaskName $TaskName
      if ($wasRunning) {
        Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        Wait-NfcUpdateReady -Config $config
      }
    }

  $replacementSucceeded = $true
  Assert-NfcPreservedState -Expected $preserved -Config $config -ConfigPath $ConfigPath -TaskName $TaskName
  try {
    Remove-NfcSafeTree -Path $backupDirectory -AllowedRoot $script:NfcToolsRoot
    $backupRemoved = $true
  } catch {
    $backupRemoved = $false
  }

  [pscustomobject]@{
    ok = $true
    helperVersion = "tenkings-ai-grader-nfc-helper-v3"
    helperProtocolVersion = "tenkings-ai-grader-nfc-loopback-v2"
    priorRunningStatePreserved = $true
    protectedConfigPreserved = $true
    workstationKeyIdentityPreserved = $true
    scheduledTaskIdentityPreserved = $true
    shortcutStatePreserved = $true
    rollbackBackupRemoved = $backupRemoved
    driverAction = "none"
  } | ConvertTo-Json -Depth 3
} catch {
  if ($wasRunning -and (Test-Path -LiteralPath $InstallDirectory -PathType Container)) {
    try {
      $currentTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
      if ($currentTask.State -ne "Running") { Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop }
      Wait-NfcUpdateReady -Config $config
    } catch {
      throw "NFC helper update failed and the prior running state could not be confirmed. $($_.Exception.Message)"
    }
  }
  throw
} finally {
  if (Test-Path -LiteralPath $stagingDirectory) {
    try { Remove-NfcSafeTree -Path $stagingDirectory -AllowedRoot $script:NfcToolsRoot } catch { }
  }
  if ($replacementSucceeded -and -not $backupRemoved -and (Test-Path -LiteralPath $backupDirectory)) {
    # A cleanup failure leaves the prior binaries contained under the dedicated tools root.
    # It is reported through rollbackBackupRemoved and is never treated as a credential rotation.
  }
}
