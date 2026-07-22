[CmdletBinding()]
param(
  [ValidateSet(
    'Worksheet', 'Status', 'Start', 'Resume', 'Advance', 'Retry',
    'DeriveAuthority', 'Seal', 'Analyze', 'Finalize', 'CompleteOffline', 'PrepareRigInput',
    'RecoverBlankTimestampFalseStop', 'RebindSealedAnalyzerAuthority'
  )]
  [string]$Action = 'Worksheet',
  [string]$BridgeUrl = 'http://127.0.0.1:47653',
  [string]$StationToken = $env:AI_GRADER_STATION_TOKEN,
  [string]$SessionId,
  [string]$OperatorId,
  [string]$TargetVersion,
  [string]$TargetSha256,
  [string]$ProfileId,
  [string]$CalibrationVersion,
  [string]$ArtifactId,
  [string]$AuthorityOutputPath,
  [string]$AnalysisOutputDir,
  [string]$FinalizedOutputDir,
  [string]$PythonExecutable = 'python',
  [string]$NodeExecutable = 'node',
  [switch]$ConfirmInitialCheckerboardPositioned,
  [switch]$ConfirmPhysicalAction,
  [switch]$ConfirmSeal
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ScriptRoot = Split-Path -Parent $PSCommandPath
$AnalyzerPath = Join-Path $ScriptRoot 'analyze-mathematical-calibration-v1.py'
$AuthorityDerivationPath = Join-Path $ScriptRoot 'prepare-mathematical-calibration-repeatability-v1.py'
$FinalizerPath = Join-Path $ScriptRoot 'finalize-mathematical-calibration-v1.mjs'

function Assert-SafeIdentifier {
  param([object]$Value, [string]$Label)
  $text = [string]$Value
  if ($text -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') {
    throw ($Label + ' must be a safe identifier.')
  }
  return $text
}

function Assert-ExactSha256 {
  param([object]$Value, [string]$Label)
  $text = ([string]$Value).ToLowerInvariant()
  if ($text -notmatch '^[a-f0-9]{64}$') {
    throw ($Label + ' must be one exact lowercase SHA-256.')
  }
  return $text
}

function Get-ExactFileSha256 {
  param([string]$Path, [string]$Label)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw ($Label + ' is unavailable: ' + $Path)
  }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Invoke-ExactProcess {
  param([string]$Executable, [string[]]$Arguments, [string]$Label)
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw ($Label + ' failed with exit code ' + $LASTEXITCODE + '.')
  }
}

function Assert-NewOutputDirectory {
  param([string]$Path, [string]$Label)
  if ([string]::IsNullOrWhiteSpace($Path)) { throw ($Label + ' is required.') }
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if (Test-Path -LiteralPath $resolved) {
    throw ($Label + ' must be a new path and will not overwrite an existing file or directory: ' + $resolved)
  }
  return $resolved
}

function New-CalibrationOperationId {
  param([string]$Prefix)
  return $Prefix + '-' + [guid]::NewGuid().ToString('N')
}

function New-CapturePlan {
  $plan = [System.Collections.Generic.List[object]]::new()
  foreach ($role in @('lens_geometry', 'normalization_registration')) {
    foreach ($sample in 1..10) {
      $plan.Add([pscustomobject]@{
        role = $role
        sampleIndex = $sample
        channelIndex = $null
        targetFace = 'checkerboard'
        physicalAction = if ($role -eq 'lens_geometry' -and $sample -eq 1) { 'none_after_initial_confirmation' } else { 'reposition_checkerboard_pose' }
        removeReseatCycleId = $null
      })
    }
  }
  foreach ($sample in 1..10) {
    $plan.Add([pscustomobject]@{
      role = 'repeated_placement'
      sampleIndex = $sample
      channelIndex = $null
      targetFace = 'checkerboard'
      physicalAction = 'remove_and_reseat_checkerboard'
      removeReseatCycleId = 'remove-reseat-' + $sample.ToString('00')
    })
  }
  foreach ($channel in 1..8) {
    foreach ($role in @('dark_control', 'flat_field', 'illumination_pattern')) {
      foreach ($sample in 1..3) {
        $plan.Add([pscustomobject]@{
          role = $role
          sampleIndex = $sample
          channelIndex = $channel
          targetFace = 'blank_reverse'
          physicalAction = if ($channel -eq 1 -and $role -eq 'dark_control' -and $sample -eq 1) { 'flip_to_blank_reverse' } else { 'none' }
          removeReseatCycleId = $null
        })
      }
    }
  }
  return $plan
}

