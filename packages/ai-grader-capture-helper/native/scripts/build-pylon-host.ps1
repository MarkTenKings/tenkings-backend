[CmdletBinding()]
param(
    [string] $PylonAssemblyPath,
    [string] $PylonSdkRoot
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$resolver = Join-Path $PSScriptRoot 'resolve-pylon-managed-assembly.ps1'
. $resolver
$resolvedPylonAssembly = Resolve-PylonManagedAssembly $PylonAssemblyPath $PylonSdkRoot
$project = Join-Path $root 'src\TenKings.AiGrader.Pylon.Host\TenKings.AiGrader.Pylon.Host.csproj'
$arguments = @(
    'build', $project,
    '--configuration', 'Release',
    '--no-restore',
    '-p:EnablePylonCompile=true',
    "-p:PylonAssemblyPath=$resolvedPylonAssembly",
    '-warnaserror',
    '--disable-build-servers',
    '-m:1'
)

# Compile only. This script never starts the host or touches a camera.
dotnet @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
