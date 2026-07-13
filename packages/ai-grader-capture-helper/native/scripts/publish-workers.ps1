[CmdletBinding()]
param(
    [string] $OutputRoot,
    [switch] $CompilePylon,
    [string] $PylonAssemblyPath,
    [string] $PylonSdkRoot
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $root 'publish'
}
$output = [System.IO.Path]::GetFullPath($OutputRoot)
$rootPrefix = [System.IO.Path]::GetFullPath($root).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $output.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Package output must remain under the native project root.'
}

& (Join-Path $PSScriptRoot 'restore-locked.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$worker = Join-Path $root 'src\TenKings.AiGrader.Worker.Host\TenKings.AiGrader.Worker.Host.csproj'
dotnet publish $worker --configuration Release --runtime win-x64 --no-restore --self-contained false --output (Join-Path $output 'fake-replay') --disable-build-servers -m:1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($CompilePylon) {
    $pylon = Join-Path $root 'src\TenKings.AiGrader.Pylon.Host\TenKings.AiGrader.Pylon.Host.csproj'
    $arguments = @(
        'publish', $pylon,
        '--configuration', 'Release',
        '--runtime', 'win-x64',
        '--no-restore',
        '--self-contained', 'false',
        '--output', (Join-Path $output 'pylon'),
        '-p:EnablePylonCompile=true',
        '--disable-build-servers',
        '-m:1'
    )
    if (-not [string]::IsNullOrWhiteSpace($PylonAssemblyPath)) {
        $arguments += "-p:PylonAssemblyPath=$PylonAssemblyPath"
    }
    if (-not [string]::IsNullOrWhiteSpace($PylonSdkRoot)) {
        $arguments += "-p:PylonSdkRoot=$PylonSdkRoot"
    }

    # Compile/package only. The Pylon host is never started by this script.
    dotnet @arguments
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
