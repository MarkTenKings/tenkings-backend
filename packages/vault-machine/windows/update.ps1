param(
  [Parameter(Mandatory=$true)][string]$ReleaseDirectory,
  [Parameter(Mandatory=$true)][string]$ManifestPath,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ManifestSha256,
  [string]$InstallRoot = 'C:\Program Files\Ten Kings\Vault Machine',
  [switch]$Activate
)
$ErrorActionPreference = 'Stop'
if ($Activate) { throw 'Activation is not implemented: it requires a trusted service maintenance barrier, completed/reconciled transactions, verified backup, compatible schema and state-aware rollback. The running installation has not been changed.' }
& (Join-Path $PSScriptRoot 'install.ps1') -ReleaseDirectory $ReleaseDirectory -ManifestPath $ManifestPath -ManifestSha256 $ManifestSha256 -InstallRoot $InstallRoot