function Assert-BridgeInput {
  if ([string]::IsNullOrWhiteSpace($StationToken)) {
    throw 'StationToken is required through the protected environment or explicit parameter.'
  }
  if ([string]::IsNullOrWhiteSpace($SessionId)) {
    throw 'SessionId is required.'
  }
}

function Invoke-CalibrationBridge {
  param(
    [ValidateSet('GET', 'POST')][string]$Method,
    [string]$Path,
    $Body
  )
  $headers = @{ 'x-ai-grader-station-token' = $StationToken }
  $uri = $BridgeUrl.TrimEnd('/') + $Path
  if ($Method -eq 'GET') {
    return Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
  }
  return Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 8 -Compress)
}

function Get-CalibrationStatus {
  $escaped = [uri]::EscapeDataString($SessionId)
  return (Invoke-CalibrationBridge -Method GET -Path ('/calibration/mathematical-v1/status?sessionId=' + $escaped)).result
}

function Write-PoseProgress {
  param($Status)
  foreach ($progress in @($Status.poseProgress)) {
    Write-Host (
      ([string]$progress.role) + ': accepted ' + ([string]$progress.acceptedCount) + '/10; current X ' +
      ([string]$progress.currentAggregate.x) + '/' + ([string]$progress.requiredAggregate.x) + ', Y ' +
      ([string]$progress.currentAggregate.y) + '/' + ([string]$progress.requiredAggregate.y) + ', rotation ' +
      ([string]$progress.currentAggregate.rotationDegrees) + '/' + ([string]$progress.requiredAggregate.rotationDegrees) + ' degrees.'
    )
  }
  $lastFailure = @($Status.failedAttempts) | Select-Object -Last 1
  if ($null -ne $lastFailure) {
    Write-Host ('Last failed operation ' + $lastFailure.operationId + ' left slot ' + $lastFailure.slotKey + ' pending: ' + $lastFailure.error)
    if ($null -ne $lastFailure.candidatePose) {
      Write-Host ('Rejected exact-still pose center/coverage/rotation: ' + $lastFailure.candidatePose.centerXFraction + ', ' + $lastFailure.candidatePose.centerYFraction + '; ' + $lastFailure.candidatePose.coverageFraction + '; ' + $lastFailure.candidatePose.rotationDegrees + ' degrees.')
    }
    if ($null -ne $lastFailure.prospectiveAggregate) {
      Write-Host ('Rejected prospective aggregate X/Y/rotation: ' + $lastFailure.prospectiveAggregate.x + ', ' + $lastFailure.prospectiveAggregate.y + ', ' + $lastFailure.prospectiveAggregate.rotationDegrees + ' degrees.')
    }
  }
}

function Get-DisplayedFrameCaptureAuthorization {
  param($Slot)
  if ($Slot.targetFace -ne 'checkerboard') { return $null }
  $authorization = (Invoke-CalibrationBridge -Method POST -Path '/calibration/mathematical-v1/capture-authorization' -Body @{ sessionId = $SessionId }).result
  if ($null -eq $authorization -or
      [string]$authorization.sessionId -ne $SessionId -or
      [string]$authorization.slotKey -ne (Get-SlotKey -Slot $Slot) -or
      [string]$authorization.authorizationId -notmatch '^math-cal-auth-[a-f0-9]{32}$' -or
      [string]$authorization.epoch -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$' -or
      [string]$authorization.frameId -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$' -or
      [string]$authorization.frameSha256 -notmatch '^[a-f0-9]{64}$' -or
      [string]$authorization.detectorAssessmentSha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Protected bridge returned an invalid or wrong-slot displayed-frame capture authorization.'
  }
  try {
    $null = [DateTimeOffset]::Parse([string]$authorization.capturedAt)
    $expiresAt = [DateTimeOffset]::Parse([string]$authorization.expiresAt)
  } catch {
    throw 'Protected bridge returned invalid displayed-frame authorization timestamps.'
  }
  if ($expiresAt -le [DateTimeOffset]::UtcNow) { throw 'Displayed-frame capture authorization expired before capture began.' }
  return $authorization
}

function Get-CalibrationState {
  param($Status)
  $statePath = Join-Path ([string]$Status.sessionDir) 'capture-session.json'
  if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    throw 'The immutable local calibration session ledger is unavailable.'
  }
  return Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
}

