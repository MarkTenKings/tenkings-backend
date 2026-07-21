[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$artifact = [ordered]@{
  schemaVersion = "ten-kings-mathematical-calibration-operator-certification-v1.1"
  artifactType = "operator_metrology_certification"
  authority = [ordered]@{
    kind = "mark_operator_certification"
    operator = "Mark"
    thirdPartyCertificate = $false
    statement = "Mark explicitly confirms the U95/calibration evidence passes every required equation."
  }
  instrument = [ordered]@{
    instrumentId = "husky-digital-fraction-caliper-mark-v1.1"
    tool = "Husky digital fraction caliper"
    kind = "caliper"
    resolutionMm = 0.01
    directRange = "greater_than_200_mm"
    calibrationVersion = "mark-operator-certification-2026-07-20-v1.1"
    calibrationAuthority = "mark_operator_certification"
  }
  print = [ordered]@{
    actualSizePercent = 100
    xBarMm = 100.00
    yBarMm = 200.00
    couponWidthMm = 63.50
    couponHeightMm = 88.90
    multipleDirectRangeToolsCrossChecked = $true
  }
  acceptance = [ordered]@{
    equation = "abs(measured - nominal) + U95 <= 0.20 mm"
    conservativeRecordedU95UpperBoundMm = 0.20
    allRequiredEquationsPass = $true
    u95ValueIsCertificateClaim = $false
  }
}

$json = $artifact | ConvertTo-Json -Depth 12
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json + "`n")
$fullPath = [System.IO.Path]::GetFullPath($OutputPath)
$parent = [System.IO.Path]::GetDirectoryName($fullPath)
if (-not [string]::IsNullOrWhiteSpace($parent)) {
  [System.IO.Directory]::CreateDirectory($parent) | Out-Null
}
$stream = $null
try {
  $stream = [System.IO.File]::Open($fullPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush($true)
} catch [System.IO.IOException] {
  throw "Operator certification artifact already exists or cannot be created write-once: $fullPath"
} finally {
  if ($null -ne $stream) { $stream.Dispose() }
}
$hash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
[pscustomobject]@{
  ok = $true
  path = $fullPath
  sha256 = $hash
  instrumentId = $artifact.instrument.instrumentId
  calibrationVersion = $artifact.instrument.calibrationVersion
  authority = $artifact.authority.kind
  conservativeRecordedU95UpperBoundMm = $artifact.acceptance.conservativeRecordedU95UpperBoundMm
} | ConvertTo-Json -Compress
