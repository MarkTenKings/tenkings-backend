[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$OutputPath,
  [Parameter(Mandatory)][string]$OwnerAttestationId,
  [Parameter(Mandatory)][string]$ProductOwnerId,
  [Parameter(Mandatory)][string]$InstrumentId,
  [Parameter(Mandatory)][string]$Manufacturer,
  [Parameter(Mandatory)][string]$Model,
  [Parameter(Mandatory)][string]$SerialNumber,
  [Parameter(Mandatory)][double]$MaximumRangeMm,
  [Parameter(Mandatory)][double]$AccuracyMm,
  [Parameter(Mandatory)][double]$ResolutionMm,
  [Parameter(Mandatory)][double]$StatedU95Mm,
  [switch]$ConfirmProductOwnerAttestation
)

$ErrorActionPreference = 'Stop'

function Assert-SafeIdentifier {
  param([string]$Value, [string]$Label)
  if ($Value -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') {
    throw ($Label + ' must be a safe identifier.')
  }
  return $Value
}

function Assert-SafeText {
  param([string]$Value, [string]$Label)
  if ($Value.Length -lt 1 -or $Value.Length -gt 191 -or $Value.Trim() -ne $Value -or $Value -match '[\x00-\x1f\x7f]') {
    throw ($Label + ' must be canonical non-empty text without control characters.')
  }
  return $Value
}

function Assert-PositiveFiniteNumber {
  param([double]$Value, [string]$Label)
  if ([double]::IsNaN($Value) -or [double]::IsInfinity($Value) -or $Value -le 0) {
    throw ($Label + ' must be finite and greater than zero.')
  }
  return $Value
}

if (-not $ConfirmProductOwnerAttestation) {
  throw 'Creation requires -ConfirmProductOwnerAttestation. This is non-traceable product-owner evidence, not a calibration certificate.'
}

$resolvedOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $resolvedOutputPath) {
  throw ('OutputPath must be a new file and will not be overwritten: ' + $resolvedOutputPath)
}
$parent = Split-Path -Parent $resolvedOutputPath
if ([string]::IsNullOrWhiteSpace($parent) -or -not (Test-Path -LiteralPath $parent -PathType Container)) {
  throw ('OutputPath parent directory must already exist: ' + $parent)
}

$maximumRange = Assert-PositiveFiniteNumber -Value $MaximumRangeMm -Label 'MaximumRangeMm'
$accuracy = Assert-PositiveFiniteNumber -Value $AccuracyMm -Label 'AccuracyMm'
$resolution = Assert-PositiveFiniteNumber -Value $ResolutionMm -Label 'ResolutionMm'
$statedU95 = Assert-PositiveFiniteNumber -Value $StatedU95Mm -Label 'StatedU95Mm'
if ($statedU95 -lt $accuracy) {
  throw 'StatedU95Mm cannot be less than AccuracyMm.'
}

# Keys remain in ordinal alphabetical order so ConvertTo-Json -Compress produces
# the same one-line canonical byte form used by the protected TypeScript loader.
$attestation = [ordered]@{
  accuracyMm = $accuracy
  attestedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
  authorityStatement = 'product_owner_attested_non_traceable_measurement_v1'
  instrumentId = Assert-SafeIdentifier -Value $InstrumentId -Label 'InstrumentId'
  manufacturer = Assert-SafeText -Value $Manufacturer -Label 'Manufacturer'
  maximumRangeMm = $maximumRange
  model = Assert-SafeText -Value $Model -Label 'Model'
  ownerAttestationId = Assert-SafeIdentifier -Value $OwnerAttestationId -Label 'OwnerAttestationId'
  productOwnerId = Assert-SafeIdentifier -Value $ProductOwnerId -Label 'ProductOwnerId'
  resolutionMm = $resolution
  schemaVersion = 'ten-kings-product-owner-metrology-attestation-v1'
  serialNumber = Assert-SafeIdentifier -Value $SerialNumber -Label 'SerialNumber'
  statedU95Mm = $statedU95
  traceabilityStatement = 'not_traceably_calibrated'
}

$json = $attestation | ConvertTo-Json -Compress -Depth 4
[System.IO.File]::WriteAllText($resolvedOutputPath, $json + "`n", [System.Text.UTF8Encoding]::new($false))
$sha256 = (Get-FileHash -LiteralPath $resolvedOutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host ('Created write-once non-traceable product-owner metrology attestation: ' + $resolvedOutputPath)
Write-Host ('SHA-256: ' + $sha256)
Write-Host 'Use ownerAttestationVersion 1 and this exact ownerAttestationSha256 in the matching metrology instrument object.'
