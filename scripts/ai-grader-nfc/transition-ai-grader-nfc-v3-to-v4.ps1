[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ServerTrustJsonPath,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedCurrentJobSigningKeyId,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedConfigSha256,
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [string]$InstallDirectory = "C:\TenKings\tools\ai-grader-nfc-helper",
  [string]$TaskName = "TenKingsAiGraderNfcHelper"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

function Stop-NfcV4TransitionProcess {
  param([Parameter(Mandatory = $true)]$Config)
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  foreach ($process in @(Get-NfcHelperProcess -Config $Config)) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  }
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if (@(Get-NfcHelperProcess -Config $Config).Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "The NFC helper did not stop within the bounded V4 transition window."
}

function Get-NfcV4TransitionStatus {
  param([Parameter(Mandatory = $true)]$Config)
  $headers = @{
    Origin = $script:NfcAllowedOrigin
    "x-tenkings-nfc-token" = [string]$Config.workstationToken
  }
  return Invoke-RestMethod -Method Get -Uri "$($Config.helperUrl)/status" -Headers $headers -TimeoutSec 3
}

function Wait-NfcV4TransitionReady {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [Parameter(Mandatory = $true)][bool]$ExpectV2
  )
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      $response = Get-NfcV4TransitionStatus -Config $Config
      $status = $response.result
      $v1Compatible = @($status.supportedProfiles | Where-Object {
        $_.chipType -ceq "FEIJU_F8215" -and [bool]$_.implemented -and [bool]$_.permanentlyLocksTag
      }).Count -eq 1
      $actualKeyIds = @($status.tenKingsV2TrustedJobSigningKeyIds | ForEach-Object { [string]$_ })
      $exactKeySet = $false
      try {
        Assert-NfcExactKeyIdSet -Expected $script:ExpectedV2JobKeyIds -Actual $actualKeyIds
        $exactKeySet = $true
      } catch { $exactKeySet = $false }
      $v2Ready = [bool]$status.tenKingsV2NfcEnabled -and
        [string]$status.tenKingsV2NfcCapability -ceq "ten-kings-v2-f8215-static-url-v1" -and
        $exactKeySet
      if ($response.ok -and
          [string]$status.helperVersion -ceq $script:NfcHelperVersionV4 -and
          [string]$status.helperProtocolVersion -ceq $script:NfcHelperProtocolVersion -and
          -not [bool]$status.busy -and
          $v1Compatible -and
          $v2Ready -eq $ExpectV2) {
        return
      }
    } catch { }
    if ($attempt + 1 -lt 40) { Start-Sleep -Milliseconds 250 }
  }
  throw "The NFC helper did not reach exact V1-compatible V4 transition readiness."
}

function Start-NfcV4TransitionTaskIfStopped {
  param([Parameter(Mandatory = $true)]$Config)
  if (@(Get-NfcHelperProcess -Config $Config).Count -eq 0) {
    $task = Assert-NfcScheduledTaskDefinition -TaskName $TaskName
    if ([string]$task.State -cne "Running") {
      Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    }
  }
}

function New-NfcV4TransitionResult {
  param([bool]$RecoveredAtEntry)
  return [pscustomobject]@{
    ok = $true
    priorConfigVersion = "tenkings-ai-grader-nfc-helper-config-v3"
    configVersion = "tenkings-ai-grader-nfc-helper-config-v4"
    helperVersion = $script:NfcHelperVersionV4
    priorConfigSha256 = $ExpectedConfigSha256
    currentJobSigningKeyId = $ExpectedCurrentJobSigningKeyId
    trustedJobSigningKeyCount = $script:ExpectedV2JobKeyIds.Count
    v1Compatible = $true
    idle = $true
    recoveredAtEntry = $RecoveredAtEntry
    hardwareAccessed = $false
    productionPrivateKeyAccessed = $false
  }
}

$layout = Assert-NfcProductionLayout -ConfigPath $ConfigPath -InstallDirectory $InstallDirectory -TaskName $TaskName
$ConfigPath = $layout.ConfigPath
$InstallDirectory = $layout.InstallDirectory
$TaskName = $layout.TaskName
$journalPath = Assert-NfcPathWithinRoot `
  -Path $script:NfcV3ToV4TransitionJournalPath `
  -AllowedRoot $script:NfcConfigRoot
