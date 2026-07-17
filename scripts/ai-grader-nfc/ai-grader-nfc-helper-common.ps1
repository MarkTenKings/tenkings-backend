[CmdletBinding()]
param()

$script:NfcTaskName = "TenKingsAiGraderNfcHelper"
$script:NfcConfigRoot = "C:\TenKings\config\ai-grader-nfc"
$script:NfcConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json"
$script:NfcToolsRoot = "C:\TenKings\tools"
$script:NfcInstallDir = "C:\TenKings\tools\ai-grader-nfc-helper"
$script:NfcMaintenanceDirectory = "C:\TenKings\tools\ai-grader-nfc-helper\maintenance"
$script:NfcStableStartScript = "C:\TenKings\tools\ai-grader-nfc-helper\maintenance\start-ai-grader-nfc-helper.ps1"
$script:NfcStableOpenScript = "C:\TenKings\tools\ai-grader-nfc-helper\maintenance\open-ai-grader-nfc-workstation.ps1"
$script:NfcPairingConsumptionPath = "C:\TenKings\config\ai-grader-nfc\pairing-consumed.sha256"
$script:NfcHelperUrl = "http://127.0.0.1:47662"
$script:NfcProgrammingUrl = "https://collect.tenkings.co/ai-grader/nfc"
$script:NfcAllowedOrigin = "https://collect.tenkings.co"
$script:NfcShortcutName = "Ten Kings AI Grader NFC.lnk"
$script:NfcAttestationKeyName = "TenKings.AiGrader.Nfc.WorkstationAttestation.v1"
$script:NfcAttestationAlgorithm = "ecdsa-p256-sha256-p1363"
$script:NfcGoToTagsTemplatePath = "C:\TenKings\tools\ai-grader-nfc-helper\Templates\f8215-gototags-manual-start-v1.json"
$script:NfcGoToTagsTemplateSha256 = "31bfcca6cfd0e947d5368643a0aeed2ce730b9e0ad2ed9d0a503cfd5e5e05c3d"
$script:NfcGoToTagsExecutableSha256 = "d21adfdef57393b948ce4e6d8771f6daa215041fa27c777ef33de24057883774"
$script:NfcGoToTagsRoot = "C:\TenKings\config\ai-grader-nfc\gototags"
$script:NfcGoToTagsJobRoot = "C:\TenKings\config\ai-grader-nfc\gototags\jobs"

function Get-NfcRepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Get-NfcCanonicalPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path) -or
      $Path.Length -gt 512 -or
      $Path -cnotmatch '^[A-Za-z]:\\' -or
      $Path.Substring(2).Contains(":") -or
      $Path.IndexOfAny([char[]]'*?"<>|') -ge 0) {
    throw "The NFC maintenance path is not a bounded absolute drive path."
  }
  $full = [IO.Path]::GetFullPath($Path)
  if ($full.Length -gt 3) { $full = $full.TrimEnd('\') }
  return $full
}

function Assert-NfcPathWithinRoot {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedRoot,
    [switch]$AllowRoot
  )
  $candidate = Get-NfcCanonicalPath -Path $Path
  $root = Get-NfcCanonicalPath -Path $AllowedRoot
  $prefix = $root.TrimEnd('\') + '\'
  $isRoot = $candidate.Equals($root, [StringComparison]::OrdinalIgnoreCase)
  if ((-not $isRoot -and -not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) -or
      ($isRoot -and -not $AllowRoot)) {
    throw "The NFC maintenance path escapes its dedicated root."
  }

  $cursor = $candidate
  while (-not [string]::IsNullOrWhiteSpace($cursor)) {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "The NFC maintenance path contains a reparse point."
      }
    }
    $parent = Split-Path -Parent $cursor
    if ([string]::IsNullOrWhiteSpace($parent) -or $parent -ceq $cursor) { break }
    $cursor = $parent
  }
  return $candidate
}

