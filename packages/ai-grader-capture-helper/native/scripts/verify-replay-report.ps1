[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'src\TenKings.AiGrader.Replay\TenKings.AiGrader.Replay.csproj'
$manifest = Join-Path $root 'fixtures\synthetic-manifest.json'
$baseline = Join-Path $root 'reports\synthetic-baseline.json'

# Deterministic fake/synthetic replay only. This script contains no Pylon host,
# SDK, camera, light-controller, network, or production integration path.
dotnet run --no-build --configuration Release -p:Platform=x64 --project $project -- --manifest $manifest --verify-baseline $baseline
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
