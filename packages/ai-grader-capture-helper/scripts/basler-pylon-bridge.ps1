[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("readiness", "list-cameras", "capture-still", "fixed-rig-side-batch", "operator-preview-window", "operator-preview-mjpeg-stream", "calibration-preview-mjpeg-stream", "line2-exposure-active", "line2-user-output-pulse", "line2-status")]
  [string]$Action,

  [string]$PylonRoot,
  [string]$OutputDir,
  [string]$Label,
  [ValidateSet("front", "back")]
  [string]$Side = "front",
  [int]$CameraIndex = 0,
  [ValidateSet("png", "tiff", "jpg")]
  [string]$Format = "png",
  [string]$LensModel,
  [ValidateSet("true", "false")]
  [string]$LineInverter = "false",
  [int]$PulseMs = 500,
  [ValidateSet("true", "false")]
  [string]$IdleUserOutputValue = "false",
  [int]$ExposureUs = 0,
  [double]$Gain = -1,
  [int]$RefreshIntervalMs = 500,
  [int]$JpegQuality = 72,
  [string]$LeimacHost,
  [int]$LeimacPort = 1000,
  [int]$LeimacUnit = 1,
  [int]$PreviewDutyTenthsPercent = 12,
  [string]$SelectedChannels = "1,2,3,4,5,6,7,8",
  [switch]$Apply
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-BridgeJson {
  param([object]$Payload)
  $Payload | ConvertTo-Json -Depth 20 -Compress
}

function New-BridgeError {
  param([string]$Code, [string]$Message)
  [ordered]@{
    ok = $false
    error = [ordered]@{
      code = $Code
      message = $Message
    }
  }
}

function Get-NonEmpty {
  param([string[]]$Values)
  foreach ($value in $Values) {
    if ($null -ne $value -and $value.Trim().Length -gt 0) {
      return $value.Trim()
    }
  }
  return $null
}

function Resolve-PylonInstall {
  $root = Get-NonEmpty -Values @(
    $PylonRoot,
    $env:TENKINGS_BASLER_PYLON_ROOT,
    $env:AI_GRADER_CAPTURE_HELPER_BASLER_PYLON_ROOT,
    "C:\Program Files\Basler\pylon"
  )

  $assemblyPath = $null
  $runtimePath = $null
  $version = $null

  if ($null -ne $root -and (Test-Path -LiteralPath $root)) {
    $assemblyCandidates = @(
      (Join-Path $root "Development\Assemblies\Basler.Pylon\x64\Basler.Pylon.dll"),
      (Join-Path $root "Development\Assemblies\Basler.Pylon\net8.0\x64\Basler.Pylon.dll")
    )
    foreach ($candidate in $assemblyCandidates) {
      if (Test-Path -LiteralPath $candidate) {
        $assemblyPath = $candidate
        break
      }
    }
    $candidateRuntime = Join-Path $root "Runtime\x64"
    if (Test-Path -LiteralPath $candidateRuntime) {
      $runtimePath = $candidateRuntime
    }
    $versionPath = Join-Path $root "VersionInfo.txt"
    if (Test-Path -LiteralPath $versionPath) {
      $version = (Get-Content -LiteralPath $versionPath -Raw).Trim()
    }
  }

  [ordered]@{
    installed = ($null -ne $assemblyPath)
    root = $root
    version = $version
    assemblyPath = $assemblyPath
    runtimePath = $runtimePath
    status = $(if ($null -ne $assemblyPath) { "installed" } else { "missing" })
  }
}

function Import-PylonAssembly {
  param([System.Collections.IDictionary]$Install)
  if (-not $Install.installed) {
    throw "Basler pylon .NET assembly was not found."
  }
  if ($Install.runtimePath) {
    $env:PATH = "$($Install.runtimePath);$env:PATH"
  }
  Add-Type -Path $Install.assemblyPath
}

function Get-CameraInfoValue {
  param([object]$CameraInfo, [string]$Key)
  try {
    if ($CameraInfo.ContainsKey($Key)) {
      $value = $CameraInfo[$Key]
      if ($null -ne $value -and "$value".Length -gt 0) {
        return "$value"
      }
    }
  } catch {
  }
  try {
    $value = $CameraInfo[$Key]
    if ($null -ne $value -and "$value".Length -gt 0) {
      return "$value"
    }
  } catch {
  }
  return $null
}

function Convert-CameraInfo {
  param([object]$CameraInfo, [int]$Index)
  [ordered]@{
    index = $Index
    friendlyName = Get-CameraInfoValue $CameraInfo ([Basler.Pylon.CameraInfoKey]::FriendlyName)
    modelName = Get-CameraInfoValue $CameraInfo ([Basler.Pylon.CameraInfoKey]::ModelName)
    vendorName = Get-CameraInfoValue $CameraInfo ([Basler.Pylon.CameraInfoKey]::VendorName)
    serialNumber = Get-CameraInfoValue $CameraInfo ([Basler.Pylon.CameraInfoKey]::SerialNumber)
    deviceType = Get-CameraInfoValue $CameraInfo ([Basler.Pylon.CameraInfoKey]::DeviceType)
    transport = Get-CameraInfoValue $CameraInfo ([Basler.Pylon.CameraInfoKey]::TLType)
    deviceIpAddress = Get-CameraInfoValue $CameraInfo ([Basler.Pylon.CameraInfoKey]::DeviceIpAddress)
    deviceMacAddress = Get-CameraInfoValue $CameraInfo ([Basler.Pylon.CameraInfoKey]::DeviceMacAddress)
    subnetMask = Get-CameraInfoValue $CameraInfo ([Basler.Pylon.CameraInfoKey]::SubnetMask)
    defaultGateway = Get-CameraInfoValue $CameraInfo ([Basler.Pylon.CameraInfoKey]::DefaultGateway)
    networkInterfaceIpAddress = Get-CameraInfoValue $CameraInfo ([Basler.Pylon.CameraInfoKey]::NetworkInterfaceIpAddress)
    userDefinedName = Get-CameraInfoValue $CameraInfo ([Basler.Pylon.CameraInfoKey]::UserDefinedName)
    fullName = Get-CameraInfoValue $CameraInfo ([Basler.Pylon.CameraInfoKey]::FullName)
  }
}

function Get-ReadOnlyNetworkAdapters {
  $adapters = @()
  try {
    $ipAddresses = @{}
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.InterfaceAlias -and -not $ipAddresses.ContainsKey($_.InterfaceAlias)) {
        $ipAddresses[$_.InterfaceAlias] = $_.IPAddress
      }
    }

    Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object {
      $adapters += [ordered]@{
        interfaceAlias = $_.Name
        description = $_.InterfaceDescription
        status = "$($_.Status)"
        linkSpeed = "$($_.LinkSpeed)"
        macAddress = $_.MacAddress
        ipAddress = $ipAddresses[$_.Name]
      }
    }
  } catch {
    return @()
  }
  return $adapters
}

function Get-GigECameras {
  $devices = [Basler.Pylon.CameraFinder]::Enumerate([Basler.Pylon.DeviceType]::GigE)
  $cameras = @()
  for ($index = 0; $index -lt $devices.Count; $index += 1) {
    $cameras += Convert-CameraInfo $devices[$index] $index
  }
  return $cameras
}

function New-ReadinessResult {
  param([System.Collections.IDictionary]$Install, [array]$Cameras)
  [ordered]@{
    pylon = $Install
    transport = "GigE"
    cameraCount = $Cameras.Count
    cameras = $Cameras
    networkAdapters = Get-ReadOnlyNetworkAdapters
    status = $(if (-not $Install.installed) { "pylon_missing" } elseif ($Cameras.Count -gt 0) { "reachable" } else { "not_reachable" })
    hardwareAccess = "explicit_pylon_gige_enumeration"
    note = "Manual Basler readiness only; this command enumerates GigE cameras and does not capture images or control lighting, Arduino, stage, or network settings."
  }
}

function Get-ReadableParameterValue {
  param([object]$Camera, [object[]]$Names)
  foreach ($name in $Names) {
    try {
      $parameter = $Camera.Parameters[$name]
      if ($null -ne $parameter -and $parameter.IsReadable) {
        return $parameter.GetValue()
      }
    } catch {
    }
  }
  return $null
}

function Get-ParameterValueByName {
  param([object]$Camera, [object[]]$Names)
  foreach ($name in $Names) {
    try {
      $parameter = $Camera.Parameters[$name]
      if ($null -ne $parameter -and $parameter.IsReadable) {
        return $parameter.GetValue()
      }
    } catch {
    }
  }
  return $null
}

function Get-ReadableParameterDiagnostic {
  param([object]$Camera, [object[]]$Names)
  foreach ($name in $Names) {
    try {
      $parameter = $Camera.Parameters[$name]
      if ($null -ne $parameter -and $parameter.IsReadable) {
        $value = $parameter.GetValue()
        return [ordered]@{
          supported = $true
          value = $value
          raw = $(if ($null -ne $value) { "$value" } else { $null })
        }
      }
    } catch {
    }
  }
  return [ordered]@{
    supported = $false
    value = $null
    raw = $null
    error = "Parameter is not readable or not present."
  }
}

function Set-EnumParameterByName {
  param([object]$Camera, [object[]]$Names, [string]$Value)
  foreach ($name in $Names) {
    try {
      $parameter = $Camera.Parameters[$name]
      if ($null -ne $parameter -and $parameter.IsWritable) {
        $parameter.SetValue($Value)
        return
      }
    } catch {
    }
  }
  throw "Writable Basler parameter was not found for value $Value."
}

function Set-BoolParameterByName {
  param([object]$Camera, [object[]]$Names, [bool]$Value)
  foreach ($name in $Names) {
    try {
      $parameter = $Camera.Parameters[$name]
      if ($null -ne $parameter -and $parameter.IsWritable) {
        $parameter.SetValue($Value)
        return
      }
    } catch {
    }
  }
  throw "Writable Basler boolean parameter was not found."
}

function Set-FloatParameterByName {
  param([object]$Camera, [object[]]$Names, [double]$Value)
  foreach ($name in $Names) {
    try {
      $parameter = $Camera.Parameters[$name]
      if ($null -ne $parameter -and $parameter.IsWritable) {
        $parameter.SetValue($Value)
        return $true
      }
    } catch {
    }
  }
  return $false
}

function Get-Line2UserOutputReadback {
  param([object]$Camera)
  [ordered]@{
    lineSelector = Get-ParameterValueByName $Camera @([Basler.Pylon.PLCamera]::LineSelector, "LineSelector")
    lineMode = Get-ParameterValueByName $Camera @([Basler.Pylon.PLCamera]::LineMode, "LineMode")
    lineSource = Get-ParameterValueByName $Camera @([Basler.Pylon.PLCamera]::LineSource, "LineSource")
    lineInverter = Get-ParameterValueByName $Camera @([Basler.Pylon.PLCamera]::LineInverter, "LineInverter")
    userOutputSelector = Get-ParameterValueByName $Camera @("UserOutputSelector")
    userOutputValue = Get-ParameterValueByName $Camera @("UserOutputValue")
    lineStatus = Get-ReadableParameterDiagnostic $Camera @("LineStatus")
    lineStatusAll = Get-ReadableParameterDiagnostic $Camera @("LineStatusAll")
  }
}

function Configure-Line2ExposureActive {
  param([System.Collections.IDictionary]$Install)
  $lineInverterBool = ($LineInverter -eq "true")

  if (-not $Apply) {
    return [ordered]@{
      applied = $false
      baslerSettingsChanged = $false
      cameraIndex = $CameraIndex
      lineSelector = "Line2"
      lineMode = "Output"
      lineSource = "ExposureActive"
      lineInverter = $lineInverterBool
      persistentSaved = $false
      hardwareAccess = "dry_run_no_camera_opened"
      safety = [ordered]@{
        dryRun = $true
        writesApplied = $false
        baslerSettingsChanged = $false
        persistentSaved = $false
        capturesImages = $false
        controlsLighting = $false
      }
      note = "Dry-run Basler Line 2 plan only; does not open the camera, does not save a User Set, and does not capture images."
    }
  }

  $devices = [Basler.Pylon.CameraFinder]::Enumerate([Basler.Pylon.DeviceType]::GigE)
  if ($devices.Count -eq 0) {
    throw "No Basler GigE cameras were detected."
  }
  if ($CameraIndex -lt 0 -or $CameraIndex -ge $devices.Count) {
    throw "CameraIndex $CameraIndex is out of range for $($devices.Count) detected camera(s)."
  }

  $camera = [Basler.Pylon.Camera]::new($devices[$CameraIndex])
  try {
    [void]$camera.Open()
    Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::LineSelector, "LineSelector") "Line2"
    Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::LineMode, "LineMode") "Output"
    Set-BoolParameterByName $camera @([Basler.Pylon.PLCamera]::LineInverter, "LineInverter") $lineInverterBool
    Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::LineSource, "LineSource") "ExposureActive"

    $readback = [ordered]@{
      lineSelector = Get-ParameterValueByName $camera @([Basler.Pylon.PLCamera]::LineSelector, "LineSelector")
      lineMode = Get-ParameterValueByName $camera @([Basler.Pylon.PLCamera]::LineMode, "LineMode")
      lineSource = Get-ParameterValueByName $camera @([Basler.Pylon.PLCamera]::LineSource, "LineSource")
      lineInverter = Get-ParameterValueByName $camera @([Basler.Pylon.PLCamera]::LineInverter, "LineInverter")
      lineStatus = Get-ReadableParameterDiagnostic $camera @("LineStatus")
      lineStatusAll = Get-ReadableParameterDiagnostic $camera @("LineStatusAll")
    }

    return [ordered]@{
      applied = $true
      baslerSettingsChanged = $true
      cameraIndex = $CameraIndex
      lineSelector = "Line2"
      lineMode = "Output"
      lineSource = "ExposureActive"
      lineInverter = $lineInverterBool
      persistentSaved = $false
      hardwareAccess = "explicit_pylon_line2_configuration"
      readback = $readback
      safety = [ordered]@{
        dryRun = $false
        writesApplied = $true
        baslerSettingsChanged = $true
        persistentSaved = $false
        capturesImages = $false
        controlsLighting = $false
      }
      note = "Transient Basler Line 2 ExposureActive configuration only; no User Set was saved and no image was captured."
    }
  } finally {
    if ($camera.IsOpen) {
      try { [void]$camera.Close() } catch {}
    }
    try { $camera.Dispose() } catch {}
  }
}

