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
# Installed helper v3 builds predating this maintenance correction accept the
# following private compatibility token. It is never accepted from the operator
# and is passed only after the truthful public confirmation above succeeds.
$installedV3ResolverCompatibilityToken = "I removed and quarantined the exact F8215 tag for this attempt."
if ($Confirmation -cne $requiredConfirmation) {
  throw "Type the exact physical-tag removal and quarantine confirmation before resolving this job."
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this bounded NFC quarantine maintenance command from an elevated PowerShell window."
}

$layout = Assert-NfcProductionLayout -ConfigPath $ConfigPath -InstallDirectory $InstallDirectory -TaskName $TaskName
$config = Read-NfcConfig -Path $layout.ConfigPath -AllowInheritedGoToTagsLeafFiles
if ($null -eq $config -or [string]::IsNullOrWhiteSpace([string]$config.goToTagsExecutablePath)) {
  throw "The installed F8215 helper configuration is unavailable."
}
$jobRoot = Assert-NfcPathWithinRoot -Path ([string]$config.goToTagsJobRoot) -AllowedRoot $script:NfcConfigRoot
if (-not $jobRoot.Equals((Get-NfcCanonicalPath -Path $script:NfcGoToTagsJobRoot), [StringComparison]::OrdinalIgnoreCase)) {
  throw "The F8215 job root does not match the dedicated protected location."
}
$recovery = Get-NfcValidatedF8215RecoveryState `
  -AttemptId $AttemptId `
  -JobRoot $jobRoot `
  -AllowedRoot $script:NfcConfigRoot `
  -AllowInheritedLeafFiles

$task = Assert-NfcScheduledTaskDefinition -TaskName $layout.TaskName
if ($task.State -eq "Running" -or @(Get-NfcHelperProcess -Config $config).Count -ne 0) {
  throw "Stop the dedicated NFC helper and Scheduled Task before offline quarantine resolution."
}
$listeners = @(Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 47662 -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -ne 0) { throw "The NFC helper loopback listener must be stopped before offline quarantine resolution." }
$goToTags = @(Get-NfcExactGoToTagsProcess -Config $config)
if ($goToTags.Count -ne 0) { throw "Close GoToTags completely before offline quarantine resolution." }

Protect-NfcValidatedF8215RecoveryArtifacts -Recovery $recovery -AllowedRoot $script:NfcConfigRoot
$recovery = Get-NfcValidatedF8215RecoveryState `
  -AttemptId $AttemptId `
  -JobRoot $jobRoot `
  -AllowedRoot $script:NfcConfigRoot
if ($recovery.Phase -notin @("failed", "uncertain")) {
  throw "Only the exact failed or uncertain F8215 job may be resolved through quarantine maintenance."
}

$dll = Assert-NfcPathWithinRoot -Path (Join-Path $layout.InstallDirectory "TenKings.AiGrader.NfcHelper.dll") -AllowedRoot $layout.InstallDirectory
if (-not (Test-Path -LiteralPath $dll -PathType Leaf)) { throw "The installed NFC helper executable is missing." }

$variables = @(
  "TENKINGS_NFC_GOTOTAGS_JOB_ROOT",
  "TENKINGS_NFC_ABANDONED_ATTEMPT_ID",
  "TENKINGS_NFC_ABANDONED_CONFIRMATION"
)
$previous = @{}
foreach ($name in $variables) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
try {
  [Environment]::SetEnvironmentVariable($variables[0], $jobRoot, "Process")
  [Environment]::SetEnvironmentVariable($variables[1], $AttemptId, "Process")
  [Environment]::SetEnvironmentVariable($variables[2], $installedV3ResolverCompatibilityToken, "Process")
  $output = @(& dotnet $dll --resolve-abandoned-f8215-job)
  if ($LASTEXITCODE -ne 0) { throw "The helper rejected the bounded abandoned-job resolution." }
  $result = ($output -join [Environment]::NewLine) | ConvertFrom-Json
  if ($result.resolution -cne "quarantined_abandoned_job_resolved" -or
      -not [bool]$result.protectedArtifactsRemoved -or
      [bool]$result.encodingSuccessClaimed -or
      [string]$result.attemptFingerprintSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      [string]$result.attemptFingerprintSha256 -cne (Get-NfcSha256Text -Value $AttemptId)) {
    throw "The abandoned-job resolver returned an unsafe result."
  }
  $auditPath = Join-Path $jobRoot "abandoned-job-audit.jsonl"
  if (-not (Test-Path -LiteralPath $auditPath -PathType Leaf)) {
    throw "The abandoned-job resolver did not persist its protected quarantine audit."
  }
  Protect-NfcPath -Path $auditPath -AllowedRoot $script:NfcConfigRoot
  Assert-NfcProtectedTree -Path $jobRoot -AllowedRoot $script:NfcConfigRoot
  Assert-NfcF8215RecoveryAudit -AuditPath $auditPath -AllowedRoot $script:NfcConfigRoot
  Assert-NfcNoActiveGoToTagsRecovery -JobRoot $jobRoot -AllowedRoot $script:NfcConfigRoot
  [pscustomobject]@{
    ok = $true
    resolution = [string]$result.resolution
    attemptFingerprintSha256 = [string]$result.attemptFingerprintSha256
    priorPhase = [string]$result.priorPhase
    physicalTagDisposition = "removed_and_quarantined"
    encodingSuccessClaimed = $false
    operationGateReleasedOnNextStart = [bool]$result.operationGateReleasedOnNextStart
  } | ConvertTo-Json -Depth 3
} finally {
  foreach ($name in $variables) {
    [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
  }
}