function Get-MeasurementKey {
  param($Measurement)
  $payload = $Measurement.payload
  if ($Measurement.measurementType -in @('print_scale', 'target_cut_dimension')) {
    return ([string]$Measurement.measurementType) + ':' + ([string]$payload.axis)
  }
  if ($Measurement.measurementType -eq 'direction_geometry') {
    return 'direction_geometry:' + ([string]$payload.channelIndex) + ':' + ([string]$payload.sampleIndex)
  }
  if ($Measurement.measurementType -eq 'measurement_repeatability') {
    return 'measurement_repeatability:' + ([string]$payload.measurementClass) + ':' + ([string]$payload.sampleIndex)
  }
  return 'unknown'
}

function Get-ExpectedMeasurementKeys {
  $keys = [System.Collections.Generic.List[string]]::new()
  foreach ($type in @('print_scale', 'target_cut_dimension')) {
    foreach ($axis in @('x', 'y')) { $keys.Add($type + ':' + $axis) }
  }
  foreach ($channel in 1..8) {
    foreach ($sample in 1..3) { $keys.Add('direction_geometry:' + $channel + ':' + $sample) }
  }
  foreach ($class in @('linear_mm', 'area_mm2', 'relief_index', 'roughness_index', 'color_delta_e')) {
    foreach ($sample in 1..10) { $keys.Add('measurement_repeatability:' + $class + ':' + $sample) }
  }
  return $keys
}

function Assert-ExactSlotSet {
  param([string[]]$Observed, [string[]]$Expected, [string]$Label)
  if (@($Observed | Select-Object -Unique).Count -ne $Observed.Count -or
      $Observed.Count -ne $Expected.Count -or
      @($Expected | Where-Object { $_ -notin $Observed }).Count -ne 0) {
    throw ($Label + ' must contain every required unique slot exactly once.')
  }
}

function Get-SlotKey {
  param($Slot)
  $channel = if ($null -eq $Slot.channelIndex) { 'none' } else { [string]$Slot.channelIndex }
  return ([string]$Slot.role) + ':' + $channel + ':' + ([string]$Slot.sampleIndex)
}

function Show-Worksheet {
  $plan = @(New-CapturePlan)
  Write-Host 'Ten Kings Mathematical Calibration V1 deterministic worksheet'
  Write-Host 'No production card, report, database, NFC, label, or inventory operation is included.'
  Write-Host ''
  Write-Host 'Physical pause 1: place the verified target checkerboard face up.'
  Write-Host 'Physical pauses 2-20: independently reposition checkerboard for lens and normalization poses.'
  Write-Host 'Physical pauses 21-30: remove and reseat checkerboard once per repeatability cycle.'
  Write-Host 'Physical pause 31: flip the same target to its blank reverse.'
  Write-Host 'After blank-reverse confirmation, the bounded 72 dark/flat/pattern captures need no target movement.'
  Write-Host ''
  $plan | Select-Object role, channelIndex, sampleIndex, targetFace, physicalAction |
    Format-Table -AutoSize
  Write-Host 'No manual physical-authority value entry is requested.'
  Write-Host 'DeriveAuthority records four protected nominal target-geometry entries and deterministically derives 24 direction/U95 plus 50 repeatability entries from exact immutable evidence.'
  Write-Host 'Target entries are protected geometry authority, never physical measurements. Direction entries bind the matching three-per-channel illumination captures and the centralized uncertainty coverage factor.'
  Write-Host 'An ordinary rejected exact still preserves all accepted slots and hashes. Reposition the same pending pose and use Retry, which always creates a new operation ID.'
  Write-Host 'Resume rebinds the same immutable session after runner, browser, or protected helper-page restart; hard-stop failures are never retryable.'
  Write-Host 'Seal is fail-closed at exactly 102 captures and 78 measurements. Analyze and Finalize require new output paths and never mutate Production.'
  Write-Host 'CompleteOffline performs evidence-authority derivation, seal, analyzer, and finalizer in that exact order.'
  Write-Host 'PrepareRigInput then probes the protected rig and creates the canonical hash-bound V1.2 materializer input without operator authority fields.'
}

