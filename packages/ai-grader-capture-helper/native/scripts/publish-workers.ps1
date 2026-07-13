[CmdletBinding()]
param(
    [string] $OutputRoot,
    [switch] $CompilePylon,
    [string] $PylonAssemblyPath,
    [string] $PylonSdkRoot
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$resolver = Join-Path $PSScriptRoot 'resolve-pylon-managed-assembly.ps1'
. $resolver
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $root 'publish'
}
$output = [System.IO.Path]::GetFullPath($OutputRoot)
$publishRoot = [System.IO.Path]::GetFullPath((Join-Path $root 'publish')).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$publishPrefix = $publishRoot + [System.IO.Path]::DirectorySeparatorChar
if (-not $output.Equals($publishRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
    -not $output.StartsWith($publishPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Package output must remain under the ignored native/publish tree.'
}

# Deterministic packaging owns only this already-bounded ignored output tree.
if (Test-Path -LiteralPath $output) {
    Remove-Item -LiteralPath $output -Recurse -Force
}
[void](New-Item -ItemType Directory -Path $output)

& (Join-Path $PSScriptRoot 'restore-locked.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$workerOutput = Join-Path $output 'fake-replay'
$worker = Join-Path $root 'src\TenKings.AiGrader.Worker.Host\TenKings.AiGrader.Worker.Host.csproj'
dotnet publish $worker --configuration Release --runtime win-x64 --no-restore --self-contained false --output $workerOutput -warnaserror --disable-build-servers -m:1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$resolvedPylonAssembly = $null
if ($CompilePylon) {
    $resolvedPylonAssembly = Resolve-PylonManagedAssembly $PylonAssemblyPath $PylonSdkRoot
    $pylonOutput = Join-Path $output 'pylon'
    $pylon = Join-Path $root 'src\TenKings.AiGrader.Pylon.Host\TenKings.AiGrader.Pylon.Host.csproj'
    $arguments = @(
        'publish', $pylon,
        '--configuration', 'Release',
        '--runtime', 'win-x64',
        '--no-restore',
        '--self-contained', 'false',
        '--output', $pylonOutput,
        '-p:EnablePylonCompile=true',
        "-p:PylonAssemblyPath=$resolvedPylonAssembly",
        '-warnaserror',
        '--disable-build-servers',
        '-m:1'
    )

    # Compile/package only. Neither the Pylon host nor a managed SDK type is loaded.
    dotnet @arguments
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $publishedBasler = Join-Path $pylonOutput 'Basler.Pylon.dll'
    Copy-Item -LiteralPath $resolvedPylonAssembly -Destination $publishedBasler -Force
    $manifest = [ordered]@{
        schema = 'tenkings.ai-grader.native-package-dependencies.v1'
        host = 'tenkings-ai-grader-pylon-worker'
        architecture = 'win-x64'
        dependencies = [ordered]@{
            baslerManaged = [ordered]@{
                file = 'Basler.Pylon.dll'
                managedFileVersion = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($publishedBasler).FileVersion
                sha256 = (Get-FileHash -LiteralPath $publishedBasler -Algorithm SHA256).Hash.ToLowerInvariant()
                sourceSha256 = (Get-FileHash -LiteralPath $resolvedPylonAssembly -Algorithm SHA256).Hash.ToLowerInvariant()
                nativeRuntime = 'installed-licensed-pylon-runtime-required'
            }
            openCvSharp = [ordered]@{
                packageVersion = '4.11.0.20250507'
                managedFile = 'OpenCvSharp.dll'
                nativeFile = 'OpenCvSharpExtern.dll'
            }
        }
    }
    $manifestJson = $manifest | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText(
        (Join-Path $pylonOutput 'native-dependencies.json'),
        $manifestJson + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false))
}

$verifyArguments = @{
    OutputRoot = $output
}
if ($CompilePylon) {
    $verifyArguments.RequirePylon = $true
    $verifyArguments.PylonAssemblyPath = $resolvedPylonAssembly
}
& (Join-Path $PSScriptRoot 'verify-native-package.ps1') @verifyArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
