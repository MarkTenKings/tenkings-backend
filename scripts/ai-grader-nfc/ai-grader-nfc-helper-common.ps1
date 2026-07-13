[CmdletBinding()]
param()

$script:NfcTaskName = "TenKingsAiGraderNfcHelper"
$script:NfcConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json"
$script:NfcInstallDir = "C:\TenKings\tools\ai-grader-nfc-helper"
$script:NfcHelperUrl = "http://127.0.0.1:47662"
$script:NfcProgrammingUrl = "https://collect.tenkings.co/ai-grader/nfc"
$script:NfcAllowedOrigin = "https://collect.tenkings.co"
$script:NfcShortcutName = "Ten Kings AI Grader NFC.lnk"

function Get-NfcRepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function New-NfcSecret {
  param([int]$ByteCount = 32)
  $bytes = New-Object byte[] $ByteCount
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Get-NfcSecretFingerprint {
  param([Parameter(Mandatory = $true)][string]$Value)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))
    return (($hash | ForEach-Object { $_.ToString("x2") }) -join "").Substring(0, 12)
  } finally {
    $sha.Dispose()
  }
}

function Protect-NfcPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($existingIdentity in @($acl.Access | ForEach-Object { $_.IdentityReference.Value } | Select-Object -Unique)) {
    $acl.PurgeAccessRules([System.Security.Principal.NTAccount]$existingIdentity)
  }
  $isDirectory = (Get-Item -LiteralPath $Path).PSIsContainer
  foreach ($account in @($identity, "BUILTIN\Administrators", "NT AUTHORITY\SYSTEM")) {
    $rule = if ($isDirectory) {
      New-Object System.Security.AccessControl.FileSystemAccessRule(
        $account,
        "FullControl",
        "ContainerInherit,ObjectInherit",
        "None",
        "Allow"
      )
    } else {
      New-Object System.Security.AccessControl.FileSystemAccessRule($account, "FullControl", "Allow")
    }
    $acl.AddAccessRule($rule) | Out-Null
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Read-NfcConfig {
  param([string]$Path = $script:NfcConfigPath)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $config = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  if ($config.schemaVersion -ne "tenkings-ai-grader-nfc-helper-config-v1" -or
      $config.host -ne "127.0.0.1" -or [int]$config.port -ne 47662 -or
      $config.allowedOrigin -ne $script:NfcAllowedOrigin) {
    throw "The NFC helper config failed its fixed loopback/origin validation."
  }
  return $config
}

function Save-NfcConfig {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [string]$Path = $script:NfcConfigPath
  )
  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  Protect-NfcPath -Path $directory
  $Config.updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  $Config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Path -Encoding UTF8
  Protect-NfcPath -Path $Path
}

function Initialize-NfcConfig {
  param(
    [string]$Path = $script:NfcConfigPath,
    [switch]$RotateToken,
    [switch]$RotatePairingCode
  )
  $now = (Get-Date).ToUniversalTime()
  $config = Read-NfcConfig -Path $Path
  if ($null -eq $config) {
    $config = [pscustomobject]@{
      schemaVersion = "tenkings-ai-grader-nfc-helper-config-v1"
      createdAt = $now.ToString("o")
      updatedAt = $now.ToString("o")
      host = "127.0.0.1"
      port = 47662
      helperUrl = $script:NfcHelperUrl
      allowedOrigin = $script:NfcAllowedOrigin
      programmingUrl = $script:NfcProgrammingUrl
      workstationToken = (New-NfcSecret -ByteCount 32)
      pairingCode = (New-NfcSecret -ByteCount 24)
      pairingCodeExpiresAt = $now.AddMinutes(10).ToString("o")
      pairingConsumptionPath = "C:\TenKings\config\ai-grader-nfc\pairing-consumed.sha256"
      backend = "pcsc"
      installDirectory = $script:NfcInstallDir
    }
  }
  if ($RotateToken) { $config.workstationToken = New-NfcSecret -ByteCount 32 }
  if ($RotatePairingCode) {
    $config.pairingCode = New-NfcSecret -ByteCount 24
    $config.pairingCodeExpiresAt = $now.AddMinutes(10).ToString("o")
  }
  if ([string]::IsNullOrWhiteSpace($config.pairingConsumptionPath)) {
    if ($config.PSObject.Properties["pairingConsumptionPath"]) {
      $config.pairingConsumptionPath = "C:\TenKings\config\ai-grader-nfc\pairing-consumed.sha256"
    } else {
      Add-Member -InputObject $config -NotePropertyName "pairingConsumptionPath" -NotePropertyValue "C:\TenKings\config\ai-grader-nfc\pairing-consumed.sha256"
    }
  }
  Save-NfcConfig -Config $config -Path $Path
  return $config
}

function Get-NfcDesktopShortcutPath {
  return Join-Path ([Environment]::GetFolderPath("Desktop")) $script:NfcShortcutName
}

function New-NfcDesktopShortcut {
  param(
    [Parameter(Mandatory = $true)][string]$OpenScript,
    [Parameter(Mandatory = $true)][string]$ConfigPath
  )
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut((Get-NfcDesktopShortcutPath))
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$OpenScript`" -ConfigPath `"$ConfigPath`""
  $shortcut.WorkingDirectory = Get-NfcRepoRoot
  $shortcut.Description = "Open the dedicated Ten Kings AI Grader NFC programming workstation"
  $shortcut.WindowStyle = 7
  $shortcut.Save()
}

function Get-NfcHelperProcess {
  param([Parameter(Mandatory = $true)]$Config)
  $dll = Join-Path ([string]$Config.installDirectory) "TenKings.AiGrader.NfcHelper.dll"
  return @(Get-CimInstance Win32_Process -Filter "Name = 'dotnet.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($dll, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
}

function Restart-NfcTask {
  param([string]$TaskName = $script:NfcTaskName)
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) { throw "The dedicated NFC helper Scheduled Task is not installed." }
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
}
