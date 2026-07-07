[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-local-bridge.json",
  [string]$TaskName = "TenKingsAiGraderLocalBridge",
  [string]$ChromeUserDataDir = "C:\TenKings\chrome-ai-grader-profile",
  [switch]$RestartBridge
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-local-bridge-common.ps1")

function Get-AiGraderChromePath {
  $candidateRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)
  foreach ($root in $candidateRoots) {
    if ([string]::IsNullOrWhiteSpace($root)) {
      continue
    }
    $candidate = Join-Path $root "Google\Chrome\Application\chrome.exe"
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  $pathCommand = Get-Command "chrome.exe" -ErrorAction SilentlyContinue
  if ($pathCommand -and -not [string]::IsNullOrWhiteSpace($pathCommand.Source)) {
    return $pathCommand.Source
  }

  throw "Google Chrome was not found. Install Chrome or add chrome.exe to PATH before opening the AI Grader Station shortcut."
}

function Quote-AiGraderProcessArgument {
  param([Parameter(Mandatory = $true)][string]$Value)
  if ($Value -match '[\s"]') {
    return '"' + ($Value -replace '"', '\"') + '"'
  }
  return $Value
}

function Open-AiGraderStationChrome {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$UserDataDir,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )

  if (-not (Test-Path -LiteralPath $UserDataDir)) {
    New-Item -ItemType Directory -Path $UserDataDir -Force | Out-Null
  }

  $chromePath = Get-AiGraderChromePath
  $chromeArgs = @(
    "--user-data-dir=$UserDataDir",
    "--new-window",
    $Url
  ) | ForEach-Object { Quote-AiGraderProcessArgument -Value $_ }

  Start-Process -FilePath $chromePath -ArgumentList $chromeArgs -WorkingDirectory $WorkingDirectory | Out-Null
  return $chromePath
}

$repoRoot = Get-AiGraderRepoRoot
$config = Initialize-AiGraderBridgeConfig -Path $ConfigPath -Mode "real" -RotatePairingCode

if ($RestartBridge) {
  & (Join-Path $PSScriptRoot "stop-local-station-bridge.ps1") -TaskName $TaskName -KillProcess | Out-Null
}

$health = Get-AiGraderBridgeHealth -BridgeUrl ([string]$config.bridgeUrl)
if (-not $health) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Start-ScheduledTask -TaskName $TaskName
  } else {
    $startScript = Join-Path $repoRoot "scripts\ai-grader\start-local-station-bridge.ps1"
    $args = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -Real -ConfigPath `"$ConfigPath`""
    Start-Process -FilePath "powershell.exe" -ArgumentList $args -WindowStyle Hidden -WorkingDirectory $repoRoot
  }
  Start-Sleep -Seconds 3
}

$pairingUrl = Get-AiGraderBridgePairingUrl -Config $config
$chromePath = Open-AiGraderStationChrome -Url $pairingUrl -UserDataDir $ChromeUserDataDir -WorkingDirectory $repoRoot

[pscustomobject]@{
  ok = $true
  opened = $script:AiGraderStationUrl
  browser = "Google Chrome"
  chromeProfileDir = $ChromeUserDataDir
  chromePath = $chromePath
  bridgeUrl = $config.bridgeUrl
  pairingCodeRedacted = $true
  pairingFingerprint = Get-AiGraderSecretFingerprint -Value ([string]$config.pairingCode)
  pairingExpiresAt = $config.pairingCodeExpiresAt
} | ConvertTo-Json -Compress
