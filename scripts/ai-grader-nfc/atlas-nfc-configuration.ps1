# Windows PowerShell 5.1 compatible. Pure configuration/public-key validation;
# no CNG key store, helper process, listener, device, or configuration writes.
function Assert-AtlasNfcServerTrustJson {
  param(
    [Parameter(Mandatory = $true)][string]$Value,
    [string[]]$ForbiddenKeyIds = @()
  )
  # A conservative 4096-byte envelope also satisfies Program's 5000-byte
  # envelope and 4096-byte nested-key limits without reserializing the export.
  if ([Text.Encoding]::UTF8.GetByteCount($Value) -gt 4096 -or
      [string]::IsNullOrWhiteSpace($Value) -or $Value.Contains('\')) {
    throw "The dedicated ATLAS public trust is invalid or outside its size bound."
  }
  # Require ordinary unescaped property/value strings. ConvertFrom-Json alone
  # loses duplicate properties and some hosts accept comments/trailing commas.
  $withoutStrings = [regex]::Replace($Value, '"[^"\x00-\x1f]*"', '""')
  if ($withoutStrings -cnotmatch '\A(?:[ \t\r\n]|[{}:,]|""|null)*\z' -or
      $withoutStrings -match ',\s*}') {
    throw "The dedicated ATLAS public trust must use strict JSON."
  }
  try { $trust = $Value | ConvertFrom-Json -ErrorAction Stop }
  catch { throw "The dedicated ATLAS public trust is invalid JSON." }
  $rootNames = @($trust.PSObject.Properties | ForEach-Object { $_.Name })
  if ($rootNames.Count -ne 3 -or
      @($rootNames | Where-Object { $_ -cnotin @('schemaVersion', 'purpose', 'keys') }).Count -ne 0 -or
      $trust.schemaVersion -cne 'atlas-nfc-helper-trust-v1' -or
      $trust.purpose -cne 'atlas-program-approved-report-url-v1') {
    throw "The dedicated ATLAS public trust has the wrong schema or purpose."
  }
  $keysJson = $trust.keys | ConvertTo-Json -Depth 5 -Compress
  Assert-NfcV2ServerTrustJson -Value $keysJson | Out-Null
  $entries = @($trust.keys.current)
  if ($null -ne $trust.keys.prior) { $entries += $trust.keys.prior }
  $expectedCounts = @{ schemaVersion = 1; purpose = 1; keys = 1; current = 1; prior = 1;
    algorithm = $entries.Count; keyId = $entries.Count; publicSpkiDerBase64 = $entries.Count }
  foreach ($name in $expectedCounts.Keys) {
    if ([regex]::Matches($Value, ('"' + $name + '"\s*:')).Count -ne $expectedCounts[$name]) {
      throw "The dedicated ATLAS public trust contains duplicate or missing properties."
    }
  }
  Add-Type -AssemblyName System.Numerics -ErrorAction Stop
  $hexStyle = [Globalization.NumberStyles]::AllowHexSpecifier
  $prime = [Numerics.BigInteger]::Parse('00ffffffff00000001000000000000000000000000ffffffffffffffffffffffff', $hexStyle)
  $curveB = [Numerics.BigInteger]::Parse('005ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b', $hexStyle)
  foreach ($entry in $entries) {
    if ($entry.algorithm -isnot [string] -or $entry.keyId -isnot [string] -or
        $entry.publicSpkiDerBase64 -isnot [string] -or $ForbiddenKeyIds -ccontains $entry.keyId) {
      throw "ATLAS job authority must be distinct from legacy and workstation signing identities."
    }
    $spki = [Convert]::FromBase64String($entry.publicSpkiDerBase64)
    try {
      # Canonical named-curve P-256 SPKI, uncompressed point. This intentionally
      # accepts only the encoding exported by the ATLAS protocol implementation.
      $hex = (($spki | ForEach-Object { $_.ToString('x2') }) -join '')
      if ($spki.Length -ne 91 -or -not $hex.StartsWith('3059301306072a8648ce3d020106082a8648ce3d03010703420004', [StringComparison]::Ordinal)) {
        throw "ATLAS public trust requires canonical named-curve P-256 SPKI."
      }
      $x = [Numerics.BigInteger]::Parse(('00' + $hex.Substring(54, 64)), $hexStyle)
      $y = [Numerics.BigInteger]::Parse(('00' + $hex.Substring(118, 64)), $hexStyle)
      if ($x -ge $prime -or $y -ge $prime -or
          (($y * $y - $x * $x * $x + $x * 3 - $curveB) % $prime) -ne [Numerics.BigInteger]::Zero) {
        throw "ATLAS public trust contains an invalid P-256 public point."
      }
    } finally { [Array]::Clear($spki, 0, $spki.Length) }
  }
  return $Value
}

function Assert-AtlasNfcConfig {
  param([Parameter(Mandatory = $true)]$Config)
  $enabledProperty = $Config.PSObject.Properties['atlasNfcEnabled']
  if ($null -ne $enabledProperty -and $enabledProperty.Value -isnot [bool]) {
    throw "atlasNfcEnabled must be an explicit JSON boolean."
  }
  $enabled = $null -ne $enabledProperty -and $enabledProperty.Value -eq $true
  $trust = $Config.PSObject.Properties['atlasNfcServerJobPublicKeysJson']
  $token = $Config.PSObject.Properties['atlasNfcWorkstationToken']
  if (-not $enabled) {
    # Retain intentionally disabled settings byte-for-byte, but never export them.
    return $false
  }
  if ($Config.schemaVersion -cnotin @('tenkings-ai-grader-nfc-helper-config-v3', 'tenkings-ai-grader-nfc-helper-config-v4') -or
      [string]::IsNullOrWhiteSpace([string]$Config.goToTagsExecutablePath) -or
      $null -eq $token -or $token.Value -isnot [string] -or
      $token.Value -cnotmatch '\A[A-Za-z0-9_-]{43,192}\z' -or
      $token.Value -ceq [string]$Config.workstationToken -or
      $null -eq $trust -or $trust.Value -isnot [string]) {
    throw "Enabled ATLAS requires its own protected token, public trust, and configured F8215 adapter."
  }
  $forbidden = @([string]$Config.workstationKeyId)
  if ($Config.schemaVersion -ceq 'tenkings-ai-grader-nfc-helper-config-v4') {
    $legacyJson = [string]$Config.tenKingsV2ServerJobPublicKeysJson
    Assert-NfcV2ServerTrustJson -Value $legacyJson | Out-Null
    $legacy = $legacyJson | ConvertFrom-Json
    $forbidden += [string]$legacy.current.keyId
    if ($null -ne $legacy.prior) { $forbidden += [string]$legacy.prior.keyId }
  }
  Assert-AtlasNfcServerTrustJson -Value $trust.Value -ForbiddenKeyIds $forbidden | Out-Null
  return $true
}

function Invoke-NfcWithAtlasEnvironment {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [object[]]$ArgumentList = @()
  )
  $enabled = Assert-AtlasNfcConfig -Config $Config
  $values = @{
    ATLAS_NFC_SERVER_JOB_PUBLIC_KEYS_JSON = $(if ($enabled) { [string]$Config.atlasNfcServerJobPublicKeysJson } else { $null })
    ATLAS_NFC_WORKSTATION_TOKEN = $(if ($enabled) { [string]$Config.atlasNfcWorkstationToken } else { $null })
  }
  $previous = @{}
  foreach ($name in $values.Keys) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, [EnvironmentVariableTarget]::Process)
    if ($null -ne $previous[$name] -and ($null -eq $values[$name] -or $previous[$name] -cne $values[$name])) {
      throw "Unmanaged inherited ATLAS NFC environment conflicts with the protected helper configuration."
    }
  }
  try {
    foreach ($name in $values.Keys) {
      [Environment]::SetEnvironmentVariable($name, $values[$name], [EnvironmentVariableTarget]::Process)
    }
    & $Action @ArgumentList
  } finally {
    # Both restores are attempted even if the first environment operation fails.
    try {
      [Environment]::SetEnvironmentVariable('ATLAS_NFC_SERVER_JOB_PUBLIC_KEYS_JSON', $previous['ATLAS_NFC_SERVER_JOB_PUBLIC_KEYS_JSON'], [EnvironmentVariableTarget]::Process)
    } finally {
      [Environment]::SetEnvironmentVariable('ATLAS_NFC_WORKSTATION_TOKEN', $previous['ATLAS_NFC_WORKSTATION_TOKEN'], [EnvironmentVariableTarget]::Process)
    }
  }
}