function Pulse-Line2UserOutput {
  param([System.Collections.IDictionary]$Install)
  $lineInverterBool = ($LineInverter -eq "true")
  $idleBool = ($IdleUserOutputValue -eq "true")
  $pulseBool = (-not $idleBool)

  if ($PulseMs -lt 250 -or $PulseMs -gt 500) {
    throw "PulseMs must be from 250 to 500."
  }

  if (-not $Apply) {
    return [ordered]@{
      applied = $false
      baslerSettingsChanged = $false
      cameraIndex = $CameraIndex
      lineSelector = "Line2"
      lineMode = "Output"
      lineSource = "UserOutput1"
      lineInverter = $lineInverterBool
      userOutputSelector = "UserOutput1"
      idleUserOutputValue = $idleBool
      pulseUserOutputValue = $pulseBool
      pulseMs = $PulseMs
      persistentSaved = $false
      hardwareAccess = "dry_run_no_camera_opened"
      safety = [ordered]@{
        dryRun = $true
        writesApplied = $false
        baslerSettingsChanged = $false
        persistentSaved = $false
        capturesImages = $false
        controlsLighting = $false
        restoresIdle = $true
      }
      note = "Dry-run Basler Line 2 UserOutput1 pulse plan only; does not open the camera, does not save a User Set, and does not capture images."
    }
  }

  $devices = [Basler.Pylon.CameraFinder]::Enumerate([Basler.Pylon.DeviceType]::GigE)
  if ($devices.Count -eq 0) {
    throw "No Basler GigE cameras were detected."
  }
  if ($CameraIndex -lt 0 -or $CameraIndex -ge $devices.Count) {
    throw "CameraIndex $CameraIndex is out of range for $($devices.Count) detected camera(s)."
  }

  $camera = [Basler.Pylon.Camera]::new($devices[$CameraIndex])
  try {
    [void]$camera.Open()
    Set-EnumParameterByName $camera @("UserOutputSelector") "UserOutput1"
    Set-BoolParameterByName $camera @("UserOutputValue") $idleBool
    Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::LineSelector, "LineSelector") "Line2"
    Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::LineMode, "LineMode") "Output"
    Set-BoolParameterByName $camera @([Basler.Pylon.PLCamera]::LineInverter, "LineInverter") $lineInverterBool
    Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::LineSource, "LineSource") "UserOutput1"

    $beforePulse = Get-Line2UserOutputReadback $camera
    Set-BoolParameterByName $camera @("UserOutputValue") $pulseBool
    Start-Sleep -Milliseconds $PulseMs
    $duringPulse = Get-Line2UserOutputReadback $camera
    Set-BoolParameterByName $camera @("UserOutputValue") $idleBool
    $afterPulse = Get-Line2UserOutputReadback $camera

    return [ordered]@{
      applied = $true
      baslerSettingsChanged = $true
      cameraIndex = $CameraIndex
      lineSelector = "Line2"
      lineMode = "Output"
      lineSource = "UserOutput1"
      lineInverter = $lineInverterBool
      userOutputSelector = "UserOutput1"
      idleUserOutputValue = $idleBool
      pulseUserOutputValue = $pulseBool
      pulseMs = $PulseMs
      persistentSaved = $false
      hardwareAccess = "explicit_pylon_line2_user_output_pulse"
      readback = [ordered]@{
        beforePulse = $beforePulse
        duringPulse = $duringPulse
        afterPulse = $afterPulse
      }
      safety = [ordered]@{
        dryRun = $false
        writesApplied = $true
        baslerSettingsChanged = $true
        persistentSaved = $false
        capturesImages = $false
        controlsLighting = $false
        restoresIdle = $true
      }
      note = "Transient Basler Line 2 UserOutput1 manual pulse only; UserOutputValue was restored to idle, no User Set was saved, and no image was captured."
    }
  } finally {
    if ($camera.IsOpen) {
      try {
        Set-EnumParameterByName $camera @("UserOutputSelector") "UserOutput1"
        Set-BoolParameterByName $camera @("UserOutputValue") $idleBool
      } catch {}
      try { [void]$camera.Close() } catch {}
    }
    try { $camera.Dispose() } catch {}
  }
}

function Read-Line2Status {
  param([System.Collections.IDictionary]$Install)

  $devices = [Basler.Pylon.CameraFinder]::Enumerate([Basler.Pylon.DeviceType]::GigE)
  if ($devices.Count -eq 0) {
    throw "No Basler GigE cameras were detected."
  }
  if ($CameraIndex -lt 0 -or $CameraIndex -ge $devices.Count) {
    throw "CameraIndex $CameraIndex is out of range for $($devices.Count) detected camera(s)."
  }

  $camera = [Basler.Pylon.Camera]::new($devices[$CameraIndex])
  try {
    [void]$camera.Open()
    Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::LineSelector, "LineSelector") "Line2"

    $readback = [ordered]@{
      lineSelector = Get-ParameterValueByName $camera @([Basler.Pylon.PLCamera]::LineSelector, "LineSelector")
      lineMode = Get-ParameterValueByName $camera @([Basler.Pylon.PLCamera]::LineMode, "LineMode")
      lineSource = Get-ParameterValueByName $camera @([Basler.Pylon.PLCamera]::LineSource, "LineSource")
      lineInverter = Get-ParameterValueByName $camera @([Basler.Pylon.PLCamera]::LineInverter, "LineInverter")
      lineStatus = Get-ReadableParameterDiagnostic $camera @("LineStatus")
      lineStatusAll = Get-ReadableParameterDiagnostic $camera @("LineStatusAll")
    }

    return [ordered]@{
      applied = $false
      baslerSettingsChanged = $false
      cameraIndex = $CameraIndex
      lineSelector = "Line2"
      persistentSaved = $false
      hardwareAccess = "explicit_pylon_line2_status_read"
      readback = $readback
      safety = [ordered]@{
        dryRun = $false
        writesApplied = $false
        baslerSettingsChanged = $false
        persistentSaved = $false
        capturesImages = $false
        controlsLighting = $false
      }
      note = "Read-only Basler Line 2 status readback; no User Set was saved and no image was captured."
    }
  } finally {
    if ($camera.IsOpen) {
      try { [void]$camera.Close() } catch {}
    }
    try { $camera.Dispose() } catch {}
  }
}

function Get-ImageFileFormat {
  param([string]$RequestedFormat)
  switch ($RequestedFormat) {
    "png" { return [Basler.Pylon.ImageFileFormat]::Png }
    "tiff" { return [Basler.Pylon.ImageFileFormat]::Tiff }
    "jpg" { return [Basler.Pylon.ImageFileFormat]::Jpeg }
  }
  throw "Unsupported image format: $RequestedFormat"
}

function Get-MimeType {
  param([string]$RequestedFormat)
  switch ($RequestedFormat) {
    "png" { return "image/png" }
    "tiff" { return "image/tiff" }
    "jpg" { return "image/jpeg" }
  }
  return "application/octet-stream"
}

function Get-SavedImageFormatName {
  param([string]$RequestedFormat)
  switch ($RequestedFormat) {
    "png" { return "PNG" }
    "tiff" { return "TIFF" }
    "jpg" { return "JPG" }
  }
  return $RequestedFormat.ToUpperInvariant()
}

function Get-FileExtension {
  param([string]$RequestedFormat)
  switch ($RequestedFormat) {
    "png" { return "png" }
    "tiff" { return "tiff" }
    "jpg" { return "jpg" }
  }
  return $RequestedFormat
}

function New-SafeLabel {
  param([string]$RawLabel)
  $safe = ($RawLabel -replace "[^A-Za-z0-9._-]+", "-").Trim("-")
  if ($safe.Length -eq 0) {
    return "basler-smoke"
  }
  return $safe
}

