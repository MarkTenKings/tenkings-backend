param(
  [Parameter(Mandatory=$true)][string]$ReleaseDirectory,
  [Parameter(Mandatory=$true)][string]$ManifestPath,
  [string]$InstallRoot = 'C:\Program Files\Ten Kings\Vault Machine'
)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator authority is required.' }
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
foreach ($file in $manifest.files) {
  $path = Join-Path $ReleaseDirectory ([string]$file.path)
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Release member missing: $($file.path)" }
  $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne ([string]$file.sha256).ToLowerInvariant()) { throw "Digest mismatch: $($file.path)" }
}
$release = Join-Path $InstallRoot ('releases\' + [string]$manifest.version)
if (Test-Path -LiteralPath $release) { throw 'Release already exists; install is create-only.' }
New-Item -ItemType Directory -Path $release -Force | Out-Null
Copy-Item -Path (Join-Path $ReleaseDirectory '*') -Destination $release -Recurse
$current = Join-Path $InstallRoot 'current'
if (Test-Path -LiteralPath $current) { throw 'Current release exists; use update.ps1.' }
New-Item -ItemType Junction -Path $current -Target $release | Out-Null
Write-Output "Installed verified release $($manifest.version). Service registration requires separately reviewed WinSW binary and explicit operator action."