function Get-NextCaptureSlot {
  param($State)
  $observed = @{}
  foreach ($capture in @($State.captures)) {
    $observed[(Get-SlotKey -Slot $capture)] = $true
  }
  foreach ($slot in @(New-CapturePlan)) {
    if (-not $observed.ContainsKey((Get-SlotKey -Slot $slot))) {
      return $slot
    }
  }
  return $null
}

function Invoke-CaptureSlot {
  param($Slot)
  $body = @{
    sessionId = $SessionId
    operationId = New-CalibrationOperationId -Prefix 'cal-capture'
    role = $Slot.role
    sampleIndex = $Slot.sampleIndex
    targetFace = $Slot.targetFace
  }
  if ($null -ne $Slot.channelIndex) {
    $body.channelIndex = $Slot.channelIndex
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$Slot.removeReseatCycleId)) {
    $body.removeReseatCycleId = $Slot.removeReseatCycleId
  }
  $captureAuthorization = Get-DisplayedFrameCaptureAuthorization -Slot $Slot
  if ($null -ne $captureAuthorization) { $body.captureAuthorizationId = [string]$captureAuthorization.authorizationId }
  Write-Host ('Capturing exact slot ' + (Get-SlotKey -Slot $Slot) + ' with new operation ID ' + $body.operationId)
  return (Invoke-CalibrationBridge -Method POST -Path '/calibration/mathematical-v1/capture' -Body $body).result
}

function Invoke-CaptureSlotWithReport {
  param($Slot)
  try {
    return Invoke-CaptureSlot -Slot $Slot
  } catch {
    $attemptError = $_.Exception.Message
    $after = Get-CalibrationStatus
    $after
    Write-PoseProgress -Status $after
    Write-Host ('Accepted immutable captures remain ' + $after.captureCount + '; accepted history/hashes were not replaced.')
    if ($null -ne $after.hardStop) {
      throw ('Calibration session hard-stopped and must not be retried: ' + $after.hardStop.reason)
    }
    if ($after.retryAllowed) {
      throw ('Ordinary attempt rejected; the same exact slot remains pending. Reposition it, then run -Action Retry with -ConfirmPhysicalAction. Original error: ' + $attemptError)
    }
    throw $attemptError
  }
}

function Invoke-EvidenceAuthorityDerivation {
  param($Status, $State)
  if ($Status.sealed) { throw 'Evidence-authority derivation must run before seal.' }
  if ([int]$Status.captureCount -ne 102) {
    throw 'Evidence-authority derivation requires all 102 immutable captures.'
  }
  $outputPath = $AuthorityOutputPath
  if ([string]::IsNullOrWhiteSpace($outputPath)) {
    $outputPath = Join-Path (Split-Path ([string]$Status.sessionDir) -Parent) ($SessionId + '-authority-' + ([string]$Status.sessionStateSha256).Substring(0, 12) + '-preseal-v1.json')
  }
  $outputPath = [System.IO.Path]::GetFullPath($outputPath)
  if (Test-Path -LiteralPath $outputPath) {
    throw ('Evidence-authority output is immutable and already exists: ' + $outputPath)
  }
  $analyzerSha256 = Get-ExactFileSha256 -Path $AnalyzerPath -Label 'Pinned analyzer source'
  $authorityDerivationSha256 = Get-ExactFileSha256 -Path $AuthorityDerivationPath -Label 'Pinned authority-derivation source'
  Write-Host ('Pinned analyzer SHA-256: ' + $analyzerSha256)
  Write-Host ('Pinned authority-derivation producer SHA-256: ' + $authorityDerivationSha256)
  $tokenVariable = 'TK_MATHEMATICAL_CALIBRATION_STATION_TOKEN'
  $previousToken = [Environment]::GetEnvironmentVariable($tokenVariable, 'Process')
  [Environment]::SetEnvironmentVariable($tokenVariable, $StationToken, 'Process')
  try {
    Invoke-ExactProcess -Executable $PythonExecutable -Label 'Evidence-authority derivation/submission' -Arguments @(
      $AuthorityDerivationPath,
      '--session-dir', ([string]$Status.sessionDir),
      '--output', $outputPath,
      '--bridge-url', $BridgeUrl,
      '--station-token-env', $tokenVariable
    )
  } finally {
    [Environment]::SetEnvironmentVariable($tokenVariable, $previousToken, 'Process')
  }
  $outputSha256 = Get-ExactFileSha256 -Path $outputPath -Label 'Evidence-authority pre-seal artifact'
  Write-Host ('Evidence-authority pre-seal artifact: ' + $outputPath)
  Write-Host ('Evidence-authority pre-seal SHA-256: ' + $outputSha256)
  return Get-CalibrationStatus
}

