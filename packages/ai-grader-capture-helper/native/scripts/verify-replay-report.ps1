[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$replayAssembly = Join-Path $root 'src\TenKings.AiGrader.Replay\bin\Release\net8.0\win-x64\TenKings.AiGrader.Replay.dll'
$manifest = Join-Path $root 'fixtures\synthetic-manifest.json'
$baseline = Join-Path $root 'reports\synthetic-baseline.json'

# Deterministic fake/synthetic replay only. This script contains no Pylon host,
# SDK, camera, light-controller, network, or production integration path.
if (-not (Test-Path -LiteralPath $replayAssembly -PathType Leaf)) {
    throw 'replay_release_assembly_missing'
}

# Reuse the exact output produced by the preceding warning-as-error solution
# build. Project-based `dotnet run --no-build -p:Platform=x64` incorrectly looks
# under bin/x64/Release on a fresh runner although the solution emits bin/Release.
dotnet $replayAssembly --manifest $manifest --verify-baseline $baseline
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