function Assert-NfcProductionLayout {
  param(
    [string]$ConfigPath = $script:NfcConfigPath,
    [string]$InstallDirectory = $script:NfcInstallDir,
    [string]$TaskName = $script:NfcTaskName
  )
  $config = Assert-NfcPathWithinRoot -Path $ConfigPath -AllowedRoot $script:NfcConfigRoot
  $install = Assert-NfcPathWithinRoot -Path $InstallDirectory -AllowedRoot $script:NfcToolsRoot
  if (-not $config.Equals((Get-NfcCanonicalPath -Path $script:NfcConfigPath), [StringComparison]::OrdinalIgnoreCase) -or
      -not $install.Equals((Get-NfcCanonicalPath -Path $script:NfcInstallDir), [StringComparison]::OrdinalIgnoreCase) -or
      $TaskName -cne $script:NfcTaskName) {
    throw "NFC maintenance is restricted to the dedicated config, install directory, and Scheduled Task."
  }
  return [pscustomobject]@{
    ConfigPath = Get-NfcCanonicalPath -Path $script:NfcConfigPath
    InstallDirectory = Get-NfcCanonicalPath -Path $script:NfcInstallDir
    TaskName = $script:NfcTaskName
  }
}

function Initialize-NfcFilesystemRoots {
  $toolsCreated = -not (Test-Path -LiteralPath $script:NfcToolsRoot)
  if ($toolsCreated) {
    New-Item -ItemType Directory -Path $script:NfcToolsRoot -Force -ErrorAction Stop | Out-Null
    Protect-NfcPath -Path $script:NfcToolsRoot -AllowedRoot $script:NfcToolsRoot
  } else {
    Assert-NfcPathWithinRoot -Path $script:NfcToolsRoot -AllowedRoot $script:NfcToolsRoot -AllowRoot | Out-Null
  }

  $configCreated = -not (Test-Path -LiteralPath $script:NfcConfigRoot)
  if ($configCreated) {
    New-Item -ItemType Directory -Path $script:NfcConfigRoot -Force -ErrorAction Stop | Out-Null
  }
  Protect-NfcPath -Path $script:NfcConfigRoot -AllowedRoot $script:NfcConfigRoot
  return [pscustomobject]@{ ToolsRootCreated = $toolsCreated; ConfigRootCreated = $configCreated }
}

function Copy-NfcStableMaintenancePayload {
  param(
    [Parameter(Mandatory = $true)][string]$SourceDirectory,
    [Parameter(Mandatory = $true)][string]$DestinationInstallDirectory
  )
  $source = Assert-NfcPathWithinRoot -Path $SourceDirectory -AllowedRoot $SourceDirectory -AllowRoot
  $destination = Assert-NfcPathWithinRoot -Path $DestinationInstallDirectory -AllowedRoot $script:NfcToolsRoot
  $maintenance = Join-Path $destination "maintenance"
  New-Item -ItemType Directory -Path $maintenance -ErrorAction Stop | Out-Null
  foreach ($name in @(
      "ai-grader-nfc-helper-common.ps1",
      "configure-ai-grader-nfc-feiju-f8215.ps1",
      "export-ai-grader-nfc-workstation-public-key.ps1",
      "open-ai-grader-nfc-workstation.ps1",
      "rotate-ai-grader-nfc-helper-token.ps1",
      "start-ai-grader-nfc-helper.ps1",
      "status-ai-grader-nfc-helper.ps1",
      "stop-ai-grader-nfc-helper.ps1",
      "uninstall-ai-grader-nfc-helper.ps1",
      "validate-ai-grader-nfc-sacrificial-tag.ps1")) {
    $sourceFile = Join-Path $source $name
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
      throw "The NFC stable maintenance payload is incomplete."
    }
    Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $maintenance $name) -ErrorAction Stop
  }
}

function Get-NfcSha256Text {
  param([Parameter(Mandatory = $true)][string]$Value)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join "")
  } finally {
    $sha.Dispose()
  }
}

