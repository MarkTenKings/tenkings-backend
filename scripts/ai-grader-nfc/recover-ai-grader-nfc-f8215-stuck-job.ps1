[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^nfc_attempt_[A-Za-z0-9_-]{43}$')]
  [string]$AttemptId,

  [Parameter(Mandatory = $true)]
  [string]$Confirmation,

  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [string]$InstallDirectory = "C:\TenKings\tools\ai-grader-nfc-helper",
  [string]$TaskName = "TenKingsAiGraderNfcHelper"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

$requiredConfirmation = "I removed and quarantined the exact NFC tag used for this F8215 attempt."
if ($Confirmation -cne $requiredConfirmation) {
  throw "Type the exact physical-tag removal and quarantine confirmation before recovering this job."
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this bounded NFC recovery command from an elevated PowerShell window."
}

function Wait-NfcRecoveryRuntimeStopped {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [Parameter(Mandatory = $true)][string]$ExpectedTaskName,
    [int]$TimeoutSeconds = 15
  )
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $task = Get-ScheduledTask -TaskName $ExpectedTaskName -ErrorAction Stop
    $helperCount = @(Get-NfcHelperProcess -Config $Config).Count
    $listenerCount = @(Get-NetTCPConnection `
      -LocalAddress "127.0.0.1" `
      -LocalPort 47662 `
      -State Listen `
      -ErrorAction SilentlyContinue).Count
    if ([string]$task.State -ceq "Ready" -and $helperCount -eq 0 -and $listenerCount -eq 0) {
      return [string]$task.State
    }
    Start-Sleep -Milliseconds 200
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  throw "The dedicated NFC helper did not reach its required stopped state."
}

function Stop-NfcRecoveryRuntime {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [Parameter(Mandatory = $true)][string]$ExpectedTaskName
  )
  $task = Assert-NfcScheduledTaskDefinition -TaskName $ExpectedTaskName
  if ([string]$task.State -cne "Ready") {
    Stop-ScheduledTask -TaskName $ExpectedTaskName -ErrorAction Stop
  }
  foreach ($process in @(Get-NfcHelperProcess -Config $Config)) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  }
  return Wait-NfcRecoveryRuntimeStopped -Config $Config -ExpectedTaskName $ExpectedTaskName
}

function Wait-NfcExactRecoveryTransition {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [Parameter(Mandatory = $true)][string]$ExpectedAttemptId,
    [int]$TimeoutSeconds = 20
  )
  $headers = @{
    Origin = $script:NfcAllowedOrigin
    "x-tenkings-nfc-token" = [string]$Config.workstationToken
  }
  $body = @{ attemptId = $ExpectedAttemptId } | ConvertTo-Json -Compress
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-RestMethod `
        -Method Post `
        -Uri "$($Config.helperUrl)/operation-status" `
        -Headers $headers `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 3
      $result = $response.result
      if (-not [bool]$response.ok -or
          [string]$result.helperProtocolVersion -cne $script:NfcHelperProtocolVersion -or
          [string]$result.attemptId -cne $ExpectedAttemptId -or
          [string]$result.chipType -cne "FEIJU_F8215" -or
          [string]$result.programmingProfile -cne "gototags_manual_start_v1") {
        throw "The restarted helper returned a mismatched F8215 recovery identity."
      }
      if ([string]$result.phase -ceq "uncertain" -and
          [bool]$result.terminal -and
          -not [bool]$result.retryable -and
          [string]$result.errorCode -ceq "gototags_helper_restarted" -and
          $null -eq $result.evidence) {
        return $result
      }
      if ([string]$result.phase -in @("completed", "failed")) {
        throw "The restarted helper returned an unexpected terminal F8215 state."
      }
    } catch {
      if ($_.Exception.Message -like "The restarted helper returned*") { throw }
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  throw "The installed helper did not convert the exact nonterminal F8215 job to uncertain."
}

