[CmdletBinding()]
param(
  [switch]$Real,
  [switch]$SkipBuild,
  [string]$StationToken = $env:AI_GRADER_STATION_TOKEN,
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-local-bridge.json",
  [switch]$NoLocalConfig,
  [switch]$RotatePairingCode,
  [switch]$OpenStation,
  [string]$HostName,
  [int]$Port,
  [string[]]$AllowedOrigin,
  [string]$OutputDir,
  [string]$ReportBundleOutputDir,
  [string]$LeimacHost,
  [int]$LeimacPort,
  [int]$ExposureUs,
  [double]$Gain,
  [double]$Duty,
  [string]$FixtureLabel,
  [double]$HorizontalSpanMm,
  [string]$HorizontalStartPx,
  [string]$HorizontalEndPx,
  [double]$VerticalSpanMm,
  [string]$VerticalStartPx,
  [string]$VerticalEndPx,
  [string]$CardBoundaryRect,
  [string]$MathematicalCalibrationOutputDir,
  [string]$MathematicalCalibrationTargetPath,
  [string]$MathematicalCalibrationTargetVersion,
  [string]$MathematicalCalibrationTargetSha256,
  [string]$MathematicalCalibrationRigId,
  [string]$MathematicalCalibrationBundlePath,
  [string]$MathematicalCalibrationBundleSha256
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

. (Join-Path $PSScriptRoot "ai-grader-local-bridge-common.ps1")

$repoRoot = Get-AiGraderRepoRoot
Set-Location $repoRoot

$mode = if ($Real) { "real" } else { "mock" }
$config = $null
if (-not $NoLocalConfig) {
  $config = Initialize-AiGraderBridgeConfig -Path $ConfigPath -Mode $mode -RotatePairingCode:$RotatePairingCode
}

if ([string]::IsNullOrWhiteSpace($StationToken)) {
  if ($null -ne $config -and -not [string]::IsNullOrWhiteSpace($config.stationToken)) {
    $StationToken = [string]$config.stationToken
  } elseif ($mode -eq "mock") {
    $StationToken = "local-dev-token"
  } else {
    throw "AI Grader real bridge requires a local station token. Use the installer/config path instead of passing tokens on the command line."
  }
}

$selectedHost = if ($PSBoundParameters.ContainsKey("HostName")) { $HostName } elseif ($config) { [string]$config.host } else { "127.0.0.1" }
$selectedPort = if ($PSBoundParameters.ContainsKey("Port")) { $Port } elseif ($config) { [int]$config.port } else { 47652 }
$selectedAllowedOrigins = if ($PSBoundParameters.ContainsKey("AllowedOrigin")) { $AllowedOrigin } elseif ($config) { @($config.allowedOrigins) } else { @("http://127.0.0.1:3020", "http://localhost:3020", "https://collect.tenkings.co") }
$selectedOutputDir = if ($PSBoundParameters.ContainsKey("OutputDir")) { $OutputDir } elseif ($config) { [string]$config.outputDir } else { "C:\TenKings\capture-data\ai-grader-station" }
$selectedReportBundleOutputDir = if ($PSBoundParameters.ContainsKey("ReportBundleOutputDir")) { $ReportBundleOutputDir } elseif ($config) { [string]$config.reportBundleOutputDir } else { "C:\TenKings\capture-data\ai-grader-report-bundles" }
$selectedLeimacHost = if ($PSBoundParameters.ContainsKey("LeimacHost")) { $LeimacHost } elseif ($config) { [string]$config.leimacHost } else { "169.254.191.156" }
$selectedLeimacPort = if ($PSBoundParameters.ContainsKey("LeimacPort")) { $LeimacPort } elseif ($config) { [int]$config.leimacPort } else { 1000 }
$selectedExposureUs = if ($PSBoundParameters.ContainsKey("ExposureUs")) { $ExposureUs } elseif ($config) { [int]$config.exposureUs } else { 45000 }
$selectedGain = if ($PSBoundParameters.ContainsKey("Gain")) { $Gain } elseif ($config) { [double]$config.gain } else { 0 }
$selectedDuty = if ($PSBoundParameters.ContainsKey("Duty")) { $Duty } elseif ($config) { [double]$config.duty } else { 1.2 }
$selectedFixtureLabel = if ($PSBoundParameters.ContainsKey("FixtureLabel")) { $FixtureLabel } elseif ($config) { [string]$config.fixtureLabel } else { "fixed-ruler-v1-dell" }
$selectedHorizontalSpanMm = if ($PSBoundParameters.ContainsKey("HorizontalSpanMm")) { $HorizontalSpanMm } elseif ($config) { [double]$config.horizontalSpanMm } else { 50.8 }
$selectedHorizontalStartPx = if ($PSBoundParameters.ContainsKey("HorizontalStartPx")) { $HorizontalStartPx } elseif ($config) { [string]$config.horizontalStartPx } else { "540,205" }
$selectedHorizontalEndPx = if ($PSBoundParameters.ContainsKey("HorizontalEndPx")) { $HorizontalEndPx } elseif ($config) { [string]$config.horizontalEndPx } else { "1620,205" }
$selectedVerticalSpanMm = if ($PSBoundParameters.ContainsKey("VerticalSpanMm")) { $VerticalSpanMm } elseif ($config) { [double]$config.verticalSpanMm } else { 50.8 }
$selectedVerticalStartPx = if ($PSBoundParameters.ContainsKey("VerticalStartPx")) { $VerticalStartPx } elseif ($config) { [string]$config.verticalStartPx } else { "2295,145" }
$selectedVerticalEndPx = if ($PSBoundParameters.ContainsKey("VerticalEndPx")) { $VerticalEndPx } elseif ($config) { [string]$config.verticalEndPx } else { "2295,1218" }
$selectedCardBoundaryRect = if ($PSBoundParameters.ContainsKey("CardBoundaryRect")) { $CardBoundaryRect } elseif ($config) { [string]$config.cardBoundaryRect } else { "285,349,1878,1350" }
$selectedMathematicalCalibrationOutputDir = if ($PSBoundParameters.ContainsKey('MathematicalCalibrationOutputDir')) { $MathematicalCalibrationOutputDir } elseif ($config) { [string]$config.mathematicalCalibrationOutputDir } else { $null }
$selectedMathematicalCalibrationTargetPath = if ($PSBoundParameters.ContainsKey('MathematicalCalibrationTargetPath')) { $MathematicalCalibrationTargetPath } elseif ($config) { [string]$config.mathematicalCalibrationTargetPath } else { $null }
$selectedMathematicalCalibrationTargetVersion = if ($PSBoundParameters.ContainsKey('MathematicalCalibrationTargetVersion')) { $MathematicalCalibrationTargetVersion } elseif ($config) { [string]$config.mathematicalCalibrationTargetVersion } else { $null }
$selectedMathematicalCalibrationTargetSha256 = if ($PSBoundParameters.ContainsKey('MathematicalCalibrationTargetSha256')) { $MathematicalCalibrationTargetSha256 } elseif ($config) { [string]$config.mathematicalCalibrationTargetSha256 } else { $null }
$selectedMathematicalCalibrationRigId = if ($PSBoundParameters.ContainsKey('MathematicalCalibrationRigId')) { $MathematicalCalibrationRigId } elseif ($config) { [string]$config.mathematicalCalibrationRigId } else { $null }
$selectedMathematicalCalibrationBundlePath = if ($PSBoundParameters.ContainsKey('MathematicalCalibrationBundlePath')) { $MathematicalCalibrationBundlePath } elseif ($config) { [string]$config.mathematicalCalibrationBundlePath } else { $null }
$selectedMathematicalCalibrationBundleSha256 = if ($PSBoundParameters.ContainsKey('MathematicalCalibrationBundleSha256')) { $MathematicalCalibrationBundleSha256 } elseif ($config) { [string]$config.mathematicalCalibrationBundleSha256 } else { $null }

$targetSettings = @(
  $selectedMathematicalCalibrationTargetPath,
  $selectedMathematicalCalibrationTargetVersion,
  $selectedMathematicalCalibrationTargetSha256
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
if ($targetSettings.Count -ne 0 -and $targetSettings.Count -ne 3) {
  throw 'Mathematical calibration target path, version, and SHA-256 must be configured together.'
}
$bundleSettings = @(
  $selectedMathematicalCalibrationBundlePath,
  $selectedMathematicalCalibrationBundleSha256
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
if ($bundleSettings.Count -ne 0 -and $bundleSettings.Count -ne 2) {
  throw 'Mathematical calibration bundle path and SHA-256 must be configured together.'
}

$cliPath = Join-Path $repoRoot "packages\ai-grader-capture-helper\dist\cli.js"
if (-not $SkipBuild) {
  Write-Host "Building @tenkings/ai-grader-capture-helper before bridge startup so the running action contract matches the checked-out source..."
  & pnpm --filter "@tenkings/ai-grader-capture-helper" build
  if ($LASTEXITCODE -ne 0) {
    Write-Error "AI Grader capture-helper build failed; the local bridge was not started with stale compiled code."
    exit $LASTEXITCODE
  }
}

if (-not (Test-Path -LiteralPath $cliPath)) {
  throw "Missing $cliPath. Run: pnpm --filter @tenkings/ai-grader-capture-helper build"
}

$env:AI_GRADER_STATION_BRIDGE_TOKEN = $StationToken
if (-not [string]::IsNullOrWhiteSpace($selectedMathematicalCalibrationOutputDir)) {
  $env:AI_GRADER_MATHEMATICAL_CALIBRATION_OUTPUT_DIR = $selectedMathematicalCalibrationOutputDir
}
if ($targetSettings.Count -eq 3) {
  $env:AI_GRADER_MATHEMATICAL_CALIBRATION_TARGET_PATH = $selectedMathematicalCalibrationTargetPath
  $env:AI_GRADER_MATHEMATICAL_CALIBRATION_TARGET_VERSION = $selectedMathematicalCalibrationTargetVersion
  $env:AI_GRADER_MATHEMATICAL_CALIBRATION_TARGET_SHA256 = $selectedMathematicalCalibrationTargetSha256
}
if (-not [string]::IsNullOrWhiteSpace($selectedMathematicalCalibrationRigId)) {
  $env:AI_GRADER_MATHEMATICAL_CALIBRATION_RIG_ID = $selectedMathematicalCalibrationRigId
}
if ($bundleSettings.Count -eq 2) {
  $env:AI_GRADER_MATHEMATICAL_CALIBRATION_BUNDLE_PATH = $selectedMathematicalCalibrationBundlePath
  $env:AI_GRADER_MATHEMATICAL_CALIBRATION_BUNDLE_SHA256 = $selectedMathematicalCalibrationBundleSha256
}
if ($config -and -not [string]::IsNullOrWhiteSpace($config.pairingCode)) {
  $env:AI_GRADER_STATION_PAIRING_CODE = [string]$config.pairingCode
  $env:AI_GRADER_STATION_PAIRING_EXPIRES_AT = [string]$config.pairingCodeExpiresAt
}

Write-Host ""
Write-Host "Ten Kings AI Grader local station bridge"
Write-Host "Mode: $mode"
Write-Host "Bridge URL: http://${selectedHost}:$selectedPort"
Write-Host "Station page: https://collect.tenkings.co/ai-grader/station"
Write-Host "Local config: $ConfigPath"
Write-Host "Station token: stored locally; not printed"
Write-Host "Station token fingerprint: $(Get-AiGraderSecretFingerprint -Value $StationToken)"
if ($config -and -not [string]::IsNullOrWhiteSpace($config.pairingCode)) {
  Write-Host "Pairing code: stored locally; not printed"
  Write-Host "Pairing code fingerprint: $(Get-AiGraderSecretFingerprint -Value ([string]$config.pairingCode))"
  Write-Host "Pairing expires: $($config.pairingCodeExpiresAt)"
}
Write-Host ""

if ($Real) {
  Write-Host "Real bridge mode is armed for Mark-supervised local hardware actions."
  Write-Host "No capture or lighting action runs until the browser station sends staged operator-confirmed actions."
  Write-Host ""
}

if ($OpenStation -and $config) {
  Start-Process (Get-AiGraderBridgePairingUrl -Config $config) | Out-Null
}

$bridgeArgs = @(
  "--filter", "@tenkings/ai-grader-capture-helper",
  "exec", "node", "dist/cli.js",
  "ai-grader-station-bridge",
  "--enable-local-station",
  "--station-bridge-mode", $mode,
  "--host", $selectedHost,
  "--port", "$selectedPort",
  "--output-dir", $selectedOutputDir,
  "--report-bundle-output-dir", $selectedReportBundleOutputDir,
  "--public-base-path", "/ai-grader/reports",
  "--exposure-us", "$selectedExposureUs",
  "--gain", "$selectedGain",
  "--duty", "$selectedDuty",
  "--fixture-label", $selectedFixtureLabel,
  "--reference-type", "fixed_metric_rulers",
  "--horizontal-span-mm", "$selectedHorizontalSpanMm",
  "--horizontal-start-px", $selectedHorizontalStartPx,
  "--horizontal-end-px", $selectedHorizontalEndPx,
  "--vertical-span-mm", "$selectedVerticalSpanMm",
  "--vertical-start-px", $selectedVerticalStartPx,
  "--vertical-end-px", $selectedVerticalEndPx,
  "--card-boundary-rect", $selectedCardBoundaryRect
)

foreach ($origin in $selectedAllowedOrigins) {
  if (-not [string]::IsNullOrWhiteSpace($origin)) {
    $bridgeArgs += @("--allowed-origin", $origin)
  }
}

if ($Real) {
  $bridgeArgs += @(
    "--leimac-host", $selectedLeimacHost,
    "--leimac-port", "$selectedLeimacPort",
    "--apply",
    "--mark-present",
    "--wiring-confirmed",
    "--leimac-status-green"
  )
}

try {
  & pnpm @bridgeArgs
  exit $LASTEXITCODE
} finally {
  Remove-Item Env:\AI_GRADER_STATION_BRIDGE_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:\AI_GRADER_STATION_PAIRING_CODE -ErrorAction SilentlyContinue
  Remove-Item Env:\AI_GRADER_STATION_PAIRING_EXPIRES_AT -ErrorAction SilentlyContinue
  Remove-Item Env:\AI_GRADER_MATHEMATICAL_CALIBRATION_OUTPUT_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:\AI_GRADER_MATHEMATICAL_CALIBRATION_TARGET_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:\AI_GRADER_MATHEMATICAL_CALIBRATION_TARGET_VERSION -ErrorAction SilentlyContinue
  Remove-Item Env:\AI_GRADER_MATHEMATICAL_CALIBRATION_TARGET_SHA256 -ErrorAction SilentlyContinue
  Remove-Item Env:\AI_GRADER_MATHEMATICAL_CALIBRATION_RIG_ID -ErrorAction SilentlyContinue
  Remove-Item Env:\AI_GRADER_MATHEMATICAL_CALIBRATION_BUNDLE_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:\AI_GRADER_MATHEMATICAL_CALIBRATION_BUNDLE_SHA256 -ErrorAction SilentlyContinue
}