function Invoke-CalibrationSeal {
  param($Status, $State)
  if (-not $ConfirmSeal) {
    throw 'Seal requires -ConfirmSeal after reviewing the complete 102-capture / 78-measurement status.'
  }
  $existingKeys = @($State.measurements | ForEach-Object { Get-MeasurementKey -Measurement $_ })
  if ($existingKeys.Count -ne 78) {
    $Status = Invoke-EvidenceAuthorityDerivation -Status $Status -State $State
    $State = Get-CalibrationState -Status $Status
  }
  foreach ($value in @(
    @{ value = $ProfileId; label = 'ProfileId' },
    @{ value = $CalibrationVersion; label = 'CalibrationVersion' },
    @{ value = $ArtifactId; label = 'ArtifactId' }
  )) {
    $null = Assert-SafeIdentifier -Value $value.value -Label $value.label
  }
  $observedKeys = @($State.measurements | ForEach-Object { Get-MeasurementKey -Measurement $_ })
  Assert-ExactSlotSet -Observed $observedKeys -Expected @(Get-ExpectedMeasurementKeys) -Label 'Seal measurement ledger'
  if ([int]$Status.captureCount -ne 102) { throw 'Seal requires exactly 102 capture slots.' }
  $sealed = (Invoke-CalibrationBridge -Method POST -Path '/calibration/mathematical-v1/seal' -Body @{
    sessionId = $SessionId
    operationId = New-CalibrationOperationId -Prefix 'cal-seal'
    profileId = $ProfileId
    calibrationVersion = $CalibrationVersion
    artifactId = $ArtifactId
  }).result
  Write-Host ('Sealed capture manifest: ' + $sealed.captureManifest.path)
  Write-Host ('Sealed capture manifest SHA-256: ' + $sealed.captureManifest.sha256)
  Write-Host ('Sealed source package SHA-256: ' + $sealed.sourceCapturePackage.sha256)
  return $sealed
}

function Invoke-CalibrationAnalysis {
  param($Status)
  if (-not $Status.sealed -or [string]::IsNullOrWhiteSpace([string]$Status.captureManifestPath)) {
    throw 'Analyze requires one sealed capture manifest from this session.'
  }
  $outputDir = $AnalysisOutputDir
  if ([string]::IsNullOrWhiteSpace($outputDir)) {
    $outputDir = Join-Path (Split-Path ([string]$Status.sessionDir) -Parent) ($SessionId + '-analysis-v1')
  }
  $outputDir = Assert-NewOutputDirectory -Path $outputDir -Label 'AnalysisOutputDir'
  $analyzerSha256 = Get-ExactFileSha256 -Path $AnalyzerPath -Label 'Pinned analyzer source'
  $requirementsSha256 = Get-ExactFileSha256 -Path (Join-Path $ScriptRoot 'requirements-mathematical-calibration-v1.txt') -Label 'Pinned analyzer requirements'
  Write-Host ('Executing pinned analyzer source SHA-256 ' + $analyzerSha256 + ' with requirements SHA-256 ' + $requirementsSha256 + '.')
  Invoke-ExactProcess -Executable $PythonExecutable -Label 'Mathematical calibration analyzer' -Arguments @(
    $AnalyzerPath,
    '--manifest', ([string]$Status.captureManifestPath),
    '--output-dir', $outputDir
  )
  $analysisPath = Join-Path $outputDir 'mathematical-calibration-analysis-v1.json'
  $analysisFileSha256 = Get-ExactFileSha256 -Path $analysisPath -Label 'Calibration analysis artifact'
  $analysis = Get-Content -LiteralPath $analysisPath -Raw | ConvertFrom-Json
  $analysisAuthoritySha256 = Assert-ExactSha256 -Value $analysis.analysisSha256 -Label 'analysis.analysisSha256'
  Write-Host ('Analysis path: ' + $analysisPath)
  Write-Host ('Analysis file SHA-256: ' + $analysisFileSha256)
  Write-Host ('Analysis certified-payload SHA-256: ' + $analysisAuthoritySha256)
  return [pscustomobject]@{ outputDir = $outputDir; analysisPath = $analysisPath; analysisSha256 = $analysisAuthoritySha256 }
}

