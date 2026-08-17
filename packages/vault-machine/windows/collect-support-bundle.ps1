param(
  [string]$InstallRoot = 'C:\Program Files\Ten Kings\Vault Machine',
  [string]$OutputRoot = 'C:\ProgramData\Ten Kings\Vault\support'
)
$ErrorActionPreference = 'Stop'
$bundle = Join-Path $OutputRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Path $bundle -Force | Out-Null
$service = Get-CimInstance Win32_Service -Filter "Name='TenKingsVaultMachine'" | Select-Object Name,State,StartMode,ExitCode,ProcessId
$service | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bundle 'service.json') -Encoding UTF8
Get-ComputerInfo | Select-Object WindowsProductName,WindowsVersion,OsBuildNumber,OsArchitecture | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bundle 'windows.json') -Encoding UTF8
$members = Get-ChildItem -LiteralPath $bundle -File | ForEach-Object { [pscustomobject]@{ file=$_.Name; size=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } }
[pscustomobject]@{ schemaVersion=1; createdAt=(Get-Date).ToUniversalTime().ToString('o'); exclusions=@('SQLite database','credentials','PIN verifiers','provider payloads','cookies'); files=$members } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $bundle 'manifest.json') -Encoding UTF8
Compress-Archive -LiteralPath $bundle -DestinationPath ($bundle + '.zip')
Write-Output ($bundle + '.zip')