function Invoke-NfcWithWorkstationKeyEnvironment {
  param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9._-]{1,128}$')][string]$KeyName,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{64}$')][string]$KeyId,
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [object[]]$ArgumentList = @()
  )
  $keyNameVariable = "TENKINGS_NFC_WORKSTATION_KEY_NAME"
  $keyIdVariable = "TENKINGS_NFC_WORKSTATION_KEY_ID"
  $previousKeyName = [Environment]::GetEnvironmentVariable(
    $keyNameVariable,
    [EnvironmentVariableTarget]::Process
  )
  $previousKeyId = [Environment]::GetEnvironmentVariable(
    $keyIdVariable,
    [EnvironmentVariableTarget]::Process
  )
  try {
    [Environment]::SetEnvironmentVariable(
      $keyNameVariable,
      $KeyName,
      [EnvironmentVariableTarget]::Process
    )
    [Environment]::SetEnvironmentVariable(
      $keyIdVariable,
      $KeyId,
      [EnvironmentVariableTarget]::Process
    )
    & $Action @ArgumentList
  } finally {
    try {
      [Environment]::SetEnvironmentVariable(
        $keyNameVariable,
        $previousKeyName,
        [EnvironmentVariableTarget]::Process
      )
    } finally {
      [Environment]::SetEnvironmentVariable(
        $keyIdVariable,
        $previousKeyId,
        [EnvironmentVariableTarget]::Process
      )
    }
  }
}

function Get-NfcAclFingerprint {
  param([Parameter(Mandatory = $true)][string]$Path)
  return Get-NfcSha256Text -Value ([string](Get-Acl -LiteralPath $Path).Sddl)
}

function Assert-NfcProtectedAcl {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [switch]$AllowInheritance
  )
  $acl = Get-Acl -LiteralPath $Path
  if (-not $AllowInheritance -and -not $acl.AreAccessRulesProtected) {
    throw "The NFC path ACL still inherits access outside the protected workstation policy."
  }
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $required = @($currentSid, "S-1-5-32-544", "S-1-5-18")
  $found = @{}
  foreach ($rule in @($acl.Access)) {
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin $required -or
        $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) {
      throw "The NFC path ACL contains a principal or access type outside the protected workstation policy."
    }
    if (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq
        [Security.AccessControl.FileSystemRights]::FullControl) {
      $found[$sid] = $true
    }
  }
  foreach ($sid in $required) {
    if (-not $found[$sid]) { throw "The NFC path ACL is missing a required protected principal." }
  }
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
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedRoot
  )
  $Path = Assert-NfcPathWithinRoot -Path $Path -AllowedRoot $AllowedRoot -AllowRoot
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($existingRule in @($acl.Access)) {
    $acl.PurgeAccessRules($existingRule.IdentityReference)
  }
  $isDirectory = (Get-Item -LiteralPath $Path).PSIsContainer
  $accounts = @(
    $identity,
    (New-Object Security.Principal.SecurityIdentifier("S-1-5-32-544")),
    (New-Object Security.Principal.SecurityIdentifier("S-1-5-18"))
  )
  foreach ($account in $accounts) {
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
  Assert-NfcProtectedAcl -Path $Path
}

function Protect-NfcTree {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedRoot
  )
  $root = Assert-NfcPathWithinRoot -Path $Path -AllowedRoot $AllowedRoot -AllowRoot
  Protect-NfcPath -Path $root -AllowedRoot $AllowedRoot
  foreach ($item in @(Get-ChildItem -LiteralPath $root -Force -Recurse)) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "The NFC helper tree contains a reparse point."
    }
    Protect-NfcPath -Path $item.FullName -AllowedRoot $AllowedRoot
  }
}

function Assert-NfcProtectedTree {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedRoot
  )
  $root = Assert-NfcPathWithinRoot -Path $Path -AllowedRoot $AllowedRoot -AllowRoot
  Assert-NfcProtectedAcl -Path $root
  foreach ($item in @(Get-ChildItem -LiteralPath $root -Force -Recurse)) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "The NFC helper tree contains a reparse point."
    }
    Assert-NfcProtectedAcl -Path $item.FullName
  }
}