function Invoke-CalibrationFinalization {
  param([string]$AnalysisPath)
  if ([string]::IsNullOrWhiteSpace($AnalysisPath)) {
    if ([string]::IsNullOrWhiteSpace($AnalysisOutputDir)) { throw 'Finalize requires AnalysisOutputDir or an analysis path from CompleteOffline.' }
    $AnalysisPath = Join-Path ([System.IO.Path]::GetFullPath($AnalysisOutputDir)) 'mathematical-calibration-analysis-v1.json'
  }
  $analysisFileSha256 = Get-ExactFileSha256 -Path $AnalysisPath -Label 'Calibration analysis artifact'
  $outputDir = $FinalizedOutputDir
  if ([string]::IsNullOrWhiteSpace($outputDir)) {
    $statusForPath = Get-CalibrationStatus
    $outputDir = Join-Path (Split-Path ([string]$statusForPath.sessionDir) -Parent) ($SessionId + '-finalized-v1')
  }
  $outputDir = Assert-NewOutputDirectory -Path $outputDir -Label 'FinalizedOutputDir'
  $finalizerSha256 = Get-ExactFileSha256 -Path $FinalizerPath -Label 'Pinned finalizer source'
  Write-Host ('Executing pinned finalizer source SHA-256 ' + $finalizerSha256 + ' against analysis file SHA-256 ' + $analysisFileSha256 + '.')
  Invoke-ExactProcess -Executable $NodeExecutable -Label 'Mathematical calibration finalizer' -Arguments @(
    $FinalizerPath,
    '--analysis', $AnalysisPath,
    '--output-dir', $outputDir
  )
  $bundlePath = Join-Path $outputDir 'mathematical-calibration-bundle-v1.json'
  $bundleSha256 = Get-ExactFileSha256 -Path $bundlePath -Label 'Finalized calibration bundle'
  Write-Host ('Finalized bundle path: ' + $bundlePath)
  Write-Host ('Finalized bundle SHA-256: ' + $bundleSha256)
  return [pscustomobject]@{ outputDir = $outputDir; bundlePath = $bundlePath; bundleSha256 = $bundleSha256 }
}

if ($Action -eq 'Worksheet') {
  Show-Worksheet
  exit 0
}

if ($Action -eq 'RebindSealedAnalyzerAuthority') {
  $result = (Invoke-CalibrationBridge -Method POST -Path '/calibration/mathematical-v1/rebind-sealed-analyzer-authority-20260722' -Body @{}).result
  if ($null -eq $result -or
      [string]$result.status.sessionId -ne 'math-cal-v1-20260722-4cfa410c-01' -or
      [string]$result.receipt.rebindId -ne 'sealed-analyzer-authority-rebind-20260722-v1' -or
      [string]$result.receipt.correctedAnalyzerSha256 -ne '4387cfacd2193e326f06e5cb461d478d293cb1c9e62449ec1c8c28b1c17eb201' -or
      [int]$result.receipt.correctedAuthority.count -ne 74 -or
      -not [bool]$result.status.sealed) {
    throw 'The protected bridge did not return the exact incident-bound analyzer-authority rebind receipt.'
  }
  $result
  Write-Host ('Analyzer-authority rebind receipt: ' + $result.receipt.receiptPath)
  Write-Host ('Corrected analyzer SHA-256: ' + $result.receipt.correctedAnalyzerSha256)
  exit 0
}

Assert-BridgeInput

if ($Action -eq 'RecoverBlankTimestampFalseStop') {
  $result = (Invoke-CalibrationBridge -Method POST -Path '/calibration/mathematical-v1/recover-blank-reverse-timestamp-false-stop' -Body @{}).result
  if ($null -eq $result -or
      [string]$result.status.sessionId -ne $SessionId -or
      [string]$result.recovery.recoveryId -ne 'blank-reverse-geometry-timestamp-false-stop-20260722-v1' -or
      [string]$result.recovery.pendingSlotKey -ne 'dark_control:1:3' -or
      [string]$result.recovery.receiptSha256 -notmatch '^[a-f0-9]{64}$' -or
      $null -ne $result.status.hardStop) {
    throw 'The protected bridge did not return the exact audited incident recovery and healthy pending slot.'
  }
  $result
  Write-Host ('Audited one-time false-stop recovery receipt: ' + $result.recovery.receiptPath)
  Write-Host ('Recovery receipt SHA-256: ' + $result.recovery.receiptSha256)
  Write-Host 'Only dark_control:1:3 remains pending; Retry must use a new operation ID.'
  exit 0
}

