[CmdletBinding()]
param(
    [string] $PylonAssemblyPath,
    [string] $PylonSdkRoot
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'src\TenKings.AiGrader.Pylon.Host\TenKings.AiGrader.Pylon.Host.csproj'
$arguments = @('build', $project, '--configuration', 'Release', '--no-restore', '-p:EnablePylonCompile=true', '--disable-build-servers', '-m:1')
if (-not [string]::IsNullOrWhiteSpace($PylonAssemblyPath)) {
    $arguments += "-p:PylonAssemblyPath=$PylonAssemblyPath"
}
if (-not [string]::IsNullOrWhiteSpace($PylonSdkRoot)) {
    $arguments += "-p:PylonSdkRoot=$PylonSdkRoot"
}

# Compile only. This script never starts the host or touches a camera.
dotnet @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