$layout = Assert-NfcProductionLayout `
  -ConfigPath $ConfigPath `
  -InstallDirectory $InstallDirectory `
  -TaskName $TaskName
$config = Read-NfcConfig -Path $layout.ConfigPath -AllowInheritedGoToTagsLeafFiles
if ($null -eq $config -or [string]::IsNullOrWhiteSpace([string]$config.goToTagsExecutablePath)) {
  throw "The installed F8215 helper configuration is unavailable."
}
$jobRoot = Assert-NfcPathWithinRoot `
  -Path ([string]$config.goToTagsJobRoot) `
  -AllowedRoot $script:NfcConfigRoot
if (-not $jobRoot.Equals((Get-NfcCanonicalPath -Path $script:NfcGoToTagsJobRoot), [StringComparison]::OrdinalIgnoreCase)) {
  throw "The F8215 job root does not match the dedicated protected location."
}
$recovery = Get-NfcValidatedF8215RecoveryState `
  -AttemptId $AttemptId `
  -JobRoot $jobRoot `
  -AllowedRoot $script:NfcConfigRoot `
  -AllowInheritedLeafFiles
if ($recovery.Phase -ceq "completed") {
  throw "A completed F8215 job cannot be discarded through quarantine recovery."
}
if (@(Get-NfcExactGoToTagsProcess -Config $config).Count -ne 0) {
  throw "Close GoToTags completely before bounded F8215 recovery."
}

$runtimeStarted = $false
$priorPhase = [string]$recovery.Phase
$transitionedToUncertain = $false
$resolution = $null
try {
  Stop-NfcRecoveryRuntime -Config $config -ExpectedTaskName $layout.TaskName | Out-Null
  if (@(Get-NfcExactGoToTagsProcess -Config $config).Count -ne 0) {
    throw "GoToTags started during bounded F8215 recovery."
  }

  # Repair only the exact validated legacy leaf artifacts. Directories, foreign
  # ACEs, extra files, malformed state, and mismatched attempts already failed.
  Protect-NfcValidatedF8215RecoveryArtifacts `
    -Recovery $recovery `
    -AllowedRoot $script:NfcConfigRoot
  $recovery = Get-NfcValidatedF8215RecoveryState `
    -AttemptId $AttemptId `
    -JobRoot $jobRoot `
    -AllowedRoot $script:NfcConfigRoot

  if ($recovery.Phase -ceq "awaiting_manual_start") {
    Start-ScheduledTask -TaskName $layout.TaskName -ErrorAction Stop
    $runtimeStarted = $true
    Wait-NfcExactRecoveryTransition -Config $config -ExpectedAttemptId $AttemptId | Out-Null
    $transitionedToUncertain = $true
  } elseif ($recovery.Phase -notin @("failed", "uncertain")) {
    throw "The exact F8215 job is not in a recoverable phase."
  }

  Stop-NfcRecoveryRuntime -Config $config -ExpectedTaskName $layout.TaskName | Out-Null
  $runtimeStarted = $false
  if (@(Get-NfcExactGoToTagsProcess -Config $config).Count -ne 0) {
    throw "GoToTags must remain closed before exact-attempt resolution."
  }

  # The installed pre-fix helper rewrites state with inherited leaf ACLs during
  # restart. Re-validate the exact identity and protect only those same leaves.
  $config = Read-NfcConfig -Path $layout.ConfigPath -AllowInheritedGoToTagsLeafFiles
  $recovery = Get-NfcValidatedF8215RecoveryState `
    -AttemptId $AttemptId `
    -JobRoot $jobRoot `
    -AllowedRoot $script:NfcConfigRoot `
    -AllowInheritedLeafFiles
  if ($recovery.Phase -notin @("failed", "uncertain")) {
    throw "The exact F8215 recovery state did not become failed or uncertain."
  }
  Protect-NfcValidatedF8215RecoveryArtifacts `
    -Recovery $recovery `
    -AllowedRoot $script:NfcConfigRoot

  $resolver = Join-Path $PSScriptRoot "resolve-ai-grader-nfc-abandoned-job.ps1"
  if (-not (Test-Path -LiteralPath $resolver -PathType Leaf)) {
    throw "The bounded exact-attempt resolver is unavailable."
  }
  $resolverOutput = @(& $resolver `
    -AttemptId $AttemptId `
    -Confirmation $Confirmation `
    -ConfigPath $layout.ConfigPath `
    -InstallDirectory $layout.InstallDirectory `
    -TaskName $layout.TaskName)
  $resolution = ($resolverOutput -join [Environment]::NewLine) | ConvertFrom-Json
  if (-not [bool]$resolution.ok -or
      [string]$resolution.resolution -cne "quarantined_abandoned_job_resolved" -or
      [bool]$resolution.encodingSuccessClaimed -or
      [string]$resolution.physicalTagDisposition -cne "removed_and_quarantined") {
    throw "The exact-attempt resolver did not return its bounded quarantine result."
  }

  Assert-NfcProtectedTree -Path $jobRoot -AllowedRoot $script:NfcConfigRoot
  Assert-NfcNoActiveGoToTagsRecovery -JobRoot $jobRoot -AllowedRoot $script:NfcConfigRoot
  Assert-NfcF8215RecoveryAudit `
    -AuditPath (Join-Path $jobRoot "abandoned-job-audit.jsonl") `
    -AllowedRoot $script:NfcConfigRoot
  $finalTaskState = Stop-NfcRecoveryRuntime -Config $config -ExpectedTaskName $layout.TaskName
  if (@(Get-NfcExactGoToTagsProcess -Config $config).Count -ne 0) {
    throw "GoToTags is unexpectedly running after bounded F8215 recovery."
  }

  [pscustomobject]@{
    ok = $true
    recovery = "exact_f8215_attempt_quarantined_and_gate_released"
    priorPhase = $priorPhase
    restartedInstalledHelperOnce = $transitionedToUncertain
    terminalPhase = [string]$resolution.priorPhase
    physicalTagDisposition = "removed_and_quarantined"
    encodingSuccessClaimed = $false
    protectedArtifactsRemoved = $true
    operationGateClear = $true
    helperStopped = $true
    scheduledTaskState = $finalTaskState
  } | ConvertTo-Json -Depth 3
} finally {
  # Always contain an ambiguous or partially successful Start-ScheduledTask.
  # This runs after success too, so the command's final invariant is exact task,
  # helper-process, and loopback-listener shutdown rather than a local flag.
  try {
    Stop-NfcRecoveryRuntime -Config $config -ExpectedTaskName $layout.TaskName | Out-Null
  } catch {
    throw "Bounded F8215 recovery ended without confirming the dedicated helper, task, and listener were stopped."
  }
}
