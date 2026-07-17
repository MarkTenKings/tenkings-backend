[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
. (Join-Path $repoRoot "scripts\ai-grader-nfc\ai-grader-nfc-helper-common.ps1")

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$fixtureProject = Join-Path $PSScriptRoot "fixtures\NfcBuildVerificationFixture\NfcBuildVerificationFixture.csproj"
$root = Join-Path ([IO.Path]::GetTempPath()) ("tenkings-nfc-versioned-update-" + [Guid]::NewGuid().ToString("N"))
$published = Join-Path $root "fixture"

function New-VersionedInstall([string]$Path, [string]$Version) {
  New-Item -ItemType Directory -Path $Path -ErrorAction Stop | Out-Null
  Copy-Item -Path (Join-Path $published "*") -Destination $Path -Recurse -Force -ErrorAction Stop
  Set-Content -LiteralPath (Join-Path $Path "helper-version.txt") -Value $Version -NoNewline -Encoding ascii
}

function Invoke-ReplacementScenario {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$PriorVersion,
    [Parameter(Mandatory = $true)][string]$ReplacementVersion,
    [switch]$InjectActivationFailure
  )
  $scenarioRoot = Join-Path $root $Name
  $install = Join-Path $scenarioRoot "install"
  $staging = Join-Path $scenarioRoot "staging"
  $backup = Join-Path $scenarioRoot "backup"
  New-Item -ItemType Directory -Path $scenarioRoot -ErrorAction Stop | Out-Null
  New-VersionedInstall -Path $install -Version $PriorVersion
  New-VersionedInstall -Path $staging -Version $ReplacementVersion
  $dllName = "NfcBuildVerificationFixture.dll"
  $capturedPrior = Invoke-NfcBuildVerification -DllPath (Join-Path $install $dllName) -AllowedHelperVersion @($script:NfcHelperVersionV2, $script:NfcHelperVersionV3)
  Assert-True ($capturedPrior -ceq $PriorVersion) "$Name did not capture the exact prior helper version."

  $failed = $false
  try {
    Invoke-NfcInstallDirectoryReplacement `
      -InstallDirectory $install `
      -StagingDirectory $staging `
      -BackupDirectory $backup `
      -AllowedRoot $scenarioRoot `
      -ValidateReplacement {
        param($activated)
        Invoke-NfcBuildVerification -DllPath (Join-Path $activated $dllName) -AllowedHelperVersion @($script:NfcHelperVersionV3) | Out-Null
        if ($InjectActivationFailure) { throw "injected activation/readiness failure" }
      } `
      -AfterRollback {
        param($restored)
        Invoke-NfcBuildVerification -DllPath (Join-Path $restored $dllName) -AllowedHelperVersion @($capturedPrior) | Out-Null
      }
  } catch {
    $failed = $true
    if (-not $InjectActivationFailure -or $_.Exception.Message -notmatch "prior working install was restored") { throw }
  }

  $actual = Invoke-NfcBuildVerification -DllPath (Join-Path $install $dllName) -AllowedHelperVersion @(
    $(if ($InjectActivationFailure) { $PriorVersion } else { $ReplacementVersion })
  )
  Assert-True ($actual -ceq $(if ($InjectActivationFailure) { $PriorVersion } else { $ReplacementVersion })) "$Name ended at the wrong helper version."
  Assert-True ($failed -eq [bool]$InjectActivationFailure) "$Name returned the wrong replacement outcome."
  return [pscustomobject]@{ name = $Name; prior = $capturedPrior; final = $actual; rolledBack = $failed }
}

try {
  New-Item -ItemType Directory -Path $root -ErrorAction Stop | Out-Null
  & dotnet publish $fixtureProject --configuration Release --self-contained false --output $published | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "The versioned update fixture did not publish." }

  $results = @(
    Invoke-ReplacementScenario -Name "v2-to-v3-success" -PriorVersion $script:NfcHelperVersionV2 -ReplacementVersion $script:NfcHelperVersionV3
    Invoke-ReplacementScenario -Name "v2-to-v3-rollback" -PriorVersion $script:NfcHelperVersionV2 -ReplacementVersion $script:NfcHelperVersionV3 -InjectActivationFailure
    Invoke-ReplacementScenario -Name "v3-to-v3-idempotent" -PriorVersion $script:NfcHelperVersionV3 -ReplacementVersion $script:NfcHelperVersionV3
  )
  [pscustomobject]@{
    ok = $true
    filesystemReplacementExecuted = $true
    scenarios = $results
    hardwareAccessed = $false
    productionKeyAccessed = $false
  } | ConvertTo-Json -Depth 5
} finally {
  if (Test-Path -LiteralPath $root) {
    Remove-NfcSafeTree -Path $root -AllowedRoot (Get-NfcCanonicalPath -Path ([IO.Path]::GetTempPath()))
  }
}