if ($Action -in @('Start', 'Resume')) {
  if ($Action -eq 'Start' -and -not $ConfirmInitialCheckerboardPositioned) {
    throw 'Start is blocked until Mark confirms the verified non-production target is positioned checkerboard face up.'
  }
  if ([string]::IsNullOrWhiteSpace($OperatorId) -or
      [string]::IsNullOrWhiteSpace($TargetVersion) -or
      [string]::IsNullOrWhiteSpace($TargetSha256)) {
    throw 'Start requires OperatorId, TargetVersion, and exact TargetSha256.'
  }
  $result = (Invoke-CalibrationBridge -Method POST -Path '/calibration/mathematical-v1/start' -Body @{
    sessionId = $SessionId
    operatorId = $OperatorId
    targetVersion = $TargetVersion
    targetSha256 = $TargetSha256
    resume = ($Action -eq 'Resume')
  }).result
  $result
  if ($Action -eq 'Resume') {
    Write-Host 'Exact immutable session resumed and rebound. Reconnect the protected V1.0.1 preview page before Advance or Retry.'
  } else {
    Write-Host 'Session created. Open the protected V1.0.1 preview page, then Advance may capture the first checkerboard pose.'
  }
  exit 0
}

$status = Get-CalibrationStatus
$state = Get-CalibrationState -Status $status
$next = Get-NextCaptureSlot -State $state

if ($Action -eq 'PrepareRigInput') {
  if (-not $status.sealed -or $null -ne $status.hardStop -or [int]$status.captureCount -ne 102 -or [int]$status.measurementCount -ne 78) {
    throw 'PrepareRigInput requires one healthy sealed V1.0.1 session with exactly 102 captures and 78 evidence-derived authority records.'
  }
  $result = (Invoke-CalibrationBridge -Method POST -Path '/calibration/mathematical-v1/materialization-input' -Body @{
    sessionId = $SessionId
  }).result
  $result
  Write-Host ('Canonical V1.2 rig materialization input SHA-256: ' + $result.inputManifestSha256)
  Write-Host ('Canonical V1.2 rig materialization input path: ' + $result.inputManifestPath)
  exit 0
}

if ($Action -eq 'Status') {
  $status
  Write-PoseProgress -Status $status
  $statePath = Join-Path ([string]$status.sessionDir) 'capture-session.json'
  Write-Host ('Capture-session ledger SHA-256: ' + (Get-ExactFileSha256 -Path $statePath -Label 'Capture-session ledger'))
  Write-Host ('Protected target SHA-256: ' + $state.subject.targetSha256)
  $observedMeasurementKeys = @($state.measurements | ForEach-Object { Get-MeasurementKey -Measurement $_ })
  $missingMeasurementKeys = @((Get-ExpectedMeasurementKeys) | Where-Object { $_ -notin $observedMeasurementKeys })
  Write-Host ('Immutable evidence-authority entries: ' + $observedMeasurementKeys.Count + '/78; missing ' + $missingMeasurementKeys.Count + '.')
  if ($missingMeasurementKeys.Count -gt 0) {
    $missingMeasurementKeys | Select-Object -First 20 | ForEach-Object { Write-Host ('  missing ' + $_) }
    if ($missingMeasurementKeys.Count -gt 20) { Write-Host '  (remaining missing slots omitted from display)' }
  }
  if ($null -eq $next) {
    Write-Host 'All 102 unique capture slots are complete.'
  } else {
    Write-Host ('Next exact slot: ' + (Get-SlotKey -Slot $next))
    Write-Host ('Required physical action: ' + $next.physicalAction)
  }
  if ($null -ne $status.hardStop) { Write-Host ('HARD STOP: ' + $status.hardStop.reason) }
  elseif ($status.retryAllowed) { Write-Host 'Retry is allowed for the exact pending slot and must use a new operation ID.' }
  exit 0
}

if ($Action -eq 'DeriveAuthority') {
  Invoke-EvidenceAuthorityDerivation -Status $status -State $state
  exit 0
}

if ($Action -eq 'Seal') {
  Invoke-CalibrationSeal -Status $status -State $state
  exit 0
}

if ($Action -eq 'Analyze') {
  Invoke-CalibrationAnalysis -Status $status
  exit 0
}

