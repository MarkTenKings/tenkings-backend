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

function Test-NfcHelperLoopbackListenerReady {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$HelperProcesses,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Listeners,
    [Parameter(Mandatory = $true)][bool]$ScheduledTaskValidated
  )

  if (-not $ScheduledTaskValidated -or
      $HelperProcesses.Count -ne 1 -or
      $Listeners.Count -ne 1) {
    return $false
  }

  $helperProcessId = 0
  $listenerOwner = 0
  $listenerPort = 0
  try {
    $helperProcessId = [int]$HelperProcesses[0].ProcessId
    $listenerOwner = [int]$Listeners[0].OwningProcess
    $listenerPort = [int]$Listeners[0].LocalPort
  } catch {
    return $false
  }
  if ($helperProcessId -le 0 -or
      [string]$Listeners[0].LocalAddress -cne "127.0.0.1" -or
      $listenerPort -ne 47662 -or
      [string]$Listeners[0].State -cne "Listen") {
    return $false
  }

  # HttpListener is registered through Windows HTTP.sys, which can expose the
  # fixed listener under System PID 4 rather than the exact helper dotnet PID.
  # PID 4 is accepted only alongside the one exact helper process and validated
  # dedicated Scheduled Task required above; it is never helper identity alone.
  return $listenerOwner -eq $helperProcessId -or $listenerOwner -eq 4
}

function Wait-NfcHelperLoopbackListener {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [Parameter(Mandatory = $true)][string]$TaskName,
    [ValidateRange(0, 30000)][int]$TimeoutMilliseconds = 5000
  )

  Assert-NfcScheduledTaskDefinition -TaskName $TaskName | Out-Null
  $deadline = [DateTimeOffset]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
  while ($true) {
    $helperProcesses = @(Get-NfcHelperProcess -Config $Config)
    $listeners = @(
      Get-NetTCPConnection `
        -LocalAddress "127.0.0.1" `
        -LocalPort 47662 `
        -State Listen `
        -ErrorAction SilentlyContinue
    )
    if (Test-NfcHelperLoopbackListenerReady `
        -HelperProcesses $helperProcesses `
        -Listeners $listeners `
        -ScheduledTaskValidated $true) {
      return
    }
    if ([DateTimeOffset]::UtcNow -ge $deadline) { break }
    Start-Sleep -Milliseconds 100
  }

  throw "The dedicated NFC helper did not establish its fixed loopback listener in time. Reopen the canonical shortcut to retry."
}

function Invoke-NfcAfterHelperLoopbackListenerReady {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [Parameter(Mandatory = $true)][string]$TaskName,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )

  Wait-NfcHelperLoopbackListener -Config $Config -TaskName $TaskName
  & $Action
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

Invoke-NfcAfterHelperLoopbackListenerReady `
  -Config $config `
  -TaskName $TaskName `
  -Action {
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
  }
