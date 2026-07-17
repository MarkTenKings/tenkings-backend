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
  New-Item -ItemType Directory -Path $live | Out-Null
  New-Item -ItemType Directory -Path $staged | Out-Null
  Set-Content -LiteralPath (Join-Path $live "marker.txt") -Value "old-success" -Encoding ASCII
  Set-Content -LiteralPath (Join-Path $staged "marker.txt") -Value "new-success" -Encoding ASCII
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
    }
  Assert-True ((Get-Content -LiteralPath (Join-Path $live "marker.txt") -Raw).Trim() -eq "new-success") "Successful replacement did not activate the staged install."
  Assert-True ((Get-Content -LiteralPath (Join-Path $backup "marker.txt") -Raw).Trim() -eq "old-success") "Successful replacement did not retain rollback state until final acceptance."

  $repoRoot = Get-NfcRepoRoot
  $update = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\update-ai-grader-nfc-helper.ps1") -Raw
  $export = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\export-ai-grader-nfc-workstation-public-key.ps1") -Raw
  $install = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\install-ai-grader-nfc-helper.ps1") -Raw
  $open = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\open-ai-grader-nfc-workstation.ps1") -Raw
  $rotate = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\rotate-ai-grader-nfc-helper-token.ps1") -Raw
  $configureFeiju = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\configure-ai-grader-nfc-feiju-f8215.ps1") -Raw
  $common = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\ai-grader-nfc-helper-common.ps1") -Raw
  $stop = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\stop-ai-grader-nfc-helper.ps1") -Raw
  $uninstall = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\ai-grader-nfc\uninstall-ai-grader-nfc-helper.ps1") -Raw
  $publishIndex = $update.IndexOf("& dotnet publish", [StringComparison]::Ordinal)
  $stagedVerifyIndex = $update.IndexOf("Invoke-NfcBuildVerification -DllPath `$stagedDll", [StringComparison]::Ordinal)
  $verifiedMarkerIndex = $update.IndexOf("Everything above is hardware-free", [StringComparison]::Ordinal)
  $stopIndex = $update.IndexOf("Stop-NfcUpdateProcess -Config `$config", $verifiedMarkerIndex, [StringComparison]::Ordinal)
  Assert-True ($publishIndex -ge 0 -and $publishIndex -lt $stagedVerifyIndex -and $stagedVerifyIndex -lt $verifiedMarkerIndex -and $verifiedMarkerIndex -lt $stopIndex) "Update can stop the working helper before staged-build verification."
  Assert-True ($update.IndexOf("Get-NfcPreservedStateSnapshot", [StringComparison]::Ordinal) -ge 0) "Update does not snapshot protected workstation state."
  Assert-True ($update.IndexOf("Assert-NfcPreservedState", [StringComparison]::Ordinal) -ge 0) "Update does not verify protected workstation state after replacement."
  Assert-True ($update.IndexOf("--export-workstation-attestation-public-key", [StringComparison]::Ordinal) -ge 0) "Update does not validate the existing CNG public identity."
  Assert-True ($update.IndexOf("Invoke-NfcWithWorkstationKeyEnvironment", [StringComparison]::Ordinal) -ge 0) "Update does not restore the caller's workstation-key environment."
  Assert-True ($export.IndexOf("Invoke-NfcWithWorkstationKeyEnvironment", [StringComparison]::Ordinal) -ge 0) "Public-only export does not restore the caller's workstation-key environment."
  Assert-True ($update.IndexOf("Remove-Item Env:\TENKINGS_NFC_WORKSTATION_KEY", [StringComparison]::Ordinal) -lt 0) "Update deletes pre-existing workstation-key environment."
  Assert-True ($export.IndexOf("Remove-Item Env:\TENKINGS_NFC_WORKSTATION_KEY", [StringComparison]::Ordinal) -lt 0) "Public-only export deletes pre-existing workstation-key environment."
  Assert-True ($update.IndexOf("Invoke-NfcInstallDirectoryReplacement", [StringComparison]::Ordinal) -ge 0) "Update does not use transactional directory replacement."
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
  Assert-True ($configureFeiju.IndexOf('feijuF8215Enabled', [StringComparison]::Ordinal) -ge 0) "F8215 configuration lacks its separate local gate."

  Write-Output "PASS NFC maintenance path/ACL containment, initial cleanup, stable launchers, rollback, preservation, and explicit-rotation contracts"
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-NfcSafeTree -Path $testRoot -AllowedRoot $testParent
  }
}