function Capture-Still {
  param([System.Collections.IDictionary]$Install)

  if (-not $OutputDir -or $OutputDir.Trim().Length -eq 0) {
    throw "OutputDir is required."
  }
  if (-not $Label -or $Label.Trim().Length -eq 0) {
    throw "Label is required."
  }

  $devices = [Basler.Pylon.CameraFinder]::Enumerate([Basler.Pylon.DeviceType]::GigE)
  if ($devices.Count -eq 0) {
    throw "No Basler GigE cameras were detected."
  }
  if ($CameraIndex -lt 0 -or $CameraIndex -ge $devices.Count) {
    throw "CameraIndex $CameraIndex is out of range for $($devices.Count) detected camera(s)."
  }

  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

  $timestampUtc = (Get-Date).ToUniversalTime()
  $timestamp = $timestampUtc.ToString("yyyy-MM-ddTHH:mm:ss.fffffffZ")
  $stamp = $timestampUtc.ToString("yyyyMMddTHHmmssfffZ")
  $safeLabel = New-SafeLabel $Label
  $extension = Get-FileExtension $Format
  $outputFilePath = Join-Path $OutputDir "basler-$safeLabel-$stamp.$extension"
  $imageFileFormat = Get-ImageFileFormat $Format
  $cameraInfo = $devices[$CameraIndex]
  $cameraMetadata = Convert-CameraInfo $cameraInfo $CameraIndex
  $camera = [Basler.Pylon.Camera]::new($cameraInfo)
  $streamStarted = $false
  $grabResult = $null
  $timing = [ordered]@{
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
  }

  try {
    $phase = [System.Diagnostics.Stopwatch]::StartNew()
    [void]$camera.Open()
    $phase.Stop()
    $timing.open = [ordered]@{ durationMs = [Math]::Round($phase.Elapsed.TotalMilliseconds, 1) }
    $phase.Restart()
    if ($ExposureUs -gt 0) {
      [void](Set-FloatParameterByName $camera @([Basler.Pylon.PLCamera]::ExposureTime, [Basler.Pylon.PLCamera]::ExposureTimeAbs, "ExposureTime") ([double]$ExposureUs))
    }
    $configuredPixelFormat = Get-ReadableParameterValue $camera @([Basler.Pylon.PLCamera]::PixelFormat)
    $exposureTime = Get-ReadableParameterValue $camera @([Basler.Pylon.PLCamera]::ExposureTime, [Basler.Pylon.PLCamera]::ExposureTimeAbs)
    $gain = Get-ReadableParameterValue $camera @([Basler.Pylon.PLCamera]::Gain, [Basler.Pylon.PLCamera]::GainAbs, [Basler.Pylon.PLCamera]::GainRaw)
    $phase.Stop()
    $timing.configure = [ordered]@{ durationMs = [Math]::Round($phase.Elapsed.TotalMilliseconds, 1) }

    $phase.Restart()
    [void]$camera.StreamGrabber.Start(1)
    $streamStarted = $true
    $grabResult = $camera.StreamGrabber.RetrieveResult(10000, [Basler.Pylon.TimeoutHandling]::ThrowException)
    if (-not $grabResult.GrabSucceeded) {
      throw "Basler grab failed: $($grabResult.ErrorCode) $($grabResult.ErrorDescription)"
    }

    $sourcePixelFormat = "$($grabResult.PixelTypeValue)"
    if (-not $sourcePixelFormat -or $sourcePixelFormat.Length -eq 0) {
      $sourcePixelFormat = "$configuredPixelFormat"
    }
    $imageWidth = [int]$grabResult.Width
    $imageHeight = [int]$grabResult.Height
    $phase.Stop()
    $timing.grab = [ordered]@{ durationMs = [Math]::Round($phase.Elapsed.TotalMilliseconds, 1) }

    $phase.Restart()
    [Basler.Pylon.ImagePersistence]::Save($imageFileFormat, $outputFilePath, $grabResult)
    $phase.Stop()
    $timing.save = [ordered]@{ durationMs = [Math]::Round($phase.Elapsed.TotalMilliseconds, 1) }

    $phase.Restart()
    $file = Get-Item -LiteralPath $outputFilePath
    $sha256 = (Get-FileHash -LiteralPath $outputFilePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $phase.Stop()
    $timing.hash = [ordered]@{ durationMs = [Math]::Round($phase.Elapsed.TotalMilliseconds, 1) }
    $timing.finishedBeforeCloseAt = (Get-Date).ToUniversalTime().ToString("o")

    $captureResult = [ordered]@{
      outputFilePath = $outputFilePath
      sha256 = $sha256
      byteSize = $file.Length
      mimeType = Get-MimeType $Format
      timestamp = $timestamp
      camera = $cameraMetadata
      imageWidth = $imageWidth
      imageHeight = $imageHeight
      sourcePixelFormat = $sourcePixelFormat
      savedImageFormat = Get-SavedImageFormatName $Format
      exposureTime = $exposureTime
      gain = $gain
      transport = "GigE"
      pylon = $Install
      calibration = [ordered]@{
        isCalibrated = $false
        calibrationProfileId = $null
        lensModel = $(if ($LensModel -and $LensModel.Trim().Length -gt 0) { $LensModel.Trim() } else { $null })
        cameraRole = "macro_overview"
        evidenceClass = "macro_raw_smoke"
        coordinateFrame = "basler_sensor_pixels"
      }
      timing = $timing
      note = "Uncalibrated macro smoke capture only; not production macro evidence and not a final AI grade."
    }
    return $captureResult
  } finally {
    $closePhase = [System.Diagnostics.Stopwatch]::StartNew()
    if ($null -ne $grabResult) {
      try { $grabResult.Dispose() } catch {}
    }
    if ($streamStarted) {
      try { [void]$camera.StreamGrabber.Stop() } catch {}
    }
    if ($camera.IsOpen) {
      try { [void]$camera.Close() } catch {}
    }
    try { $camera.Dispose() } catch {}
    $closePhase.Stop()
    $timing.closeDispose = [ordered]@{ durationMs = [Math]::Round($closePhase.Elapsed.TotalMilliseconds, 1) }
  }
}

function Get-ZoomRect {
  param([System.Drawing.Rectangle]$Bounds, [int]$ImageWidth, [int]$ImageHeight)
  if ($ImageWidth -le 0 -or $ImageHeight -le 0 -or $Bounds.Width -le 0 -or $Bounds.Height -le 0) {
    return $Bounds
  }
  $imageRatio = [double]$ImageWidth / [double]$ImageHeight
  $boundsRatio = [double]$Bounds.Width / [double]$Bounds.Height
  if ($boundsRatio -gt $imageRatio) {
    $height = $Bounds.Height
    $width = [int]([double]$height * $imageRatio)
    $x = $Bounds.X + [int](($Bounds.Width - $width) / 2)
    return [System.Drawing.Rectangle]::new($x, $Bounds.Y, $width, $height)
  }
  $width = $Bounds.Width
  $height = [int]([double]$width / $imageRatio)
  $y = $Bounds.Y + [int](($Bounds.Height - $height) / 2)
  return [System.Drawing.Rectangle]::new($Bounds.X, $y, $width, $height)
}

function New-RelativeRect {
  param([System.Drawing.RectangleF]$Guide, [double]$X, [double]$Y, [double]$Width, [double]$Height)
  return [System.Drawing.RectangleF]::new(
    [single]($Guide.X + ($Guide.Width * $X)),
    [single]($Guide.Y + ($Guide.Height * $Y)),
    [single]($Guide.Width * $Width),
    [single]($Guide.Height * $Height)
  )
}

function Measure-PreviewBitmap {
  param([System.Drawing.Bitmap]$Bitmap)
  $step = 16
  $count = 0
  $sum = 0.0
  $max = 0
  $clipped = 0
  $dark = 0
  $gradient = 0.0
  $gradientCount = 0
  for ($y = 0; $y -lt $Bitmap.Height; $y += $step) {
    for ($x = 0; $x -lt $Bitmap.Width; $x += $step) {
      $pixel = $Bitmap.GetPixel($x, $y)
      $value = [int](($pixel.R + $pixel.G + $pixel.B) / 3)
      $sum += $value
      if ($value -gt $max) { $max = $value }
      if ($value -ge 250) { $clipped += 1 }
      if ($value -le 10) { $dark += 1 }
      $count += 1
      if (($x + $step) -lt $Bitmap.Width) {
        $next = $Bitmap.GetPixel(($x + $step), $y)
        $nextValue = [int](($next.R + $next.G + $next.B) / 3)
        $gradient += [Math]::Abs($value - $nextValue)
        $gradientCount += 1
      }
      if (($y + $step) -lt $Bitmap.Height) {
        $nextY = $Bitmap.GetPixel($x, ($y + $step))
        $nextYValue = [int](($nextY.R + $nextY.G + $nextY.B) / 3)
        $gradient += [Math]::Abs($value - $nextYValue)
        $gradientCount += 1
      }
    }
  }
  if ($count -eq 0) {
    return [ordered]@{ mean = 0; max = 0; clippedFraction = 0; darkFraction = 0; sharpness = 0 }
  }
  [ordered]@{
    mean = [Math]::Round(($sum / $count), 4)
    max = $max
    clippedFraction = [Math]::Round(($clipped / $count), 6)
    darkFraction = [Math]::Round(($dark / $count), 6)
    sharpness = $(if ($gradientCount -gt 0) { [Math]::Round(($gradient / $gradientCount), 4) } else { 0 })
  }
}

function New-LeimacChannelData {
  param([int[]]$EnabledChannels, [string]$EnabledValue, [string]$DisabledValue = "0000")
  $data = ""
  for ($channel = 1; $channel -le 8; $channel += 1) {
    $value = $(if ($EnabledChannels -contains $channel) { $EnabledValue } else { $DisabledValue })
    $data += ("{0:D2}{1}" -f $channel, $value)
  }
  return $data
}

function New-LeimacFrame {
  param([string]$CommandNumber, [string]$ChannelData)
  return "W$CommandNumber$("{0:D2}" -f $LeimacUnit)$ChannelData"
}

function Send-LeimacFrame {
  param([string]$Frame)
  if (-not $LeimacHost -or $LeimacHost.Trim().Length -eq 0) {
    return "DISABLED"
  }
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connectTask = $client.ConnectAsync($LeimacHost, $LeimacPort)
    if (-not $connectTask.Wait(1500)) {
      throw "Timed out connecting to Leimac $LeimacHost`:$LeimacPort"
    }
    $stream = $client.GetStream()
    $stream.ReadTimeout = 1500
    $stream.WriteTimeout = 1500
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($Frame)
    $stream.Write($bytes, 0, $bytes.Length)
    $buffer = New-Object byte[] 256
    $read = $stream.Read($buffer, 0, $buffer.Length)
    if ($read -le 0) { return "" }
    return [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
  } finally {
    try { $client.Close() } catch {}
    try { $client.Dispose() } catch {}
  }
}

function Invoke-LeimacPreviewSafeOff {
  $offData = New-LeimacChannelData -EnabledChannels @() -EnabledValue "0000" -DisabledValue "0000"
  $responses = @()
  $responses += Send-LeimacFrame (New-LeimacFrame "86" $offData)
  $responses += Send-LeimacFrame (New-LeimacFrame "85" $offData)
  $responses += Send-LeimacFrame (New-LeimacFrame "11" $offData)
  return $responses
}

function Invoke-LeimacPreviewApply {
  param([int[]]$EnabledChannels, [int]$DutyTenthsPercent)
  if ($DutyTenthsPercent -lt 0 -or $DutyTenthsPercent -gt 50) {
    throw "Preview duty must be from 0.0% to 5.0%."
  }
  [void](Invoke-LeimacPreviewSafeOff)
  if ($EnabledChannels.Count -eq 0 -or $DutyTenthsPercent -eq 0) {
    return @("preview-light-off")
  }
  $dutySteps = [int]$DutyTenthsPercent
  $dutyValue = "{0:D4}" -f $dutySteps
  $dutyData = New-LeimacChannelData -EnabledChannels $EnabledChannels -EnabledValue $dutyValue -DisabledValue "0000"
  $onData = New-LeimacChannelData -EnabledChannels $EnabledChannels -EnabledValue "0001" -DisabledValue "0000"
  $responses = @()
  $responses += Send-LeimacFrame (New-LeimacFrame "11" $dutyData)
  $responses += Send-LeimacFrame (New-LeimacFrame "86" $onData)
  return $responses
}

function Parse-SelectedLeimacChannels {
  param([string]$Raw)
  $channels = @()
  foreach ($part in ($Raw -split ",")) {
    $trimmed = $part.Trim()
    if ($trimmed.Length -eq 0) { continue }
    $channel = [int]$trimmed
    if ($channel -lt 1 -or $channel -gt 8) {
      throw "SelectedChannels must contain only channels 1 through 8."
    }
    if ($channels -notcontains $channel) {
      $channels += $channel
    }
  }
  if ($channels.Count -eq 0) {
    throw "SelectedChannels must include at least one channel."
  }
  return $channels | Sort-Object
}

function New-WarmLeimacFrameObject {
  param(
    [string]$Name,
    [string]$CommandNumber,
    [int[]]$EnabledChannels,
    [string]$EnabledValue,
    [string]$DisabledValue,
    [string]$Meaning
  )
  $targetDesignation = "{0:D2}" -f $LeimacUnit
  $channelValues = @()
  $data = ""
  for ($channel = 1; $channel -le 8; $channel += 1) {
    $value = $(if ($EnabledChannels -contains $channel) { $EnabledValue } else { $DisabledValue })
    $channelValues += [ordered]@{
      channel = $channel
      value = $value
      meaning = $(if ($value -eq $EnabledValue) { $Meaning } else { "Off / disabled" })
    }
    $data += ("{0:D2}{1}" -f $channel, $value)
  }
  $requestFrame = "W$CommandNumber$targetDesignation$data"
  return [ordered]@{
    name = $Name
    commandNumber = $CommandNumber
    description = $Name
    targetDesignation = $targetDesignation
    channelValues = $channelValues
    requestAscii = $requestFrame
    requestFrame = $requestFrame
    terminator = ""
    allowlisted = $true
  }
}

function New-WarmLeimacSafeOffFrames {
  $none = @()
  return @(
    (New-WarmLeimacFrameObject -Name "lightingOutput" -CommandNumber "86" -EnabledChannels $none -EnabledValue "0000" -DisabledValue "0000" -Meaning "Lighting output OFF"),
    (New-WarmLeimacFrameObject -Name "asynchronousOutput" -CommandNumber "85" -EnabledChannels $none -EnabledValue "0000" -DisabledValue "0000" -Meaning "Asynchronous output OFF"),
    (New-WarmLeimacFrameObject -Name "lightingOutputValue" -CommandNumber "11" -EnabledChannels $none -EnabledValue "0000" -DisabledValue "0000" -Meaning "PWM duty 0 steps for safe-off")
  )
}

function New-WarmLeimacTriggerSetupFrames {
  $all = @(1, 2, 3, 4, 5, 6, 7, 8)
  return @(
    (New-WarmLeimacFrameObject -Name "triggerActivation" -CommandNumber "09" -EnabledChannels $all -EnabledValue "0002" -DisabledValue "0002" -Meaning "LevelLow"),
    (New-WarmLeimacFrameObject -Name "triggerSource" -CommandNumber "65" -EnabledChannels $all -EnabledValue "0000" -DisabledValue "0000" -Meaning "TRG IN1"),
    (New-WarmLeimacFrameObject -Name "triggerSynchronizationMode" -CommandNumber "84" -EnabledChannels $all -EnabledValue "0000" -DisabledValue "0000" -Meaning "Synchronous"),
    (New-WarmLeimacFrameObject -Name "lightingOutputDelay" -CommandNumber "13" -EnabledChannels $all -EnabledValue "0000" -DisabledValue "0000" -Meaning "0 microseconds"),
    (New-WarmLeimacFrameObject -Name "asynchronousOutput" -CommandNumber "85" -EnabledChannels $all -EnabledValue "0000" -DisabledValue "0000" -Meaning "Asynchronous output OFF")
  )
}

function New-WarmLeimacLightFrames {
  param([int[]]$Channels, [int]$DutyTenthsPercent)
  if ($DutyTenthsPercent -lt 0 -or $DutyTenthsPercent -gt 50) {
    throw "Warm capture duty must be from 0.0% to 5.0%."
  }
  $dutyValue = "{0:D4}" -f $DutyTenthsPercent
  return @(
    (New-WarmLeimacFrameObject -Name "lightingOutputValue" -CommandNumber "11" -EnabledChannels $Channels -EnabledValue $dutyValue -DisabledValue "0000" -Meaning "PWM duty $($DutyTenthsPercent / 10)%"),
    (New-WarmLeimacFrameObject -Name "lightingOutput" -CommandNumber "86" -EnabledChannels $Channels -EnabledValue "0001" -DisabledValue "0000" -Meaning "Lighting output enabled for trigger-controlled capture")
  )
}

function New-WarmLeimacSession {
  if (-not $LeimacHost -or $LeimacHost.Trim().Length -eq 0) {
    return [ordered]@{
      enabled = $false
      client = $null
      stream = $null
      reconnectCount = 0
      persistentConnectionUsed = $false
    }
  }
  $session = [ordered]@{
    enabled = $true
    client = $null
    stream = $null
    reconnectCount = 0
    persistentConnectionUsed = $false
  }
  Open-WarmLeimacSession $session
  return $session
}

function Open-WarmLeimacSession {
  param([System.Collections.IDictionary]$Session)
  if (-not $Session.enabled) { return }
  try { if ($null -ne $Session.stream) { $Session.stream.Dispose() } } catch {}
  try { if ($null -ne $Session.client) { $Session.client.Dispose() } } catch {}
  $client = [System.Net.Sockets.TcpClient]::new()
  $connectTask = $client.ConnectAsync($LeimacHost, $LeimacPort)
  if (-not $connectTask.Wait(1500)) {
    try { $client.Dispose() } catch {}
    throw "Timed out connecting to Leimac $LeimacHost`:$LeimacPort"
  }
  $stream = $client.GetStream()
  $stream.ReadTimeout = 1500
  $stream.WriteTimeout = 1500
  $Session.client = $client
  $Session.stream = $stream
  $Session.persistentConnectionUsed = $true
}

function Close-WarmLeimacSession {
  param([System.Collections.IDictionary]$Session)
  if ($null -eq $Session) { return }
  try { if ($null -ne $Session.stream) { $Session.stream.Dispose() } } catch {}
  try { if ($null -ne $Session.client) { $Session.client.Dispose() } } catch {}
  $Session.stream = $null
  $Session.client = $null
}

function Send-WarmLeimacFrameObject {
  param([System.Collections.IDictionary]$Session, [System.Collections.IDictionary]$Frame)
  $started = (Get-Date).ToUniversalTime()
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  if (-not $Session.enabled) {
    return [ordered]@{
      ok = $true
      host = ""
      port = $LeimacPort
      timeoutMs = 1500
      startedAt = $started.ToString("o")
      finishedAt = (Get-Date).ToUniversalTime().ToString("o")
      durationMs = 0
      frame = $Frame
      rawResponse = "DISABLED"
      responseKind = "ack"
    }
  }
  $attempts = 0
  while ($attempts -lt 2) {
    $attempts += 1
    try {
      if ($null -eq $Session.stream) {
        Open-WarmLeimacSession $Session
        $Session.reconnectCount = [int]$Session.reconnectCount + 1
      }
      $bytes = [System.Text.Encoding]::ASCII.GetBytes([string]$Frame.requestFrame)
      $Session.stream.Write($bytes, 0, $bytes.Length)
      $buffer = New-Object byte[] 256
      $read = $Session.stream.Read($buffer, 0, $buffer.Length)
      $raw = $(if ($read -gt 0) { [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read) } else { "" })
      $responseKind = $(if ($raw -match "NAK") { "nak" } elseif ($raw -match "ACK|^A|OK" -or $raw.Length -gt 0) { "ack" } else { "unknown" })
      $watch.Stop()
      return [ordered]@{
        ok = ($responseKind -ne "nak")
        host = $LeimacHost
        port = $LeimacPort
        timeoutMs = 1500
        startedAt = $started.ToString("o")
        finishedAt = (Get-Date).ToUniversalTime().ToString("o")
        durationMs = [Math]::Round($watch.Elapsed.TotalMilliseconds, 1)
        frame = $Frame
        rawResponse = $raw
        responseKind = $responseKind
      }
    } catch {
      Close-WarmLeimacSession $Session
      if ($attempts -ge 2) {
        $watch.Stop()
        return [ordered]@{
          ok = $false
          host = $LeimacHost
          port = $LeimacPort
          timeoutMs = 1500
          startedAt = $started.ToString("o")
          finishedAt = (Get-Date).ToUniversalTime().ToString("o")
          durationMs = [Math]::Round($watch.Elapsed.TotalMilliseconds, 1)
          frame = $Frame
          responseKind = "unknown"
          error = $_.Exception.Message
        }
      }
      $Session.reconnectCount = [int]$Session.reconnectCount + 1
    }
  }
}

function Apply-WarmLeimacFrames {
  param([System.Collections.IDictionary]$Session, [object[]]$Frames)
  $writes = @()
  foreach ($frame in $Frames) {
    $write = Send-WarmLeimacFrameObject -Session $Session -Frame $frame
    $writes += $write
    if (-not $write.ok) {
      throw "Leimac warm write failed for $($frame.name): $($write.error)"
    }
  }
  return $writes
}

function Configure-WarmBatchCamera {
  param([object]$Camera)
  try { Set-EnumParameterByName $Camera @([Basler.Pylon.PLCamera]::TriggerSelector, "TriggerSelector") "FrameStart" } catch {}
  try { Set-EnumParameterByName $Camera @([Basler.Pylon.PLCamera]::TriggerMode, "TriggerMode") "Off" } catch {}
  try { Set-EnumParameterByName $Camera @([Basler.Pylon.PLCamera]::ExposureAuto, "ExposureAuto") "Off" } catch {}
  try { Set-EnumParameterByName $Camera @([Basler.Pylon.PLCamera]::GainAuto, "GainAuto") "Off" } catch {}
  if ($ExposureUs -gt 0) {
    [void](Set-FloatParameterByName $Camera @([Basler.Pylon.PLCamera]::ExposureTime, [Basler.Pylon.PLCamera]::ExposureTimeAbs, "ExposureTime") ([double]$ExposureUs))
  }
  if ($Gain -ge 0) {
    try { [void](Set-FloatParameterByName $Camera @([Basler.Pylon.PLCamera]::Gain, [Basler.Pylon.PLCamera]::GainAbs, [Basler.Pylon.PLCamera]::GainRaw, "Gain") ([double]$Gain)) } catch {}
  }
  Set-EnumParameterByName $Camera @([Basler.Pylon.PLCamera]::LineSelector, "LineSelector") "Line2"
  Set-EnumParameterByName $Camera @([Basler.Pylon.PLCamera]::LineMode, "LineMode") "Output"
  Set-BoolParameterByName $Camera @([Basler.Pylon.PLCamera]::LineInverter, "LineInverter") $true
  Set-EnumParameterByName $Camera @([Basler.Pylon.PLCamera]::LineSource, "LineSource") "ExposureActive"
}

function Capture-WarmStill {
  param(
    [object]$Camera,
    [System.Collections.IDictionary]$Install,
    [System.Collections.IDictionary]$CameraMetadata,
    [string]$CaptureLabel,
    [string]$ConfiguredPixelFormat,
    [object]$ExposureTime,
    [object]$ConfiguredGain
  )
  $timestampUtc = (Get-Date).ToUniversalTime()
  $timestamp = $timestampUtc.ToString("yyyy-MM-ddTHH:mm:ss.fffffffZ")
  $stamp = $timestampUtc.ToString("yyyyMMddTHHmmssfffZ")
  $safeLabel = New-SafeLabel $CaptureLabel
  $extension = Get-FileExtension $Format
  $outputFilePath = Join-Path $OutputDir "basler-$safeLabel-$stamp.$extension"
  $imageFileFormat = Get-ImageFileFormat $Format
  $streamStarted = $false
  $grabResult = $null
  $timing = [ordered]@{
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    open = [ordered]@{ durationMs = 0; reusedWarmCamera = $true }
    configure = [ordered]@{ durationMs = 0; reusedWarmCamera = $true }
  }
  try {
    $phase = [System.Diagnostics.Stopwatch]::StartNew()
    [void]$Camera.StreamGrabber.Start(1)
    $streamStarted = $true
    $grabResult = $Camera.StreamGrabber.RetrieveResult(10000, [Basler.Pylon.TimeoutHandling]::ThrowException)
    if (-not $grabResult.GrabSucceeded) {
      throw "Basler warm grab failed: $($grabResult.ErrorCode) $($grabResult.ErrorDescription)"
    }
    $sourcePixelFormat = "$($grabResult.PixelTypeValue)"
    if (-not $sourcePixelFormat -or $sourcePixelFormat.Length -eq 0) {
      $sourcePixelFormat = "$ConfiguredPixelFormat"
    }
    $imageWidth = [int]$grabResult.Width
    $imageHeight = [int]$grabResult.Height
    $phase.Stop()
    $timing.grab = [ordered]@{ durationMs = [Math]::Round($phase.Elapsed.TotalMilliseconds, 1) }

    $phase.Restart()
    [Basler.Pylon.ImagePersistence]::Save($imageFileFormat, $outputFilePath, $grabResult)
    $phase.Stop()
    $timing.save = [ordered]@{ durationMs = [Math]::Round($phase.Elapsed.TotalMilliseconds, 1) }

    $phase.Restart()
    $file = Get-Item -LiteralPath $outputFilePath
    $sha256 = (Get-FileHash -LiteralPath $outputFilePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $phase.Stop()
    $timing.hash = [ordered]@{ durationMs = [Math]::Round($phase.Elapsed.TotalMilliseconds, 1) }
    $timing.finishedBeforeCloseAt = (Get-Date).ToUniversalTime().ToString("o")

    return [ordered]@{
      outputFilePath = $outputFilePath
      sha256 = $sha256
      byteSize = $file.Length
      mimeType = Get-MimeType $Format
      timestamp = $timestamp
      camera = $CameraMetadata
      imageWidth = $imageWidth
      imageHeight = $imageHeight
      sourcePixelFormat = $sourcePixelFormat
      savedImageFormat = Get-SavedImageFormatName $Format
      exposureTime = $ExposureTime
      gain = $ConfiguredGain
      transport = "GigE"
      pylon = $Install
      calibration = [ordered]@{
        isCalibrated = $false
        calibrationProfileId = $null
        lensModel = $(if ($LensModel -and $LensModel.Trim().Length -gt 0) { $LensModel.Trim() } else { $null })
        cameraRole = "macro_overview"
        evidenceClass = "macro_raw_smoke"
        coordinateFrame = "basler_sensor_pixels"
      }
      timing = $timing
      note = "Warm full-forensic side-batch capture. Raw Basler evidence remains unchanged; camera ownership is bridge-scoped for this side batch."
    }
  } finally {
    if ($null -ne $grabResult) {
      try { $grabResult.Dispose() } catch {}
    }
    if ($streamStarted) {
      try { [void]$Camera.StreamGrabber.Stop() } catch {}
    }
    $timing.closeDispose = [ordered]@{ durationMs = 0; deferredToWarmBatchEnd = $true }
  }
}

function Capture-FixedRigSideBatch {
  param([System.Collections.IDictionary]$Install)

  if (-not $OutputDir -or $OutputDir.Trim().Length -eq 0) {
    throw "OutputDir is required."
  }
  if ($PreviewDutyTenthsPercent -lt 0 -or $PreviewDutyTenthsPercent -gt 50) {
    throw "PreviewDutyTenthsPercent must be from 0 to 50."
  }

  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
  $selected = @(Parse-SelectedLeimacChannels $SelectedChannels)
  $devices = [Basler.Pylon.CameraFinder]::Enumerate([Basler.Pylon.DeviceType]::GigE)
  if ($devices.Count -eq 0) {
    throw "No Basler GigE cameras were detected."
  }
  if ($CameraIndex -lt 0 -or $CameraIndex -ge $devices.Count) {
    throw "CameraIndex $CameraIndex is out of range for $($devices.Count) detected camera(s)."
  }

  $cameraInfo = $devices[$CameraIndex]
  $cameraMetadata = Convert-CameraInfo $cameraInfo $CameraIndex
  $camera = [Basler.Pylon.Camera]::new($cameraInfo)
  $leimacSession = $null
  $openedAt = (Get-Date).ToUniversalTime().ToString("o")
  $openWatch = [System.Diagnostics.Stopwatch]::StartNew()
  $safeOffStartWrites = @()
  $safeOffEndWrites = @()
  $capturesStarted = $false
  try {
    [void]$camera.Open()
    Configure-WarmBatchCamera $camera
    $configuredPixelFormat = Get-ReadableParameterValue $camera @([Basler.Pylon.PLCamera]::PixelFormat)
    $exposureTime = Get-ReadableParameterValue $camera @([Basler.Pylon.PLCamera]::ExposureTime, [Basler.Pylon.PLCamera]::ExposureTimeAbs)
    $configuredGain = Get-ReadableParameterValue $camera @([Basler.Pylon.PLCamera]::Gain, [Basler.Pylon.PLCamera]::GainAbs, [Basler.Pylon.PLCamera]::GainRaw)
    $line2 = [ordered]@{
      lineSelector = Get-ParameterValueByName $camera @([Basler.Pylon.PLCamera]::LineSelector, "LineSelector")
      lineMode = Get-ParameterValueByName $camera @([Basler.Pylon.PLCamera]::LineMode, "LineMode")
      lineSource = Get-ParameterValueByName $camera @([Basler.Pylon.PLCamera]::LineSource, "LineSource")
      lineInverter = Get-ParameterValueByName $camera @([Basler.Pylon.PLCamera]::LineInverter, "LineInverter")
    }
    $openWatch.Stop()

    $leimacSession = New-WarmLeimacSession
    $safeOffFrames = @(New-WarmLeimacSafeOffFrames)
    $safeOffStartWrites = @(Apply-WarmLeimacFrames -Session $leimacSession -Frames $safeOffFrames)
    $darkCapture = Capture-WarmStill -Camera $camera -Install $Install -CameraMetadata $cameraMetadata -CaptureLabel "$Side-dark-control" -ConfiguredPixelFormat $configuredPixelFormat -ExposureTime $exposureTime -ConfiguredGain $configuredGain
    $capturesStarted = $true

    $setupFrames = @(New-WarmLeimacTriggerSetupFrames)
    $setupWrites = @(Apply-WarmLeimacFrames -Session $leimacSession -Frames $setupFrames)

    function Capture-WarmLitRole {
      param([string]$Role, [string]$CaptureLabel, [object]$ChannelSpec, [int[]]$Channels)
      $frames = @(New-WarmLeimacLightFrames -Channels $Channels -DutyTenthsPercent $PreviewDutyTenthsPercent)
      $writes = @(Apply-WarmLeimacFrames -Session $leimacSession -Frames $frames)
      $capture = Capture-WarmStill -Camera $camera -Install $Install -CameraMetadata $cameraMetadata -CaptureLabel $CaptureLabel -ConfiguredPixelFormat $configuredPixelFormat -ExposureTime $exposureTime -ConfiguredGain $configuredGain
      return [ordered]@{
        role = $Role
        label = $CaptureLabel
        channel = $ChannelSpec
        frames = $frames
        writes = $writes
        capture = $capture
      }
    }

    $all = @(1, 2, 3, 4, 5, 6, 7, 8)
    $allOn = Capture-WarmLitRole -Role "all_on" -CaptureLabel "$Side-all-on" -ChannelSpec "all" -Channels $all
    $accepted = Capture-WarmLitRole -Role "accepted_profile" -CaptureLabel "$Side-accepted-lighting-profile" -ChannelSpec $selected -Channels $selected
    $channels = @()
    for ($channel = 1; $channel -le 8; $channel += 1) {
      $channels += Capture-WarmLitRole -Role "channel_$channel" -CaptureLabel "$Side-channel-$channel" -ChannelSpec $channel -Channels @($channel)
    }

    $safeOffEndWrites = @(Apply-WarmLeimacFrames -Session $leimacSession -Frames $safeOffFrames)
    return [ordered]@{
      executionPath = "warm_full_forensic_runner"
      fallbackUsed = $false
      side = $Side
      outputDir = $OutputDir
      cameraIndex = $CameraIndex
      openedAt = $openedAt
      finishedAt = (Get-Date).ToUniversalTime().ToString("o")
      persistentBaslerSession = $true
      persistentLeimacSession = [bool]$leimacSession.persistentConnectionUsed
      selectedChannels = $selected
      dutyTenthsPercent = $PreviewDutyTenthsPercent
      line2 = $line2
      capturesStarted = $capturesStarted
      leimac = [ordered]@{
        safeOffStart = [ordered]@{ ok = $true; frames = $safeOffFrames; writes = $safeOffStartWrites }
        triggerSetup = [ordered]@{ frames = $setupFrames; writes = $setupWrites }
        safeOffEnd = [ordered]@{ ok = $true; frames = $safeOffFrames; writes = $safeOffEndWrites }
        reconnectCount = [int]$leimacSession.reconnectCount
        persistentConnectionUsed = [bool]$leimacSession.persistentConnectionUsed
      }
      captures = [ordered]@{
        darkControl = [ordered]@{ role = "dark_control"; label = "$Side-dark-control"; capture = $darkCapture }
        allOn = $allOn
        acceptedProfile = $accepted
        channels = $channels
      }
      timing = [ordered]@{
        warmCameraOpenConfigure = [ordered]@{ durationMs = [Math]::Round($openWatch.Elapsed.TotalMilliseconds, 1); startedAt = $openedAt }
        baslerOpenSavedPerImage = $true
        baslerCloseDisposeDeferred = $true
      }
      safety = [ordered]@{
        localOnly = $true
        safeOffBefore = $true
        safeOffAfter = $true
        persistentBaslerSaved = $false
        persistentLeimacSaved = $false
        finalLightOffAttempted = $true
      }
      note = "Warm full-forensic side batch captured dark control, all-on, accepted profile, and Leimac channels 1-8 with one Basler camera owner for the side."
    }
  } catch {
    $failureMessage = $_.Exception.Message
    if ($null -ne $leimacSession) {
      try { $safeOffEndWrites = @(Apply-WarmLeimacFrames -Session $leimacSession -Frames @(New-WarmLeimacSafeOffFrames)) } catch {}
    } else {
      try { $safeOffEndWrites = @(Invoke-LeimacPreviewSafeOff) } catch {}
    }
    throw $failureMessage
  } finally {
    if ($null -ne $leimacSession) {
      try { Close-WarmLeimacSession $leimacSession } catch {}
    }
    if ($camera.IsOpen) {
      try { [void]$camera.Close() } catch {}
    }
    try { $camera.Dispose() } catch {}
  }
}

function Convert-GrabResultToBitmap {
  param([object]$GrabResult)
  $width = [int]$GrabResult.Width
  $height = [int]$GrabResult.Height
  $converter = [Basler.Pylon.PixelDataConverter]::new()
  $converter.OutputPixelFormat = [Basler.Pylon.PixelType]::BGR8packed
  $buffer = New-Object byte[] ($width * $height * 3)
  $converter.Convert($buffer, $GrabResult)
  $bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $rect = [System.Drawing.Rectangle]::new(0, 0, $width, $height)
  $data = $bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  try {
    [System.Runtime.InteropServices.Marshal]::Copy($buffer, 0, $data.Scan0, $buffer.Length)
  } finally {
    $bitmap.UnlockBits($data)
  }
  return $bitmap
}

function Convert-BitmapToJpegBytes {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [int]$Quality
  )
  $stream = [System.IO.MemoryStream]::new()
  $encoderParameters = $null
  try {
    $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" } | Select-Object -First 1
    if ($null -ne $jpegCodec) {
      $encoderParameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
      $encoderParameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, [int64]$Quality)
      $Bitmap.Save($stream, $jpegCodec, $encoderParameters)
    } else {
      $Bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    }
    return $stream.ToArray()
  } finally {
    if ($null -ne $encoderParameters) { try { $encoderParameters.Dispose() } catch {} }
    try { $stream.Dispose() } catch {}
  }
}

