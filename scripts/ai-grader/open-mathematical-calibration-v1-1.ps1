[CmdletBinding()]
param(
  [string]$ConfigPath = "C:\TenKings\capture-data\ai-grader-mathematical-calibration-v1\private-bridge-config.json",
  [Parameter(Mandatory = $true)][string]$SessionId,
  [int]$Port = 47653,
  [string]$ChromeUserDataDir = "C:\TenKings\chrome-ai-grader-mathematical-calibration-v1.1"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-local-bridge-common.ps1")

if ($SessionId -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') {
  throw "SessionId must be a safe calibration session identifier."
}
if ($Port -ne 47653) {
  throw "Mathematical Calibration V1.1 is restricted to protected loopback port 47653."
}
$config = Read-AiGraderBridgeConfig -Path $ConfigPath
if ($null -eq $config -or [string]::IsNullOrWhiteSpace([string]$config.bridgeUrl) -or [string]::IsNullOrWhiteSpace([string]$config.pairingCode)) {
  throw "Protected calibration bridge config is unavailable or has no pairing code. Start the protected bridge first."
}
$bridgeUri = [Uri]::new("http://$($config.host):$Port")
if ($bridgeUri.Scheme -ne "http" -or $bridgeUri.Host -notin @("127.0.0.1", "localhost", "::1")) {
  throw "Calibration page launcher accepts only a loopback bridge URL."
}

function Get-ChromePath {
  foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
    if ([string]::IsNullOrWhiteSpace($root)) { continue }
    $candidate = Join-Path $root "Google\Chrome\Application\chrome.exe"
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  $command = Get-Command chrome.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw "Google Chrome was not found."
}

if (-not (Test-Path -LiteralPath $ChromeUserDataDir)) {
  New-Item -ItemType Directory -Path $ChromeUserDataDir -Force | Out-Null
}
$pageUrl = "$($bridgeUri.AbsoluteUri.TrimEnd('/'))/calibration/mathematical-v1.1?sessionId=$([Uri]::EscapeDataString($SessionId))#aiGraderBridgePair=$([Uri]::EscapeDataString([string]$config.pairingCode))"
$chromeArgs = @(
  "--user-data-dir=$ChromeUserDataDir",
  "--new-window",
  $pageUrl
)
Start-Process -FilePath (Get-ChromePath) -ArgumentList $chromeArgs -WorkingDirectory (Get-AiGraderRepoRoot) | Out-Null
[pscustomobject]@{
  ok = $true
  pagePath = "/calibration/mathematical-v1.1"
  bridgeUrl = $bridgeUri.AbsoluteUri.TrimEnd('/')
  sessionId = $SessionId
  pairingCodeRedacted = $true
} | ConvertTo-Json -Compress
