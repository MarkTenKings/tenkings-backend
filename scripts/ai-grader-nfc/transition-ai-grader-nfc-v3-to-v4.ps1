[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ServerTrustJsonPath,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedCurrentJobSigningKeyId,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedConfigSha256,
  [string]$ConfigPath = "C:\TenKings\config\ai-grader-nfc\helper.json",
  [string]$InstallDirectory = "C:\TenKings\tools\ai-grader-nfc-helper",
  [string]$TaskName = "TenKingsAiGraderNfcHelper"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ai-grader-nfc-helper-common.ps1")

function Stop-NfcV4TransitionProcess {
  param([Parameter(Mandatory = $true)]$Config)
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  foreach ($process in @(Get-NfcHelperProcess -Config $Config)) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  }
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if (@(Get-NfcHelperProcess -Config $Config).Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "The NFC helper did not stop within the bounded V4 transition window."
}

function Get-NfcV4TransitionStatus {
  param([Parameter(Mandatory = $true)]$Config)
  $headers = @{
    Origin = $script:NfcAllowedOrigin
    "x-tenkings-nfc-token" = [string]$Config.workstationToken
  }
  return Invoke-RestMethod -Method Get -Uri "$($Config.helperUrl)/status" -Headers $headers -TimeoutSec 3
}

function Wait-NfcV4TransitionReady {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [Parameter(Mandatory = $true)][bool]$ExpectV2
  )
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      $response = Get-NfcV4TransitionStatus -Config $Config
      $status = $response.result
      $v1Compatible = @($status.supportedProfiles | Where-Object {
        $_.chipType -ceq "FEIJU_F8215" -and [bool]$_.implemented -and [bool]$_.permanentlyLocksTag
      }).Count -eq 1
      $actualKeyIds = @($status.tenKingsV2TrustedJobSigningKeyIds | ForEach-Object { [string]$_ })
      $exactKeySet = $false
      try {
        Assert-NfcExactKeyIdSet -Expected $script:ExpectedV2JobKeyIds -Actual $actualKeyIds
        $exactKeySet = $true
      } catch { $exactKeySet = $false }
      $v2Ready = [bool]$status.tenKingsV2NfcEnabled -and
        [string]$status.tenKingsV2NfcCapability -ceq "ten-kings-v2-f8215-static-url-v1" -and
        $exactKeySet
      if ($response.ok -and
          [string]$status.helperVersion -ceq $script:NfcHelperVersionV4 -and
          [string]$status.helperProtocolVersion -ceq $script:NfcHelperProtocolVersion -and
          -not [bool]$status.busy -and
          $v1Compatible -and
          $v2Ready -eq $ExpectV2) {
        return
      }
    } catch { }
    if ($attempt + 1 -lt 40) { Start-Sleep -Milliseconds 250 }
  }
  throw "The NFC helper did not reach exact V1-compatible V4 transition readiness."
}