function Write-MjpegChunk {
  param(
    [System.IO.Stream]$Output,
    [string]$Boundary,
    [byte[]]$JpegBytes,
    [int]$FrameIndex,
    [datetime]$CapturedAt
  )
  $header = "--$Boundary`r`nContent-Type: image/jpeg`r`nContent-Length: $($JpegBytes.Length)`r`nX-AI-Grader-Frame-Index: $FrameIndex`r`nX-AI-Grader-Captured-At: $($CapturedAt.ToUniversalTime().ToString("o"))`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $footerBytes = [System.Text.Encoding]::ASCII.GetBytes("`r`n")
  $Output.Write($headerBytes, 0, $headerBytes.Length)
  $Output.Write($JpegBytes, 0, $JpegBytes.Length)
  $Output.Write($footerBytes, 0, $footerBytes.Length)
  $Output.Flush()
}

function Start-OperatorPreviewMjpegStream {
  param([System.Collections.IDictionary]$Install)

  if ($RefreshIntervalMs -lt 50 -or $RefreshIntervalMs -gt 2000) {
    throw "RefreshIntervalMs must be from 50 to 2000 for browser MJPEG preview."
  }
  if ($JpegQuality -lt 35 -or $JpegQuality -gt 95) {
    throw "JpegQuality must be from 35 to 95."
  }

  Add-Type -AssemblyName System.Drawing

  $devices = [Basler.Pylon.CameraFinder]::Enumerate([Basler.Pylon.DeviceType]::GigE)
  if ($devices.Count -eq 0) {
    throw "No Basler GigE cameras were detected."
  }
  if ($CameraIndex -lt 0 -or $CameraIndex -ge $devices.Count) {
    throw "CameraIndex $CameraIndex is out of range for $($devices.Count) detected camera(s)."
  }

  $camera = [Basler.Pylon.Camera]::new($devices[$CameraIndex])
  $streamStarted = $false
  $grabResult = $null
  $stdout = [Console]::OpenStandardOutput()
  $boundary = "tenkings-ai-grader-preview"
  $frameIndex = 0

  try {
    [void]$camera.Open()
    if ($ExposureUs -gt 0) {
      [void](Set-FloatParameterByName $camera @([Basler.Pylon.PLCamera]::ExposureTime, [Basler.Pylon.PLCamera]::ExposureTimeAbs, "ExposureTime") ([double]$ExposureUs))
    }
    try { Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::TriggerSelector, "TriggerSelector") "FrameStart" } catch {}
    try { Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::TriggerMode, "TriggerMode") "Off" } catch {}
    try { Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::ExposureAuto, "ExposureAuto") "Off" } catch {}
    try { Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::GainAuto, "GainAuto") "Off" } catch {}
    try { [Basler.Pylon.Configuration]::AcquireContinuous($camera, $null) } catch {}
    try { Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::AcquisitionMode, "AcquisitionMode") "Continuous" } catch {}
    try { $camera.Parameters[[Basler.Pylon.PLCameraInstance]::OutputQueueSize].SetValue(1) } catch {}
    [void]$camera.StreamGrabber.Start([Basler.Pylon.GrabStrategy]::LatestImages, [Basler.Pylon.GrabLoop]::ProvidedByUser)
    $streamStarted = $true

    while ($true) {
      $grabResult = $camera.StreamGrabber.RetrieveResult(1000, [Basler.Pylon.TimeoutHandling]::Return)
      if ($null -eq $grabResult) {
        continue
      }
      if (-not $grabResult.GrabSucceeded -or -not $grabResult.IsValid) {
        try { $grabResult.Dispose() } catch {}
        $grabResult = $null
        continue
      }
      $bitmap = $null
      try {
        $bitmap = Convert-GrabResultToBitmap $grabResult
        $bitmap.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone)
        $bytes = Convert-BitmapToJpegBytes -Bitmap $bitmap -Quality $JpegQuality
        $frameIndex += 1
        Write-MjpegChunk -Output $stdout -Boundary $boundary -JpegBytes $bytes -FrameIndex $frameIndex -CapturedAt (Get-Date)
      } finally {
        if ($null -ne $bitmap) { try { $bitmap.Dispose() } catch {} }
        if ($null -ne $grabResult) { try { $grabResult.Dispose() } catch {} }
        $grabResult = $null
      }
      Start-Sleep -Milliseconds $RefreshIntervalMs
    }
  } finally {
    if ($null -ne $grabResult) { try { $grabResult.Dispose() } catch {} }
    if ($streamStarted) { try { [void]$camera.StreamGrabber.Stop() } catch {} }
    if ($camera.IsOpen) { try { [void]$camera.Close() } catch {} }
    try { $camera.Dispose() } catch {}
  }
}

