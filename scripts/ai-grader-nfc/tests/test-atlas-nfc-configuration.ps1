[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\ai-grader-nfc-helper-common.ps1')
$script:assertions = 0
function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
  $script:assertions++
}
function Assert-Throws {
  param([scriptblock]$Action, [string]$Message)
  try { & $Action | Out-Null } catch { $script:assertions++; return }
  throw $Message
}

# Public-only synthetic point from the committed protocol vector. No private
# key, named key store, listener, production path, or helper entry point is used.
$publicSpki = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/eq7FrQ7YUt2BqT+YP8Vae+xAcLUBGpxtM4ZJ/PNFEDWrDcA+Xv+Qr+CceDAL52FeeLMEBtcfh2XXRlWCl5Ing=='
function New-PublicEntry {
  param([string]$Base64)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $id = (($sha.ComputeHash([Convert]::FromBase64String($Base64)) | ForEach-Object { $_.ToString('x2') }) -join '') }
  finally { $sha.Dispose() }
  return [pscustomobject]@{ algorithm = 'ecdsa-p256-sha256-p1363'; keyId = $id; publicSpkiDerBase64 = $Base64 }
}
function New-Trust {
  param($Current, $Prior = $null)
  return ([ordered]@{ schemaVersion = 'atlas-nfc-helper-trust-v1'; purpose = 'atlas-program-approved-report-url-v1';
    keys = [ordered]@{ current = $Current; prior = $Prior } } | ConvertTo-Json -Depth 5 -Compress)
}
$entry = New-PublicEntry -Base64 $publicSpki
$trust = New-Trust -Current $entry
$config = [pscustomobject]@{
  schemaVersion = 'tenkings-ai-grader-nfc-helper-config-v3'
  workstationToken = ('L' * 43)
  workstationKeyId = ('a' * 64)
  goToTagsExecutablePath = 'synthetic-not-opened'
}
$names = @('ATLAS_NFC_SERVER_JOB_PUBLIC_KEYS_JSON', 'ATLAS_NFC_WORKSTATION_TOKEN')
$caller = @{}
foreach ($name in $names) {
  $caller[$name] = [Environment]::GetEnvironmentVariable($name, [EnvironmentVariableTarget]::Process)
  [Environment]::SetEnvironmentVariable($name, $null, [EnvironmentVariableTarget]::Process)
}
try {
  $before = $config | ConvertTo-Json -Depth 5 -Compress
  Assert-True (-not (Assert-AtlasNfcConfig -Config $config)) 'Absent fields enabled ATLAS.'
  Invoke-NfcWithAtlasEnvironment -Config $config -Action {
    foreach ($name in $names) {
      Assert-True ($null -eq [Environment]::GetEnvironmentVariable($name)) 'Disabled config exported ATLAS.'
    }
  }
  Assert-True (($config | ConvertTo-Json -Depth 5 -Compress) -ceq $before) 'Validation mutated legacy config.'
  [Environment]::SetEnvironmentVariable($names[0], $trust)
  $script:actionRan = $false
  Assert-Throws { Invoke-NfcWithAtlasEnvironment -Config $config -Action { $script:actionRan = $true } } 'Unmanaged disabled trust accepted.'
  Assert-True (-not $script:actionRan) 'Disabled configuration ran with inherited trust.'
  Assert-True ([Environment]::GetEnvironmentVariable($names[0]) -ceq $trust) 'Rejected inherited trust was altered.'
  [Environment]::SetEnvironmentVariable($names[0], $null)
  [Environment]::SetEnvironmentVariable($names[1], ('A' * 43))
  Assert-Throws { Invoke-NfcWithAtlasEnvironment -Config $config -Action { $script:actionRan = $true } } 'Unmanaged disabled token accepted.'
  Assert-True (-not $script:actionRan) 'Disabled configuration ran with inherited token.'
  [Environment]::SetEnvironmentVariable($names[1], $null)
  Set-NfcConfigProperty -Config $config -Name atlasNfcEnabled -Value 'false'
  Assert-Throws { Assert-AtlasNfcConfig -Config $config } 'String enabled flag accepted.'
  $config.atlasNfcEnabled = $true
  Assert-Throws { Assert-AtlasNfcConfig -Config $config } 'Missing enabled credentials accepted.'
  Set-NfcConfigProperty -Config $config -Name atlasNfcServerJobPublicKeysJson -Value $trust
  Set-NfcConfigProperty -Config $config -Name atlasNfcWorkstationToken -Value ('A' * 43)
  Assert-True (Assert-AtlasNfcConfig -Config $config) 'Exact valid dedicated configuration rejected.'
  $before = $config | ConvertTo-Json -Depth 5 -Compress
  $result = Invoke-NfcWithAtlasEnvironment -Config $config -ArgumentList @('sentinel') -Action {
    param($argument)
    Assert-True ([Environment]::GetEnvironmentVariable($names[0]) -ceq $trust) 'Trust bytes changed during export.'
    Assert-True ([Environment]::GetEnvironmentVariable($names[1]) -ceq ('A' * 43)) 'Token bytes changed during export.'
    return $argument
  }
  Assert-True ($result -ceq 'sentinel') 'Action return value was lost.'
  foreach ($name in $names) { Assert-True ($null -eq [Environment]::GetEnvironmentVariable($name)) 'New scoped environment leaked.' }
  Assert-Throws { Invoke-NfcWithAtlasEnvironment -Config $config -Action { throw 'synthetic failure' } } 'Action failure was lost.'
  foreach ($name in $names) { Assert-True ($null -eq [Environment]::GetEnvironmentVariable($name)) 'Failure leaked environment.' }
  [Environment]::SetEnvironmentVariable($names[0], $trust)
  [Environment]::SetEnvironmentVariable($names[1], ('A' * 43))
  Invoke-NfcWithAtlasEnvironment -Config $config -Action { }
  Assert-Throws { Invoke-NfcWithAtlasEnvironment -Config $config -Action { throw 'synthetic failure with existing environment' } } 'Inherited action failure was lost.'
  Assert-True ([Environment]::GetEnvironmentVariable($names[0]) -ceq $trust) 'Exact inherited trust not restored.'
  Assert-True ([Environment]::GetEnvironmentVariable($names[1]) -ceq ('A' * 43)) 'Exact inherited token not restored.'
  [Environment]::SetEnvironmentVariable($names[1], ('B' * 43))
  $script:actionRan = $false
  Assert-Throws { Invoke-NfcWithAtlasEnvironment -Config $config -Action { $script:actionRan = $true } } 'Mismatched inherited token accepted.'
  Assert-True (-not $script:actionRan) 'Action ran with unmanaged environment.'
  Assert-True ([Environment]::GetEnvironmentVariable($names[1]) -ceq ('B' * 43)) 'Rejected caller environment changed.'
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $null) }
  Assert-True (($config | ConvertTo-Json -Depth 5 -Compress) -ceq $before) 'Enabled validation mutated config.'
  foreach ($invalidToken in @(('A' * 42), ('A' * 193), (('A' * 43) + "`n"), $config.workstationToken)) {
    $config.atlasNfcWorkstationToken = $invalidToken
    Assert-Throws { Assert-AtlasNfcConfig -Config $config } 'Invalid or legacy-alias token accepted.'
  }
  $config.atlasNfcWorkstationToken = 'A' * 43
  $config.workstationKeyId = $entry.keyId
  Assert-Throws { Assert-AtlasNfcConfig -Config $config } 'Workstation signing identity accepted as server authority.'
  $config.workstationKeyId = 'a' * 64
  $config.schemaVersion = 'tenkings-ai-grader-nfc-helper-config-v4'
  Set-NfcConfigProperty -Config $config -Name tenKingsV2ServerJobPublicKeysJson -Value (([ordered]@{ current = $entry; prior = $null }) | ConvertTo-Json -Depth 5 -Compress)
  Assert-Throws { Assert-AtlasNfcConfig -Config $config } 'Legacy signing identity accepted as ATLAS authority.'
  $config.schemaVersion = 'tenkings-ai-grader-nfc-helper-config-v3'
  foreach ($badTrust in @(
      $trust.Replace('atlas-program-approved-report-url-v1', 'ten-kings-v2-f8215-static-url-v1'),
      $trust.Replace('"keys":', '"purpose":"atlas-program-approved-report-url-v1","keys":'),
      $trust.Replace('"prior":null', '"prior":null,"prior":null'),
      $trust.Replace('"keyId":', '"algorithm":"ecdsa-p256-sha256-p1363","keyId":'),
      $trust.Replace('"prior":null', '"prior":null,'),
      ('/*comment*/' + $trust), $trust.Replace('"keys"', '"\u006beys"'),
      (New-Trust -Current $entry -Prior $entry), ($trust + (' ' * 4096)))) {
    Assert-Throws { Assert-AtlasNfcServerTrustJson -Value $badTrust } 'Malformed, duplicate, wrong-domain, or oversized trust accepted.'
  }
  $badPoint = [Convert]::FromBase64String($publicSpki)
  $badPoint[90] = $badPoint[90] -bxor 1
  $invalidEntry = New-PublicEntry -Base64 ([Convert]::ToBase64String($badPoint))
  Assert-Throws { Assert-AtlasNfcServerTrustJson -Value (New-Trust -Current $invalidEntry) } 'Off-curve point with matching SHA accepted.'
  $badPoint[23] = 8
  $invalidEntry = New-PublicEntry -Base64 ([Convert]::ToBase64String($badPoint))
  Assert-Throws { Assert-AtlasNfcServerTrustJson -Value (New-Trust -Current $invalidEntry) } 'Wrong curve with matching SHA accepted.'
  $config.atlasNfcEnabled = $false
  $config.atlasNfcServerJobPublicKeysJson = 'retained-disabled-settings'
  Assert-True (-not (Assert-AtlasNfcConfig -Config $config)) 'Explicit disable was ignored.'
  Invoke-NfcWithAtlasEnvironment -Config $config -Action {
    foreach ($name in $names) { Assert-True ($null -eq [Environment]::GetEnvironmentVariable($name)) 'Disabled retained credential exported.' }
  }
  [pscustomobject]@{ ok = $true; assertions = $script:assertions; helperStarted = $false; hardwareAccessed = $false; configWritten = $false } | ConvertTo-Json
} finally {
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $caller[$name], [EnvironmentVariableTarget]::Process) }
}
