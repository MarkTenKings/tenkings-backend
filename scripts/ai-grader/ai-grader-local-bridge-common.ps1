[CmdletBinding()]
param()

$script:AiGraderBridgeTaskName = "TenKingsAiGraderLocalBridge"
$script:AiGraderBridgeConfigPath = "C:\TenKings\config\ai-grader-local-bridge.json"
$script:AiGraderBridgeUrl = "http://127.0.0.1:47652"
$script:AiGraderStationUrl = "https://collect.tenkings.co/ai-grader/station"

function Get-AiGraderRepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function New-AiGraderLocalSecret {
  param(
    [string]$Prefix = "tk-local-",
    [int]$ByteCount = 32
  )
  $bytes = New-Object byte[] $ByteCount
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $secret = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  return "$Prefix$secret"
}

function Get-AiGraderSecretFingerprint {
  param([Parameter(Mandatory = $true)][string]$Value)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    $hash = $sha.ComputeHash($bytes)
    return (($hash | ForEach-Object { $_.ToString("x2") }) -join "").Substring(0, 12)
  } finally {
    $sha.Dispose()
  }
}

function Protect-AiGraderBridgeConfigFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) {
    return
  }
  try {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($account in @($identity, "BUILTIN\Administrators", "NT AUTHORITY\SYSTEM")) {
      $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $account,
        "FullControl",
        "Allow"
      )
      $acl.AddAccessRule($rule) | Out-Null
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
  } catch {
    Write-Warning "Could not lock AI Grader bridge config ACL: $($_.Exception.Message)"
  }
}

function Read-AiGraderBridgeConfig {
  param([string]$Path = $script:AiGraderBridgeConfigPath)
  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Set-AiGraderConfigValue {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [Parameter(Mandatory = $true)][string]$Name,
    $Value
  )
  if ($Config.PSObject.Properties[$Name]) {
    $Config.$Name = $Value
  } else {
    Add-Member -InputObject $Config -NotePropertyName $Name -NotePropertyValue $Value
  }
}

function Save-AiGraderBridgeConfig {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [string]$Path = $script:AiGraderBridgeConfigPath
  )
  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  Set-AiGraderConfigValue -Config $Config -Name "updatedAt" -Value ((Get-Date).ToUniversalTime().ToString("o"))
  $Config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding UTF8
  Protect-AiGraderBridgeConfigFile -Path $Path
}