function Start-CalibrationPreviewMjpegStream {
  param([System.Collections.IDictionary]$Install)

  if ($RefreshIntervalMs -lt 50 -or $RefreshIntervalMs -gt 2000) {
    throw "RefreshIntervalMs must be from 50 to 2000 for calibration preview."
  }
  if ($JpegQuality -lt 35 -or $JpegQuality -gt 95) {
    throw "JpegQuality must be from 35 to 95."
  }

  Add-Type -AssemblyName System.Drawing

  $devices = [Basler.Pylon.CameraFinder]::Enumerate([Basler.Pylon.DeviceType]::GigE)
  if ($devices.Count -eq 0) {
    throw "PYLON_CALIBRATION_PREVIEW_NO_CAMERA: No Basler GigE cameras were detected."
  }
  if ($CameraIndex -lt 0 -or $CameraIndex -ge $devices.Count) {
    throw "PYLON_CALIBRATION_PREVIEW_CAMERA_INDEX: CameraIndex $CameraIndex is out of range for $($devices.Count) detected camera(s)."
  }

  $camera = [Basler.Pylon.Camera]::new($devices[$CameraIndex])
  $stdout = [Console]::OpenStandardOutput()
  $boundary = "tenkings-ai-grader-preview"
  $frameIndex = 0
  $deadline = (Get-Date).AddSeconds(10)
  $lastPylonError = "no valid frame was returned"

  try {
    [void]$camera.Open()
    if ($ExposureUs -gt 0) {
      [void](Set-FloatParameterByName $camera @([Basler.Pylon.PLCamera]::ExposureTime, [Basler.Pylon.PLCamera]::ExposureTimeAbs, "ExposureTime") ([double]$ExposureUs))
    }
    try { Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::TriggerSelector, "TriggerSelector") "FrameStart" } catch {}
    try { Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::TriggerMode, "TriggerMode") "Off" } catch {}
    try { Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::ExposureAuto, "ExposureAuto") "Off" } catch {}
    try { Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::GainAuto, "GainAuto") "Off" } catch {}

    while ($true) {
      $grabResult = $null
      $streamStarted = $false
      try {
        [void]$camera.StreamGrabber.Start(1)
        $streamStarted = $true
        $grabResult = $camera.StreamGrabber.RetrieveResult(1000, [Basler.Pylon.TimeoutHandling]::ThrowException)
        if ($null -eq $grabResult -or -not $grabResult.IsValid -or -not $grabResult.GrabSucceeded) {
          $code = if ($null -ne $grabResult) { $grabResult.ErrorCode } else { "unknown" }
          $description = if ($null -ne $grabResult) { $grabResult.ErrorDescription } else { "no grab result" }
          throw "Pylon invalid calibration preview grab: $code $description"
        }
        $bitmap = $null
        try {
          $bitmap = Convert-GrabResultToBitmap $grabResult
          $bitmap.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone)
          $bytes = Convert-BitmapToJpegBytes -Bitmap $bitmap -Quality $JpegQuality
          $frameIndex += 1
          Write-MjpegChunk -Output $stdout -Boundary $boundary -JpegBytes $bytes -FrameIndex $frameIndex -CapturedAt (Get-Date)
        } finally {
          if ($null -ne $bitmap) { try { $bitmap.Dispose() } catch {} }
        }
      } catch {
        $lastPylonError = $_.Exception.Message
      } finally {
        if ($null -ne $grabResult) { try { $grabResult.Dispose() } catch {} }
        if ($streamStarted) { try { [void]$camera.StreamGrabber.Stop() } catch {} }
      }
      if ($frameIndex -eq 0 -and (Get-Date) -ge $deadline) {
        throw "PYLON_CALIBRATION_PREVIEW_NO_VALID_FRAME: No valid Basler frame arrived within 10 seconds. Last Pylon error: $lastPylonError"
      }
      if ($frameIndex -gt 0) { Start-Sleep -Milliseconds $RefreshIntervalMs }
    }
  } finally {
    if ($camera.IsOpen) { try { [void]$camera.Close() } catch {} }
    try { $camera.Dispose() } catch {}
  }
}

function Add-OperatorPreviewTypes {
  param([System.Collections.IDictionary]$Install)
  try {
    [void][TenKings.PylonWinFormsPreviewPump]
    [void][TenKings.LeimacPreviewLightController]
    return
  } catch {
  }

  $source = @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Basler.Pylon;

namespace TenKings {
  public sealed class PreviewFrameMetrics {
    public double Mean;
    public int Max;
    public double ClippedFraction;
    public double DarkFraction;
    public double Sharpness;
  }

  public sealed class PylonWinFormsPreviewPump : IDisposable {
    private readonly Camera camera;
    private readonly PictureBox picture;
    private readonly Label statusLabel;
    private readonly Label metricsLabel;
    private readonly Stopwatch started = new Stopwatch();
    private Thread worker;
    private volatile bool stopRequested;
    private volatile bool paused;
    private volatile bool displayBusy;
    private long frameCount;
    private long skippedFrames;
    private double fps;
    private double frameAgeMs;
    private string lastError;
    private PreviewFrameMetrics lastMetrics;

    public PylonWinFormsPreviewPump(Camera camera, PictureBox picture, Label statusLabel, Label metricsLabel) {
      this.camera = camera;
      this.picture = picture;
      this.statusLabel = statusLabel;
      this.metricsLabel = metricsLabel;
    }

    public bool Paused {
      get { return paused; }
      set { paused = value; }
    }

    public long FrameCount { get { return Interlocked.Read(ref frameCount); } }
    public long SkippedFrames { get { return Interlocked.Read(ref skippedFrames); } }
    public double Fps { get { return fps; } }
    public double FrameAgeMs { get { return frameAgeMs; } }
    public string LastError { get { return lastError; } }
    public PreviewFrameMetrics LastMetrics { get { return lastMetrics; } }

    public void Start() {
      if (worker != null) return;
      started.Start();
      worker = new Thread(Run);
      worker.IsBackground = true;
      worker.Name = "TenKings Basler pylon preview pump";
      worker.Start();
    }

    public void Stop() {
      stopRequested = true;
      Thread thread = worker;
      if (thread != null && thread.IsAlive) {
        try { thread.Join(1000); } catch {}
      }
    }

    public void Dispose() {
      Stop();
    }

    private void Run() {
      while (!stopRequested) {
        if (paused || displayBusy) {
          Interlocked.Increment(ref skippedFrames);
          Thread.Sleep(5);
          continue;
        }

        IGrabResult grabResult = null;
        Bitmap bitmap = null;
        try {
          grabResult = camera.StreamGrabber.RetrieveResult(100, TimeoutHandling.Return);
          if (grabResult == null) {
            continue;
          }
          if (!grabResult.GrabSucceeded || !grabResult.IsValid) {
            continue;
          }

          bitmap = ConvertGrabResultToBitmap(grabResult);
          bitmap.RotateFlip(RotateFlipType.Rotate90FlipNone);
          PreviewFrameMetrics metrics = null;
          if ((FrameCount % 5) == 0) {
            metrics = MeasureBitmap(bitmap);
          }
          DateTime capturedAt = DateTime.UtcNow;
          displayBusy = true;
          Bitmap displayBitmap = bitmap;
          bitmap = null;
          try {
            picture.BeginInvoke(new Action(delegate {
              try {
                Image oldImage = picture.Image;
                picture.Image = displayBitmap;
                if (oldImage != null) oldImage.Dispose();
                long frames = Interlocked.Increment(ref frameCount);
                double seconds = Math.Max(0.001, started.Elapsed.TotalSeconds);
                fps = Math.Round(frames / seconds, 2);
                frameAgeMs = Math.Round((DateTime.UtcNow - capturedAt).TotalMilliseconds, 1);
                if (metrics != null) lastMetrics = metrics;
                statusLabel.Text = "Pylon live stream. Frames: " + frames + ". FPS: " + fps + ". Frame age: " + frameAgeMs + " ms. Skipped stale: " + SkippedFrames + ". Display: portrait; raw unchanged.";
                if (lastMetrics != null) {
                  metricsLabel.Text = "sharpness=" + lastMetrics.Sharpness.ToString("0.####") + "\r\nmean=" + lastMetrics.Mean.ToString("0.####") + " max=" + lastMetrics.Max + "\r\nclipped=" + lastMetrics.ClippedFraction.ToString("0.######") + " dark=" + lastMetrics.DarkFraction.ToString("0.######") + "\r\ncoverage/framing=operator review";
                }
                picture.Invalidate();
              } catch (Exception ex) {
                lastError = ex.Message;
                statusLabel.Text = "Preview display error: " + lastError;
                if (displayBitmap != null) {
                  try { displayBitmap.Dispose(); } catch {}
                }
              } finally {
                displayBusy = false;
              }
            }));
          } catch (Exception ex) {
            lastError = ex.Message;
            displayBusy = false;
            if (displayBitmap != null) {
              try { displayBitmap.Dispose(); } catch {}
            }
          }
        } catch (Exception ex) {
          lastError = ex.Message;
          try {
            if (!statusLabel.IsDisposed) {
              statusLabel.BeginInvoke(new Action(delegate {
                statusLabel.Text = "Preview stream error: " + lastError;
              }));
            }
          } catch {}
          Thread.Sleep(50);
        } finally {
          if (bitmap != null) {
            try { bitmap.Dispose(); } catch {}
          }
          if (grabResult != null) {
            try { grabResult.Dispose(); } catch {}
          }
        }
      }
    }

    private static Bitmap ConvertGrabResultToBitmap(IGrabResult grabResult) {
      int width = grabResult.Width;
      int height = grabResult.Height;
      PixelDataConverter converter = new PixelDataConverter();
      converter.OutputPixelFormat = PixelType.BGR8packed;
      byte[] buffer = new byte[width * height * 3];
      converter.Convert(buffer, grabResult);
      Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb);
      Rectangle rect = new Rectangle(0, 0, width, height);
      BitmapData data = bitmap.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
      try {
        Marshal.Copy(buffer, 0, data.Scan0, buffer.Length);
      } finally {
        bitmap.UnlockBits(data);
      }
      return bitmap;
    }

    private static PreviewFrameMetrics MeasureBitmap(Bitmap bitmap) {
      int width = bitmap.Width;
      int height = bitmap.Height;
      int stepX = Math.Max(1, width / 160);
      int stepY = Math.Max(1, height / 160);
      long count = 0;
      double sum = 0;
      int max = 0;
      long clipped = 0;
      long dark = 0;
      double edge = 0;
      int previous = -1;
      for (int y = 0; y < height; y += stepY) {
        previous = -1;
        for (int x = 0; x < width; x += stepX) {
          Color pixel = bitmap.GetPixel(x, y);
          int value = (pixel.R + pixel.G + pixel.B) / 3;
          sum += value;
          if (value > max) max = value;
          if (value >= 250) clipped += 1;
          if (value <= 10) dark += 1;
          if (previous >= 0) edge += Math.Abs(value - previous);
          previous = value;
          count += 1;
        }
      }
      PreviewFrameMetrics metrics = new PreviewFrameMetrics();
      metrics.Mean = count > 0 ? Math.Round(sum / count, 4) : 0;
      metrics.Max = max;
      metrics.ClippedFraction = count > 0 ? Math.Round((double)clipped / count, 6) : 0;
      metrics.DarkFraction = count > 0 ? Math.Round((double)dark / count, 6) : 0;
      metrics.Sharpness = count > 0 ? Math.Round(edge / count, 4) : 0;
      return metrics;
    }
  }

  public sealed class LeimacPreviewLightController : IDisposable {
    private readonly string host;
    private readonly int port;
    private readonly int unit;
    private readonly object gate = new object();
    private readonly AutoResetEvent signal = new AutoResetEvent(false);
    private Thread worker;
    private volatile bool stopRequested;
    private bool requestedOn;
    private int requestedDutyTenths;
    private int[] requestedChannels = new int[0];
    private int requestedVersion;
    private int appliedDutyTenths;
    private int[] appliedChannels = new int[0];
    private bool lightEnabled;
    private bool everEngaged;
    private bool applyInFlight;
    private double lastLatencyMs;
    private string[] lastResponses = new string[0];
    private string lastError;

    public LeimacPreviewLightController(string host, int port, int unit) {
      this.host = host;
      this.port = port;
      this.unit = unit;
    }

    public int AppliedDutyTenths { get { return appliedDutyTenths; } }
    public bool LightEnabled { get { return lightEnabled; } }
    public bool EverEngaged { get { return everEngaged; } }
    public bool ApplyInFlight { get { return applyInFlight; } }
    public double LastLatencyMs { get { return lastLatencyMs; } }
    public string[] LastResponses { get { return lastResponses; } }
    public string LastError { get { return lastError; } }

    public void Start() {
      if (worker != null) return;
      worker = new Thread(Run);
      worker.IsBackground = true;
      worker.Name = "TenKings Leimac preview light controller";
      worker.Start();
    }

    public void Request(bool on, int dutyTenths, int[] channels) {
      if (dutyTenths < 0) dutyTenths = 0;
      if (dutyTenths > 50) dutyTenths = 50;
      int[] copy = channels == null ? new int[0] : (int[])channels.Clone();
      lock (gate) {
        requestedOn = on;
        requestedDutyTenths = dutyTenths;
        requestedChannels = copy;
        requestedVersion += 1;
      }
      signal.Set();
    }

    public void SafeOffSync() {
      Stopwatch watch = Stopwatch.StartNew();
      try {
        string[] responses = SafeOff();
        appliedDutyTenths = 0;
        appliedChannels = new int[0];
        lightEnabled = false;
        lastResponses = responses;
        lastError = null;
      } catch (Exception ex) {
        lastError = ex.Message;
      } finally {
        lastLatencyMs = Math.Round(watch.Elapsed.TotalMilliseconds, 1);
      }
    }

    public void Stop() {
      stopRequested = true;
      signal.Set();
      Thread thread = worker;
      if (thread != null && thread.IsAlive) {
        try { thread.Join(1000); } catch {}
      }
    }

    public void Dispose() {
      try { SafeOffSync(); } catch {}
      Stop();
      try { signal.Dispose(); } catch {}
    }

    private void Run() {
      int lastAppliedVersion = -1;
      while (!stopRequested) {
        bool signaled = signal.WaitOne(100);
        if (stopRequested) break;
        if (!signaled) continue;
        bool on;
        int duty;
        int[] channels;
        int version;
        lock (gate) {
          on = requestedOn;
          duty = requestedDutyTenths;
          channels = (int[])requestedChannels.Clone();
          version = requestedVersion;
        }
        Thread.Sleep(50);
        lock (gate) {
          if (version != requestedVersion) continue;
          on = requestedOn;
          duty = requestedDutyTenths;
          channels = (int[])requestedChannels.Clone();
          version = requestedVersion;
        }
        if (version == lastAppliedVersion) continue;
        ApplyLatest(on, duty, channels);
        lastAppliedVersion = version;
      }
    }

    private void ApplyLatest(bool on, int dutyTenths, int[] channels) {
      Stopwatch watch = Stopwatch.StartNew();
      applyInFlight = true;
      try {
        List<string> responses = new List<string>();
        if (on && dutyTenths > 0 && channels != null && channels.Length > 0) {
          string dutyValue = dutyTenths.ToString("D4");
          if (lightEnabled && SameChannels(appliedChannels, channels)) {
            responses.Add(SendFrame(NewFrame("11", ChannelData(channels, dutyValue, "0000"))));
          } else {
            responses.AddRange(SafeOff());
            responses.Add(SendFrame(NewFrame("11", ChannelData(channels, dutyValue, "0000"))));
            responses.Add(SendFrame(NewFrame("86", ChannelData(channels, "0001", "0000"))));
          }
          appliedDutyTenths = dutyTenths;
          appliedChannels = (int[])channels.Clone();
          lightEnabled = true;
          everEngaged = true;
        } else {
          responses.AddRange(SafeOff());
          appliedDutyTenths = 0;
          appliedChannels = new int[0];
          lightEnabled = false;
        }
        lastResponses = responses.ToArray();
        lastError = null;
      } catch (Exception ex) {
        lastError = ex.Message;
        try { lastResponses = SafeOff(); } catch {}
        appliedDutyTenths = 0;
        appliedChannels = new int[0];
        lightEnabled = false;
      } finally {
        lastLatencyMs = Math.Round(watch.Elapsed.TotalMilliseconds, 1);
        applyInFlight = false;
      }
    }

    private string[] SafeOff() {
      string off = ChannelData(new int[0], "0000", "0000");
      return new string[] {
        SendFrame(NewFrame("86", off)),
        SendFrame(NewFrame("85", off)),
        SendFrame(NewFrame("11", off))
      };
    }

    private string NewFrame(string commandNumber, string channelData) {
      return "W" + commandNumber + unit.ToString("D2") + channelData;
    }

    private static bool SameChannels(int[] left, int[] right) {
      if (left == null || right == null) return false;
      if (left.Length != right.Length) return false;
      bool[] seen = new bool[9];
      for (int index = 0; index < left.Length; index += 1) {
        int channel = left[index];
        if (channel < 1 || channel > 8) return false;
        seen[channel] = true;
      }
      for (int index = 0; index < right.Length; index += 1) {
        int channel = right[index];
        if (channel < 1 || channel > 8 || !seen[channel]) return false;
      }
      return true;
    }

    private static string ChannelData(int[] enabledChannels, string enabledValue, string disabledValue) {
      StringBuilder builder = new StringBuilder();
      for (int channel = 1; channel <= 8; channel += 1) {
        bool enabled = false;
        if (enabledChannels != null) {
          for (int index = 0; index < enabledChannels.Length; index += 1) {
            if (enabledChannels[index] == channel) {
              enabled = true;
              break;
            }
          }
        }
        builder.Append(channel.ToString("D2"));
        builder.Append(enabled ? enabledValue : disabledValue);
      }
      return builder.ToString();
    }

    private string SendFrame(string frame) {
      TcpClient client = new TcpClient();
      try {
        IAsyncResult connect = client.BeginConnect(host, port, null, null);
        if (!connect.AsyncWaitHandle.WaitOne(1500)) {
          throw new TimeoutException("Timed out connecting to Leimac " + host + ":" + port);
        }
        client.EndConnect(connect);
        NetworkStream stream = client.GetStream();
        stream.ReadTimeout = 1500;
        stream.WriteTimeout = 1500;
        byte[] bytes = Encoding.ASCII.GetBytes(frame);
        stream.Write(bytes, 0, bytes.Length);
        byte[] buffer = new byte[256];
        int read = stream.Read(buffer, 0, buffer.Length);
        return read > 0 ? Encoding.ASCII.GetString(buffer, 0, read) : "";
      } finally {
        try { client.Close(); } catch {}
      }
    }
  }
}
"@

  Add-Type -ReferencedAssemblies @($Install.assemblyPath, "System.Windows.Forms", "System.Drawing") -TypeDefinition $source
}

