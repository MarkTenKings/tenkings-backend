[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [string]$TaskName = "TenKingsAiGraderNfcHelper"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

$script:NfcChromeUserDataDir = "C:\TenKings\chrome-ai-grader-profile"

function Get-NfcChromePath {
  $candidateRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)
  foreach ($root in $candidateRoots) {
    if ([string]::IsNullOrWhiteSpace($root)) { continue }
    $candidate = Join-Path $root "Google\Chrome\Application\chrome.exe"
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }

  $pathCommand = Get-Command "chrome.exe" -ErrorAction SilentlyContinue
  if ($pathCommand -and -not [string]::IsNullOrWhiteSpace([string]$pathCommand.Source)) {
    return [string]$pathCommand.Source
  }

  throw "Google Chrome was not found. Install Chrome before opening the AI Grader NFC workstation shortcut."
}

function Quote-NfcProcessArgument {
  param([Parameter(Mandatory = $true)][string]$Value)
  if ($Value -match '[\s"]') {
    return '"' + ($Value -replace '"', '\"') + '"'
  }
  return $Value
}

function Open-NfcWorkstationChrome {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )

  $profilePath = Get-NfcCanonicalPath -Path $script:NfcChromeUserDataDir
  if (-not $profilePath.Equals(
      (Get-NfcCanonicalPath -Path "C:\TenKings\chrome-ai-grader-profile"),
      [StringComparison]::OrdinalIgnoreCase)) {
    throw "The NFC workstation Chrome profile path is not the fixed AI Grader profile."
  }
  if (Test-Path -LiteralPath $profilePath) {
    $profile = Get-Item -LiteralPath $profilePath -Force
    if (-not $profile.PSIsContainer -or
        ($profile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "The fixed AI Grader Chrome profile path is not a safe directory."
    }
  } else {
    New-Item -ItemType Directory -Path $profilePath -Force -ErrorAction Stop | Out-Null
  }

  $chromePath = Get-NfcChromePath
  $chromeArguments = @(
    "--user-data-dir=$profilePath",
    "--new-window",
    $Url
  ) | ForEach-Object { Quote-NfcProcessArgument -Value $_ }
  Start-Process `
    -FilePath $chromePath `
    -ArgumentList $chromeArguments `
    -WorkingDirectory $WorkingDirectory | Out-Null
}

function Wait-NfcHelperLoopbackListener {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [int]$TimeoutMilliseconds = 5000
  )

  $deadline = [DateTimeOffset]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  do {
    $helperProcessIds = @(Get-NfcHelperProcess -Config $Config | ForEach-Object { [int]$_.ProcessId })
    $ownedListeners = @(
      Get-NetTCPConnection `
        -LocalAddress "127.0.0.1" `
        -LocalPort 47662 `
        -State Listen `
        -ErrorAction SilentlyContinue |
        Where-Object { $helperProcessIds -contains [int]$_.OwningProcess }
    )
    if ($ownedListeners.Count -gt 0) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  throw "The dedicated NFC helper did not establish its fixed loopback listener in time. Reopen the canonical shortcut to retry."
}

$layout = Assert-NfcProductionLayout -ConfigPath $ConfigPath -TaskName $TaskName
$ConfigPath = $layout.ConfigPath
$TaskName = $layout.TaskName
$config = Read-NfcConfig -Path $ConfigPath
if (-not $config) { throw "The NFC helper is not installed. Run the dedicated installer first." }
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) { throw "The dedicated NFC helper Scheduled Task is not installed." }
Assert-NfcScheduledTaskDefinition -TaskName $TaskName | Out-Null
$helperStarted = $false
if (@(Get-NfcHelperProcess -Config $config).Count -eq 0 -and [string]$task.State -cne "Running") {
  Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $helperStarted = $true
}
Wait-NfcHelperLoopbackListener -Config $config

$pairingConsumed = $false
$pairingStatePath = [string]$config.pairingConsumptionPath
if (Test-Path -LiteralPath $pairingStatePath -PathType Leaf) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $digest = (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$config.pairingCode)) |
      ForEach-Object { $_.ToString("x2") }) -join "")
    $pairingConsumed = ((Get-Content -LiteralPath $pairingStatePath -Raw).Trim() -ceq $digest)
  } finally {
    $sha.Dispose()
  }
}

$url = "$([string]$config.programmingUrl)#aiGraderNfcLaunch=v1"
if (-not $pairingConsumed) {
  $expiry = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse([string]$config.pairingCodeExpiresAt, [ref]$expiry) -or
      $expiry -le [DateTimeOffset]::UtcNow) {
    throw "The one-time NFC pairing code expired. Use rotate-ai-grader-nfc-helper-token.ps1 -RotatePairingCode -RestartHelper explicitly."
  }
  $url = "$url&aiGraderNfcPair=$([uri]::EscapeDataString([string]$config.pairingCode))"
}
Open-NfcWorkstationChrome -Url $url -WorkingDirectory ([string]$config.installDirectory)
[pscustomobject]@{
  ok = $true
  browser = "Google Chrome"
  dedicatedChromeProfile = $true
  pairingRequired = -not $pairingConsumed
  helperStarted = $helperStarted
  helperRestarted = $false
  programmingPageOpened = $true
} | ConvertTo-Json