function Read-NfcConfig {
  param([string]$Path = $script:NfcConfigPath)
  $Path = (Assert-NfcProductionLayout -ConfigPath $Path).ConfigPath
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  if ((Get-Item -LiteralPath $Path).Length -gt 16384) { throw "The NFC helper config exceeds its size bound." }
  Assert-NfcProtectedAcl -Path (Split-Path -Parent $Path)
  Assert-NfcProtectedAcl -Path $Path
  $config = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  if ($config.schemaVersion -notin @("tenkings-ai-grader-nfc-helper-config-v1", "tenkings-ai-grader-nfc-helper-config-v2", "tenkings-ai-grader-nfc-helper-config-v3") -or
      $config.host -ne "127.0.0.1" -or [int]$config.port -ne 47662 -or
      $config.allowedOrigin -ne $script:NfcAllowedOrigin) {
    throw "The NFC helper config failed its fixed loopback/origin validation."
  }
  $pairingExpiry = [DateTimeOffset]::MinValue
  $installDirectory = Get-NfcCanonicalPath -Path ([string]$config.installDirectory)
  $pairingConsumptionPath = Get-NfcCanonicalPath -Path ([string]$config.pairingConsumptionPath)
  if ($config.helperUrl -cne $script:NfcHelperUrl -or
      $config.programmingUrl -cne $script:NfcProgrammingUrl -or
      $config.backend -cne "pcsc" -or
      -not $installDirectory.Equals((Get-NfcCanonicalPath -Path $script:NfcInstallDir), [StringComparison]::OrdinalIgnoreCase) -or
      -not $pairingConsumptionPath.Equals((Get-NfcCanonicalPath -Path $script:NfcPairingConsumptionPath), [StringComparison]::OrdinalIgnoreCase) -or
      [string]$config.workstationToken -cnotmatch '^[A-Za-z0-9_-]{32,160}$' -or
      [string]$config.pairingCode -cnotmatch '^[A-Za-z0-9_-]{8,128}$' -or
      -not [DateTimeOffset]::TryParse([string]$config.pairingCodeExpiresAt, [ref]$pairingExpiry)) {
    throw "The NFC helper config failed its bounded path/credential validation."
  }
  if ($config.schemaVersion -eq "tenkings-ai-grader-nfc-helper-config-v2" -and
      ($config.workstationKeyName -cne $script:NfcAttestationKeyName -or
       [string]$config.workstationKeyId -cnotmatch '^[a-f0-9]{64}$')) {
    throw "The NFC helper config failed its workstation attestation-key validation."
  }
  if ($config.schemaVersion -eq "tenkings-ai-grader-nfc-helper-config-v3") {
    if ($config.workstationKeyName -cne $script:NfcAttestationKeyName -or
        [string]$config.workstationKeyId -cnotmatch '^[a-f0-9]{64}$' -or
        $config.feijuF8215Enabled -isnot [bool] -or
        [string]$config.goToTagsExecutableSha256 -cne $script:NfcGoToTagsExecutableSha256 -or
        [string]$config.goToTagsTemplateSha256 -cne $script:NfcGoToTagsTemplateSha256 -or
        -not (Get-NfcCanonicalPath -Path ([string]$config.goToTagsTemplatePath)).Equals(
          (Get-NfcCanonicalPath -Path $script:NfcGoToTagsTemplatePath),
          [StringComparison]::OrdinalIgnoreCase) -or
        -not (Get-NfcCanonicalPath -Path ([string]$config.goToTagsJobRoot)).Equals(
          (Get-NfcCanonicalPath -Path $script:NfcGoToTagsJobRoot),
          [StringComparison]::OrdinalIgnoreCase)) {
      throw "The NFC helper config failed its F8215 adapter validation."
    }
    if ([bool]$config.feijuF8215Enabled) {
      $goToTagsExecutable = Get-NfcCanonicalPath -Path ([string]$config.goToTagsExecutablePath)
      if (-not (Test-Path -LiteralPath $goToTagsExecutable -PathType Leaf) -or
          -not (Test-Path -LiteralPath $script:NfcGoToTagsTemplatePath -PathType Leaf) -or
          -not (Test-Path -LiteralPath $script:NfcGoToTagsJobRoot -PathType Container)) {
        throw "The enabled F8215 adapter dependencies are unavailable."
      }
      Assert-NfcPathWithinRoot -Path $script:NfcGoToTagsJobRoot -AllowedRoot $script:NfcConfigRoot | Out-Null
      Assert-NfcProtectedTree -Path $script:NfcGoToTagsRoot -AllowedRoot $script:NfcConfigRoot
    }
  }
  return $config
}