function Show-OperatorPreviewWindow {
  param([System.Collections.IDictionary]$Install)

  if ($RefreshIntervalMs -lt 250 -or $RefreshIntervalMs -gt 5000) {
    throw "RefreshIntervalMs must be from 250 to 5000."
  }

  $devices = [Basler.Pylon.CameraFinder]::Enumerate([Basler.Pylon.DeviceType]::GigE)
  if ($devices.Count -eq 0) {
    throw "No Basler GigE cameras were detected."
  }
  if ($CameraIndex -lt 0 -or $CameraIndex -ge $devices.Count) {
    throw "CameraIndex $CameraIndex is out of range for $($devices.Count) detected camera(s)."
  }

  if ($OutputDir -and $OutputDir.Trim().Length -gt 0) {
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
  }
  $lastFramePath = $(if ($OutputDir -and $OutputDir.Trim().Length -gt 0) { Join-Path $OutputDir "operator-preview-window-display-frame.png" } else { Join-Path $env:TEMP "operator-preview-window-display-frame.png" })

  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-OperatorPreviewTypes $Install
  [System.Windows.Forms.Application]::EnableVisualStyles()

  $cameraInfo = $devices[$CameraIndex]
  $cameraMetadata = Convert-CameraInfo $cameraInfo $CameraIndex
  $camera = [Basler.Pylon.Camera]::new($cameraInfo)
  $script:operatorPreviewFrameCount = 0
  $script:operatorPreviewLastMetrics = $null
  $script:operatorPreviewLastError = $null
  $script:operatorPreviewPaused = $false
  $script:operatorPreviewDecision = "closed"
  $script:operatorPreviewStreamStarted = $false
  $script:operatorPreviewLightEnabled = $false
  $script:operatorPreviewDutyTenths = $PreviewDutyTenthsPercent
  $script:operatorPreviewChannels = @(1,2,3,4,5,6,7,8)
  $script:operatorPreviewLeimacEngaged = $false
  $script:operatorPreviewLeimacEverEngaged = $false
  $script:operatorPreviewLeimacResponses = @()
  $script:operatorPreviewFps = 0.0
  $script:operatorPreviewStartedAt = Get-Date
  $script:operatorPreviewLastFrameAt = $null
  $script:operatorPreviewLightingStatus = $(if ($LeimacHost -and $LeimacHost.Trim().Length -gt 0) { "Preview light off; controls enabled. Channel mapping UNKNOWN/UNCALIBRATED." } else { "Preview lighting disabled; no Leimac host supplied." })
  $leimacPreviewController = $null
  if ($LeimacHost -and $LeimacHost.Trim().Length -gt 0) {
    $leimacPreviewController = [TenKings.LeimacPreviewLightController]::new($LeimacHost, $LeimacPort, $LeimacUnit)
    $leimacPreviewController.Start()
  }

  $form = [System.Windows.Forms.Form]::new()
  $form.Text = "Ten Kings Basler Fixed-Rig Live Operator Preview - UNCALIBRATED GUIDE"
  $form.Width = 1320
  $form.Height = 980
  $form.StartPosition = "CenterScreen"
  $form.TopMost = $true

  $layout = [System.Windows.Forms.TableLayoutPanel]::new()
  $layout.Dock = [System.Windows.Forms.DockStyle]::Fill
  $layout.ColumnCount = 2
  $layout.RowCount = 1
  [void]$layout.ColumnStyles.Add([System.Windows.Forms.ColumnStyle]::new([System.Windows.Forms.SizeType]::Percent, 74))
  [void]$layout.ColumnStyles.Add([System.Windows.Forms.ColumnStyle]::new([System.Windows.Forms.SizeType]::Percent, 26))

  $picture = [System.Windows.Forms.PictureBox]::new()
  $picture.Dock = [System.Windows.Forms.DockStyle]::Fill
  $picture.BackColor = [System.Drawing.Color]::Black
  $picture.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom

  $panel = [System.Windows.Forms.FlowLayoutPanel]::new()
  $panel.Dock = [System.Windows.Forms.DockStyle]::Fill
  $panel.FlowDirection = [System.Windows.Forms.FlowDirection]::TopDown
  $panel.WrapContents = $false
  $panel.AutoScroll = $true
  $panel.Padding = [System.Windows.Forms.Padding]::new(10)
  $panel.BackColor = [System.Drawing.Color]::FromArgb(238, 238, 238)

  $statusLabel = [System.Windows.Forms.Label]::new()
  $statusLabel.Width = 310
  $statusLabel.Height = 86
  $statusLabel.Text = "Opening Basler live stream..."

  $metricsLabel = [System.Windows.Forms.Label]::new()
  $metricsLabel.Width = 310
  $metricsLabel.Height = 116
  $metricsLabel.Text = "Metrics pending..."

  $warningLabel = [System.Windows.Forms.Label]::new()
  $warningLabel.Width = 310
  $warningLabel.Height = 54
  $warningLabel.ForeColor = [System.Drawing.Color]::DarkRed
  $warningLabel.Text = "UNCALIBRATED GRID / GUIDE. Channel mapping UNKNOWN."

  $lightingLabel = [System.Windows.Forms.Label]::new()
  $lightingLabel.Width = 310
  $lightingLabel.Height = 56
  $lightingLabel.Text = $script:operatorPreviewLightingStatus

  $previewLightCheck = [System.Windows.Forms.CheckBox]::new()
  $previewLightCheck.Text = "Master Preview Light On"
  $previewLightCheck.Width = 310
  $previewLightCheck.Enabled = ($LeimacHost -and $LeimacHost.Trim().Length -gt 0)

  $dutyLabel = [System.Windows.Forms.Label]::new()
  $dutyLabel.Width = 310
  $dutyLabel.Height = 40
  $dutyLabel.Text = ("Requested duty: {0:N1}% (V1 marker 1.2%, hard cap 5.0%)" -f ($script:operatorPreviewDutyTenths / 10.0))

  $dutySlider = [System.Windows.Forms.TrackBar]::new()
  $dutySlider.Minimum = 0
  $dutySlider.Maximum = 50
  $dutySlider.TickFrequency = 5
  $dutySlider.Value = [Math]::Max(0, [Math]::Min(50, $script:operatorPreviewDutyTenths))
  $dutySlider.Width = 310
  $dutySlider.Enabled = $previewLightCheck.Enabled

  $dutyInputPanel = [System.Windows.Forms.FlowLayoutPanel]::new()
  $dutyInputPanel.Width = 310
  $dutyInputPanel.Height = 32
  $dutyInputPanel.FlowDirection = [System.Windows.Forms.FlowDirection]::LeftToRight
  $dutyInputLabel = [System.Windows.Forms.Label]::new()
  $dutyInputLabel.Text = "Duty %:"
  $dutyInputLabel.Width = 58
  $dutyInputLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
  $dutyTextBox = [System.Windows.Forms.TextBox]::new()
  $dutyTextBox.Width = 58
  $dutyTextBox.Text = ("{0:N1}" -f ($script:operatorPreviewDutyTenths / 10.0))
  $appliedDutyLabel = [System.Windows.Forms.Label]::new()
  $appliedDutyLabel.Width = 175
  $appliedDutyLabel.Text = "Applied: pending"
  [void]$dutyInputPanel.Controls.Add($dutyInputLabel)
  [void]$dutyInputPanel.Controls.Add($dutyTextBox)
  [void]$dutyInputPanel.Controls.Add($appliedDutyLabel)

  $ringPanel = [System.Windows.Forms.Panel]::new()
  $ringPanel.Width = 230
  $ringPanel.Height = 230
  $ringPanel.BackColor = [System.Drawing.Color]::White
  $ringPanel.Enabled = $previewLightCheck.Enabled

  $channelButtons = [System.Windows.Forms.FlowLayoutPanel]::new()
  $channelButtons.Width = 310
  $channelButtons.Height = 36
  $channelButtons.FlowDirection = [System.Windows.Forms.FlowDirection]::LeftToRight

  $allOnButton = [System.Windows.Forms.Button]::new()
  $allOnButton.Text = "All On"
  $allOnButton.Width = 80
  $allOnButton.Enabled = $previewLightCheck.Enabled
  $allOffButton = [System.Windows.Forms.Button]::new()
  $allOffButton.Text = "All Off"
  $allOffButton.Width = 80
  $allOffButton.Enabled = $previewLightCheck.Enabled
  $resetDutyButton = [System.Windows.Forms.Button]::new()
  $resetDutyButton.Text = "Reset 1.2%"
  $resetDutyButton.Width = 90
  $resetDutyButton.Enabled = $previewLightCheck.Enabled
  [void]$channelButtons.Controls.Add($allOnButton)
  [void]$channelButtons.Controls.Add($allOffButton)
  [void]$channelButtons.Controls.Add($resetDutyButton)

  $acceptButton = [System.Windows.Forms.Button]::new()
  $acceptButton.Text = "Accept / Start / Continue"
  $acceptButton.Width = 250
  $acceptButton.Add_Click({
    try {
      if ($null -ne $leimacPreviewController) { $leimacPreviewController.SafeOffSync() } else { [void](Invoke-LeimacPreviewSafeOff) }
      $script:operatorPreviewLeimacEngaged = $false
    } catch {}
    $script:operatorPreviewDecision = "accepted"
    $form.Close()
  })

  $abortButton = [System.Windows.Forms.Button]::new()
  $abortButton.Text = "Abort / Close"
  $abortButton.Width = 250
  $abortButton.Add_Click({
    try {
      if ($null -ne $leimacPreviewController) { $leimacPreviewController.SafeOffSync() } else { [void](Invoke-LeimacPreviewSafeOff) }
      $script:operatorPreviewLeimacEngaged = $false
    } catch {}
    $script:operatorPreviewDecision = "aborted"
    $form.Close()
  })

  $pauseButton = [System.Windows.Forms.Button]::new()
  $pauseButton.Text = "Pause"
  $pauseButton.Width = 250
  $pauseButton.Add_Click({
    $script:operatorPreviewPaused = -not $script:operatorPreviewPaused
    $pauseButton.Text = $(if ($script:operatorPreviewPaused) { "Resume" } else { "Pause" })
  })

  $safeOffButton = [System.Windows.Forms.Button]::new()
  $safeOffButton.Text = "Safe Off"
  $safeOffButton.Width = 250
  $safeOffButton.Enabled = $previewLightCheck.Enabled
  $safeOffButton.Add_Click({
    try {
      if ($null -ne $leimacPreviewController) {
        $leimacPreviewController.SafeOffSync()
        $script:operatorPreviewLeimacResponses = @($leimacPreviewController.LastResponses)
        $script:operatorPreviewLastApplyLatencyMs = $leimacPreviewController.LastLatencyMs
      } else {
        $script:operatorPreviewLeimacResponses = Invoke-LeimacPreviewSafeOff
      }
      $script:operatorPreviewAppliedDutySteps = 0
      $script:operatorPreviewLeimacEngaged = $false
      $script:operatorPreviewLightEnabled = $false
      $previewLightCheck.Checked = $false
      $script:operatorPreviewLightingStatus = "Safe Off sent. Preview light off."
      $lightingLabel.Text = $script:operatorPreviewLightingStatus
    } catch {
      $script:operatorPreviewLightingStatus = "Safe Off error: $($_.Exception.Message)"
      $lightingLabel.Text = $script:operatorPreviewLightingStatus
    }
  })

  $script:operatorPreviewRequestedDutySteps = [int]($script:operatorPreviewDutyTenths)
  $script:operatorPreviewAppliedDutySteps = 0
  $script:operatorPreviewApplyInFlight = $false
  $script:operatorPreviewApplyPending = $false
  $script:operatorPreviewApplyVersion = 0
  $script:operatorPreviewLastApplyLatencyMs = $null

  function Update-RequestedLightingText {
    param([bool]$InvalidateRing = $true)
    $requestedDuty = [Math]::Round(($script:operatorPreviewDutyTenths / 10.0), 1)
    $dutyLabel.Text = "Requested duty: $requestedDuty% (V1 marker 1.2%, hard cap 5.0%)"
    $lightingLabel.Text = "Requested: $(if ($previewLightCheck.Checked) { 'ON' } else { 'OFF' }); duty $requestedDuty%; channels: $($script:operatorPreviewChannels -join ','). Applied: $($script:operatorPreviewLightingStatus)"
    if ($InvalidateRing) { $ringPanel.Invalidate() }
  }

  function Apply-DutyTextBox {
    $parsed = 0.0
    if ([double]::TryParse($dutyTextBox.Text, [ref]$parsed)) {
      if ($parsed -lt 0) { $parsed = 0 }
      if ($parsed -gt 5) { $parsed = 5 }
      $steps = [int]([Math]::Round($parsed * 10.0))
      $script:operatorPreviewDutyTenths = $steps
      $dutySlider.Value = [Math]::Max($dutySlider.Minimum, [Math]::Min($dutySlider.Maximum, $steps))
      $dutyTextBox.Text = ("{0:N1}" -f ($steps / 10.0))
      Update-RequestedLightingText
    }
  }

  function Invoke-PreviewLightingAsync {
    if (-not $previewLightCheck.Enabled) { return }
    $script:operatorPreviewApplyVersion += 1
    $appliedDutyLabel.Text = "Applied: sending..."
    if ($null -ne $leimacPreviewController) {
      $leimacPreviewController.Request([bool]$previewLightCheck.Checked, [int]$script:operatorPreviewDutyTenths, [int[]]@($script:operatorPreviewChannels))
    } else {
      $requestedOn = [bool]$previewLightCheck.Checked
      $requestedDutyTenths = [int]$script:operatorPreviewDutyTenths
      $requestedChannels = @($script:operatorPreviewChannels)
      $requestedStarted = Get-Date
      try {
        if (-not $requestedOn -or $requestedChannels.Count -eq 0 -or $requestedDutyTenths -eq 0) {
          $script:operatorPreviewLeimacResponses = Invoke-LeimacPreviewSafeOff
          $script:operatorPreviewAppliedDutySteps = 0
          $script:operatorPreviewLightEnabled = $false
          $script:operatorPreviewLeimacEngaged = $false
        } else {
          $script:operatorPreviewLeimacResponses = Invoke-LeimacPreviewApply -EnabledChannels $requestedChannels -DutyTenthsPercent $requestedDutyTenths
          $script:operatorPreviewAppliedDutySteps = $requestedDutyTenths
          $script:operatorPreviewLightEnabled = $true
          $script:operatorPreviewLeimacEngaged = $true
          $script:operatorPreviewLeimacEverEngaged = $true
        }
        $script:operatorPreviewLastApplyLatencyMs = [Math]::Round(((Get-Date) - $requestedStarted).TotalMilliseconds, 1)
        $script:operatorPreviewLightingStatus = "ACK $script:operatorPreviewLastApplyLatencyMs ms"
      } catch {
        try { $script:operatorPreviewLeimacResponses = Invoke-LeimacPreviewSafeOff } catch {}
        $script:operatorPreviewAppliedDutySteps = 0
        $script:operatorPreviewLightEnabled = $false
        $script:operatorPreviewLeimacEngaged = $false
        $script:operatorPreviewLightingStatus = "ERROR, safe-off: $($_.Exception.Message)"
        $previewLightCheck.Checked = $false
      }
      $appliedDutyLabel.Text = ("Applied: {0:N1}% / PWM {1:D4}" -f ($script:operatorPreviewAppliedDutySteps / 10.0), $script:operatorPreviewAppliedDutySteps)
      Update-RequestedLightingText
    }
  }

  $lightingDebounceTimer = [System.Windows.Forms.Timer]::new()
  $lightingDebounceTimer.Interval = 50
  $lightingDebounceTimer.Add_Tick({
    $lightingDebounceTimer.Stop()
    Invoke-PreviewLightingAsync
  })
  $lightingPollTimer = [System.Windows.Forms.Timer]::new()
  $lightingPollTimer.Interval = 100
  $lightingPollTimer.Add_Tick({
    if ($null -eq $leimacPreviewController) { return }
    $script:operatorPreviewApplyInFlight = $leimacPreviewController.ApplyInFlight
    $script:operatorPreviewLastApplyLatencyMs = $leimacPreviewController.LastLatencyMs
    $script:operatorPreviewLeimacResponses = @($leimacPreviewController.LastResponses)
    $script:operatorPreviewAppliedDutySteps = [int]$leimacPreviewController.AppliedDutyTenths
    $script:operatorPreviewLightEnabled = [bool]$leimacPreviewController.LightEnabled
    $script:operatorPreviewLeimacEngaged = [bool]$leimacPreviewController.LightEnabled
    $script:operatorPreviewLeimacEverEngaged = [bool]$leimacPreviewController.EverEngaged
    if ($leimacPreviewController.LastError) {
      $script:operatorPreviewLightingStatus = "ERROR, safe-off: $($leimacPreviewController.LastError)"
    } elseif ($script:operatorPreviewApplyInFlight) {
      $script:operatorPreviewLightingStatus = "sending..."
    } elseif ($script:operatorPreviewLastApplyLatencyMs -gt 0) {
      $script:operatorPreviewLightingStatus = "ACK $script:operatorPreviewLastApplyLatencyMs ms"
    }
    $appliedDutyLabel.Text = ("Applied: {0:N1}% / PWM {1:D4}" -f ($script:operatorPreviewAppliedDutySteps / 10.0), $script:operatorPreviewAppliedDutySteps)
    Update-RequestedLightingText -InvalidateRing $false
  })
  $lightingPollTimer.Start()
  function Schedule-PreviewLightingApply {
    if (-not $previewLightCheck.Enabled) { return }
    Update-RequestedLightingText
    $lightingDebounceTimer.Stop()
    $lightingDebounceTimer.Start()
  }

  $previewLightCheck.Add_CheckedChanged({ Schedule-PreviewLightingApply })
  $dutySlider.Add_ValueChanged({
    $script:operatorPreviewDutyTenths = [int]$dutySlider.Value
    $dutyTextBox.Text = ("{0:N1}" -f ($script:operatorPreviewDutyTenths / 10.0))
    Schedule-PreviewLightingApply
  })
  $dutyTextBox.Add_Leave({ Apply-DutyTextBox; Schedule-PreviewLightingApply })
  $dutyTextBox.Add_KeyDown({
    param($sender, $eventArgs)
    if ($eventArgs.KeyCode -eq [System.Windows.Forms.Keys]::Enter) {
      Apply-DutyTextBox
      Schedule-PreviewLightingApply
      $eventArgs.SuppressKeyPress = $true
    }
  })
  $allOnButton.Add_Click({ $script:operatorPreviewChannels = @(1,2,3,4,5,6,7,8); Schedule-PreviewLightingApply; $ringPanel.Invalidate() })
  $allOffButton.Add_Click({ $script:operatorPreviewChannels = @(); Schedule-PreviewLightingApply; $ringPanel.Invalidate() })
  $resetDutyButton.Add_Click({ $dutySlider.Value = 12; $dutyTextBox.Text = "1.2"; Schedule-PreviewLightingApply })

  $ringPanel.Add_Paint({
    param($sender, $eventArgs)
    $g = $eventArgs.Graphics
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $rect = [System.Drawing.Rectangle]::new(15, 15, 190, 190)
    $font = [System.Drawing.Font]::new("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    try {
      for ($channel = 1; $channel -le 8; $channel += 1) {
        $start = -90 + (($channel - 1) * 45)
        $brush = $(if ($script:operatorPreviewChannels -contains $channel) { [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(116, 185, 89)) } else { [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(210, 210, 210)) })
        $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::Black, 1)
        try {
          $g.FillPie($brush, $rect, $start, 45)
          $g.DrawPie($pen, $rect, $start, 45)
          $angle = ($start + 22.5) * [Math]::PI / 180.0
          $tx = 110 + [int]([Math]::Cos($angle) * 70)
          $ty = 110 + [int]([Math]::Sin($angle) * 70)
          $g.DrawString("$channel", $font, [System.Drawing.Brushes]::Black, $tx - 6, $ty - 8)
        } finally {
          $brush.Dispose(); $pen.Dispose()
        }
      }
      $g.FillEllipse([System.Drawing.Brushes]::White, 72, 72, 76, 76)
      $g.DrawEllipse([System.Drawing.Pens]::Black, 72, 72, 76, 76)
      $g.DrawString("UNKNOWN", $font, [System.Drawing.Brushes]::DarkRed, 65, 100)
    } finally {
      $font.Dispose()
    }
  })

  $ringPanel.Add_MouseClick({
    param($sender, $eventArgs)
    if (-not $ringPanel.Enabled) { return }
    $dx = $eventArgs.X - 110
    $dy = $eventArgs.Y - 110
    $distance = [Math]::Sqrt(($dx * $dx) + ($dy * $dy))
    if ($distance -lt 45 -or $distance -gt 100) { return }
    $angle = ([Math]::Atan2($dy, $dx) * 180.0 / [Math]::PI) + 90
    if ($angle -lt 0) { $angle += 360 }
    $channel = [int]([Math]::Floor($angle / 45.0)) + 1
    if ($script:operatorPreviewChannels -contains $channel) {
      $script:operatorPreviewChannels = @($script:operatorPreviewChannels | Where-Object { $_ -ne $channel })
    } else {
      $script:operatorPreviewChannels = @($script:operatorPreviewChannels + $channel | Sort-Object)
    }
    Schedule-PreviewLightingApply
    $ringPanel.Invalidate()
  })

  [void]$panel.Controls.Add($statusLabel)
  [void]$panel.Controls.Add($metricsLabel)
  [void]$panel.Controls.Add($warningLabel)
  [void]$panel.Controls.Add($lightingLabel)
  [void]$panel.Controls.Add($previewLightCheck)
  [void]$panel.Controls.Add($dutyLabel)
  [void]$panel.Controls.Add($dutySlider)
  [void]$panel.Controls.Add($dutyInputPanel)
  [void]$panel.Controls.Add($ringPanel)
  [void]$panel.Controls.Add($channelButtons)
  [void]$panel.Controls.Add($acceptButton)
  [void]$panel.Controls.Add($abortButton)
  [void]$panel.Controls.Add($pauseButton)
  [void]$panel.Controls.Add($safeOffButton)
  [void]$layout.Controls.Add($picture, 0, 0)
  [void]$layout.Controls.Add($panel, 1, 0)
  [void]$form.Controls.Add($layout)

  $picture.Add_Paint({
    param($sender, $eventArgs)
    if ($null -eq $picture.Image) { return }
    $graphics = $eventArgs.Graphics
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $imageRect = Get-ZoomRect $picture.ClientRectangle $picture.Image.Width $picture.Image.Height
    $cyan = [System.Drawing.Pen]::new([System.Drawing.Color]::Cyan, 2)
    $yellow = [System.Drawing.Pen]::new([System.Drawing.Color]::Gold, 3)
    $green = [System.Drawing.Pen]::new([System.Drawing.Color]::Lime, 2)
    $orange = [System.Drawing.Pen]::new([System.Drawing.Color]::Orange, 2)
    $pink = [System.Drawing.Pen]::new([System.Drawing.Color]::DeepPink, 2)
    $whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    $blackBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(170, 0, 0, 0))
    $font = [System.Drawing.Font]::new("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)

    try {
      $graphics.DrawLine($cyan, ($imageRect.Left + $imageRect.Width / 2), $imageRect.Top, ($imageRect.Left + $imageRect.Width / 2), $imageRect.Bottom)
      $graphics.DrawLine($cyan, $imageRect.Left, ($imageRect.Top + $imageRect.Height / 2), $imageRect.Right, ($imageRect.Top + $imageRect.Height / 2))
      $graphics.DrawRectangle($cyan, $imageRect)

      $guideHeight = [single]($imageRect.Height * 0.86)
      $guideWidth = [single]($guideHeight * (2.5 / 3.5))
      if ($guideWidth -gt ($imageRect.Width * 0.86)) {
        $guideWidth = [single]($imageRect.Width * 0.86)
        $guideHeight = [single]($guideWidth * (3.5 / 2.5))
      }
      $guide = [System.Drawing.RectangleF]::new(
        [single]($imageRect.Left + (($imageRect.Width - $guideWidth) / 2)),
        [single]($imageRect.Top + (($imageRect.Height - $guideHeight) / 2)),
        $guideWidth,
        $guideHeight
      )
      $graphics.DrawRectangle($yellow, $guide.X, $guide.Y, $guide.Width, $guide.Height)

      foreach ($rect in @(
        (New-RelativeRect $guide 0 0 0.18 0.18),
        (New-RelativeRect $guide 0.82 0 0.18 0.18),
        (New-RelativeRect $guide 0.82 0.82 0.18 0.18),
        (New-RelativeRect $guide 0 0.82 0.18 0.18)
      )) {
        $graphics.DrawRectangle($orange, $rect.X, $rect.Y, $rect.Width, $rect.Height)
      }
      foreach ($rect in @(
        (New-RelativeRect $guide 0.18 0 0.64 0.12),
        (New-RelativeRect $guide 0.88 0.18 0.12 0.64),
        (New-RelativeRect $guide 0.18 0.88 0.64 0.12),
        (New-RelativeRect $guide 0 0.18 0.12 0.64)
      )) {
        $graphics.DrawRectangle($pink, $rect.X, $rect.Y, $rect.Width, $rect.Height)
      }
      foreach ($rect in @(
        (New-RelativeRect $guide 0.32 0.34 0.36 0.30),
        (New-RelativeRect $guide 0.26 0.18 0.48 0.22),
        (New-RelativeRect $guide 0.26 0.60 0.48 0.22)
      )) {
        $graphics.DrawRectangle($green, $rect.X, $rect.Y, $rect.Width, $rect.Height)
      }

      $text = "UNCALIBRATED GRID / GUIDE - raw preview image is clean; overlay is window-only"
      $textRect = [System.Drawing.RectangleF]::new(8, 8, 760, 30)
      $graphics.FillRectangle($blackBrush, $textRect)
      $graphics.DrawString($text, $font, $whiteBrush, 12, 12)
    } finally {
      $cyan.Dispose(); $yellow.Dispose(); $green.Dispose(); $orange.Dispose(); $pink.Dispose()
      $whiteBrush.Dispose(); $blackBrush.Dispose(); $font.Dispose()
    }
  })

  $script:operatorPreviewDisplayBusy = $false
  $script:operatorPreviewSkippedFrames = 0
  $script:operatorPreviewLastDisplayStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $script:operatorPreviewFrameAgeMs = 0
  $script:operatorPreviewFrameSource = "pylon_stream_grabber_retrieve_result_latest_images_threaded_csharp"
  $script:operatorPreviewFormClosed = $false
  $form.Add_FormClosed({ $script:operatorPreviewFormClosed = $true })

  $previewPump = $null

  try {
    [void]$camera.Open()
    if ($ExposureUs -gt 0) {
      [void](Set-FloatParameterByName $camera @([Basler.Pylon.PLCamera]::ExposureTime, [Basler.Pylon.PLCamera]::ExposureTimeAbs, "ExposureTime") ([double]$ExposureUs))
    }
    try { Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::TriggerSelector, "TriggerSelector") "FrameStart" } catch {}
    try { Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::TriggerMode, "TriggerMode") "Off" } catch {}
    try { Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::TriggerSelector, "TriggerSelector") "AcquisitionStart" } catch {}
    try { Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::TriggerMode, "TriggerMode") "Off" } catch {}
    try { Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::ExposureAuto, "ExposureAuto") "Off" } catch {}
    try { Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::GainAuto, "GainAuto") "Off" } catch {}
    try { [Basler.Pylon.Configuration]::AcquireContinuous($camera, $null) } catch {}
    try { Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::AcquisitionMode, "AcquisitionMode") "Continuous" } catch {}
    $exposureTime = Get-ReadableParameterValue $camera @([Basler.Pylon.PLCamera]::ExposureTime, [Basler.Pylon.PLCamera]::ExposureTimeAbs)
    $gain = Get-ReadableParameterValue $camera @([Basler.Pylon.PLCamera]::Gain, [Basler.Pylon.PLCamera]::GainAbs, [Basler.Pylon.PLCamera]::GainRaw)
    $configuredPixelFormat = Get-ReadableParameterValue $camera @([Basler.Pylon.PLCamera]::PixelFormat)
    try {
      $camera.Parameters[[Basler.Pylon.PLCameraInstance]::OutputQueueSize].SetValue(1)
    } catch {}
    [void]$camera.StreamGrabber.Start([Basler.Pylon.GrabStrategy]::LatestImages, [Basler.Pylon.GrabLoop]::ProvidedByUser)
    $script:operatorPreviewStreamStarted = $true
    $previewPump = [TenKings.PylonWinFormsPreviewPump]::new($camera, $picture, $statusLabel, $metricsLabel)
    $previewPump.Start()
    [void]$form.ShowDialog()
    try {
      if ($null -ne $previewPump) { $previewPump.Stop() }
      if ($null -ne $leimacPreviewController) {
        $leimacPreviewController.SafeOffSync()
        $script:operatorPreviewLeimacResponses = @($leimacPreviewController.LastResponses)
        $script:operatorPreviewLastApplyLatencyMs = $leimacPreviewController.LastLatencyMs
        $script:operatorPreviewLeimacEverEngaged = [bool]$leimacPreviewController.EverEngaged
      } else {
        $script:operatorPreviewLeimacResponses = Invoke-LeimacPreviewSafeOff
      }
      $script:operatorPreviewAppliedDutySteps = 0
      $script:operatorPreviewLightEnabled = $false
      $script:operatorPreviewLeimacEngaged = $false
      $script:operatorPreviewLightingStatus = "Safe Off sent on preview exit."
    } catch {}

    $file = $null
    $sha256 = $null
    if ($null -ne $picture.Image) {
      try { $picture.Image.Save($lastFramePath, [System.Drawing.Imaging.ImageFormat]::Png) } catch {}
    }
    if (Test-Path -LiteralPath $lastFramePath) {
      $file = Get-Item -LiteralPath $lastFramePath
      $sha256 = (Get-FileHash -LiteralPath $lastFramePath -Algorithm SHA256).Hash.ToLowerInvariant()
    }

    return [ordered]@{
      windowVisible = $true
      implementationType = "windows_winforms_pylon_live_stream"
      framesUpdateAutomatically = $true
      fps = $(if ($null -ne $previewPump) { $previewPump.Fps } else { $script:operatorPreviewFps })
      frameAgeMs = $(if ($null -ne $previewPump) { $previewPump.FrameAgeMs } else { $script:operatorPreviewFrameAgeMs })
      skippedStaleFrames = $(if ($null -ne $previewPump) { $previewPump.SkippedFrames } else { $script:operatorPreviewSkippedFrames })
      frameSource = $script:operatorPreviewFrameSource
      framesDisplayed = $(if ($null -ne $previewPump) { $previewPump.FrameCount } else { $script:operatorPreviewFrameCount })
      overlayVisible = $true
      metricsVisible = $true
      displayOrientation = "portrait_rotated_90_for_operator_preview"
      rawCaptureOrientation = "unchanged_unrotated_sensor_pixels"
      sidebarLayout = "right_vertical_sidebar"
      operatorDecision = $script:operatorPreviewDecision
      lastFramePath = $(if ($file) { $lastFramePath } else { $null })
      lastFrameSha256 = $sha256
      lastFrameByteSize = $(if ($file) { $file.Length } else { $null })
      lastMetrics = $(if ($null -ne $previewPump -and $null -ne $previewPump.LastMetrics) {
        [ordered]@{
          mean = $previewPump.LastMetrics.Mean
          max = $previewPump.LastMetrics.Max
          clippedFraction = $previewPump.LastMetrics.ClippedFraction
          darkFraction = $previewPump.LastMetrics.DarkFraction
          sharpness = $previewPump.LastMetrics.Sharpness
        }
      } else { $script:operatorPreviewLastMetrics })
      lastError = $(if ($null -ne $previewPump -and $previewPump.LastError) { $previewPump.LastError } else { $script:operatorPreviewLastError })
      previewLighting = [ordered]@{
        controlsVisible = $true
        controlsEnabled = [bool]($LeimacHost -and $LeimacHost.Trim().Length -gt 0)
        masterLightOn = $script:operatorPreviewLightEnabled
        currentDutyPercent = [Math]::Round(($script:operatorPreviewDutyTenths / 10.0), 1)
        requestedDutyPercent = [Math]::Round(($script:operatorPreviewDutyTenths / 10.0), 1)
        actualAppliedDutyPercent = [Math]::Round(($script:operatorPreviewAppliedDutySteps / 10.0), 1)
        actualAppliedPwmStep = $script:operatorPreviewAppliedDutySteps
        actualAppliedPwmValue = ("{0:D4}" -f $script:operatorPreviewAppliedDutySteps)
        defaultV1DutyMarkerPercent = 1.2
        maxDutyPercent = 5.0
        selectedChannels = $script:operatorPreviewChannels
        channelMappingStatus = "unknown_uncalibrated"
        safeOffOnExit = $true
        leimacEngagedDuringPreview = $script:operatorPreviewLeimacEverEngaged
        lastApplyLatencyMs = $script:operatorPreviewLastApplyLatencyMs
        lastResponses = $script:operatorPreviewLeimacResponses
      }
      camera = $cameraMetadata
      exposureTime = $exposureTime
      gain = $gain
      sourcePixelFormat = "$configuredPixelFormat"
      transport = "GigE"
      pylon = $Install
      safety = [ordered]@{
        leimacRequired = $false
        leimacEngaged = $script:operatorPreviewLeimacEngaged
        persistentBaslerSaved = $false
        persistentLeimacSaved = $false
        overlaysBakedIntoRawEvidence = $false
        rawEvidenceClean = $true
      }
      note = "Visible Windows pylon live-stream Basler operator preview. Display is portrait-rotated for ergonomics; raw capture orientation is unchanged. Overlay is window-only; preview lighting safe-offs on exit and no User Set is saved."
    }
  } finally {
    $script:operatorPreviewFormClosed = $true
    try { $lightingDebounceTimer.Stop() } catch {}
    try { $lightingPollTimer.Stop() } catch {}
    if ($null -ne $previewPump) { try { $previewPump.Dispose() } catch {} }
    if ($null -ne $leimacPreviewController) { try { $leimacPreviewController.Dispose() } catch {} }
    try { [void](Invoke-LeimacPreviewSafeOff) } catch {}
    if ($script:operatorPreviewStreamStarted) { try { [void]$camera.StreamGrabber.Stop() } catch {} }
    if ($camera.IsOpen) { try { [void]$camera.Close() } catch {} }
    try { $camera.Dispose() } catch {}
    if ($null -ne $picture.Image) { try { $picture.Image.Dispose() } catch {} }
    try { $form.Dispose() } catch {}
  }
}

