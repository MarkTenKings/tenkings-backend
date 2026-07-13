[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
dotnet restore (Join-Path $root 'TenKings.AiGrader.NativeCamera.sln') --configfile (Join-Path $root 'NuGet.config') --locked-mode
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
