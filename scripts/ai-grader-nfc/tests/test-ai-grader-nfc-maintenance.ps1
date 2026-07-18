[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "..\ai-grader-nfc-helper-common.ps1")

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Assert-Throws {
  param([scriptblock]$Action, [string]$Message)
  try { & $Action } catch { return }
  throw $Message
}

$testParent = Get-NfcCanonicalPath -Path ([IO.Path]::GetTempPath())
$testRoot = Join-Path $testParent "tenkings-nfc-maintenance-test-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $testRoot -ErrorAction Stop | Out-Null
try {
  $inside = Join-Path $testRoot "inside\artifact"
  $canonicalInside = Assert-NfcPathWithinRoot -Path $inside -AllowedRoot $testRoot
  Assert-True ($canonicalInside.StartsWith($testRoot, [StringComparison]::OrdinalIgnoreCase)) "Contained path validation failed."
  Assert-Throws { Assert-NfcPathWithinRoot -Path (Join-Path $testRoot "..\escape") -AllowedRoot $testRoot } "Traversal escaped the test root."
  Assert-Throws { Assert-NfcPathWithinRoot -Path $testRoot -AllowedRoot $testRoot } "Root deletion was accepted without -AllowRoot."

  $keyNameVariable = "TENKINGS_NFC_WORKSTATION_KEY_NAME"
  $keyIdVariable = "TENKINGS_NFC_WORKSTATION_KEY_ID"
  $originalKeyName = [Environment]::GetEnvironmentVariable($keyNameVariable, [EnvironmentVariableTarget]::Process)
  $originalKeyId = [Environment]::GetEnvironmentVariable($keyIdVariable, [EnvironmentVariableTarget]::Process)
  try {
    [Environment]::SetEnvironmentVariable($keyNameVariable, "preexisting-key-name", [EnvironmentVariableTarget]::Process)
    [Environment]::SetEnvironmentVariable($keyIdVariable, ("b" * 64), [EnvironmentVariableTarget]::Process)
    $temporaryResult = Invoke-NfcWithWorkstationKeyEnvironment `
      -KeyName $script:NfcAttestationKeyName `
      -KeyId ("a" * 64) `
      -ArgumentList @($script:NfcAttestationKeyName, ("a" * 64)) `
      -Action {
        param($expectedName, $expectedId)
        Assert-True ([Environment]::GetEnvironmentVariable($keyNameVariable, [EnvironmentVariableTarget]::Process) -ceq $expectedName) "Temporary key-name environment was not applied."
        Assert-True ([Environment]::GetEnvironmentVariable($keyIdVariable, [EnvironmentVariableTarget]::Process) -ceq $expectedId) "Temporary key-ID environment was not applied."
        return "environment-applied"
      }
    Assert-True ($temporaryResult -ceq "environment-applied") "Temporary key environment action did not complete."
    Assert-True ([Environment]::GetEnvironmentVariable($keyNameVariable, [EnvironmentVariableTarget]::Process) -ceq "preexisting-key-name") "Successful public-key validation did not restore the prior key-name environment."
    Assert-True ([Environment]::GetEnvironmentVariable($keyIdVariable, [EnvironmentVariableTarget]::Process) -ceq ("b" * 64)) "Successful public-key validation did not restore the prior key-ID environment."
    Assert-Throws {
      Invoke-NfcWithWorkstationKeyEnvironment `
        -KeyName $script:NfcAttestationKeyName `
        -KeyId ("a" * 64) `
        -Action { throw "injected public-key validation failure" }
    } "Injected public-key validation failure did not fail."
    Assert-True ([Environment]::GetEnvironmentVariable($keyNameVariable, [EnvironmentVariableTarget]::Process) -ceq "preexisting-key-name") "Failed public-key validation did not restore the prior key-name environment."
    Assert-True ([Environment]::GetEnvironmentVariable($keyIdVariable, [EnvironmentVariableTarget]::Process) -ceq ("b" * 64)) "Failed public-key validation did not restore the prior key-ID environment."
  } finally {
    try {
      [Environment]::SetEnvironmentVariable($keyNameVariable, $originalKeyName, [EnvironmentVariableTarget]::Process)
    } finally {
      [Environment]::SetEnvironmentVariable($keyIdVariable, $originalKeyId, [EnvironmentVariableTarget]::Process)
    }
  }

  $aclTree = Join-Path $testRoot "acl-tree"
  New-Item -ItemType Directory -Path $aclTree | Out-Null
  Set-Content -LiteralPath (Join-Path $aclTree "artifact.txt") -Value "acl" -Encoding ASCII
  Protect-NfcTree -Path $aclTree -AllowedRoot $testRoot
  Assert-NfcProtectedTree -Path $aclTree -AllowedRoot $testRoot

  $recoveryRoot = Join-Path $testRoot "recovery"
  New-Item -ItemType Directory -Path $recoveryRoot | Out-Null
  Protect-NfcTree -Path $recoveryRoot -AllowedRoot $testRoot
  Assert-NfcNoActiveGoToTagsRecovery -JobRoot $recoveryRoot -AllowedRoot $testRoot
  $auditPath = Join-Path $recoveryRoot "abandoned-job-audit.jsonl"
  Set-Content -LiteralPath $auditPath -Value '{"outcome":"removed_and_quarantined"}' -Encoding UTF8
  Assert-NfcNoActiveGoToTagsRecovery -JobRoot $recoveryRoot -AllowedRoot $testRoot
  Set-Content -LiteralPath (Join-Path $recoveryRoot "active-job.json") -Value '{}' -Encoding ASCII
  Assert-Throws {
    Assert-NfcNoActiveGoToTagsRecovery -JobRoot $recoveryRoot -AllowedRoot $testRoot
  } "Active recovery state did not keep the operation gate closed."
  Remove-Item -LiteralPath (Join-Path $recoveryRoot "active-job.json") -Force

  # Reproduce the legacy v3 defect: the protected job directory is explicit,
  # but helper-created state/operation/audit leaves inherit that exact DACL.
  $legacyRecoveryRoot = Join-Path $testRoot "legacy-recovery"
  New-Item -ItemType Directory -Path $legacyRecoveryRoot | Out-Null
  Protect-NfcPath -Path $legacyRecoveryRoot -AllowedRoot $testRoot
  $legacyAttemptId = "nfc_attempt_$('A' * 43)"
  $legacyPublicTagId = "P" * 32
  $legacyOperationName = "f8215-$('O' * 22).gototags"
  $legacyState = [ordered]@{
    attemptId = $legacyAttemptId
    requestDigest = "a" * 64
    publicTagId = $legacyPublicTagId
    attestationChallenge = "C" * 43
    url = "https://collect.tenkings.co/nfc/$legacyPublicTagId"
    attemptExpiresAt = "2026-07-18T12:00:00.0000000Z"
    callbackIdentity = "B" * 43
    correlationId = "R" * 43
    operationFileName = $legacyOperationName
    phase = "awaiting_manual_start"
    retryable = $false
    errorCode = $null
    callbackBodySha256 = $null
    evidence = $null
    createdAt = "2026-07-18T11:00:00.0000000Z"
    updatedAt = "2026-07-18T11:00:00.0000000Z"
  }
  $legacyState | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $legacyRecoveryRoot "active-job.json") -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $legacyRecoveryRoot $legacyOperationName) -Value "bounded-operation" -Encoding ASCII
  $legacyAudit = [ordered]@{
    schemaVersion = "tenkings-ai-grader-nfc-abandoned-resolution-v1"
    attemptFingerprintSha256 = "d" * 64
    priorPhase = "uncertain"
    errorCode = "gototags_helper_restarted"
    physicalTagDisposition = "removed_and_quarantined"
    action = "quarantine_resolution_authorized"
    encodingSuccessClaimed = $false
    resolvedAt = "2026-07-18T11:30:00.0000000Z"
  }
  $legacyAudit | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $legacyRecoveryRoot "abandoned-job-audit.jsonl") -Encoding UTF8
  Assert-Throws {
    Assert-NfcProtectedTree -Path $legacyRecoveryRoot -AllowedRoot $testRoot
  } "Strict validation accepted inherited legacy recovery leaves."
  Assert-NfcProtectedTree -Path $legacyRecoveryRoot -AllowedRoot $testRoot -AllowInheritedLeafFiles
  $validatedLegacy = Get-NfcValidatedF8215RecoveryState `
    -AttemptId $legacyAttemptId `
    -JobRoot $legacyRecoveryRoot `
    -AllowedRoot $testRoot `
    -AllowInheritedLeafFiles
  Assert-True ($validatedLegacy.Phase -ceq "awaiting_manual_start") "The exact legacy attempt was not validated."
  Assert-Throws {
    Get-NfcValidatedF8215RecoveryState `
      -AttemptId "nfc_attempt_$('Z' * 43)" `
      -JobRoot $legacyRecoveryRoot `
      -AllowedRoot $testRoot `
      -AllowInheritedLeafFiles
  } "A mismatched hosted attempt was accepted for legacy recovery."
  Set-Content -LiteralPath (Join-Path $legacyRecoveryRoot "unexpected.txt") -Value "unexpected" -Encoding ASCII
  Assert-Throws {
    Get-NfcValidatedF8215RecoveryState `
      -AttemptId $legacyAttemptId `
      -JobRoot $legacyRecoveryRoot `
      -AllowedRoot $testRoot `
      -AllowInheritedLeafFiles
  } "An unexpected recovery artifact was accepted."
  Remove-Item -LiteralPath (Join-Path $legacyRecoveryRoot "unexpected.txt") -Force
  Protect-NfcValidatedF8215RecoveryArtifacts -Recovery $validatedLegacy -AllowedRoot $testRoot
  Assert-NfcProtectedTree -Path $legacyRecoveryRoot -AllowedRoot $testRoot

  $inheritedDirectoryRoot = Join-Path $testRoot "inherited-directory-rejected"
  New-Item -ItemType Directory -Path $inheritedDirectoryRoot | Out-Null
  Protect-NfcPath -Path $inheritedDirectoryRoot -AllowedRoot $testRoot
  New-Item -ItemType Directory -Path (Join-Path $inheritedDirectoryRoot "unexpected-directory") | Out-Null
  Assert-Throws {
    Assert-NfcProtectedTree `
      -Path $inheritedDirectoryRoot `
      -AllowedRoot $testRoot `
      -AllowInheritedLeafFiles
  } "Inherited-directory ACL tolerance was incorrectly accepted."

  $foreignAceRoot = Join-Path $testRoot "foreign-ace-rejected"
  New-Item -ItemType Directory -Path $foreignAceRoot | Out-Null
  Protect-NfcPath -Path $foreignAceRoot -AllowedRoot $testRoot
  $foreignAceLeaf = Join-Path $foreignAceRoot "artifact.txt"
  Set-Content -LiteralPath $foreignAceLeaf -Value "foreign" -Encoding ASCII
  $foreignAcl = Get-Acl -LiteralPath $foreignAceLeaf
  $foreignAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier("S-1-1-0")),
    "FullControl",
    "Allow"
  ))) | Out-Null
  Set-Acl -LiteralPath $foreignAceLeaf -AclObject $foreignAcl
  Assert-Throws {
    Assert-NfcProtectedTree `
      -Path $foreignAceRoot `
      -AllowedRoot $testRoot `
      -AllowInheritedLeafFiles
  } "Inherited-leaf tolerance accepted a foreign ACE."

  $live = Join-Path $testRoot "live"
  $staged = Join-Path $testRoot "staged"
  $backup = Join-Path $testRoot "backup"
  New-Item -ItemType Directory -Path $live | Out-Null
  New-Item -ItemType Directory -Path $staged | Out-Null
  Set-Content -LiteralPath (Join-Path $live "marker.txt") -Value "old" -Encoding ASCII
  Set-Content -LiteralPath (Join-Path $staged "marker.txt") -Value "new" -Encoding ASCII
  Assert-Throws {
    Invoke-NfcInstallDirectoryReplacement `
      -InstallDirectory $live `
      -StagingDirectory $staged `
      -BackupDirectory $backup `
      -AllowedRoot $testRoot `
      -ValidateReplacement { throw "injected replacement validation failure" }
  } "Injected replacement failure did not fail closed."
  Assert-True ((Get-Content -LiteralPath (Join-Path $live "marker.txt") -Raw).Trim() -eq "old") "Rollback did not restore the prior live install."
  Assert-True ((Get-Content -LiteralPath (Join-Path $staged "marker.txt") -Raw).Trim() -eq "new") "Rollback did not isolate the failed replacement."
  Assert-True (-not (Test-Path -LiteralPath $backup)) "Rollback left the prior install stranded in backup."

  Remove-NfcSafeTree -Path $live -AllowedRoot $testRoot
  Remove-NfcSafeTree -Path $staged -AllowedRoot $testRoot
  $repoRoot = Get-NfcRepoRoot
  $templateAttribute = "packages/ai-grader-nfc-helper/src/TenKings.AiGrader.NfcHelper/Templates/f8215-gototags-manual-start-v1.json text eol=lf"
  Assert-True ([IO.File]::ReadAllLines((Join-Path $repoRoot ".gitattributes")) -ccontains $templateAttribute) "The reviewed GoToTags template is not pinned to LF in .gitattributes."
  New-Item -ItemType Directory -Path $live | Out-Null
  New-Item -ItemType Directory -Path $staged | Out-Null
  Set-Content -LiteralPath (Join-Path $live "marker.txt") -Value "old-success" -Encoding ASCII
  Set-Content -LiteralPath (Join-Path $staged "marker.txt") -Value "new-success" -Encoding ASCII
  Copy-NfcReviewedGoToTagsTemplate `
    -RepoRoot $repoRoot `
    -DestinationInstallDirectory $staged `
    -AllowedDestinationRoot $testRoot | Out-Null
  Invoke-NfcInstallDirectoryReplacement `
    -InstallDirectory $live `
    -StagingDirectory $staged `
    -BackupDirectory $backup `
    -AllowedRoot $testRoot `
    -ValidateReplacement {
      param($activated)
      if ((Get-Content -LiteralPath (Join-Path $activated "marker.txt") -Raw).Trim() -ne "new-success") {
        throw "The staged install was not activated for validation."
      }
      if ((Get-NfcFileFingerprint -Path (Join-Path $activated "Templates\f8215-gototags-manual-start-v1.json")) -cne $script:NfcGoToTagsTemplateSha256) {
        throw "The activated install did not retain the reviewed GoToTags template bytes."
      }
    }
  Assert-True ((Get-Content -LiteralPath (Join-Path $live "marker.txt") -Raw).Trim() -eq "new-success") "Successful replacement did not activate the staged install."
  Assert-True ((Get-Content -LiteralPath (Join-Path $backup "marker.txt") -Raw).Trim() -eq "old-success") "Successful replacement did not retain rollback state until final acceptance."
  $installedTemplate = Join-Path $live "Templates\f8215-gototags-manual-start-v1.json"
  Assert-True ((Get-NfcFileFingerprint -Path $installedTemplate) -ceq $script:NfcGoToTagsTemplateSha256) "Windows maintenance did not install the reviewed GoToTags template bytes."
  Assert-True (-not ([IO.File]::ReadAllBytes($installedTemplate) -contains [byte]13)) "The installed GoToTags template contains a CR byte instead of exact LF line endings."

  $update = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\update-ai-grader-nfc-helper.ps1") -Raw
  $export = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\export-ai-grader-nfc-workstation-public-key.ps1") -Raw
  $install = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\install-ai-grader-nfc-helper.ps1") -Raw
  $open = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\open-ai-grader-nfc-workstation.ps1") -Raw
  $rotate = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\rotate-ai-grader-nfc-helper-token.ps1") -Raw
  $configureFeiju = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\configure-ai-grader-nfc-feiju-f8215.ps1") -Raw
  $common = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\ai-grader-nfc-helper-common.ps1") -Raw
  $stop = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\stop-ai-grader-nfc-helper.ps1") -Raw
  $uninstall = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\uninstall-ai-grader-nfc-helper.ps1") -Raw
  $resolveAbandoned = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\resolve-ai-grader-nfc-abandoned-job.ps1") -Raw
  $recoverStuck = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\recover-ai-grader-nfc-f8215-stuck-job.ps1") -Raw
  $publishIndex = $update.IndexOf("& dotnet publish", [StringComparison]::Ordinal)
  $templateCopyIndex = $update.IndexOf("Copy-NfcReviewedGoToTagsTemplate", [StringComparison]::Ordinal)
  $stagedVerifyIndex = $update.IndexOf("Invoke-NfcBuildVerification -DllPath `$stagedDll", [StringComparison]::Ordinal)
  $verifiedMarkerIndex = $update.IndexOf("Everything above is hardware-free", [StringComparison]::Ordinal)
  $stopIndex = $update.IndexOf("Stop-NfcUpdateProcess -Config `$config", $verifiedMarkerIndex, [StringComparison]::Ordinal)
  Assert-True ($publishIndex -ge 0 -and $publishIndex -lt $templateCopyIndex -and $templateCopyIndex -lt $stagedVerifyIndex -and $stagedVerifyIndex -lt $verifiedMarkerIndex -and $verifiedMarkerIndex -lt $stopIndex) "Update can stop the working helper before reviewed-template and staged-build verification."
  Assert-True ($update.IndexOf("Get-NfcPreservedStateSnapshot", [StringComparison]::Ordinal) -ge 0) "Update does not snapshot protected workstation state."
  Assert-True ($update.IndexOf("Assert-NfcPreservedState", [StringComparison]::Ordinal) -ge 0) "Update does not verify protected workstation state after replacement."
  Assert-True ($update.IndexOf("--export-workstation-attestation-public-key", [StringComparison]::Ordinal) -ge 0) "Update does not validate the existing CNG public identity."
  Assert-True ($update.IndexOf("Invoke-NfcWithWorkstationKeyEnvironment", [StringComparison]::Ordinal) -ge 0) "Update does not restore the caller's workstation-key environment."
  Assert-True ($export.IndexOf("Invoke-NfcWithWorkstationKeyEnvironment", [StringComparison]::Ordinal) -ge 0) "Public-only export does not restore the caller's workstation-key environment."
  Assert-True ($update.IndexOf("Remove-Item Env:\TENKINGS_NFC_WORKSTATION_KEY", [StringComparison]::Ordinal) -lt 0) "Update deletes pre-existing workstation-key environment."
  Assert-True ($export.IndexOf("Remove-Item Env:\TENKINGS_NFC_WORKSTATION_KEY", [StringComparison]::Ordinal) -lt 0) "Public-only export deletes pre-existing workstation-key environment."
  Assert-True ($update.IndexOf("Invoke-NfcInstallDirectoryReplacement", [StringComparison]::Ordinal) -ge 0) "Update does not use transactional directory replacement."
  Assert-True ($templateCopyIndex -ge 0) "Update does not stage the reviewed GoToTags template with a byte-exact copy."
  Assert-True ($update.IndexOf("Copy-NfcStableMaintenancePayload", [StringComparison]::Ordinal) -ge 0) "Update does not refresh stable installed launchers."
  Assert-True ($update.IndexOf("Initialize-NfcConfig", [StringComparison]::Ordinal) -lt 0) "Ordinary update can rewrite protected config."
  Assert-True ($update.IndexOf("--ensure-workstation-attestation-key", [StringComparison]::Ordinal) -lt 0) "Ordinary update can create or rotate the CNG key."
  Assert-True ($update.IndexOf("RotateToken", [StringComparison]::Ordinal) -lt 0) "Ordinary update can rotate the workstation token."
  Assert-True ($update.IndexOf("RotatePairingCode", [StringComparison]::Ordinal) -lt 0) "Ordinary update can rotate the pairing code."
  Assert-True ($update.IndexOf("capture-helper", [StringComparison]::OrdinalIgnoreCase) -lt 0) "NFC update references the camera capture helper."
  Assert-True ($install.IndexOf("Use update-ai-grader-nfc-helper.ps1", [StringComparison]::Ordinal) -ge 0) "Installer rerun does not redirect operators to safe update."
  Assert-True ($install.IndexOf("-RotatePairingCode", [StringComparison]::Ordinal) -lt 0) "Installer silently rotates pairing state."
  Assert-True ($install.IndexOf("newly created files/config/task/shortcut were removed", [StringComparison]::Ordinal) -ge 0) "Initial install lacks bounded cleanup reporting."
  Assert-True ($install.IndexOf("CNG key, if created, was preserved", [StringComparison]::Ordinal) -ge 0) "Initial install can silently discard its named key identity."
  Assert-True ($install.IndexOf("`$script:NfcStableStartScript", [StringComparison]::Ordinal) -ge 0) "Scheduled Task does not use the stable installed launcher."
  Assert-True ($install.IndexOf("`$script:NfcStableOpenScript", [StringComparison]::Ordinal) -ge 0) "Shortcut does not use the stable installed launcher."
  Assert-True ($install.IndexOf('helperVersion -cne "tenkings-ai-grader-nfc-helper-v3"', [StringComparison]::Ordinal) -ge 0) "Initial install does not pin the helper version."
  Assert-True ($install.IndexOf('attestationSchemaVersion -cne "ai-grader-nfc-helper-attestation-v1"', [StringComparison]::Ordinal) -ge 0) "Initial install does not pin the attestation schema."
  Assert-True ($install.IndexOf('multiProfileAttestationSchemaVersion -cne "ai-grader-nfc-helper-attestation-v2"', [StringComparison]::Ordinal) -ge 0) "Initial install does not pin the multi-profile attestation schema."
  Assert-True ($install.IndexOf("attestationAlgorithm -cne `$script:NfcAttestationAlgorithm", [StringComparison]::Ordinal) -ge 0) "Initial install does not pin the attestation algorithm."
  Assert-True ($open.IndexOf("Initialize-NfcConfig", [StringComparison]::Ordinal) -lt 0) "Ordinary workstation open rewrites protected config."
  Assert-True ($open.IndexOf("Restart-NfcTask", [StringComparison]::Ordinal) -lt 0) "Ordinary workstation open restarts a healthy helper."
  Assert-True ($open.IndexOf("pairingConsumed", [StringComparison]::Ordinal) -ge 0) "Ordinary workstation open does not preserve one-time pairing trust."
  Assert-True ($open.IndexOf('$script:NfcChromeUserDataDir = "C:\TenKings\chrome-ai-grader-profile"', [StringComparison]::Ordinal) -ge 0) "NFC workstation launcher does not pin the canonical AI Grader Chrome profile."
  Assert-True ($open.IndexOf('function Get-NfcChromePath', [StringComparison]::Ordinal) -ge 0) "NFC workstation launcher does not discover Google Chrome explicitly."
  Assert-True ($open.IndexOf('"--user-data-dir=$profilePath"', [StringComparison]::Ordinal) -ge 0) "NFC workstation launcher does not bind Chrome to the dedicated profile."
  Assert-True ($open.IndexOf('"--new-window"', [StringComparison]::Ordinal) -ge 0) "NFC workstation launcher does not open the programming page in a dedicated Chrome window."
  Assert-True ($open.IndexOf('Start-Process `', [StringComparison]::Ordinal) -ge 0 -and
    $open.IndexOf('-FilePath $chromePath', [StringComparison]::Ordinal) -ge 0 -and
    $open.IndexOf('-ArgumentList $chromeArguments', [StringComparison]::Ordinal) -ge 0) "NFC workstation launcher does not invoke the explicitly discovered Chrome executable."
  Assert-True ($open.IndexOf('Start-Process $url', [StringComparison]::Ordinal) -lt 0) "NFC workstation launcher can fall back to the Windows default browser/profile."
  Assert-True ($open.IndexOf('[string]$ChromeUserDataDir', [StringComparison]::Ordinal) -lt 0) "NFC workstation launcher allows the fixed Chrome profile to be overridden through shortcut arguments."
  $openResult = $open.Substring($open.LastIndexOf('[pscustomobject]@{', [StringComparison]::Ordinal))
  Assert-True ($openResult.IndexOf('pairingCode =', [StringComparison]::Ordinal) -lt 0 -and
    $openResult.IndexOf('url =', [StringComparison]::OrdinalIgnoreCase) -lt 0) "NFC workstation launcher result can expose its one-time pairing URL or code."
  Assert-True ($open.IndexOf('function Wait-NfcHelperLoopbackListener', [StringComparison]::Ordinal) -ge 0) "NFC workstation launcher does not bound helper-listener startup before automatic pairing."
  Assert-True ($open.IndexOf('-LocalAddress "127.0.0.1"', [StringComparison]::Ordinal) -ge 0 -and
    $open.IndexOf('-LocalPort 47662', [StringComparison]::Ordinal) -ge 0 -and
    $open.IndexOf('[int]$_.ProcessId', [StringComparison]::Ordinal) -ge 0 -and
    $open.IndexOf('$helperProcessIds -contains [int]$_.OwningProcess', [StringComparison]::Ordinal) -ge 0) "NFC workstation launcher readiness wait is not bound to the exact helper-owned loopback listener."
  $listenerWaitIndex = $open.IndexOf('Wait-NfcHelperLoopbackListener -Config $config', [StringComparison]::Ordinal)
  $openChromeIndex = $open.IndexOf('Open-NfcWorkstationChrome -Url $url', [StringComparison]::Ordinal)
  Assert-True ($listenerWaitIndex -ge 0 -and $openChromeIndex -gt $listenerWaitIndex) "NFC workstation launcher can open Chrome before the helper listener is ready."
  Assert-True ($open.IndexOf('#aiGraderNfcLaunch=v1', [StringComparison]::Ordinal) -ge 0 -and
    $open.IndexOf('&aiGraderNfcPair=', [StringComparison]::Ordinal) -ge 0) "NFC workstation launcher does not identify its scrubbed automatic bootstrap fragment."
  Assert-True ($stop.IndexOf("Assert-NfcScheduledTaskDefinition", [StringComparison]::Ordinal) -ge 0) "Stop does not validate the dedicated task before mutation."
  Assert-True ($uninstall.IndexOf("Assert-NfcScheduledTaskDefinition", [StringComparison]::Ordinal) -ge 0) "Uninstall does not validate the dedicated task before removal."
  $uninstallShortcutValidationIndex = $uninstall.IndexOf("Assert-NfcDesktopShortcutDefinition", [StringComparison]::Ordinal)
  $uninstallStopIndex = $uninstall.IndexOf('Join-Path $PSScriptRoot "stop-ai-grader-nfc-helper.ps1"', [StringComparison]::Ordinal)
  $uninstallShortcutRemovalIndex = $uninstall.IndexOf("Remove-Item -LiteralPath `$shortcut", [StringComparison]::Ordinal)
  Assert-True ($uninstallShortcutValidationIndex -ge 0 -and
    $uninstallShortcutValidationIndex -lt $uninstallStopIndex -and
    $uninstallStopIndex -lt $uninstallShortcutRemovalIndex) "Uninstall does not validate the dedicated desktop shortcut before any mutation and its removal."
  Assert-True ($rotate.IndexOf("-not `$RotateToken -and -not `$RotatePairingCode", [StringComparison]::Ordinal) -ge 0) "Credential maintenance does not require an explicit rotation choice."
  Assert-True ($rotate.IndexOf("`$RotateToken -and -not `$RotatePairingCode", [StringComparison]::Ordinal) -ge 0) "Token rotation can strand consumed browser pairing trust."
  Assert-True ($rotate.IndexOf("also requires -RotatePairingCode", [StringComparison]::Ordinal) -ge 0) "Token rotation does not explain its mandatory pairing rotation."
  Assert-True ($rotate.IndexOf("Ordinary update rotates neither", [StringComparison]::Ordinal) -ge 0) "Credential maintenance does not document the ordinary-update boundary."
  Assert-True ($configureFeiju.IndexOf('4.37.0.1', [StringComparison]::Ordinal) -ge 0) "F8215 configuration does not pin GoToTags."
  Assert-True ($common.IndexOf('d21adfdef57393b948ce4e6d8771f6daa215041fa27c777ef33de24057883774', [StringComparison]::Ordinal) -ge 0) "F8215 configuration does not pin the approved GoToTags executable bytes."
  Assert-True ($configureFeiju.IndexOf('Desktopapp_4.37.0.1_x64__14h5dv7m6vvvy', [StringComparison]::Ordinal) -ge 0) "F8215 configuration does not pin the approved operation-file association."
  Assert-True ($configureFeiju.IndexOf('CN=GoToTags, O=GoToTags, S=Washington, C=US', [StringComparison]::Ordinal) -ge 0) "F8215 configuration does not pin the publisher."
  Assert-True ($configureFeiju.IndexOf('CertPropSvc', [StringComparison]::Ordinal) -ge 0) "F8215 configuration does not fail closed on Certificate Propagation."
  Assert-True ($configureFeiju.IndexOf('Set-Service', [StringComparison]::OrdinalIgnoreCase) -lt 0) "F8215 configuration can change Windows services."
  Assert-True ($configureFeiju.IndexOf('Start-Service', [StringComparison]::OrdinalIgnoreCase) -lt 0) "F8215 configuration can start Windows services."
  Assert-True ($configureFeiju.IndexOf('feijuF8215Enabled', [StringComparison]::Ordinal) -lt 0) "F8215 configuration still contains a redundant local profile gate."
  Assert-True ($common.IndexOf('recover-ai-grader-nfc-f8215-stuck-job.ps1', [StringComparison]::Ordinal) -ge 0) "Stable maintenance payload omits legacy stuck-job recovery."
  Assert-True ($common.IndexOf('resolve-ai-grader-nfc-abandoned-job.ps1', [StringComparison]::Ordinal) -ge 0) "Stable maintenance payload omits abandoned-job resolution."
  $truthfulQuarantineConfirmation = 'I removed and quarantined the exact NFC tag used for this F8215 attempt.'
  Assert-True ($resolveAbandoned.IndexOf($truthfulQuarantineConfirmation, [StringComparison]::Ordinal) -ge 0) "Abandoned-job resolution lacks truthful physical quarantine confirmation."
  Assert-True ($recoverStuck.IndexOf($truthfulQuarantineConfirmation, [StringComparison]::Ordinal) -ge 0) "Stuck-job recovery lacks truthful physical quarantine confirmation."
  Assert-True ($recoverStuck.IndexOf('Start-ScheduledTask', [StringComparison]::Ordinal) -ge 0) "Stuck-job recovery does not perform the bounded restart-to-uncertain transition."
  Assert-True ($recoverStuck.IndexOf('gototags_helper_restarted', [StringComparison]::Ordinal) -ge 0) "Stuck-job recovery does not require the exact restart uncertainty evidence."
  Assert-True ($recoverStuck.IndexOf('Get-NfcValidatedF8215RecoveryState', [StringComparison]::Ordinal) -ge 0) "Stuck-job recovery does not validate the exact attempt state."
  Assert-True ($recoverStuck.IndexOf('Protect-NfcValidatedF8215RecoveryArtifacts', [StringComparison]::Ordinal) -ge 0) "Stuck-job recovery does not protect the exact validated legacy leaves."
  Assert-True ($recoverStuck.IndexOf('Assert-NfcNoActiveGoToTagsRecovery', [StringComparison]::Ordinal) -ge 0) "Stuck-job recovery does not prove the operation gate artifacts are clear."
  Assert-True ($recoverStuck.IndexOf('Get-NfcExactGoToTagsProcess', [StringComparison]::Ordinal) -ge 0) "Stuck-job recovery does not require the exact GoToTags executable to be closed."
  Assert-True ($recoverStuck.IndexOf('CommandLine', [StringComparison]::OrdinalIgnoreCase) -lt 0) "Stuck-job recovery can falsely match unrelated process command lines."
  Assert-True ($resolveAbandoned.IndexOf('Get-NfcHelperProcess', [StringComparison]::Ordinal) -ge 0) "Abandoned-job resolution does not require the helper process to be stopped."
  Assert-True ($resolveAbandoned.IndexOf('Get-NetTCPConnection', [StringComparison]::Ordinal) -ge 0) "Abandoned-job resolution does not require the loopback listener to be stopped."
  Assert-True ($resolveAbandoned.IndexOf('Get-NfcExactGoToTagsProcess', [StringComparison]::Ordinal) -ge 0) "Abandoned-job resolution does not require the exact GoToTags executable to be closed."
  Assert-True ($resolveAbandoned.IndexOf('--resolve-abandoned-f8215-job', [StringComparison]::Ordinal) -ge 0) "Abandoned-job resolution does not invoke the bounded helper mode."

  $versionedResult = (& (Join-Path $PSScriptRoot "test-ai-grader-nfc-versioned-update.ps1") | Out-String) | ConvertFrom-Json
  Assert-True ([bool]$versionedResult.ok -and [bool]$versionedResult.filesystemReplacementExecuted) "Versioned update did not execute real filesystem replacement."
  Assert-True ($versionedResult.scenarios.Count -eq 3) "Versioned update did not cover all required upgrade/rollback paths."
  Assert-True ($versionedResult.scenarios[0].prior -ceq $script:NfcHelperVersionV2 -and $versionedResult.scenarios[0].final -ceq $script:NfcHelperVersionV3) "Real v2-to-v3 replacement did not pass."
  Assert-True ([bool]$versionedResult.scenarios[1].rolledBack -and $versionedResult.scenarios[1].final -ceq $script:NfcHelperVersionV2) "Injected v3 activation failure did not restore exact v2."
  Assert-True ($versionedResult.scenarios[2].prior -ceq $script:NfcHelperVersionV3 -and $versionedResult.scenarios[2].final -ceq $script:NfcHelperVersionV3) "Idempotent v3-to-v3 replacement did not pass."

  Write-Output "PASS NFC maintenance path/ACL containment, exact GoToTags template bytes, v2-to-v3 upgrade/rollback, quarantine recovery, stable launchers, preservation, and explicit-rotation contracts"
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-NfcSafeTree -Path $testRoot -AllowedRoot $testParent
  }
}
