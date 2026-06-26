[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("readiness", "list-cameras", "capture-still", "line2-exposure-active")]
  [string]$Action,

  [string]$PylonRoot,
  [string]$OutputDir,
  [string]$Label,
  [int]$CameraIndex = 0,
  [ValidateSet("png", "tiff", "jpg")]
  [string]$Format = "png",
  [string]$LensModel,
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

function Configure-Line2ExposureActive {
  param([System.Collections.IDictionary]$Install)

  if (-not $Apply) {
    return [ordered]@{
      applied = $false
      baslerSettingsChanged = $false
      cameraIndex = $CameraIndex
      lineSelector = "Line2"
      lineMode = "Output"
      lineSource = "ExposureActive"
      lineInverter = $false
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
    Set-BoolParameterByName $camera @([Basler.Pylon.PLCamera]::LineInverter, "LineInverter") $false
    Set-EnumParameterByName $camera @([Basler.Pylon.PLCamera]::LineSource, "LineSource") "ExposureActive"

    $readback = [ordered]@{
      lineSelector = Get-ParameterValueByName $camera @([Basler.Pylon.PLCamera]::LineSelector, "LineSelector")
      lineMode = Get-ParameterValueByName $camera @([Basler.Pylon.PLCamera]::LineMode, "LineMode")
      lineSource = Get-ParameterValueByName $camera @([Basler.Pylon.PLCamera]::LineSource, "LineSource")
      lineInverter = Get-ParameterValueByName $camera @([Basler.Pylon.PLCamera]::LineInverter, "LineInverter")
    }

    return [ordered]@{
      applied = $true
      baslerSettingsChanged = $true
      cameraIndex = $CameraIndex
      lineSelector = "Line2"
      lineMode = "Output"
      lineSource = "ExposureActive"
      lineInverter = $false
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

  try {
    [void]$camera.Open()
    $configuredPixelFormat = Get-ReadableParameterValue $camera @([Basler.Pylon.PLCamera]::PixelFormat)
    $exposureTime = Get-ReadableParameterValue $camera @([Basler.Pylon.PLCamera]::ExposureTime, [Basler.Pylon.PLCamera]::ExposureTimeAbs)
    $gain = Get-ReadableParameterValue $camera @([Basler.Pylon.PLCamera]::Gain, [Basler.Pylon.PLCamera]::GainAbs, [Basler.Pylon.PLCamera]::GainRaw)

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

    [Basler.Pylon.ImagePersistence]::Save($imageFileFormat, $outputFilePath, $grabResult)

    $file = Get-Item -LiteralPath $outputFilePath
    $sha256 = (Get-FileHash -LiteralPath $outputFilePath -Algorithm SHA256).Hash.ToLowerInvariant()

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
      note = "Uncalibrated macro smoke capture only; not production macro evidence and not a final AI grade."
    }
    return $captureResult
  } finally {
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
  }
}

try {
  $install = Resolve-PylonInstall

  if (-not $install.installed) {
    if ($Action -eq "capture-still") {
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

  $capture = Capture-Still $install
  Write-BridgeJson ([ordered]@{ ok = $true; result = $capture })
  exit 0
} catch {
  Write-BridgeJson (New-BridgeError "BASLER_PYLON_BRIDGE_ERROR" $_.Exception.Message)
  exit 1
}