try {
  $install = Resolve-PylonInstall

  if (-not $install.installed) {
    if ($Action -eq "capture-still" -or $Action -eq "fixed-rig-side-batch" -or $Action -eq "operator-preview-window" -or $Action -eq "operator-preview-mjpeg-stream") {
      throw "Basler pylon is not installed or Basler.Pylon.dll was not found."
    }
    $result = New-ReadinessResult $install @()
    if ($Action -eq "list-cameras") {
      $result.command = "basler-list-cameras"
    }
    Write-BridgeJson ([ordered]@{ ok = $true; result = $result })
    exit 0
  }

  Import-PylonAssembly $install
  $cameras = Get-GigECameras

  if ($Action -eq "readiness") {
    Write-BridgeJson ([ordered]@{ ok = $true; result = (New-ReadinessResult $install $cameras) })
    exit 0
  }

  if ($Action -eq "list-cameras") {
    $result = New-ReadinessResult $install $cameras
    $result.command = "basler-list-cameras"
    Write-BridgeJson ([ordered]@{ ok = $true; result = $result })
    exit 0
  }

  if ($Action -eq "line2-exposure-active") {
    $result = Configure-Line2ExposureActive $install
    Write-BridgeJson ([ordered]@{ ok = $true; result = $result })
    exit 0
  }

  if ($Action -eq "line2-status") {
    $result = Read-Line2Status $install
    Write-BridgeJson ([ordered]@{ ok = $true; result = $result })
    exit 0
  }

  if ($Action -eq "line2-user-output-pulse") {
    $result = Pulse-Line2UserOutput $install
    Write-BridgeJson ([ordered]@{ ok = $true; result = $result })
    exit 0
  }

  if ($Action -eq "operator-preview-window") {
    $result = Show-OperatorPreviewWindow $install
    Write-BridgeJson ([ordered]@{ ok = $true; result = $result })
    exit 0
  }

  if ($Action -eq "operator-preview-mjpeg-stream") {
    Start-OperatorPreviewMjpegStream $install
    exit 0
  }

  if ($Action -eq "calibration-preview-mjpeg-stream") {
    Start-CalibrationPreviewMjpegStream $install
    exit 0
  }

  if ($Action -eq "fixed-rig-side-batch") {
    $result = Capture-FixedRigSideBatch $install
    Write-BridgeJson ([ordered]@{ ok = $true; result = $result })
    exit 0
  }

  $capture = Capture-Still $install
  Write-BridgeJson ([ordered]@{ ok = $true; result = $capture })
  exit 0
} catch {
  Write-BridgeJson (New-BridgeError "BASLER_PYLON_BRIDGE_ERROR" $_.Exception.Message)
  exit 1
}
