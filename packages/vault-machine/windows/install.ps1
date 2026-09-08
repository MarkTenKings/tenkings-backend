param(
  [Parameter(Mandatory=$true)][string]$ReleaseDirectory,
  [Parameter(Mandatory=$true)][string]$ManifestPath,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ManifestSha256,
  [string]$InstallRoot = 'C:\Program Files\Ten Kings\Vault Machine'
)
$ErrorActionPreference = 'Stop'
# Source-artifact staging only. No current pointer, service, database or credential is changed.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator authority is required.' }
$validator = Join-Path $PSScriptRoot 'verify-release.cjs'
$verifiedJson = & node $validator $ReleaseDirectory $ManifestPath $ManifestSha256
if ($LASTEXITCODE -ne 0) { throw 'Release validation failed. Nothing was staged.' }
$manifest = $verifiedJson | ConvertFrom-Json
$root = [IO.Path]::GetFullPath($InstallRoot)
if ($root -eq [IO.Path]::GetPathRoot($root)) { throw 'Install root cannot be a drive root.' }
$ancestor = $root
while ($ancestor) {
  if (Test-Path -LiteralPath $ancestor) {
    if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Install ancestors cannot be reparse points.' }
  }
  $ancestor = Split-Path -Parent $ancestor
}
$stagingRoot = Join-Path $root 'staged'
if ((Test-Path -LiteralPath $stagingRoot) -and ((Get-Item -LiteralPath $stagingRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Staging root cannot be a reparse point.' }
$release = Join-Path $stagingRoot ([string]$manifest.version)
if (Test-Path -LiteralPath $release) { throw 'Staged release already exists; staging is create-only.' }
New-Item -ItemType Directory -Path $release -Force | Out-Null
foreach ($file in $manifest.files) {
  $source = Join-Path $ReleaseDirectory ([string]$file.path)
  $destination = Join-Path $release ([string]$file.path)
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
}
# Recheck the bytes actually copied before declaring staging successful.
& node $validator $release $ManifestPath $ManifestSha256 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Staged verification failed; retain $release for inspection. It has not been activated." }
Write-Output "Verified release $($manifest.version) staged at $release. Activation is unavailable until the state-aware Windows installer, verified backup/restore and service-registration integration are implemented and qualified."