function Save-NfcConfig {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [string]$Path = $script:NfcConfigPath
  )
  $Path = (Assert-NfcProductionLayout -ConfigPath $Path).ConfigPath
  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  Protect-NfcPath -Path $directory -AllowedRoot $script:NfcConfigRoot
  $Config.updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  $Config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Path -Encoding UTF8
  Protect-NfcPath -Path $Path -AllowedRoot $script:NfcConfigRoot
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
      schemaVersion = "tenkings-ai-grader-nfc-helper-config-v3"
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
      pairingConsumptionPath = $script:NfcPairingConsumptionPath
      backend = "pcsc"
      installDirectory = $script:NfcInstallDir
      workstationKeyName = $WorkstationKeyName
      workstationKeyId = $WorkstationKeyId
      feijuF8215Enabled = $false
      goToTagsExecutablePath = ""
      goToTagsExecutableSha256 = $script:NfcGoToTagsExecutableSha256
      goToTagsTemplatePath = $script:NfcGoToTagsTemplatePath
      goToTagsTemplateSha256 = $script:NfcGoToTagsTemplateSha256
      goToTagsJobRoot = $script:NfcGoToTagsJobRoot
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
    if ($config.schemaVersion -eq "tenkings-ai-grader-nfc-helper-config-v1") {
      $config.schemaVersion = "tenkings-ai-grader-nfc-helper-config-v2"
    }
  }
  if ($config.schemaVersion -notin @("tenkings-ai-grader-nfc-helper-config-v2", "tenkings-ai-grader-nfc-helper-config-v3") -or
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
      $config.pairingConsumptionPath = $script:NfcPairingConsumptionPath
    } else {
      Add-Member -InputObject $config -NotePropertyName "pairingConsumptionPath" -NotePropertyValue $script:NfcPairingConsumptionPath
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

function Get-NfcFileFingerprint {
  param([Parameter(Mandatory = $true)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-NfcPreservedStateSnapshot {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [string]$ConfigPath = $script:NfcConfigPath,
    [string]$TaskName = $script:NfcTaskName
  )
  $layout = Assert-NfcProductionLayout -ConfigPath $ConfigPath -TaskName $TaskName
  $task = Assert-NfcScheduledTaskDefinition -TaskName $layout.TaskName
  Assert-NfcDesktopShortcutDefinition
  $taskXml = Export-ScheduledTask -TaskName $layout.TaskName -ErrorAction Stop
  $shortcut = Get-NfcDesktopShortcutPath
  $pairingPath = Get-NfcCanonicalPath -Path ([string]$Config.pairingConsumptionPath)
  Assert-NfcPathWithinRoot -Path $pairingPath -AllowedRoot $script:NfcConfigRoot | Out-Null
  $pairingExists = Test-Path -LiteralPath $pairingPath
  if ($pairingExists) { Assert-NfcProtectedAcl -Path $pairingPath -AllowInheritance }
  return [pscustomobject]@{
    ConfigFingerprint = Get-NfcFileFingerprint -Path $layout.ConfigPath
    ConfigAclFingerprint = Get-NfcAclFingerprint -Path $layout.ConfigPath
    ConfigDirectoryAclFingerprint = Get-NfcAclFingerprint -Path (Split-Path -Parent $layout.ConfigPath)
    PairingStateExists = $pairingExists
    PairingStateFingerprint = if ($pairingExists) { Get-NfcFileFingerprint -Path $pairingPath } else { $null }
    PairingStateAclFingerprint = if ($pairingExists) { Get-NfcAclFingerprint -Path $pairingPath } else { $null }
    WorkstationKeyName = [string]$Config.workstationKeyName
    WorkstationKeyId = [string]$Config.workstationKeyId
    TaskName = [string]$task.TaskName
    TaskPath = [string]$task.TaskPath
    TaskXmlFingerprint = Get-NfcSha256Text -Value ([string]$taskXml)
    ShortcutExists = Test-Path -LiteralPath $shortcut
    ShortcutFingerprint = if (Test-Path -LiteralPath $shortcut) { Get-NfcFileFingerprint -Path $shortcut } else { $null }
  }
}

function Assert-NfcPreservedState {
  param(
    [Parameter(Mandatory = $true)]$Expected,
    [Parameter(Mandatory = $true)]$Config,
    [string]$ConfigPath = $script:NfcConfigPath,
    [string]$TaskName = $script:NfcTaskName
  )
  $actual = Get-NfcPreservedStateSnapshot -Config $Config -ConfigPath $ConfigPath -TaskName $TaskName
  foreach ($property in @(
      "ConfigFingerprint",
      "ConfigAclFingerprint",
      "ConfigDirectoryAclFingerprint",
      "PairingStateExists",
      "PairingStateFingerprint",
      "PairingStateAclFingerprint",
      "WorkstationKeyName",
      "WorkstationKeyId",
      "TaskName",
      "TaskPath",
      "TaskXmlFingerprint",
      "ShortcutExists",
      "ShortcutFingerprint")) {
    if ($Expected.$property -cne $actual.$property) {
      throw "Ordinary NFC helper update changed protected workstation state: $property."
    }
  }
}

function Invoke-NfcInstallDirectoryReplacement {
  param(
    [Parameter(Mandatory = $true)][string]$InstallDirectory,
    [Parameter(Mandatory = $true)][string]$StagingDirectory,
    [Parameter(Mandatory = $true)][string]$BackupDirectory,
    [Parameter(Mandatory = $true)][string]$AllowedRoot,
    [Parameter(Mandatory = $true)][scriptblock]$ValidateReplacement,
    [scriptblock]$BeforeRollback,
    [scriptblock]$AfterRollback
  )
  $install = Assert-NfcPathWithinRoot -Path $InstallDirectory -AllowedRoot $AllowedRoot
  $staging = Assert-NfcPathWithinRoot -Path $StagingDirectory -AllowedRoot $AllowedRoot
  $backup = Assert-NfcPathWithinRoot -Path $BackupDirectory -AllowedRoot $AllowedRoot
  if (-not (Test-Path -LiteralPath $install -PathType Container) -or
      -not (Test-Path -LiteralPath $staging -PathType Container) -or
      (Test-Path -LiteralPath $backup)) {
    throw "The NFC helper replacement directories are not in the required initial state."
  }

  Move-Item -LiteralPath $install -Destination $backup -ErrorAction Stop
  try {
    Move-Item -LiteralPath $staging -Destination $install -ErrorAction Stop
    & $ValidateReplacement $install
  } catch {
    $replacementFailure = $_
    try {
      if ($BeforeRollback) { & $BeforeRollback $install }
      if (Test-Path -LiteralPath $install) {
        if (Test-Path -LiteralPath $staging) {
          throw "The NFC helper staging and activated paths both exist during rollback."
        }
        Move-Item -LiteralPath $install -Destination $staging -ErrorAction Stop
      }
      if (-not (Test-Path -LiteralPath $backup -PathType Container)) {
        throw "The prior NFC helper backup is unavailable for rollback."
      }
      Move-Item -LiteralPath $backup -Destination $install -ErrorAction Stop
      if ($AfterRollback) { & $AfterRollback $install }
    } catch {
      throw "NFC helper replacement failed and rollback could not restore the prior install. Replacement: $($replacementFailure.Exception.Message) Rollback: $($_.Exception.Message)"
    }
    throw "NFC helper replacement failed; the prior working install was restored. $($replacementFailure.Exception.Message)"
  }
}

function Remove-NfcSafeTree {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedRoot
  )
  $target = Assert-NfcPathWithinRoot -Path $Path -AllowedRoot $AllowedRoot
  if (-not (Test-Path -LiteralPath $target)) { return }
  foreach ($item in @(Get-ChildItem -LiteralPath $target -Force -Recurse)) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Refusing to remove an NFC maintenance tree containing a reparse point."
    }
  }
  Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
}