if (-not (Test-Path -LiteralPath $ServerTrustJsonPath -PathType Leaf) -or
    (Get-Item -LiteralPath $ServerTrustJsonPath).Length -gt 4096) {
  throw "The staged NFC V2 public-trust file is unavailable or outside its size bound."
}
$trustJson = Get-Content -LiteralPath $ServerTrustJsonPath -Raw
Assert-NfcV2ServerTrustJson -Value $trustJson | Out-Null
$trust = $trustJson | ConvertFrom-Json
if ([string]$trust.current.keyId -cne $ExpectedCurrentJobSigningKeyId) {
  throw "The staged NFC V2 current public key does not match the approved signing-key ID."
}
$script:ExpectedV2JobKeyIds = @(
  [string]$trust.current.keyId
  $(if ($null -ne $trust.prior) { [string]$trust.prior.keyId })
)
Assert-NfcExactKeyIdSet -Expected $script:ExpectedV2JobKeyIds -Actual $script:ExpectedV2JobKeyIds
$dll = Join-Path $InstallDirectory "TenKings.AiGrader.NfcHelper.dll"
Invoke-NfcBuildVerification -DllPath $dll -AllowedHelperVersion @($script:NfcHelperVersionV4) | Out-Null
try {
  if (Test-Path -LiteralPath $journalPath) {
    $entryJournal = Read-NfcV3ToV4TransitionJournal `
      -ConfigPath $ConfigPath `
      -JournalPath $journalPath `
      -AllowedRoot $script:NfcConfigRoot `
      -ExpectedV3Sha256 $ExpectedConfigSha256 `
      -ExpectedCurrentJobSigningKeyId $ExpectedCurrentJobSigningKeyId `
      -ExpectedTrustedJobSigningKeyIds $script:ExpectedV2JobKeyIds
    $entryV3Bytes = [Convert]::FromBase64String([string]$entryJournal.v3ConfigBytesBase64)
    try { $processConfig = [Text.Encoding]::UTF8.GetString($entryV3Bytes) | ConvertFrom-Json }
    finally { [Array]::Clear($entryV3Bytes, 0, $entryV3Bytes.Length) }
    $entryOutcome = Resolve-NfcV3ToV4TransitionJournal `
      -ConfigPath $ConfigPath `
      -JournalPath $journalPath `
      -AllowedRoot $script:NfcConfigRoot `
      -ExpectedV3Sha256 $ExpectedConfigSha256 `
      -ExpectedCurrentJobSigningKeyId $ExpectedCurrentJobSigningKeyId `
      -ExpectedTrustedJobSigningKeyIds $script:ExpectedV2JobKeyIds `
      -ValidateV4 {
        $entryV4 = Read-NfcConfig -Path $ConfigPath
        $entryV3BytesForProof = [Convert]::FromBase64String([string]$entryJournal.v3ConfigBytesBase64)
        try { $entryV3 = [Text.Encoding]::UTF8.GetString($entryV3BytesForProof) | ConvertFrom-Json }
        finally { [Array]::Clear($entryV3BytesForProof, 0, $entryV3BytesForProof.Length) }
        Assert-NfcV4SemanticTransition -Before $entryV3 -After $entryV4 -ExactTrustJson $trustJson
        Assert-NfcNoActiveGoToTagsRecovery -JobRoot $script:NfcGoToTagsJobRoot
        Start-NfcV4TransitionTaskIfStopped -Config $entryV4
        Wait-NfcV4TransitionReady -Config $entryV4 -ExpectV2 $true
      } `
      -StopBeforeRestore {
        Stop-NfcV4TransitionProcess -Config $processConfig
        Assert-NfcNoActiveGoToTagsRecovery -JobRoot $script:NfcGoToTagsJobRoot
      } `
      -ValidateRestoredV3 {
        $entryRestoredV3 = Read-NfcConfig -Path $ConfigPath
        Assert-NfcNoActiveGoToTagsRecovery -JobRoot $script:NfcGoToTagsJobRoot
        Start-NfcV4TransitionTaskIfStopped -Config $entryRestoredV3
        Wait-NfcV4TransitionReady -Config $entryRestoredV3 -ExpectV2 $false
      }
    if ($entryOutcome -ceq "completed_v4") {
      New-NfcV4TransitionResult -RecoveredAtEntry $true | ConvertTo-Json -Depth 3
      return
    }
    throw "An interrupted NFC V3-to-V4 transition restored byte-exact V3 and proved V3 readiness. Re-run the approved transition command to begin a new attempt."
  }

  $config = Read-NfcConfig -Path $ConfigPath
  if ($null -eq $config -or [string]$config.schemaVersion -cne "tenkings-ai-grader-nfc-helper-config-v3") {
    throw "The public-trust transition requires the exact protected V3 helper config."
  }
  if ((Get-NfcFileFingerprint -Path $ConfigPath) -cne $ExpectedConfigSha256) {
    throw "The protected NFC config does not match the operator-approved exact V3 preimage."
  }
  $semanticBefore = (Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json)
  Assert-NfcNoActiveGoToTagsRecovery -JobRoot $script:NfcGoToTagsJobRoot
  $task = Assert-NfcScheduledTaskDefinition -TaskName $TaskName
  if ($task.State -ne "Running" -and @(Get-NfcHelperProcess -Config $config).Count -eq 0) {
    throw "Start the idle V4 helper under its V3 config before the public-trust transition."
  }
  Wait-NfcV4TransitionReady -Config $config -ExpectV2 $false
  Resolve-NfcV3ToV4TransitionStagingArtifact `
    -ConfigPath $ConfigPath `
    -JournalPath $journalPath `
    -AllowedRoot $script:NfcConfigRoot `
    -ExpectedV3Sha256 $ExpectedConfigSha256 `
    -ValidateV3 {
      $stagingV3 = Read-NfcConfig -Path $ConfigPath
      Wait-NfcV4TransitionReady -Config $stagingV3 -ExpectV2 $false
    } | Out-Null

  $v4Config = $semanticBefore | ConvertTo-Json -Depth 10 | ConvertFrom-Json
  $v4Config.schemaVersion = "tenkings-ai-grader-nfc-helper-config-v4"
  $v4Config.programmingUrl = $script:NfcProgrammingUrlV4
  Set-NfcConfigProperty -Config $v4Config -Name "tenKingsV2ServerJobPublicKeysJson" -Value $trustJson
  Assert-NfcV4SemanticTransition -Before $semanticBefore -After $v4Config -ExactTrustJson $trustJson
  $v4Bytes = [Text.UTF8Encoding]::new($false).GetBytes(($v4Config | ConvertTo-Json -Depth 5))
  try {
    $journal = New-NfcV3ToV4TransitionJournal `
      -ConfigPath $ConfigPath `
      -JournalPath $journalPath `
      -AllowedRoot $script:NfcConfigRoot `
      -ExpectedV3Sha256 $ExpectedConfigSha256 `
      -V4ConfigBytes $v4Bytes `
      -ExpectedCurrentJobSigningKeyId $ExpectedCurrentJobSigningKeyId `
      -ExpectedTrustedJobSigningKeyIds $script:ExpectedV2JobKeyIds
    try {
      Stop-NfcV4TransitionProcess -Config $config
      Assert-NfcNoActiveGoToTagsRecovery -JobRoot $script:NfcGoToTagsJobRoot
      Set-NfcProtectedFileBytesAtomic `
        -Path $ConfigPath `
        -AllowedRoot $script:NfcConfigRoot `
        -Bytes $v4Bytes `
        -ExactAclSddl ([string]$journal.v3ConfigAclSddl) `
        -ExpectedSha256 ([string]$journal.v4ConfigSha256)
      $activatedV4 = Read-NfcConfig -Path $ConfigPath
      Assert-NfcV4SemanticTransition -Before $semanticBefore -After $activatedV4 -ExactTrustJson $trustJson
      Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
      Wait-NfcV4TransitionReady -Config $activatedV4 -ExpectV2 $true
      if ((Get-NfcFileFingerprint -Path $ConfigPath) -cne [string]$journal.v4ConfigSha256 -or
          (Get-NfcAclFingerprint -Path $ConfigPath) -cne [string]$journal.v3ConfigAclSha256) {
        throw "Completed V4 config or ACL identity changed during readiness proof."
      }
      [IO.File]::Delete($journalPath)
    } catch {
      $transitionFailure = $_
      $recoveryOutcome = Resolve-NfcV3ToV4TransitionJournal `
        -ConfigPath $ConfigPath `
        -JournalPath $journalPath `
        -AllowedRoot $script:NfcConfigRoot `
        -ExpectedV3Sha256 $ExpectedConfigSha256 `
        -ExpectedCurrentJobSigningKeyId $ExpectedCurrentJobSigningKeyId `
        -ExpectedTrustedJobSigningKeyIds $script:ExpectedV2JobKeyIds `
        -ValidateV4 {
          $retryV4 = Read-NfcConfig -Path $ConfigPath
          Assert-NfcV4SemanticTransition -Before $semanticBefore -After $retryV4 -ExactTrustJson $trustJson
          Assert-NfcNoActiveGoToTagsRecovery -JobRoot $script:NfcGoToTagsJobRoot
          Start-NfcV4TransitionTaskIfStopped -Config $retryV4
          Wait-NfcV4TransitionReady -Config $retryV4 -ExpectV2 $true
        } `
        -StopBeforeRestore {
          Stop-NfcV4TransitionProcess -Config $config
          Assert-NfcNoActiveGoToTagsRecovery -JobRoot $script:NfcGoToTagsJobRoot
        } `
        -ValidateRestoredV3 {
          $restoredV3 = Read-NfcConfig -Path $ConfigPath
          Assert-NfcNoActiveGoToTagsRecovery -JobRoot $script:NfcGoToTagsJobRoot
          Start-NfcV4TransitionTaskIfStopped -Config $restoredV3
          Wait-NfcV4TransitionReady -Config $restoredV3 -ExpectV2 $false
        }
      if ($recoveryOutcome -ceq "completed_v4") {
        New-NfcV4TransitionResult -RecoveredAtEntry $false | ConvertTo-Json -Depth 3
        return
      }
      throw "The NFC config transition failed; byte-exact V3, its ACL identity, and V3 readiness were restored. $($transitionFailure.Exception.Message)"
    }
  } finally {
    [Array]::Clear($v4Bytes, 0, $v4Bytes.Length)
  }
  New-NfcV4TransitionResult -RecoveredAtEntry $false | ConvertTo-Json -Depth 3
} finally {
  $trustJson = $null
}
