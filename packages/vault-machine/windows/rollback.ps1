param([string]$InstallRoot = 'C:\Program Files\Ten Kings\Vault Machine')
$ErrorActionPreference = 'Stop'
$current = Join-Path $InstallRoot 'current'; $previous = Join-Path $InstallRoot 'previous'; $failed = Join-Path $InstallRoot ('failed-' + (Get-Date -Format 'yyyyMMddHHmmss'))
if (-not (Test-Path -LiteralPath $previous)) { throw 'No retained previous release exists.' }
Stop-Service -Name 'TenKingsVaultMachine'
Rename-Item -LiteralPath $current -NewName (Split-Path -Leaf $failed)
Rename-Item -LiteralPath $previous -NewName 'current'
Start-Service -Name 'TenKingsVaultMachine'
Write-Output 'Rollback activated. Failed release preserved for evidence.'
