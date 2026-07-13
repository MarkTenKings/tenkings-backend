[CmdletBinding()]
param()

$script:NfcTaskName = "TenKingsAiGraderNfcHelper"
$script:NfcConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json"
$script:NfcInstallDir = "C:\TenKings\tools\ai-grader-nfc-helper"
$script:NfcHelperUrl = "http://127.0.0.1:47662"
$script:NfcProgrammingUrl = "https://collect.tenkings.co/ai-grader/nfc"
$script:NfcAllowedOrigin = "https://collect.tenkings.co"
$script:NfcShortcutName = "Ten Kings AI Grader NFC.lnk"
$script:NfcAttestationKeyName = "TenKings.AiGrader.Nfc.WorkstationAttestation.v1"
$script:NfcAttestationAlgorithm = "ecdsa-p256-sha256-p1363"

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
  if ($config.schemaVersion -notin @("tenkings-ai-grader-nfc-helper-config-v1", "tenkings-ai-grader-nfc-helper-config-v2") -or
      $config.host -ne "127.0.0.1" -or [int]$config.port -ne 47662 -or
      $config.allowedOrigin -ne $script:NfcAllowedOrigin) {
    throw "The NFC helper config failed its fixed loopback/origin validation."
  }
  if ($config.schemaVersion -eq "tenkings-ai-grader-nfc-helper-config-v2" -and
      ($config.workstationKeyName -cne $script:NfcAttestationKeyName -or
       [string]$config.workstationKeyId -cnotmatch '^[a-f0-9]{64}$')) {
    throw "The NFC helper config failed its workstation attestation-key validation."
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
    [switch]$RotatePairingCode,
    [string]$WorkstationKeyName,
    [string]$WorkstationKeyId
  )
  $now = (Get-Date).ToUniversalTime()
  $config = Read-NfcConfig -Path $Path
  if ($null -eq $config) {
    if ($WorkstationKeyName -cne $script:NfcAttestationKeyName -or
        $WorkstationKeyId -cnotmatch '^[a-f0-9]{64}$') {
      throw "Create or reuse the named NFC workstation attestation key through the installer first."
    }
    $config = [pscustomobject]@{
      schemaVersion = "tenkings-ai-grader-nfc-helper-config-v2"
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
      workstationKeyName = $WorkstationKeyName
      workstationKeyId = $WorkstationKeyId
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($WorkstationKeyName) -or
      -not [string]::IsNullOrWhiteSpace($WorkstationKeyId)) {
    if ($WorkstationKeyName -cne $script:NfcAttestationKeyName -or
        $WorkstationKeyId -cnotmatch '^[a-f0-9]{64}$') {
      throw "The installer returned invalid NFC workstation attestation-key metadata."
    }
    if ($config.PSObject.Properties["workstationKeyName"] -and
        -not [string]::IsNullOrWhiteSpace([string]$config.workstationKeyName) -and
        [string]$config.workstationKeyName -cne $WorkstationKeyName) {
      throw "The existing NFC workstation key name does not match the named CNG key."
    }
    if ($config.PSObject.Properties["workstationKeyId"] -and
        -not [string]::IsNullOrWhiteSpace([string]$config.workstationKeyId) -and
        [string]$config.workstationKeyId -cne $WorkstationKeyId) {
      throw "The existing NFC workstation key ID does not match the named CNG key. Ordinary updates never rotate it."
    }
    Set-NfcConfigProperty -Config $config -Name "workstationKeyName" -Value $WorkstationKeyName
    Set-NfcConfigProperty -Config $config -Name "workstationKeyId" -Value $WorkstationKeyId
    $config.schemaVersion = "tenkings-ai-grader-nfc-helper-config-v2"
  }
  if ($config.schemaVersion -ne "tenkings-ai-grader-nfc-helper-config-v2" -or
      [string]$config.workstationKeyName -cne $script:NfcAttestationKeyName -or
      [string]$config.workstationKeyId -cnotmatch '^[a-f0-9]{64}$') {
    throw "Run the NFC helper installer to attach the existing named workstation attestation key."
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

function Set-NfcConfigProperty {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)]$Value
  )
  if ($Config.PSObject.Properties[$Name]) {
    $Config.$Name = $Value
  } else {
    Add-Member -InputObject $Config -NotePropertyName $Name -NotePropertyValue $Value
  }
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