if ($Action -eq 'Finalize') {
  Invoke-CalibrationFinalization -AnalysisPath $null
  exit 0
}

if ($Action -eq 'CompleteOffline') {
  $authorityKeys = @($state.measurements | ForEach-Object {
    Get-MeasurementKey -Measurement $_
  })
  if ($authorityKeys.Count -ne 78) {
    $status = Invoke-EvidenceAuthorityDerivation -Status $status -State $state
    $state = Get-CalibrationState -Status $status
  } else {
    Assert-ExactSlotSet -Observed $authorityKeys -Expected @(Get-ExpectedMeasurementKeys) -Label 'Existing evidence-authority ledger'
    Write-Host 'All 78 evidence-derived authority records already exist; derivation was not repeated.'
  }
  if (-not $status.sealed) {
    $sealed = Invoke-CalibrationSeal -Status $status -State $state
    $status = $sealed.status
  }
  $analysisResult = Invoke-CalibrationAnalysis -Status $status
  $finalizedResult = Invoke-CalibrationFinalization -AnalysisPath $analysisResult.analysisPath
  [pscustomobject]@{
    status = 'offline_calibration_complete'
    sessionId = $SessionId
    captureManifestPath = $status.captureManifestPath
    analysisPath = $analysisResult.analysisPath
    analysisSha256 = $analysisResult.analysisSha256
    bundlePath = $finalizedResult.bundlePath
    bundleSha256 = $finalizedResult.bundleSha256
    productionMutation = $false
    v0FallbackUsed = $false
  }
  exit 0
}

if ($null -eq $next) {
  Write-Host 'All 102 unique capture slots are complete; no hardware action was requested.'
  exit 0
}

if ($null -ne $status.hardStop) {
  throw ('Calibration session is hard-stopped and no capture/retry is allowed: ' + $status.hardStop.reason)
}
if ($Action -eq 'Advance' -and $status.retryAllowed) {
  throw ('The exact pending slot has a recorded ordinary failure. Use -Action Retry with a new operation ID; Advance will not silently turn a failed attempt into a new step.')
}
if ($Action -eq 'Retry') {
  if (-not $status.retryAllowed) { throw 'Retry is allowed only when the exact pending slot has a recorded ordinary failed attempt.' }
  $lastFailure = @($status.failedAttempts) | Select-Object -Last 1
  if ($null -eq $lastFailure -or $lastFailure.slotKey -ne (Get-SlotKey -Slot $next)) {
    throw 'Retry status does not bind the most recent failed attempt to the exact current missing slot.'
  }
  if (-not $ConfirmPhysicalAction) {
    throw ('Retry paused for physical correction of the same missing slot ' + $lastFailure.slotKey + '. Reposition it, then rerun with -ConfirmPhysicalAction.')
  }
  $status = Invoke-CaptureSlotWithReport -Slot $next
  $status
  Write-PoseProgress -Status $status
  Write-Host 'Retry accepted the exact previously missing slot under a new operation ID; all earlier accepted hashes remain unchanged.'
  exit 0
}

$requiresPhysicalAction = $next.physicalAction -notin @('none', 'none_after_initial_confirmation')
if ($requiresPhysicalAction -and -not $ConfirmPhysicalAction) {
  throw ('Advance paused for physical action: ' + $next.physicalAction + '. Complete it, then rerun with -ConfirmPhysicalAction.')
}

$status = Invoke-CaptureSlotWithReport -Slot $next
Write-PoseProgress -Status $status
if ($next.targetFace -ne 'blank_reverse') {
  $status
  Write-Host 'Capture complete. The driver stopped because the next checkerboard slot requires a physical pose or reseat.'
  exit 0
}

# Once Mark has explicitly confirmed the single target flip, all remaining
# blank-reverse slots are routine bounded captures under the bridge lock and
# safe-off watchdog. Continue without inventing extra operator pauses.
while ($true) {
  $state = Get-CalibrationState -Status $status
  $next = Get-NextCaptureSlot -State $state
  if ($null -eq $next) {
    $status
    Write-Host 'All 102 unique capture slots are complete.'
    break
  }
  if ($next.targetFace -ne 'blank_reverse' -or $next.physicalAction -notin @('none')) {
    throw 'Deterministic plan invariant failed while advancing blank-reverse captures.'
  }
  $status = Invoke-CaptureSlotWithReport -Slot $next
}