function Remove-NfcNewEmptyRoot {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedRoot
  )
  $target = Get-NfcCanonicalPath -Path $Path
  $expected = Get-NfcCanonicalPath -Path $ExpectedRoot
  if (-not $target.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove an unexpected NFC filesystem root."
  }
  Assert-NfcPathWithinRoot -Path $target -AllowedRoot $expected -AllowRoot | Out-Null
  if ((Test-Path -LiteralPath $target -PathType Container) -and
      @(Get-ChildItem -LiteralPath $target -Force).Count -eq 0) {
    Remove-Item -LiteralPath $target -Force -ErrorAction Stop
  }
}

function Get-NfcDesktopShortcutPath {
  return Join-Path ([Environment]::GetFolderPath("Desktop")) $script:NfcShortcutName
}

function Assert-NfcScheduledTaskDefinition {
  param([string]$TaskName = $script:NfcTaskName)
  Assert-NfcProductionLayout -TaskName $TaskName | Out-Null
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $actions = @($task.Actions)
  $expectedArguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script:NfcStableStartScript`" -ConfigPath `"$script:NfcConfigPath`""
  if ($task.TaskName -cne $script:NfcTaskName -or
      $task.TaskPath -cne "\" -or
      $actions.Count -ne 1 -or
      [IO.Path]::GetFileName([string]$actions[0].Execute) -ine "powershell.exe" -or
      [string]$actions[0].Arguments -cne $expectedArguments -or
      -not (Get-NfcCanonicalPath -Path ([string]$actions[0].WorkingDirectory)).Equals(
        (Get-NfcCanonicalPath -Path $script:NfcInstallDir),
        [StringComparison]::OrdinalIgnoreCase)) {
    throw "The dedicated NFC helper Scheduled Task definition does not match the stable installed launcher."
  }
  return $task
}

