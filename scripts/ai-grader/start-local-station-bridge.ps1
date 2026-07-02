[CmdletBinding()]
param(
  [switch]$Real,
  [switch]$SkipBuild,
  [string]$StationToken = $env:AI_GRADER_STATION_TOKEN,
  [string]$HostName = "127.0.0.1",
  [int]$Port = 47652,
  [string[]]$AllowedOrigin = @("http://127.0.0.1:3020", "http://localhost:3020", "https://collect.tenkings.co"),
  [string]$OutputDir = "C:\TenKings\capture-data\ai-grader-station",
  [string]$ReportBundleOutputDir = "C:\TenKings\capture-data\ai-grader-report-bundles",
  [string]$LeimacHost = "169.254.191.156",
  [int]$LeimacPort = 1000,
  [int]$ExposureUs = 45000,
  [double]$Gain = 0,
  [double]$Duty = 1.2,
  [string]$FixtureLabel = "fixed-ruler-v1-dell",
  [double]$HorizontalSpanMm = 50.8,
  [string]$HorizontalStartPx = "540,205",
  [string]$HorizontalEndPx = "1620,205",
  [double]$VerticalSpanMm = 50.8,
  [string]$VerticalStartPx = "2295,145",
  [string]$VerticalEndPx = "2295,1218",
  [string]$CardBoundaryRect = "285,349,1878,1350"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

if ([string]::IsNullOrWhiteSpace($StationToken)) {
  $StationToken = "tk-local-" + ([guid]::NewGuid().ToString("N"))
}

$cliPath = Join-Path $repoRoot "packages\ai-grader-capture-helper\dist\cli.js"
if (-not $SkipBuild -and -not (Test-Path -LiteralPath $cliPath)) {
  Write-Host "Building @tenkings/ai-grader-capture-helper because dist/cli.js is missing..."
  & pnpm --filter "@tenkings/ai-grader-capture-helper" build
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

if (-not (Test-Path -LiteralPath $cliPath)) {
  throw "Missing $cliPath. Run: pnpm --filter @tenkings/ai-grader-capture-helper build"
}

$mode = if ($Real) { "real" } else { "mock" }

Write-Host ""
Write-Host "Ten Kings AI Grader local station bridge"
Write-Host "Mode: $mode"
Write-Host "Station page: http://127.0.0.1:3020/ai-grader/station"
Write-Host "Sample report: http://127.0.0.1:3020/ai-grader/reports/sample-pr45"
Write-Host "Bridge URL: http://${HostName}:$Port"
Write-Host "Station token: $StationToken"
Write-Host ""

if ($Real) {
  Write-Host "Real bridge mode is armed for Mark-supervised local hardware actions."
  Write-Host "The browser workflow must still stage-confirm light idle/off, fixture/rulers visible, flip complete, safe-off, and final light off."
  Write-Host ""
}

$bridgeArgs = @(
  "--filter", "@tenkings/ai-grader-capture-helper",
  "exec", "node", "dist/cli.js",
  "ai-grader-station-bridge",
  "--enable-local-station",
  "--station-bridge-mode", $mode,
  "--host", $HostName,
  "--port", "$Port",
  "--station-token", $StationToken,
  "--output-dir", $OutputDir,
  "--report-bundle-output-dir", $ReportBundleOutputDir,
  "--public-base-path", "/ai-grader/reports",
  "--exposure-us", "$ExposureUs",
  "--gain", "$Gain",
  "--duty", "$Duty",
  "--fixture-label", $FixtureLabel,
  "--reference-type", "fixed_metric_rulers",
  "--horizontal-span-mm", "$HorizontalSpanMm",
  "--horizontal-start-px", $HorizontalStartPx,
  "--horizontal-end-px", $HorizontalEndPx,
  "--vertical-span-mm", "$VerticalSpanMm",
  "--vertical-start-px", $VerticalStartPx,
  "--vertical-end-px", $VerticalEndPx,
  "--card-boundary-rect", $CardBoundaryRect
)

foreach ($origin in $AllowedOrigin) {
  if (-not [string]::IsNullOrWhiteSpace($origin)) {
    $bridgeArgs += @("--allowed-origin", $origin)
  }
}

if ($Real) {
  $bridgeArgs += @(
    "--leimac-host", $LeimacHost,
    "--leimac-port", "$LeimacPort",
    "--apply",
    "--mark-present",
    "--wiring-confirmed",
    "--leimac-status-green"
  )
}

& pnpm @bridgeArgs
exit $LASTEXITCODE
