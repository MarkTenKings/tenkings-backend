param(
  [Parameter(Mandatory=$true)][string]$ReleaseDirectory,
  [Parameter(Mandatory=$true)][string]$ManifestPath,
  [string]$InstallRoot = 'C:\Program Files\Ten Kings\Vault Machine'
)
$ErrorActionPreference = 'Stop'
$service = Get-Service -Name 'TenKingsVaultMachine' -ErrorAction Stop
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
foreach ($file in $manifest.files) {
  $path = Join-Path $ReleaseDirectory ([string]$file.path)
  if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne ([string]$file.sha256).ToLowerInvariant()) { throw "Digest mismatch: $($file.path)" }
}
$release = Join-Path $InstallRoot ('releases\' + [string]$manifest.version)
if (Test-Path -LiteralPath $release) { throw 'Target release already exists.' }
New-Item -ItemType Directory -Path $release -Force | Out-Null
Copy-Item -Path (Join-Path $ReleaseDirectory '*') -Destination $release -Recurse
Stop-Service -InputObject $service
$current = Join-Path $InstallRoot 'current'; $previous = Join-Path $InstallRoot 'previous'
if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Force }
Rename-Item -LiteralPath $current -NewName 'previous'
New-Item -ItemType Junction -Path $current -Target $release | Out-Null
Start-Service -Name 'TenKingsVaultMachine'
Write-Output "Activated verified release $($manifest.version); previous release retained for rollback."