$layout = Assert-NfcProductionLayout -ConfigPath $ConfigPath -InstallDirectory $InstallDirectory -TaskName $TaskName
$ConfigPath = $layout.ConfigPath
$InstallDirectory = $layout.InstallDirectory
$TaskName = $layout.TaskName
$config = Read-NfcConfig -Path $ConfigPath
if ($null -eq $config -or [string]$config.schemaVersion -cne "tenkings-ai-grader-nfc-helper-config-v3") {
  throw "The public-trust transition requires the exact protected V3 helper config."
}
if ((Get-NfcFileFingerprint -Path $ConfigPath) -cne $ExpectedConfigSha256) {
  throw "The protected NFC config does not match the operator-approved exact V3 preimage."
}
$semanticBefore = (Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json)
if (-not (Test-Path -LiteralPath $ServerTrustJsonPath -PathType Leaf) -or
    (Get-Item -LiteralPath $ServerTrustJsonPath).Length -gt 4096) {
  throw "The staged NFC V2 public-trust file is unavailable or outside its size bound."
}
$trustJson = Get-Content -LiteralPath $ServerTrustJsonPath -Raw
Assert-NfcV2ServerTrustJson -Value $trustJson | Out-Null
$trust = $trustJson | ConvertFrom-Json
if ([string]$trust.current.keyId -cne $ExpectedCurrentJobSigningKeyId) {
  throw "The staged NFC V2 current public key does not match the approved signing-key ID."
}
$script:ExpectedV2JobKeyIds = @(
  [string]$trust.current.keyId
  $(if ($null -ne $trust.prior) { [string]$trust.prior.keyId })
)
Assert-NfcExactKeyIdSet -Expected $script:ExpectedV2JobKeyIds -Actual $script:ExpectedV2JobKeyIds
$dll = Join-Path $InstallDirectory "TenKings.AiGrader.NfcHelper.dll"
Invoke-NfcBuildVerification -DllPath $dll -AllowedHelperVersion @($script:NfcHelperVersionV4) | Out-Null
Assert-NfcNoActiveGoToTagsRecovery -JobRoot $script:NfcGoToTagsJobRoot
$task = Assert-NfcScheduledTaskDefinition -TaskName $TaskName
if ($task.State -ne "Running" -and @(Get-NfcHelperProcess -Config $config).Count -eq 0) {
  throw "Start the idle V4 helper under its V3 config before the public-trust transition."
}
Wait-NfcV4TransitionReady -Config $config -ExpectV2 $false

$preimageAcl = Get-NfcAclFingerprint -Path $ConfigPath
try {
  $provenPriorConfigSha256 = Invoke-NfcExactConfigFileTransition `
    -Path $ConfigPath `
    -ExpectedPreimageSha256 $ExpectedConfigSha256 `
    -Mutate {
      Stop-NfcV4TransitionProcess -Config $config
      Assert-NfcNoActiveGoToTagsRecovery -JobRoot $script:NfcGoToTagsJobRoot
      $config.schemaVersion = "tenkings-ai-grader-nfc-helper-config-v4"
      Set-NfcConfigProperty -Config $config -Name "tenKingsV2ServerJobPublicKeysJson" -Value $trustJson
      Save-NfcConfig -Config $config -Path $ConfigPath -PreserveUpdatedAt
      $v4Config = Read-NfcConfig -Path $ConfigPath
      Assert-NfcV4SemanticTransition -Before $semanticBefore -After $v4Config -ExactTrustJson $trustJson
    } `
    -Validate {
      $v4Config = Read-NfcConfig -Path $ConfigPath
      Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
      Wait-NfcV4TransitionReady -Config $v4Config -ExpectV2 $true
    } `
    -BeforeRollback { Stop-NfcV4TransitionProcess -Config $config } `
    -ProtectRestored { Protect-NfcPath -Path $ConfigPath -AllowedRoot $script:NfcConfigRoot | Out-Null } `
    -AfterRollback {
      if ((Get-NfcAclFingerprint -Path $ConfigPath) -cne $preimageAcl) {
        throw "Exact protected V3 config ACL restoration could not be proven."
      }
      $restored = Read-NfcConfig -Path $ConfigPath
      Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
      Wait-NfcV4TransitionReady -Config $restored -ExpectV2 $false
    }
  [pscustomobject]@{
    ok = $true
    priorConfigVersion = "tenkings-ai-grader-nfc-helper-config-v3"
    configVersion = "tenkings-ai-grader-nfc-helper-config-v4"
    helperVersion = $script:NfcHelperVersionV4
    priorConfigSha256 = $provenPriorConfigSha256
    currentJobSigningKeyId = $ExpectedCurrentJobSigningKeyId
    trustedJobSigningKeyCount = if ($null -eq $trust.prior) { 1 } else { 2 }
    v1Compatible = $true
    idle = $true
    hardwareAccessed = $false
    productionPrivateKeyAccessed = $false
  } | ConvertTo-Json -Depth 3
} finally {
  $trustJson = $null
}
