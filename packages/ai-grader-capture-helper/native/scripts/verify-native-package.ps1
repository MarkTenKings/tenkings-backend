[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $OutputRoot,
    [switch] $RequirePylon,
    [string] $PylonAssemblyPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $root '..\..\..'))
$output = [System.IO.Path]::GetFullPath($OutputRoot)
$publishRoot = [System.IO.Path]::GetFullPath((Join-Path $root 'publish')).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$publishPrefix = $publishRoot + [System.IO.Path]::DirectorySeparatorChar
if (-not $output.Equals($publishRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
    -not $output.StartsWith($publishPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Package verification output must remain under the ignored native/publish tree.'
}

function Require-File {
    param([string] $Path, [string] $Code)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw $Code
    }
}

function Require-OpenCv {
    param([string] $HostRoot, [string] $DependencyFile)
    Require-File (Join-Path $HostRoot 'OpenCvSharp.dll') 'package_opencv_managed_missing'
    $native = @(Get-ChildItem -LiteralPath $HostRoot -Recurse -File -Filter 'OpenCvSharpExtern.dll')
    if ($native.Count -ne 1) {
        throw 'package_opencv_native_missing_or_duplicated'
    }
    $deps = [System.IO.File]::ReadAllText($DependencyFile)
    if ($deps.IndexOf('OpenCvSharp4/4.11.0.20250507', [System.StringComparison]::Ordinal) -lt 0) {
        throw 'package_opencv_dependency_version_unrepresented'
    }
}

$fakeRoot = Join-Path $output 'fake-replay'
$fakeBase = Join-Path $fakeRoot 'tenkings-ai-grader-native-worker'
Require-File ($fakeBase + '.exe') 'package_fake_host_exe_missing'
Require-File ($fakeBase + '.dll') 'package_fake_host_dll_missing'
Require-File ($fakeBase + '.deps.json') 'package_fake_host_deps_missing'
Require-File ($fakeBase + '.runtimeconfig.json') 'package_fake_host_runtimeconfig_missing'
Require-OpenCv $fakeRoot ($fakeBase + '.deps.json')

if ($RequirePylon) {
    if ([string]::IsNullOrWhiteSpace($PylonAssemblyPath) -or
        -not (Test-Path -LiteralPath $PylonAssemblyPath -PathType Leaf)) {
        throw 'package_pylon_source_managed_dependency_missing'
    }
    $pylonRoot = Join-Path $output 'pylon'
    $pylonBase = Join-Path $pylonRoot 'tenkings-ai-grader-pylon-worker'
    Require-File ($pylonBase + '.exe') 'package_pylon_host_exe_missing'
    Require-File ($pylonBase + '.dll') 'package_pylon_host_dll_missing'
    Require-File ($pylonBase + '.deps.json') 'package_pylon_host_deps_missing'
    Require-File ($pylonBase + '.runtimeconfig.json') 'package_pylon_host_runtimeconfig_missing'
    Require-OpenCv $pylonRoot ($pylonBase + '.deps.json')
    $publishedBasler = Join-Path $pylonRoot 'Basler.Pylon.dll'
    Require-File $publishedBasler 'package_basler_managed_missing'
    Require-File (Join-Path $pylonRoot 'native-dependencies.json') 'package_dependency_manifest_missing'
    $sourceHash = (Get-FileHash -LiteralPath $PylonAssemblyPath -Algorithm SHA256).Hash
    $publishedHash = (Get-FileHash -LiteralPath $publishedBasler -Algorithm SHA256).Hash
    if (-not $sourceHash.Equals($publishedHash, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'package_basler_managed_hash_mismatch'
    }
    $dependencyManifest = Get-Content -LiteralPath (Join-Path $pylonRoot 'native-dependencies.json') -Raw | ConvertFrom-Json
    if ($dependencyManifest.schema -ne 'tenkings.ai-grader.native-package-dependencies.v1' -or
        [string]::IsNullOrWhiteSpace($dependencyManifest.dependencies.baslerManaged.managedFileVersion) -or
        $dependencyManifest.dependencies.baslerManaged.sha256 -ne $publishedHash.ToLowerInvariant() -or
        $dependencyManifest.dependencies.openCvSharp.packageVersion -ne '4.11.0.20250507') {
        throw 'package_dependency_manifest_invalid'
    }
}

# Static repository check only: do not invoke, reflect over, or load either host
# or any SDK assembly. No PE/DLL may be tracked under native source.
$tracked = @(git -C $repositoryRoot ls-files -- 'packages/ai-grader-capture-helper/native')
if ($LASTEXITCODE -ne 0) {
    throw 'package_git_tracking_check_failed'
}
$trackedProprietary = @($tracked | Where-Object {
    $_ -match '(?i)\.(dll|exe|lib|so|dylib)$'
})
if ($trackedProprietary.Count -ne 0) {
    throw 'package_tracked_proprietary_binary_detected'
}

[ordered]@{
    ok = $true
    schema = 'tenkings.ai-grader.native-package-verification.v1'
    pylonIncluded = [bool]$RequirePylon
    sdkHostExecuted = $false
    sdkAssemblyLoaded = $false
    proprietaryBinariesTracked = 0
} | ConvertTo-Json -Compress