function Initialize-AiGraderBridgeConfig {
  param(
    [string]$Path = $script:AiGraderBridgeConfigPath,
    [switch]$RotateToken,
    [switch]$RotatePairingCode,
    [string]$Mode = "real"
  )
  $config = Read-AiGraderBridgeConfig -Path $Path
  $now = (Get-Date).ToUniversalTime()
  if ($null -eq $config) {
    $config = [pscustomobject]@{
      schemaVersion = "tenkings-ai-grader-local-bridge-v1"
      createdAt = $now.ToString("o")
      updatedAt = $now.ToString("o")
      mode = $Mode
      host = "127.0.0.1"
      port = 47652
      bridgeUrl = $script:AiGraderBridgeUrl
      stationUrl = $script:AiGraderStationUrl
      stationToken = (New-AiGraderLocalSecret -Prefix "tk-local-")
      pairingCode = (New-AiGraderLocalSecret -Prefix "tk-pair-")
      pairingCodeExpiresAt = $now.AddMinutes(10).ToString("o")
      allowedOrigins = @("https://collect.tenkings.co")
      outputDir = "C:\TenKings\capture-data\ai-grader-station"
      reportBundleOutputDir = "C:\TenKings\capture-data\ai-grader-report-bundles"
      leimacHost = "169.254.191.156"
      leimacPort = 1000
      exposureUs = 45000
      gain = 0
      duty = 1.2
      fixtureLabel = "fixed-ruler-v1-dell"
      horizontalSpanMm = 50.8
      horizontalStartPx = "540,205"
      horizontalEndPx = "1620,205"
      verticalSpanMm = 50.8
      verticalStartPx = "2295,145"
      verticalEndPx = "2295,1218"
      cardBoundaryRect = "285,349,1878,1350"
    }
  }
  if ($RotateToken -or [string]::IsNullOrWhiteSpace($config.stationToken)) {
    Set-AiGraderConfigValue -Config $config -Name "stationToken" -Value (New-AiGraderLocalSecret -Prefix "tk-local-")
  }
  if ([string]::IsNullOrWhiteSpace($config.schemaVersion)) {
    Set-AiGraderConfigValue -Config $config -Name "schemaVersion" -Value "tenkings-ai-grader-local-bridge-v1"
  }
  if ([string]::IsNullOrWhiteSpace($config.createdAt)) {
    Set-AiGraderConfigValue -Config $config -Name "createdAt" -Value $now.ToString("o")
  }
  if ([string]::IsNullOrWhiteSpace($config.host)) {
    Set-AiGraderConfigValue -Config $config -Name "host" -Value "127.0.0.1"
  }
  if ($null -eq $config.port) {
    Set-AiGraderConfigValue -Config $config -Name "port" -Value 47652
  }
  if ([string]::IsNullOrWhiteSpace($config.bridgeUrl)) {
    Set-AiGraderConfigValue -Config $config -Name "bridgeUrl" -Value $script:AiGraderBridgeUrl
  }
  if ([string]::IsNullOrWhiteSpace($config.stationUrl)) {
    Set-AiGraderConfigValue -Config $config -Name "stationUrl" -Value $script:AiGraderStationUrl
  }
  if ($null -eq $config.allowedOrigins -or $config.allowedOrigins.Count -eq 0) {
    Set-AiGraderConfigValue -Config $config -Name "allowedOrigins" -Value @("https://collect.tenkings.co")
  }
  if ([string]::IsNullOrWhiteSpace($config.outputDir)) {
    Set-AiGraderConfigValue -Config $config -Name "outputDir" -Value "C:\TenKings\capture-data\ai-grader-station"
  }
  if ([string]::IsNullOrWhiteSpace($config.reportBundleOutputDir)) {
    Set-AiGraderConfigValue -Config $config -Name "reportBundleOutputDir" -Value "C:\TenKings\capture-data\ai-grader-report-bundles"
  }
  if ([string]::IsNullOrWhiteSpace($config.leimacHost)) {
    Set-AiGraderConfigValue -Config $config -Name "leimacHost" -Value "169.254.191.156"
  }
  if ($null -eq $config.leimacPort) {
    Set-AiGraderConfigValue -Config $config -Name "leimacPort" -Value 1000
  }
  if ($null -eq $config.exposureUs) {
    Set-AiGraderConfigValue -Config $config -Name "exposureUs" -Value 45000
  }
  if ($null -eq $config.gain) {
    Set-AiGraderConfigValue -Config $config -Name "gain" -Value 0
  }
  if ($null -eq $config.duty) {
    Set-AiGraderConfigValue -Config $config -Name "duty" -Value 1.2
  }
  if ([string]::IsNullOrWhiteSpace($config.fixtureLabel)) {
    Set-AiGraderConfigValue -Config $config -Name "fixtureLabel" -Value "fixed-ruler-v1-dell"
  }
  if ($null -eq $config.horizontalSpanMm) {
    Set-AiGraderConfigValue -Config $config -Name "horizontalSpanMm" -Value 50.8
  }
  if ([string]::IsNullOrWhiteSpace($config.horizontalStartPx)) {
    Set-AiGraderConfigValue -Config $config -Name "horizontalStartPx" -Value "540,205"
  }
  if ([string]::IsNullOrWhiteSpace($config.horizontalEndPx)) {
    Set-AiGraderConfigValue -Config $config -Name "horizontalEndPx" -Value "1620,205"
  }
  if ($null -eq $config.verticalSpanMm) {
    Set-AiGraderConfigValue -Config $config -Name "verticalSpanMm" -Value 50.8
  }
  if ([string]::IsNullOrWhiteSpace($config.verticalStartPx)) {
    Set-AiGraderConfigValue -Config $config -Name "verticalStartPx" -Value "2295,145"
  }
  if ([string]::IsNullOrWhiteSpace($config.verticalEndPx)) {
    Set-AiGraderConfigValue -Config $config -Name "verticalEndPx" -Value "2295,1218"
  }
  if ([string]::IsNullOrWhiteSpace($config.cardBoundaryRect)) {
    Set-AiGraderConfigValue -Config $config -Name "cardBoundaryRect" -Value "285,349,1878,1350"
  }
  if ($RotatePairingCode -or [string]::IsNullOrWhiteSpace($config.pairingCode)) {
    Set-AiGraderConfigValue -Config $config -Name "pairingCode" -Value (New-AiGraderLocalSecret -Prefix "tk-pair-")
  }
  if ($RotatePairingCode -or [string]::IsNullOrWhiteSpace($config.pairingCodeExpiresAt)) {
    Set-AiGraderConfigValue -Config $config -Name "pairingCodeExpiresAt" -Value ($now.AddMinutes(10).ToString("o"))
  }
  if ([string]::IsNullOrWhiteSpace($config.mode)) {
    Set-AiGraderConfigValue -Config $config -Name "mode" -Value $Mode
  }
  Save-AiGraderBridgeConfig -Config $config -Path $Path
  return $config
}

function Get-AiGraderBridgePairingUrl {
  param(
    [Parameter(Mandatory = $true)]$Config
  )
  return "$($Config.stationUrl)#aiGraderBridgePair=$([uri]::EscapeDataString($Config.pairingCode))"
}

function Get-AiGraderBridgeHealth {
  param([string]$BridgeUrl = $script:AiGraderBridgeUrl)
  try {
    return Invoke-RestMethod -Method GET -Uri "$BridgeUrl/health" -TimeoutSec 2
  } catch {
    return $null
  }
}
