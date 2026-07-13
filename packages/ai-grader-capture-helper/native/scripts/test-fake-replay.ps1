[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'restore-locked.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
dotnet test (Join-Path $root 'TenKings.AiGrader.NativeCamera.sln') --no-restore --configuration Release --disable-build-servers -m:1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