function Assert-NfcDesktopShortcutDefinition {
  $path = Get-NfcDesktopShortcutPath
  if (-not (Test-Path -LiteralPath $path)) { return }
  $shell = $null
  $shortcut = $null
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($path)
    $expectedArguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script:NfcStableOpenScript`" -ConfigPath `"$script:NfcConfigPath`""
    if ([IO.Path]::GetFileName([string]$shortcut.TargetPath) -ine "powershell.exe" -or
        [string]$shortcut.Arguments -cne $expectedArguments -or
        -not (Get-NfcCanonicalPath -Path ([string]$shortcut.WorkingDirectory)).Equals(
          (Get-NfcCanonicalPath -Path $script:NfcInstallDir),
          [StringComparison]::OrdinalIgnoreCase)) {
      throw "The NFC workstation shortcut does not match the stable installed launcher."
    }
  } finally {
    if ($shortcut) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) }
    if ($shell) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
  }
}

function New-NfcDesktopShortcut {
  param(
    [Parameter(Mandatory = $true)][string]$OpenScript,
    [Parameter(Mandatory = $true)][string]$ConfigPath
  )
  Assert-NfcProductionLayout -ConfigPath $ConfigPath | Out-Null
  $open = Assert-NfcPathWithinRoot -Path $OpenScript -AllowedRoot $script:NfcInstallDir
  if (-not $open.Equals((Get-NfcCanonicalPath -Path $script:NfcStableOpenScript), [StringComparison]::OrdinalIgnoreCase)) {
    throw "The NFC shortcut must use the stable installed launcher."
  }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut((Get-NfcDesktopShortcutPath))
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$OpenScript`" -ConfigPath `"$ConfigPath`""
  $shortcut.WorkingDirectory = $script:NfcInstallDir
  $shortcut.Description = "Open the dedicated Ten Kings AI Grader NFC programming workstation"
  $shortcut.WindowStyle = 7
  $shortcut.Save()
  Assert-NfcDesktopShortcutDefinition
}

function Get-NfcHelperProcess {
  param([Parameter(Mandatory = $true)]$Config)
  $dll = Join-Path ([string]$Config.installDirectory) "TenKings.AiGrader.NfcHelper.dll"
  return @(Get-CimInstance Win32_Process -Filter "Name = 'dotnet.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($dll, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
}

function Restart-NfcTask {
  param([string]$TaskName = $script:NfcTaskName)
  Assert-NfcProductionLayout -TaskName $TaskName | Out-Null
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) { throw "The dedicated NFC helper Scheduled Task is not installed." }
  Assert-NfcScheduledTaskDefinition -TaskName $TaskName | Out-Null
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
}
