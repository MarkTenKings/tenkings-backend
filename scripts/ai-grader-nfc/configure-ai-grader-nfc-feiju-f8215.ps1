[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$GoToTagsExecutablePath,
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [string]$TaskName = "TenKingsAiGraderNfcHelper"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

$layout = Assert-NfcProductionLayout -ConfigPath $ConfigPath -TaskName $TaskName
$ConfigPath = $layout.ConfigPath
$TaskName = $layout.TaskName
$config = Read-NfcConfig -Path $ConfigPath
if ($null -eq $config) { throw "Install the dedicated NFC helper before configuring the F8215 adapter." }
Assert-NfcScheduledTaskDefinition -TaskName $TaskName | Out-Null
Assert-NfcDesktopShortcutDefinition
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
if ($task.State -eq "Running" -or @(Get-NfcHelperProcess -Config $config).Count -ne 0) {
  throw "Stop the dedicated NFC helper before changing its F8215 adapter configuration."
}
if (@(Get-Process -Name "GoToTags*" -ErrorAction SilentlyContinue).Count -ne 0) {
  throw "Close GoToTags before changing the protected F8215 adapter configuration."
}

$createdRoot = $false
$backupPath = Join-Path $script:NfcConfigRoot ("helper-feiju-config-backup-{0}.json" -f [Guid]::NewGuid().ToString("N"))
Assert-NfcPathWithinRoot -Path $backupPath -AllowedRoot $script:NfcConfigRoot | Out-Null
Copy-Item -LiteralPath $ConfigPath -Destination $backupPath -ErrorAction Stop
Protect-NfcPath -Path $backupPath -AllowedRoot $script:NfcConfigRoot
try {
  $executable = Get-NfcCanonicalPath -Path $GoToTagsExecutablePath
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "The approved GoToTags executable was not found."
  }
  if ((Get-NfcFileFingerprint -Path $executable) -cne $script:NfcGoToTagsExecutableSha256) {
    throw "The installed GoToTags executable bytes are not the reviewed 4.37.0.1 build."
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $executable
  if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
      $null -eq $signature.SignerCertificate -or
      $signature.SignerCertificate.Subject -cne "CN=GoToTags, O=GoToTags, S=Washington, C=US") {
    throw "The installed GoToTags publisher identity is not approved."
  }
    $goToTagsProgId = "AppXtamynr710a4k4xderv2ath0xe29hgtkd"
    $openWith = Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\.gototags\OpenWithProgids" -ErrorAction Stop
    $application = Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\$goToTagsProgId\Application" -ErrorAction Stop
    $command = Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\$goToTagsProgId\Shell\open\command" -ErrorAction Stop
    if ($null -eq $openWith.PSObject.Properties[$goToTagsProgId] -or
        [string]$application.ApplicationName -cne "GoToTags" -or
        [string]$application.ApplicationCompany -cne "GoToTags" -or
        [string]$application.AppUserModelID -cne "Desktopapp_14h5dv7m6vvvy!GoToTags" -or
        -not ([string]$application.ApplicationIcon).StartsWith("@{Desktopapp_4.37.0.1_x64__14h5dv7m6vvvy?", [StringComparison]::Ordinal) -or
        [string]$command.DelegateExecute -cne "{BFEC0C93-0B7D-4F2C-B09C-AFFFC4BDAE78}") {
      throw "The reviewed GoToTags operation-file association is not installed."
    }
    if (-not (Test-Path -LiteralPath $script:NfcGoToTagsTemplatePath -PathType Leaf) -or
        (Get-NfcFileFingerprint -Path $script:NfcGoToTagsTemplatePath) -cne $script:NfcGoToTagsTemplateSha256) {
      throw "The installed reviewed F8215 operation template is missing or changed."
    }
    $certProp = Get-CimInstance Win32_Service -Filter "Name = 'CertPropSvc'" -ErrorAction Stop
    if ([string]$certProp.State -cne "Stopped" -or [string]$certProp.StartMode -cne "Disabled") {
      throw "GoToTags requires Certificate Propagation to be stopped and disabled. This configuration command never changes Windows services."
    }
    $smartCard = Get-CimInstance Win32_Service -Filter "Name = 'SCardSvr'" -ErrorAction Stop
    if ([string]$smartCard.State -cne "Running" -or [string]$smartCard.StartMode -ceq "Disabled") {
      throw "The Windows Smart Card service is unavailable."
    }
    if (-not (Test-Path -LiteralPath $script:NfcGoToTagsRoot -PathType Container)) {
      New-Item -ItemType Directory -Path $script:NfcGoToTagsJobRoot -Force -ErrorAction Stop | Out-Null
      $createdRoot = $true
    } elseif (-not (Test-Path -LiteralPath $script:NfcGoToTagsJobRoot -PathType Container)) {
      New-Item -ItemType Directory -Path $script:NfcGoToTagsJobRoot -ErrorAction Stop | Out-Null
    }
    Protect-NfcTree -Path $script:NfcGoToTagsRoot -AllowedRoot $script:NfcConfigRoot
    Assert-NfcNoActiveGoToTagsRecovery -JobRoot $script:NfcGoToTagsJobRoot
  Set-NfcConfigProperty -Config $config -Name "goToTagsExecutablePath" -Value $executable
  Set-NfcConfigProperty -Config $config -Name "goToTagsTemplatePath" -Value $script:NfcGoToTagsTemplatePath
  Set-NfcConfigProperty -Config $config -Name "goToTagsExecutableSha256" -Value $script:NfcGoToTagsExecutableSha256
  Set-NfcConfigProperty -Config $config -Name "goToTagsTemplateSha256" -Value $script:NfcGoToTagsTemplateSha256
  Set-NfcConfigProperty -Config $config -Name "goToTagsJobRoot" -Value $script:NfcGoToTagsJobRoot
  $config.schemaVersion = "tenkings-ai-grader-nfc-helper-config-v3"
  Save-NfcConfig -Config $config -Path $ConfigPath
  $validated = Read-NfcConfig -Path $ConfigPath
  [pscustomobject]@{
    ok = $true
    f8215AdapterConfigured = $true
    goToTagsVersion = "4.37.0.1"
    reviewedExecutableSha256 = $script:NfcGoToTagsExecutableSha256
    publisherVerified = $true
    reviewedTemplateSha256 = $script:NfcGoToTagsTemplateSha256
    helperRestarted = $false
    windowsServiceChanged = $false
    driverOrFirmwareAction = "none"
  } | ConvertTo-Json -Depth 3
} catch {
  $configurationFailure = $_
  if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
    Copy-Item -LiteralPath $backupPath -Destination $ConfigPath -Force -ErrorAction Stop
    Protect-NfcPath -Path $ConfigPath -AllowedRoot $script:NfcConfigRoot
  }
  if ($createdRoot -and (Test-Path -LiteralPath $script:NfcGoToTagsRoot)) {
    try { Remove-NfcSafeTree -Path $script:NfcGoToTagsRoot -AllowedRoot $script:NfcConfigRoot } catch { }
  }
  throw $configurationFailure
} finally {
  if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
    Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
  }
}
