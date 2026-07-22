[CmdletBinding()]
param(
  [ValidateSet(
    'Worksheet', 'Status', 'Start', 'Resume', 'Advance', 'Retry', 'CreateMetrologyTemplate', 'SubmitMetrology',
    'DeriveRepeatability', 'Seal', 'Analyze', 'Finalize', 'CompleteOffline'
  )]
  [string]$Action = 'Worksheet',
  [string]$BridgeUrl = 'http://127.0.0.1:47653',
  [string]$StationToken = $env:AI_GRADER_STATION_TOKEN,
  [string]$SessionId,
  [string]$OperatorId,
  [string]$TargetVersion,
  [string]$TargetSha256,
  [string]$MetrologyInputPath,
  [string]$MetrologyInputSha256,
  [string]$ProfileId,
  [string]$CalibrationVersion,
  [string]$ArtifactId,
  [string]$RepeatabilityOutputPath,
  [string]$AnalysisOutputDir,
  [string]$FinalizedOutputDir,
  [string]$PythonExecutable = 'python',
  [string]$NodeExecutable = 'node',
  [switch]$ConfirmInitialCheckerboardPositioned,
  [switch]$ConfirmPhysicalAction,
  [switch]$ConfirmMetrologySubmission,
  [switch]$ConfirmSeal
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ScriptRoot = Split-Path -Parent $PSCommandPath
$RepositoryRoot = (Resolve-Path (Join-Path $ScriptRoot '..\..')).Path
$AnalyzerPath = Join-Path $ScriptRoot 'analyze-mathematical-calibration-v1.py'
$RepeatabilityPath = Join-Path $ScriptRoot 'prepare-mathematical-calibration-repeatability-v1.py'
$FinalizerPath = Join-Path $ScriptRoot 'finalize-mathematical-calibration-v1.mjs'
$TargetManifestPath = Join-Path $RepositoryRoot 'output\pdf\ten-kings-mathematical-calibration-target-v1.json'

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

function Get-FiniteNumber {
  param([object]$Value, [string]$Label, [double]$Minimum = [double]::NegativeInfinity)
  if ($null -eq $Value -or ([string]$Value).Trim().Length -eq 0) {
    throw ($Label + ' is required and must be numeric.')
  }
  try { $number = [double]$Value } catch { throw ($Label + ' must be numeric.') }
  if ([double]::IsNaN($number) -or [double]::IsInfinity($number) -or $number -lt $Minimum) {
    throw ($Label + ' must be finite and at least ' + $Minimum + '.')
  }
  return $number
}

function Get-ExactInteger {
  param([object]$Value, [string]$Label, [int]$Minimum, [int]$Maximum)
  $number = Get-FiniteNumber -Value $Value -Label $Label -Minimum $Minimum
  if ($number -ne [Math]::Truncate($number) -or $number -gt $Maximum) {
    throw ($Label + ' must be an integer from ' + $Minimum + ' through ' + $Maximum + '.')
  }
  return [int]$number
}

function Get-Instrument {
  param([object]$Value, [string]$Label)
  if ($null -eq $Value) { throw ($Label + ' instrument is required.') }
  $kind = [string]$Value.kind
  if ($kind -notin @('traceable_ruler', 'caliper', 'fixed_rig_geometry')) {
    throw ($Label + ' instrument kind is not allowlisted.')
  }
  $instrumentId = Assert-SafeIdentifier -Value $Value.instrumentId -Label ($Label + '.instrumentId')
  $calibrationVersionValue = Assert-SafeIdentifier -Value $Value.calibrationVersion -Label ($Label + '.calibrationVersion')
  $calibrationSha256Value = Assert-ExactSha256 -Value $Value.calibrationSha256 -Label ($Label + '.calibrationSha256')
  return @{
    instrumentId = $instrumentId
    kind = $kind
    calibrationVersion = $calibrationVersionValue
    calibrationSha256 = $calibrationSha256Value
  }
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

function Assert-NewOutputFile {
  param([string]$Path, [string]$Label)
  if ([string]::IsNullOrWhiteSpace($Path)) { throw ($Label + ' is required.') }
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if (Test-Path -LiteralPath $resolved) {
    throw ($Label + ' must be a new path and will not overwrite an existing file or directory: ' + $resolved)
  }
  $parent = Split-Path -Parent $resolved
  if ([string]::IsNullOrWhiteSpace($parent) -or -not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw ($Label + ' parent directory must already exist: ' + $parent)
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

function Get-LivePreviewBinding {
  param($Slot)
  if ($Slot.targetFace -ne 'checkerboard') { return $null }
  $preview = (Invoke-CalibrationBridge -Method GET -Path '/preview/status').result
  $math = $preview.mathematicalCalibrationPreview
  if ($preview.status -ne 'live' -or $preview.cameraOwnership -ne 'preview_stream' -or
      $null -eq $math -or $math.contractVersion -ne '1.0.1' -or $math.sessionId -ne $SessionId -or
      -not $math.active -or [string]::IsNullOrWhiteSpace([string]$preview.sideEpoch) -or
      [string]::IsNullOrWhiteSpace([string]$preview.latestFrameId) -or
      $preview.latestFrameId -ne $math.lastFrameId -or $preview.lastFrameAt -ne $math.lastFrameAt) {
    throw 'Checkerboard capture requires one live V1.0.1 preview bound to this exact session and latest frame. Open or reconnect the protected V1.0.1 page.'
  }
  try { $frameAt = [DateTimeOffset]::Parse([string]$preview.lastFrameAt) } catch { throw 'The live preview frame timestamp is invalid.' }
  $ageMs = ([DateTimeOffset]::UtcNow - $frameAt.ToUniversalTime()).TotalMilliseconds
  if ($ageMs -lt -1000 -or $ageMs -gt 2000) { throw 'The live preview frame is stale; reconnect and wait for a fresh epoch/frame before capture.' }
  return @{
    sessionId = $SessionId
    epoch = [string]$preview.sideEpoch
    frameId = [string]$preview.latestFrameId
    capturedAt = [string]$preview.lastFrameAt
  }
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

function New-MetrologyInputTemplate {
  param($Status, $State)
  if ($Status.sealed) { throw 'A sealed calibration session cannot create a new metrology template.' }
  if ([int]$Status.captureCount -ne 102) {
    throw 'CreateMetrologyTemplate is blocked until all 102 immutable capture slots are complete.'
  }
  $outputPath = Assert-NewOutputFile -Path $MetrologyInputPath -Label 'MetrologyInputPath'
  $targetManifestSha256 = Get-ExactFileSha256 -Path $TargetManifestPath -Label 'Protected target manifest'
  $targetManifest = Get-Content -LiteralPath $TargetManifestPath -Raw | ConvertFrom-Json
  if ($targetManifest.schemaVersion -ne 'ten-kings-calibration-target-manifest-v1') {
    throw 'Protected target manifest is not the exact calibration-target V1 schema.'
  }
  $protectedTargetSha256 = Assert-ExactSha256 -Value $State.subject.targetSha256 -Label 'capture-session targetSha256'
  $manifestTargetSha256 = Assert-ExactSha256 -Value $targetManifest.pdfSha256 -Label 'target manifest pdfSha256'
  if ($protectedTargetSha256 -ne $manifestTargetSha256) {
    throw 'The session target authority does not match the repository-protected printable target PDF.'
  }
  $statePath = Join-Path ([string]$Status.sessionDir) 'capture-session.json'
  $sourceCaptureSessionSha256 = Get-ExactFileSha256 -Path $statePath -Label 'Capture-session ledger'
  $instrumentTemplate = [ordered]@{
    instrumentId = $null
    kind = $null
    calibrationVersion = $null
    calibrationSha256 = $null
  }
  $directions = [System.Collections.Generic.List[object]]::new()
  foreach ($channel in 1..8) {
    foreach ($sample in 1..3) {
      $directions.Add([ordered]@{
        channelIndex = $channel
        sampleIndex = $sample
        sourcePointMm = [ordered]@{ x = $null; y = $null }
        cardCenterPointMm = [ordered]@{ x = $null; y = $null }
        pointU95Mm = $null
        measurementMethod = $null
      })
    }
  }
  $template = [ordered]@{
    schemaVersion = 'ten-kings-mathematical-calibration-metrology-input-v1'
    sessionId = $SessionId
    targetSha256 = $protectedTargetSha256
    sourceCaptureSessionSha256 = $sourceCaptureSessionSha256
    targetManifestSha256 = $targetManifestSha256
    instructions = [ordered]@{
      incompleteTemplate = $true
      submission = 'Replace every null with the independently observed value or immutable instrument identity, then compute the exact file SHA-256 and use SubmitMetrology with -ConfirmMetrologySubmission.'
      printAcceptance = [string]$targetManifest.requiredPrintScaleVerification.acceptanceFormula
      cutAcceptance = 'abs(measuredDimensionMm - nominalDimensionMm) + measurementU95Mm <= 0.20'
      permittedInstrumentKinds = @('traceable_ruler', 'caliper', 'fixed_rig_geometry')
    }
    instruments = [ordered]@{
      printScale = $instrumentTemplate.Clone()
      targetCutDimension = $instrumentTemplate.Clone()
      directionGeometry = $instrumentTemplate.Clone()
    }
    printScaleMeasurements = @(
      [ordered]@{ axis = 'x'; nominalSpanMm = [double]$targetManifest.requiredPrintScaleVerification.x.nominalSpanMm; measuredSpanMm = $null; measurementU95Mm = $null; measurementMethod = $null },
      [ordered]@{ axis = 'y'; nominalSpanMm = [double]$targetManifest.requiredPrintScaleVerification.y.nominalSpanMm; measuredSpanMm = $null; measurementU95Mm = $null; measurementMethod = $null }
    )
    targetCutDimensionMeasurements = @(
      [ordered]@{ axis = 'x'; nominalDimensionMm = [double]$targetManifest.requiredCutDimensionVerification.x.nominalDimensionMm; measuredDimensionMm = $null; measurementU95Mm = $null; measurementMethod = $null },
      [ordered]@{ axis = 'y'; nominalDimensionMm = [double]$targetManifest.requiredCutDimensionVerification.y.nominalDimensionMm; measuredDimensionMm = $null; measurementU95Mm = $null; measurementMethod = $null }
    )
    directionGeometryMeasurements = @($directions)
  }
  $json = $template | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText(
    $outputPath,
    $json + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
  )
  Write-Host ('Created incomplete write-once metrology template: ' + $outputPath)
  Write-Host ('Template baseline SHA-256 (will change when completed): ' + (Get-ExactFileSha256 -Path $outputPath -Label 'Metrology template'))
  Write-Host 'No metrology was submitted. Complete every null, rehash the exact file, independently review it, then use SubmitMetrology.'
}

function Submit-MetrologyArtifact {
  param($Status, $State)
  if (-not $ConfirmMetrologySubmission) {
    throw 'SubmitMetrology requires -ConfirmMetrologySubmission after the physical values and instrument identities have been checked.'
  }
  if ($Status.sealed) { throw 'A sealed calibration session cannot accept metrology.' }
  if ([int]$Status.captureCount -ne 102) {
    throw 'Metrology submission is blocked until all 102 immutable capture slots are complete.'
  }
  if ([string]::IsNullOrWhiteSpace($MetrologyInputPath) -or
      [string]::IsNullOrWhiteSpace($MetrologyInputSha256)) {
    throw 'SubmitMetrology requires MetrologyInputPath and its exact MetrologyInputSha256.'
  }
  $metrologyPath = [System.IO.Path]::GetFullPath($MetrologyInputPath)
  $observedMetrologySha256 = Get-ExactFileSha256 -Path $metrologyPath -Label 'Metrology input'
  $expectedMetrologySha256 = Assert-ExactSha256 -Value $MetrologyInputSha256 -Label 'MetrologyInputSha256'
  if ($observedMetrologySha256 -ne $expectedMetrologySha256) {
    throw 'Metrology input SHA-256 does not match the explicitly supplied authority.'
  }
  $metrology = Get-Content -LiteralPath $metrologyPath -Raw | ConvertFrom-Json
  if ($metrology.schemaVersion -ne 'ten-kings-mathematical-calibration-metrology-input-v1') {
    throw 'Metrology input schemaVersion is not the exact V1 contract.'
  }
  if ([string]$metrology.sessionId -ne $SessionId) {
    throw 'Metrology input is not bound to this exact sessionId.'
  }
  $targetHash = Assert-ExactSha256 -Value $metrology.targetSha256 -Label 'metrology.targetSha256'
  if ($targetHash -ne ([string]$State.subject.targetSha256).ToLowerInvariant()) {
    throw 'Metrology input is not bound to the exact protected calibration target SHA-256.'
  }
  $statePath = Join-Path ([string]$Status.sessionDir) 'capture-session.json'
  $currentStateSha256 = Get-ExactFileSha256 -Path $statePath -Label 'Capture-session ledger'
  $sourceStateSha256 = Assert-ExactSha256 -Value $metrology.sourceCaptureSessionSha256 -Label 'metrology.sourceCaptureSessionSha256'
  if ($currentStateSha256 -ne $sourceStateSha256) {
    $physicalExisting = @($State.measurements | Where-Object {
      $_.measurementType -in @('print_scale', 'target_cut_dimension', 'direction_geometry')
    })
    if ($physicalExisting.Count -eq 0 -or @($physicalExisting | Where-Object {
      ([string]$_.payload.sourceMetrologyArtifactSha256).ToLowerInvariant() -ne $observedMetrologySha256
    }).Count -ne 0) {
      throw 'Metrology source capture-session SHA-256 changed and no same-artifact immutable resume authority exists.'
    }
  }
  $printInstrument = Get-Instrument -Value $metrology.instruments.printScale -Label 'instruments.printScale'
  $cutInstrument = Get-Instrument -Value $metrology.instruments.targetCutDimension -Label 'instruments.targetCutDimension'
  $directionInstrument = Get-Instrument -Value $metrology.instruments.directionGeometry -Label 'instruments.directionGeometry'
  $requests = [System.Collections.Generic.List[object]]::new()
  $prefix = 'cal-metrology-' + $observedMetrologySha256.Substring(0, 12)
  $printSlots = [System.Collections.Generic.List[string]]::new()
  foreach ($entry in @($metrology.printScaleMeasurements)) {
    $axis = [string]$entry.axis
    $printSlots.Add('print_scale:' + $axis)
    $requests.Add(@{
      sessionId = $SessionId; operationId = $prefix + '-print-' + $axis
      measurementType = 'print_scale'; axis = $axis
      nominalSpanMm = Get-FiniteNumber -Value $entry.nominalSpanMm -Label ('printScale.' + $axis + '.nominalSpanMm') -Minimum 0.001
      measuredSpanMm = Get-FiniteNumber -Value $entry.measuredSpanMm -Label ('printScale.' + $axis + '.measuredSpanMm') -Minimum 0.001
      measurementU95Mm = Get-FiniteNumber -Value $entry.measurementU95Mm -Label ('printScale.' + $axis + '.measurementU95Mm') -Minimum 0
      measurementMethod = Assert-SafeIdentifier -Value $entry.measurementMethod -Label ('printScale.' + $axis + '.measurementMethod')
      sourceMetrologyArtifactSha256 = $observedMetrologySha256; instrument = $printInstrument
    })
  }
  Assert-ExactSlotSet -Observed $printSlots -Expected @('print_scale:x', 'print_scale:y') -Label 'Print-scale measurements'
  $cutSlots = [System.Collections.Generic.List[string]]::new()
  foreach ($entry in @($metrology.targetCutDimensionMeasurements)) {
    $axis = [string]$entry.axis
    $cutSlots.Add('target_cut_dimension:' + $axis)
    $requests.Add(@{
      sessionId = $SessionId; operationId = $prefix + '-cut-' + $axis
      measurementType = 'target_cut_dimension'; axis = $axis
      nominalDimensionMm = Get-FiniteNumber -Value $entry.nominalDimensionMm -Label ('targetCut.' + $axis + '.nominalDimensionMm') -Minimum 0.001
      measuredDimensionMm = Get-FiniteNumber -Value $entry.measuredDimensionMm -Label ('targetCut.' + $axis + '.measuredDimensionMm') -Minimum 0.001
      measurementU95Mm = Get-FiniteNumber -Value $entry.measurementU95Mm -Label ('targetCut.' + $axis + '.measurementU95Mm') -Minimum 0
      measurementMethod = Assert-SafeIdentifier -Value $entry.measurementMethod -Label ('targetCut.' + $axis + '.measurementMethod')
      sourceMetrologyArtifactSha256 = $observedMetrologySha256; instrument = $cutInstrument
    })
  }
  Assert-ExactSlotSet -Observed $cutSlots -Expected @('target_cut_dimension:x', 'target_cut_dimension:y') -Label 'Target-cut measurements'
  $directionSlots = [System.Collections.Generic.List[string]]::new()
  foreach ($entry in @($metrology.directionGeometryMeasurements)) {
    $channel = Get-ExactInteger -Value $entry.channelIndex -Label 'direction.channelIndex' -Minimum 1 -Maximum 8
    $sample = Get-ExactInteger -Value $entry.sampleIndex -Label 'direction.sampleIndex' -Minimum 1 -Maximum 3
    $directionSlots.Add('direction_geometry:' + $channel + ':' + $sample)
    $requests.Add(@{
      sessionId = $SessionId; operationId = $prefix + '-direction-' + $channel + '-' + $sample
      measurementType = 'direction_geometry'; channelIndex = $channel; sampleIndex = $sample
      sourcePointMm = @{
        x = Get-FiniteNumber -Value $entry.sourcePointMm.x -Label 'direction.sourcePointMm.x'
        y = Get-FiniteNumber -Value $entry.sourcePointMm.y -Label 'direction.sourcePointMm.y'
      }
      cardCenterPointMm = @{
        x = Get-FiniteNumber -Value $entry.cardCenterPointMm.x -Label 'direction.cardCenterPointMm.x'
        y = Get-FiniteNumber -Value $entry.cardCenterPointMm.y -Label 'direction.cardCenterPointMm.y'
      }
      pointU95Mm = Get-FiniteNumber -Value $entry.pointU95Mm -Label 'direction.pointU95Mm' -Minimum 0
      measurementMethod = Assert-SafeIdentifier -Value $entry.measurementMethod -Label 'direction.measurementMethod'
      sourceMetrologyArtifactSha256 = $observedMetrologySha256; instrument = $directionInstrument
    })
  }
  $expectedDirections = foreach ($channel in 1..8) { foreach ($sample in 1..3) { 'direction_geometry:' + $channel + ':' + $sample } }
  Assert-ExactSlotSet -Observed $directionSlots -Expected $expectedDirections -Label 'Direction-geometry measurements'
  foreach ($request in $requests) {
    $null = Invoke-CalibrationBridge -Method POST -Path '/calibration/mathematical-v1/measurement' -Body $request
  }
  Write-Host ('Recorded or idempotently confirmed 28 immutable metrology slots from artifact ' + $observedMetrologySha256 + '.')
  return Get-CalibrationStatus
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
  Write-Host 'Required physical metrology ledger: print scale x/y; cut dimensions x/y; direction geometry channels 1..8 samples 1..3.'
  Write-Host 'CreateMetrologyTemplate emits the exact 28-slot, session/target/ledger-bound input skeleton after all 102 captures; it never submits placeholder values.'
  Write-Host 'SubmitMetrology accepts one SHA-pinned ten-kings-mathematical-calibration-metrology-input-v1 JSON artifact bound to sessionId, targetSha256, and sourceCaptureSessionSha256.'
  Write-Host 'Its instruments object must contain printScale, targetCutDimension, and directionGeometry identities; its three measurement arrays must contain exactly 2, 2, and 24 unique slots.'
  Write-Host 'DeriveRepeatability invokes the pinned OpenCV analyzer implementation and records the exact 50 repeatability measurements before sealing.'
  Write-Host 'An ordinary rejected exact still preserves all accepted slots and hashes. Reposition the same pending pose and use Retry, which always creates a new operation ID.'
  Write-Host 'Resume rebinds the same immutable session after runner, browser, or protected helper-page restart; hard-stop failures are never retryable.'
  Write-Host 'Seal is fail-closed at exactly 102 captures and 78 measurements. Analyze and Finalize require new output paths and never mutate Production.'
  Write-Host 'CompleteOffline performs optional metrology submission, repeatability derivation, seal, analyzer, and finalizer in that exact order.'
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
  $previewBinding = Get-LivePreviewBinding -Slot $Slot
  if ($null -ne $previewBinding) { $body.previewBinding = $previewBinding }
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

function Invoke-RepeatabilityDerivation {
  param($Status, $State)
  if ($Status.sealed) { throw 'Repeatability derivation must run before seal.' }
  if ([int]$Status.captureCount -ne 102) {
    throw 'Repeatability derivation requires all 102 immutable captures.'
  }
  $physicalKeys = @($State.measurements | Where-Object {
    $_.measurementType -in @('print_scale', 'target_cut_dimension', 'direction_geometry')
  } | ForEach-Object { Get-MeasurementKey -Measurement $_ })
  $expectedPhysical = @((Get-ExpectedMeasurementKeys) | Where-Object {
    $_ -notlike 'measurement_repeatability:*'
  })
  Assert-ExactSlotSet -Observed $physicalKeys -Expected $expectedPhysical -Label 'Pre-repeatability physical metrology ledger'
  $outputPath = $RepeatabilityOutputPath
  if ([string]::IsNullOrWhiteSpace($outputPath)) {
    $outputPath = Join-Path (Split-Path ([string]$Status.sessionDir) -Parent) ($SessionId + '-repeatability-preseal-v1.json')
  }
  $outputPath = [System.IO.Path]::GetFullPath($outputPath)
  if (Test-Path -LiteralPath $outputPath) {
    throw ('Repeatability output is immutable and already exists: ' + $outputPath)
  }
  $analyzerSha256 = Get-ExactFileSha256 -Path $AnalyzerPath -Label 'Pinned analyzer source'
  $repeatabilitySha256 = Get-ExactFileSha256 -Path $RepeatabilityPath -Label 'Pinned repeatability source'
  Write-Host ('Pinned analyzer SHA-256: ' + $analyzerSha256)
  Write-Host ('Pinned repeatability producer SHA-256: ' + $repeatabilitySha256)
  $tokenVariable = 'TK_MATHEMATICAL_CALIBRATION_STATION_TOKEN'
  $previousToken = [Environment]::GetEnvironmentVariable($tokenVariable, 'Process')
  [Environment]::SetEnvironmentVariable($tokenVariable, $StationToken, 'Process')
  try {
    Invoke-ExactProcess -Executable $PythonExecutable -Label 'Repeatability derivation/submission' -Arguments @(
      $RepeatabilityPath,
      '--session-dir', ([string]$Status.sessionDir),
      '--output', $outputPath,
      '--bridge-url', $BridgeUrl,
      '--station-token-env', $tokenVariable
    )
  } finally {
    [Environment]::SetEnvironmentVariable($tokenVariable, $previousToken, 'Process')
  }
  $outputSha256 = Get-ExactFileSha256 -Path $outputPath -Label 'Repeatability pre-seal artifact'
  Write-Host ('Repeatability pre-seal artifact: ' + $outputPath)
  Write-Host ('Repeatability pre-seal SHA-256: ' + $outputSha256)
  return Get-CalibrationStatus
}

function Invoke-CalibrationSeal {
  param($Status, $State)
  if (-not $ConfirmSeal) {
    throw 'Seal requires -ConfirmSeal after reviewing the complete 102-capture / 78-measurement status.'
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

Assert-BridgeInput

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

if ($Action -eq 'Status') {
  $status
  Write-PoseProgress -Status $status
  $statePath = Join-Path ([string]$status.sessionDir) 'capture-session.json'
  Write-Host ('Capture-session ledger SHA-256: ' + (Get-ExactFileSha256 -Path $statePath -Label 'Capture-session ledger'))
  Write-Host ('Protected target SHA-256: ' + $state.subject.targetSha256)
  $observedMeasurementKeys = @($state.measurements | ForEach-Object { Get-MeasurementKey -Measurement $_ })
  $missingMeasurementKeys = @((Get-ExpectedMeasurementKeys) | Where-Object { $_ -notin $observedMeasurementKeys })
  Write-Host ('Immutable measurements: ' + $observedMeasurementKeys.Count + '/78; missing ' + $missingMeasurementKeys.Count + '.')
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

if ($Action -eq 'SubmitMetrology') {
  Submit-MetrologyArtifact -Status $status -State $state
  exit 0
}

if ($Action -eq 'CreateMetrologyTemplate') {
  New-MetrologyInputTemplate -Status $status -State $state
  exit 0
}

if ($Action -eq 'DeriveRepeatability') {
  Invoke-RepeatabilityDerivation -Status $status -State $state
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
  if (-not [string]::IsNullOrWhiteSpace($MetrologyInputPath)) {
    $status = Submit-MetrologyArtifact -Status $status -State $state
    $state = Get-CalibrationState -Status $status
  }
  $repeatabilityKeys = @($state.measurements | Where-Object {
    $_.measurementType -eq 'measurement_repeatability'
  } | ForEach-Object { Get-MeasurementKey -Measurement $_ })
  if ($repeatabilityKeys.Count -eq 0) {
    $status = Invoke-RepeatabilityDerivation -Status $status -State $state
    $state = Get-CalibrationState -Status $status
  } elseif ($repeatabilityKeys.Count -ne 50) {
    throw 'CompleteOffline found a partial repeatability ledger; rerun DeriveRepeatability with a new output path to idempotently finish the exact same producer requests.'
  } else {
    Write-Host 'All 50 analyzer-derived repeatability records already exist; derivation was not repeated.'
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
