using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace TenKings.AiGrader.DinoLiteBridge
{
    public sealed class DnVideoXAdapter : IDinoLiteBridgeAdapter
    {
        private const string ProgId = "VIDEOCAPX.VideoCapXCtrl.1";
        private const string Clsid = "922FB007-DD9A-11D3-BD8D-DAAFCB8D9378";
        private const string ActiveXPath = @"C:\Windows\SysWOW64\DNVideoX.ocx";
        private const int StreamSettleDelayMs = 750;
        private const int LightingSettleDelayMs = 250;
        private const int OptionalCapturePollTimeoutMs = 15000;
        private const int OptionalCapturePollIntervalMs = 100;
        private static readonly string[] RequiredEdofRuntimeFiles = { "enfuse.exe", "SMIUtility.dll", "d3dx9_31.dll" };
        private static readonly string[] OptionalRuntimeFiles =
        {
            "DNLBarReader.dll",
            "Microsoft.VC90.CRT.manifest",
            "msvcr90.dll",
            "msvcp90.dll",
            "msvcm90.dll"
        };
        private readonly BridgeOptions options;

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool SetDllDirectory(string? lpPathName);

        public DnVideoXAdapter(BridgeOptions options)
        {
            this.options = options;
        }

        public object Health()
        {
            return NotReady("DNVideoX real adapter skeleton is present but hardware access is disabled.");
        }

        public object SdkInfo()
        {
            return new
            {
                adapter = "dnvideox",
                sdk = "DNVideoX",
                registeredActiveXPath = ActiveXPath,
                progId = ProgId,
                targetFramework = ".NET Framework 4.8",
                platform = "x86",
                threadingModel = "STA",
                comActiveXInstantiated = false,
                manualEnumerateRequested = options.ManualEnumerate,
                manualHardwareAccess = options.ManualHardwareAccess,
                status = "SDK_NOT_READY",
                message = "DNVideoX real hardware access is manual-only; default health/sdkInfo commands do not instantiate the OCX."
            };
        }

        public object ListDevices()
        {
            return options.ManualEnumerate
                ? NotReady("Manual DNVideoX enumeration is not implemented in this skeleton; no OCX was instantiated.")
                : NotReady("DNVideoX enumeration requires an explicit future manual command; no OCX was instantiated.");
        }

        public object Capabilities()
        {
            return new
            {
                adapter = "dnvideox",
                status = "NOT_IMPLEMENTED",
                stillCapture = false,
                amr = false,
                flc = false,
                edr = false,
                edof = false,
                comActiveXInstantiated = false,
                message = "Real microscope status and still JPG capture are implemented only through explicit manual commands."
            };
        }

        public object EnumerateDevices()
        {
            if (!options.ManualEnumerate)
            {
                return NotReady("DNVideoX enumeration requires --manual-enumerate; no OCX was instantiated.");
            }

            object? control = null;
            HiddenDnVideoXHost? host = null;
            try
            {
                host = HiddenDnVideoXHost.Create();
                control = host.ControlInstance;
                var deviceCount = Convert.ToInt32(InvokeRequired(control, "GetVideoDeviceCount"));
                var devices = new List<object>();
                var optionalErrors = new List<object>();

                for (var index = 0; index < deviceCount; index += 1)
                {
                    var name = Convert.ToString(InvokeRequired(control, "GetVideoDeviceName", index)) ?? "";
                    var description = InvokeOptionalString(control, "GetVideoDeviceDesc", index, optionalErrors);
                    var deviceId = InvokeOptionalString(control, "GetDeviceID", index, optionalErrors);

                    devices.Add(new
                    {
                        index,
                        name,
                        description,
                        deviceId
                    });
                }

                return new
                {
                    adapter = "dnvideox",
                    comActiveXInstantiated = true,
                    connected = false,
                    preview = false,
                    deviceCount,
                    devices = devices.ToArray(),
                    optionalErrors = optionalErrors.ToArray(),
                    sdk = new
                    {
                        control = "DNVideoX",
                        version = GetOcxVersion(),
                        progId = ProgId,
                        clsid = Clsid,
                        registeredActiveXPath = ActiveXPath
                    },
                    host = "hidden-winforms-axhost",
                    forbiddenOperationsInvoked = false
                };
            }
            catch (Exception error)
            {
                return new
                {
                    adapter = "dnvideox",
                    status = "SDK_NOT_READY",
                    comActiveXInstantiated = control != null,
                    connected = false,
                    preview = false,
                    deviceCount = 0,
                    devices = new object[0],
                    sdk = new
                    {
                        control = "DNVideoX",
                        version = GetOcxVersion(),
                        progId = ProgId,
                        clsid = Clsid,
                        registeredActiveXPath = ActiveXPath
                    },
                    host = "hidden-winforms-axhost",
                    error = new
                    {
                        code = "DNVIDEOX_ENUMERATION_FAILED",
                        message = FormatExceptionMessage(error)
                    },
                    forbiddenOperationsInvoked = false
                };
            }
            finally
            {
                host?.Dispose();
            }
        }

        public object Status(int deviceIndex)
        {
            if (!options.ManualHardwareAccess)
            {
                return NotReady("DNVideoX status requires --manual-hardware; no OCX was instantiated.");
            }

            object? control = null;
            HiddenDnVideoXHost? host = null;
            var cleanup = new CleanupState();
            try
            {
                host = HiddenDnVideoXHost.Create();
                control = host.ControlInstance;
                ValidateDeviceIndex(control, deviceIndex);
                SetProperty(control, "VideoDeviceIndex", deviceIndex);
                SetProperty(control, "Connected", true);
                Application.DoEvents();

                var optionalErrors = new List<object>();
                var device = ReadDevice(control, deviceIndex, optionalErrors);
                var config = ReadConfig(control, deviceIndex, optionalErrors);

                return new
                {
                    adapter = "dnvideox",
                    comActiveXInstantiated = true,
                    ocxVersion = GetOcxVersion(),
                    device,
                    connectedDuringCommand = true,
                    previewDuringCommand = false,
                    config,
                    amr = InvokeOptional(control, "GetAMR", optionalErrors, deviceIndex),
                    videoCaps = ReadVideoCaps(control, optionalErrors),
                    videoFormat = ReadVideoFormat(control, optionalErrors),
                    lensLimits = ReadLongPair(control, "GetLensPosLimits", deviceIndex, optionalErrors),
                    lensFineLimits = new { unavailable = true, code = "NOT_EXPOSED_BY_SDK_HEADER" },
                    exposure = new
                    {
                        exposureValue = InvokeOptional(control, "GetExposureValue", optionalErrors, deviceIndex),
                        gain = InvokeOptional(control, "GetGain", optionalErrors, deviceIndex),
                        autoExposure = InvokeOptional(control, "GetAutoExposure", optionalErrors, deviceIndex)
                    },
                    ledState = InvokeOptional(control, "GetLEDState", optionalErrors, deviceIndex),
                    optionalErrors = optionalErrors.ToArray(),
                    cleanup,
                    forbiddenOperationsInvoked = false
                };
            }
            catch (Exception error)
            {
                return RealCommandError("DNVIDEOX_STATUS_FAILED", error, control != null, cleanup);
            }
            finally
            {
                CleanupControl(control, cleanup, stopPreview: false);
                host?.Dispose();
                cleanup.hostDisposed = true;
            }
        }

        public object CaptureStillJpg(int deviceIndex, string? outputDir)
        {
            if (!options.ManualHardwareAccess)
            {
                return NotReady("DNVideoX still capture requires --manual-hardware; no OCX was instantiated.");
            }
            if (string.IsNullOrWhiteSpace(outputDir))
            {
                return new
                {
                    adapter = "dnvideox",
                    status = "INVALID_REQUEST",
                    comActiveXInstantiated = false,
                    message = "dinolite.captureStillJpg requires outputDir."
                };
            }

            object? control = null;
            HiddenDnVideoXHost? host = null;
            var cleanup = new CleanupState();
            try
            {
                var absoluteOutputDir = Path.GetFullPath(outputDir);
                Directory.CreateDirectory(absoluteOutputDir);
                var timestamp = DateTimeOffset.UtcNow;
                var outputPath = Path.Combine(
                    absoluteOutputDir,
                    "dinolite-still-" + timestamp.ToString("yyyyMMddTHHmmssfffZ") + ".jpg");

                host = HiddenDnVideoXHost.Create();
                control = host.ControlInstance;
                ValidateDeviceIndex(control, deviceIndex);
                SetProperty(control, "VideoDeviceIndex", deviceIndex);
                SetProperty(control, "Connected", true);
                SetProperty(control, "Preview", true);
                Application.DoEvents();

                var optionalErrors = new List<object>();
                var device = ReadDevice(control, deviceIndex, optionalErrors);
                var config = ReadConfig(control, deviceIndex, optionalErrors);
                var amr = InvokeOptional(control, "GetAMR", optionalErrors, deviceIndex);
                var saved = Convert.ToBoolean(InvokeRequired(control, "SaveFrameJPG", outputPath, 90, 1.0));
                if (!saved || !File.Exists(outputPath))
                {
                    throw new InvalidOperationException("SaveFrameJPG did not produce an output file.");
                }

                return new
                {
                    adapter = "dnvideox",
                    comActiveXInstantiated = true,
                    device,
                    outputFilePath = outputPath,
                    sha256 = ComputeSha256(outputPath),
                    byteSize = new FileInfo(outputPath).Length,
                    mimeType = "image/jpeg",
                    timestamp = timestamp.ToString("o"),
                    connectedDuringCommand = true,
                    previewDuringCommand = true,
                    config,
                    amr,
                    optionalErrors = optionalErrors.ToArray(),
                    cleanup,
                    forbiddenOperationsInvoked = false
                };
            }
            catch (Exception error)
            {
                return RealCommandError("DNVIDEOX_CAPTURE_STILL_JPG_FAILED", error, control != null, cleanup);
            }
            finally
            {
                CleanupControl(control, cleanup, stopPreview: true);
                host?.Dispose();
                cleanup.hostDisposed = true;
            }
        }

        public object GetLightingStatus(int deviceIndex)
        {
            if (!options.ManualHardwareAccess)
            {
                return NotReady("DNVideoX lighting status requires --manual-hardware; no OCX was instantiated.");
            }

            object? control = null;
            HiddenDnVideoXHost? host = null;
            var cleanup = new CleanupState();
            try
            {
                host = HiddenDnVideoXHost.Create();
                control = host.ControlInstance;
                ValidateDeviceIndex(control, deviceIndex);
                SetProperty(control, "VideoDeviceIndex", deviceIndex);
                SetProperty(control, "Connected", true);
                Application.DoEvents();

                var optionalErrors = new List<object>();
                var config = ReadConfig(control, deviceIndex, optionalErrors);
                return new
                {
                    adapter = "dnvideox",
                    comActiveXInstantiated = true,
                    ocxVersion = GetOcxVersion(),
                    device = ReadDevice(control, deviceIndex, optionalErrors),
                    connectedDuringCommand = true,
                    previewDuringCommand = false,
                    config,
                    ledState = InvokeOptional(control, "GetLEDState", optionalErrors, deviceIndex),
                    optionalErrors = optionalErrors.ToArray(),
                    cleanup,
                    forbiddenOperationsInvoked = false
                };
            }
            catch (Exception error)
            {
                return RealCommandError("DNVIDEOX_LIGHTING_STATUS_FAILED", error, control != null, cleanup);
            }
            finally
            {
                CleanupControl(control, cleanup, stopPreview: false);
                host?.Dispose();
                cleanup.hostDisposed = true;
            }
        }

        public object SetLightingRecipe(int deviceIndex, string? recipeName)
        {
            if (!options.ManualHardwareAccess)
            {
                return NotReady("DNVideoX lighting recipe requires --manual-hardware; no OCX was instantiated.");
            }

            object? control = null;
            HiddenDnVideoXHost? host = null;
            var cleanup = new CleanupState();
            try
            {
                host = HiddenDnVideoXHost.Create();
                control = host.ControlInstance;
                ValidateDeviceIndex(control, deviceIndex);
                SetProperty(control, "VideoDeviceIndex", deviceIndex);
                SetProperty(control, "Connected", true);
                Application.DoEvents();

                var optionalErrors = new List<object>();
                var configBits = ReadConfigBitfield(control, deviceIndex, optionalErrors);
                var device = ReadDevice(control, deviceIndex, optionalErrors);
                var pid = ExtractUsbPid(GetDeviceIdFromDeviceObject(device));
                var recipe = BuildLightingRecipe(string.IsNullOrWhiteSpace(recipeName) ? "safe-final-all-quadrants-level-3" : recipeName!);
                var apply = ApplyLightingRecipe(control, deviceIndex, recipe, configBits, pid, optionalErrors);
                return new
                {
                    adapter = "dnvideox",
                    comActiveXInstantiated = true,
                    ocxVersion = GetOcxVersion(),
                    device,
                    connectedDuringCommand = true,
                    previewDuringCommand = false,
                    recipe,
                    apply,
                    optionalErrors = optionalErrors.ToArray(),
                    cleanup,
                    forbiddenOperationsInvoked = false
                };
            }
            catch (Exception error)
            {
                return RealCommandError("DNVIDEOX_SET_LIGHTING_RECIPE_FAILED", error, control != null, cleanup);
            }
            finally
            {
                CleanupControl(control, cleanup, stopPreview: false);
                host?.Dispose();
                cleanup.hostDisposed = true;
            }
        }

        public object CapturePackage(int deviceIndex, string? outputDir, string? label, bool includeLightingSweep, bool includeEdr, bool includeEdof)
        {
            if (!options.ManualHardwareAccess)
            {
                return NotReady("DNVideoX capture package requires --manual-hardware; no OCX was instantiated.");
            }
            if (string.IsNullOrWhiteSpace(outputDir))
            {
                return new
                {
                    adapter = "dnvideox",
                    status = "INVALID_REQUEST",
                    comActiveXInstantiated = false,
                    message = "dinolite.capturePackage requires outputDir."
                };
            }
            if (string.IsNullOrWhiteSpace(label))
            {
                return new
                {
                    adapter = "dnvideox",
                    status = "INVALID_REQUEST",
                    comActiveXInstantiated = false,
                    message = "dinolite.capturePackage requires label."
                };
            }

            object? control = null;
            HiddenDnVideoXHost? host = null;
            var cleanup = new CleanupState();
            RuntimeDirectoryScope? runtimeScope = null;
            try
            {
                var timestamp = DateTimeOffset.UtcNow;
                var packageId = "dinolite-" + SanitizeFilePart(label!) + "-" + timestamp.ToString("yyyyMMddTHHmmssfffZ");
                var absoluteOutputDir = Path.GetFullPath(outputDir);
                var packageDir = Path.Combine(absoluteOutputDir, packageId);
                Directory.CreateDirectory(packageDir);
                var runtimeDependencies = InspectRuntimeDependencies(options.SdkRuntimeDir);
                runtimeScope = RuntimeDirectoryScope.TryEnter(options.SdkRuntimeDir, runtimeDependencies);

                host = HiddenDnVideoXHost.Create();
                control = host.ControlInstance;
                ValidateDeviceIndex(control, deviceIndex);
                SetProperty(control, "VideoDeviceIndex", deviceIndex);
                SetProperty(control, "Connected", true);
                SetProperty(control, "Preview", true);
                Application.DoEvents();
                WaitWithEvents(StreamSettleDelayMs);

                var optionalErrors = new List<object>();
                var device = ReadDevice(control, deviceIndex, optionalErrors);
                var configBits = ReadConfigBitfield(control, deviceIndex, optionalErrors);
                var deviceId = GetDeviceIdFromDeviceObject(device);
                var pid = ExtractUsbPid(deviceId);
                var config = BuildConfigObject(configBits, pid);
                var amr = InvokeOptional(control, "GetAMR", optionalErrors, deviceIndex);
                var captures = new List<object>();

                captures.Add(CaptureJpg(control, Path.Combine(packageDir, "normal-still.jpg"), "normal", "normal-still", "SaveFrameJPG"));

                if (includeLightingSweep)
                {
                    var recipes = new List<LightingRecipe>(BuildLightingSweepRecipes(configBits, pid));
                    if (recipes.Count == 0)
                    {
                        captures.Add(UnavailableCapture(packageDir, "lighting-sweep-unavailable.jpg", "lightingSweep", "lighting-sweep", "LIGHTING_SWEEP_UNSUPPORTED", "GetConfig did not report LED or FLC support.", null));
                    }

                    foreach (var recipe in recipes)
                    {
                        var apply = ApplyLightingRecipe(control, deviceIndex, recipe, configBits, pid, optionalErrors);
                        if (!IsSuccessfulApply(apply))
                        {
                            captures.Add(UnavailableCapture(packageDir, recipe.name + ".jpg", "lightingSweep", recipe.name, "FLC_UNAVAILABLE", "Lighting recipe could not be applied.", apply));
                            continue;
                        }
                        captures.Add(CaptureJpg(control, Path.Combine(packageDir, recipe.name + ".jpg"), "lightingSweep", recipe.name, "SaveFrameJPG"));
                    }
                }

                if (includeEdr)
                {
                    captures.Add(TryOptionalSdkCapture(control, deviceIndex, Path.Combine(packageDir, "edr.jpg"), "edr", "edr", "SaveEDR", optionalErrors));
                }

                if (includeEdof)
                {
                    if (!IsEdofSupported(configBits, pid))
                    {
                        captures.Add(UnavailableCapture(packageDir, "edof.jpg", "edof", "edof", "EDOF_UNSUPPORTED", "GetConfig did not report EDOF support.", null));
                    }
                    else if (!IsEdofRuntimeReady(runtimeDependencies))
                    {
                        captures.Add(UnavailableCapture(
                            packageDir,
                            "edof.jpg",
                            "edof",
                            "edof",
                            "EDOF_RUNTIME_DEPENDENCIES_MISSING",
                            "EDOF is reported by GetConfig, but required DNVideoX helper runtime files are not available from the configured SDK runtime directory.",
                            runtimeDependencies));
                    }
                    else
                    {
                        captures.Add(TryOptionalSdkCapture(control, deviceIndex, Path.Combine(packageDir, "edof.jpg"), "edof", "edof", "SaveEDOF", optionalErrors));
                    }
                }

                var finalRecipe = BuildLightingRecipe("safe-final-all-quadrants-level-3");
                cleanup.finalLightingRecipe = ApplyLightingRecipe(control, deviceIndex, finalRecipe, configBits, pid, optionalErrors);
                CleanupControl(control, cleanup, stopPreview: true);
                control = null;
                host.Dispose();
                host = null;
                cleanup.hostDisposed = true;

                var manifestPath = Path.Combine(packageDir, "manifest.json");
                var previewReportPath = Path.Combine(packageDir, "preview-report.html");
                var manifest = new
                {
                    packageId,
                    label,
                    timestamp = timestamp.ToString("o"),
                    adapter = "dnvideox",
                    device,
                    ocxVersion = GetOcxVersion(),
                    config,
                    runtimeDependencies,
                    amr,
                    connectedDuringCommand = true,
                    previewDuringCommand = true,
                    captures = captures.ToArray(),
                    cleanup,
                    optionalErrors = optionalErrors.ToArray(),
                    manifestPath,
                    previewReportPath,
                    limitations = new[] { "Dino-Lite capture package preview -- not a certified grade." },
                    forbiddenOperationsInvoked = false
                };

                WriteManifestAndReport(manifestPath, previewReportPath, manifest, captures);

                return new
                {
                    adapter = "dnvideox",
                    comActiveXInstantiated = true,
                    packageId,
                    label,
                    packageDir,
                    manifestPath,
                    previewReportPath,
                    timestamp = timestamp.ToString("o"),
                    device,
                    ocxVersion = GetOcxVersion(),
                    connectedDuringCommand = true,
                    previewDuringCommand = true,
                    config,
                    runtimeDependencies,
                    amr,
                    captures = captures.ToArray(),
                    cleanup,
                    optionalErrors = optionalErrors.ToArray(),
                    limitations = new[] { "Dino-Lite capture package preview -- not a certified grade." },
                    forbiddenOperationsInvoked = false
                };
            }
            catch (Exception error)
            {
                return RealCommandError("DNVIDEOX_CAPTURE_PACKAGE_FAILED", error, control != null, cleanup);
            }
            finally
            {
                CleanupControl(control, cleanup, stopPreview: true);
                host?.Dispose();
                cleanup.hostDisposed = true;
                runtimeScope?.Dispose();
            }
        }

        public object OperatorWorkflow(int deviceIndex, string? outputDir, string? label, string? plan, bool includeFlcSweep, bool includeEdr, bool includeEdof, string? cornerProfile, bool captureGuides)
        {
            if (!options.ManualHardwareAccess)
            {
                return NotReady("DNVideoX operator workflow requires --manual-hardware; no OCX was instantiated.");
            }
            if (string.IsNullOrWhiteSpace(outputDir))
            {
                return new
                {
                    adapter = "dnvideox",
                    status = "INVALID_REQUEST",
                    comActiveXInstantiated = false,
                    message = "dinolite.operatorWorkflow requires outputDir."
                };
            }

            var normalizedCornerProfile = NormalizeCornerProfile(cornerProfile);
            var targets = BuildOperatorPlan(plan, normalizedCornerProfile, captureGuides);
            if (targets.Count == 0)
            {
                return new
                {
                    adapter = "dnvideox",
                    status = "INVALID_REQUEST",
                    comActiveXInstantiated = false,
                    message = "Unsupported Dino-Lite operator plan: " + (plan ?? "")
                };
            }

            object? control = null;
            OperatorDnVideoXHost? host = null;
            var cleanup = new CleanupState();
            RuntimeDirectoryScope? runtimeScope = null;
            try
            {
                var timestamp = DateTimeOffset.UtcNow;
                var normalizedLabel = string.IsNullOrWhiteSpace(label) ? "operator-session" : label!;
                var normalizedPlan = string.IsNullOrWhiteSpace(plan) ? "corners-basic" : plan!.Trim();
                var sessionId = "dinolite-operator-" + SanitizeFilePart(normalizedLabel) + "-" + timestamp.ToString("yyyyMMddTHHmmssfffZ");
                var absoluteOutputDir = Path.GetFullPath(outputDir);
                var sessionDir = Path.Combine(absoluteOutputDir, sessionId);
                Directory.CreateDirectory(sessionDir);
                var runtimeDependencies = InspectRuntimeDependencies(options.SdkRuntimeDir);
                runtimeScope = RuntimeDirectoryScope.TryEnter(options.SdkRuntimeDir, runtimeDependencies);

                host = OperatorDnVideoXHost.Create();
                control = host.ControlInstance;
                ValidateDeviceIndex(control, deviceIndex);
                SetProperty(control, "VideoDeviceIndex", deviceIndex);
                SetProperty(control, "Connected", true);
                SetProperty(control, "Preview", true);
                Application.DoEvents();
                WaitWithEvents(StreamSettleDelayMs);

                var optionalErrors = new List<object>();
                var device = ReadDevice(control, deviceIndex, optionalErrors);
                var configBits = ReadConfigBitfield(control, deviceIndex, optionalErrors);
                var deviceId = GetDeviceIdFromDeviceObject(device);
                var pid = ExtractUsbPid(deviceId);
                var config = BuildConfigObject(configBits, pid);
                var amr = InvokeOptional(control, "GetAMR", optionalErrors, deviceIndex);
                var targetRecords = new List<object>();
                var sessionStatus = "completed";
                var showPostOverviewNotice = false;

                for (var index = 0; index < targets.Count; index += 1)
                {
                    var target = targets[index];
                    var attempt = 1;
                    var advance = false;
                    while (!advance)
                    {
                        var action = host.WaitForAction(target, index + 1, targets.Count, showPostOverviewNotice);
                        showPostOverviewNotice = false;
                        if (action == OperatorAction.Abort)
                        {
                            sessionStatus = "aborted";
                            targetRecords.Add(BuildOperatorTargetRecord(target, index + 1, action, attempt, "aborted", new object[0]));
                            advance = true;
                            break;
                        }

                        if (action == OperatorAction.Skip)
                        {
                            targetRecords.Add(BuildOperatorTargetRecord(target, index + 1, action, attempt, "skipped", new object[0]));
                            advance = true;
                            break;
                        }

                        var artifacts = CaptureOperatorTargetArtifacts(
                            control,
                            deviceIndex,
                            sessionDir,
                            target,
                            index + 1,
                            attempt,
                            configBits,
                            pid,
                            runtimeDependencies,
                            includeFlcSweep,
                            includeEdr,
                            includeEdof,
                            optionalErrors);
                        targetRecords.Add(BuildOperatorTargetRecord(target, index + 1, action, attempt, "success", artifacts));
                        if (target.id == "full-card-overview")
                        {
                            showPostOverviewNotice = true;
                        }

                        if (action == OperatorAction.Retake)
                        {
                            attempt += 1;
                            continue;
                        }

                        advance = true;
                    }

                    if (sessionStatus == "aborted")
                    {
                        break;
                    }
                }

                var finalRecipe = BuildLightingRecipe("safe-final-all-quadrants-level-3");
                cleanup.finalLightingRecipe = ApplyLightingRecipe(control, deviceIndex, finalRecipe, configBits, pid, optionalErrors);
                CleanupControl(control, cleanup, stopPreview: true);
                control = null;
                host.Dispose();
                host = null;
                cleanup.hostDisposed = true;

                var manifestPath = Path.Combine(sessionDir, "manifest.json");
                var previewReportPath = Path.Combine(sessionDir, "preview-report.html");
                var limitations = OperatorLimitations();
                var manifest = new
                {
                    sessionId,
                    label = normalizedLabel,
                    plan = normalizedPlan,
                    timestamp = timestamp.ToString("o"),
                    status = sessionStatus,
                    adapter = "dnvideox",
                    device,
                    ocxVersion = GetOcxVersion(),
                    config,
                    runtimeDependencies,
                    amr,
                    connectedDuringCommand = true,
                    previewDuringCommand = true,
                    options = new { includeFlcSweep, includeEdr, includeEdof, cornerProfile = normalizedCornerProfile, captureGuides },
                    targets = targetRecords.ToArray(),
                    cleanup,
                    optionalErrors = optionalErrors.ToArray(),
                    manifestPath,
                    previewReportPath,
                    limitations,
                    forbiddenOperationsInvoked = false
                };

                WriteOperatorManifestAndReport(manifestPath, previewReportPath, manifest, targetRecords);

                return new
                {
                    adapter = "dnvideox",
                    comActiveXInstantiated = true,
                    sessionId,
                    label = normalizedLabel,
                    plan = normalizedPlan,
                    sessionDir,
                    manifestPath,
                    previewReportPath,
                    timestamp = timestamp.ToString("o"),
                    status = sessionStatus,
                    device,
                    ocxVersion = GetOcxVersion(),
                    connectedDuringCommand = true,
                    previewDuringCommand = true,
                    config,
                    runtimeDependencies,
                    amr,
                    options = new { includeFlcSweep, includeEdr, includeEdof, cornerProfile = normalizedCornerProfile, captureGuides },
                    targets = targetRecords.ToArray(),
                    cleanup,
                    optionalErrors = optionalErrors.ToArray(),
                    limitations,
                    forbiddenOperationsInvoked = false
                };
            }
            catch (Exception error)
            {
                return RealCommandError("DNVIDEOX_OPERATOR_WORKFLOW_FAILED", error, control != null, cleanup);
            }
            finally
            {
                CleanupControl(control, cleanup, stopPreview: true);
                host?.Dispose();
                cleanup.hostDisposed = true;
                runtimeScope?.Dispose();
            }
        }

        public object RuntimeDiagnostics()
        {
            return InspectRuntimeDependencies(options.SdkRuntimeDir);
        }

        private static object NotReady(string message)
        {
            return new
            {
                adapter = "dnvideox",
                status = "SDK_NOT_READY",
                comActiveXInstantiated = false,
                message
            };
        }

        private static object? InvokeRequired(object target, string methodName, params object[] args)
        {
            return target.GetType().InvokeMember(
                methodName,
                BindingFlags.InvokeMethod,
                binder: null,
                target: target,
                args: args);
        }

        private static object? GetProperty(object target, string propertyName)
        {
            return target.GetType().InvokeMember(
                propertyName,
                BindingFlags.GetProperty,
                binder: null,
                target: target,
                args: null);
        }

        private static void SetProperty(object target, string propertyName, object value)
        {
            target.GetType().InvokeMember(
                propertyName,
                BindingFlags.SetProperty,
                binder: null,
                target: target,
                args: new[] { value });
        }

        private static string? InvokeOptionalString(object target, string methodName, int index, List<object> optionalErrors)
        {
            try
            {
                return Convert.ToString(InvokeRequired(target, methodName, index));
            }
            catch (Exception error)
            {
                optionalErrors.Add(new
                {
                    index,
                    field = methodName,
                    code = "OPTIONAL_FIELD_UNAVAILABLE",
                    message = FormatExceptionMessage(error)
                });
                return null;
            }
        }

        private static object? InvokeOptional(object target, string methodName, List<object> optionalErrors, params object[] args)
        {
            try
            {
                return InvokeRequired(target, methodName, args);
            }
            catch (Exception error)
            {
                optionalErrors.Add(new
                {
                    field = methodName,
                    code = "OPTIONAL_FIELD_UNAVAILABLE",
                    message = FormatExceptionMessage(error)
                });
                return null;
            }
        }

        private static void ValidateDeviceIndex(object control, int deviceIndex)
        {
            var deviceCount = Convert.ToInt32(InvokeRequired(control, "GetVideoDeviceCount"));
            if (deviceIndex < 0 || deviceIndex >= deviceCount)
            {
                throw new ArgumentOutOfRangeException(nameof(deviceIndex), "Device index " + deviceIndex + " is outside detected device count " + deviceCount + ".");
            }
        }

        private static object ReadDevice(object control, int deviceIndex, List<object> optionalErrors)
        {
            return new
            {
                index = deviceIndex,
                name = Convert.ToString(InvokeRequired(control, "GetVideoDeviceName", deviceIndex)) ?? "",
                description = InvokeOptionalString(control, "GetVideoDeviceDesc", deviceIndex, optionalErrors),
                deviceId = InvokeOptionalString(control, "GetDeviceID", deviceIndex, optionalErrors)
            };
        }

        private static object ReadConfig(object control, int deviceIndex, List<object> optionalErrors)
        {
            return BuildConfigObject(ReadConfigBitfield(control, deviceIndex, optionalErrors), null);
        }

        private static long? ReadConfigBitfield(object control, int deviceIndex, List<object> optionalErrors)
        {
            var raw = InvokeOptional(control, "GetConfig", optionalErrors, deviceIndex);
            return raw == null ? (long?)null : Convert.ToInt64(raw);
        }

        public static object DecodeConfigForTests(long bitfield)
        {
            return BuildConfigObject(bitfield, null);
        }

        private static object BuildConfigObject(long? bitfield, string? pid)
        {
            var ledMode = bitfield == null ? (long?)null : (bitfield.Value >> 2) & 0x03;
            return new
            {
                bitfield,
                source = "DNVideoX GetConfig: bit7 EDOF, bit6 AMR, bits3:2 LED mode, bit1 FLC, bit0 AXI",
                decoded = bitfield == null
                    ? null
                    : new
                    {
                        edof = IsEdofSupported(bitfield, pid),
                        amr = (bitfield.Value & 0x40) == 0x40,
                        ledMode,
                        led = IsLedSupported(bitfield, pid),
                        flc = IsFlcSupported(bitfield, pid),
                        axi = (bitfield.Value & 0x01) == 0x01,
                        pid
                    }
            };
        }

        private static bool IsLedSupported(long? bitfield, string? pid)
        {
            if (bitfield == null) return false;
            var ledMode = (bitfield.Value >> 2) & 0x03;
            return ledMode > 0 || IsKnownLedPid(pid);
        }

        private static bool IsFlcSupported(long? bitfield, string? pid)
        {
            return bitfield != null && ((bitfield.Value & 0x02) == 0x02 || IsKnownFlcPid(pid));
        }

        private static bool IsEdofSupported(long? bitfield, string? pid)
        {
            return bitfield != null && (bitfield.Value & 0x80) == 0x80;
        }

        private static LightingRecipe BuildLightingRecipe(string recipeName)
        {
            switch (recipeName)
            {
                case "all-leds-on-normal":
                    return new LightingRecipe(recipeName, ledState: 1, flcSwitch: null, flcLevel: null);
                case "flc-all-level-6":
                    return new LightingRecipe(recipeName, ledState: null, flcSwitch: 15, flcLevel: 6);
                case "flc-quadrant-1-level-4":
                    return new LightingRecipe(recipeName, ledState: null, flcSwitch: 1, flcLevel: 4);
                case "flc-quadrant-2-level-4":
                    return new LightingRecipe(recipeName, ledState: null, flcSwitch: 2, flcLevel: 4);
                case "flc-quadrant-3-level-4":
                    return new LightingRecipe(recipeName, ledState: null, flcSwitch: 4, flcLevel: 4);
                case "flc-quadrant-4-level-4":
                    return new LightingRecipe(recipeName, ledState: null, flcSwitch: 8, flcLevel: 4);
                case "safe-final-all-quadrants-level-3":
                case "flc-all-level-3":
                default:
                    return new LightingRecipe(recipeName, ledState: null, flcSwitch: 15, flcLevel: 3);
            }
        }

        private static IEnumerable<LightingRecipe> BuildLightingSweepRecipes(long? configBits, string? pid)
        {
            if (IsLedSupported(configBits, pid))
            {
                yield return BuildLightingRecipe("all-leds-on-normal");
            }

            if (!IsFlcSupported(configBits, pid))
            {
                yield break;
            }

            yield return BuildLightingRecipe("flc-all-level-3");
            yield return BuildLightingRecipe("flc-quadrant-1-level-4");
            yield return BuildLightingRecipe("flc-quadrant-2-level-4");
        }

        private static object ApplyLightingRecipe(object control, int deviceIndex, LightingRecipe recipe, long? configBits, string? pid, List<object> optionalErrors)
        {
            var steps = new List<object>();
            try
            {
                if (recipe.ledState != null)
                {
                    if (!IsLedSupported(configBits, pid))
                    {
                        return new { status = "unavailable", recipe, code = "LED_UNSUPPORTED", steps = steps.ToArray() };
                    }

                    var result = InvokeRequired(control, "SetLEDState", deviceIndex, recipe.ledState.Value);
                    steps.Add(new { method = "SetLEDState", value = recipe.ledState.Value, result, status = "success" });
                }

                if (recipe.flcSwitch != null || recipe.flcLevel != null)
                {
                    if (!IsFlcSupported(configBits, pid))
                    {
                        return new { status = "unavailable", recipe, code = "FLC_UNSUPPORTED", steps = steps.ToArray() };
                    }

                    if (recipe.flcLevel != null)
                    {
                        var result = InvokeRequired(control, "SetFLCLevel", deviceIndex, recipe.flcLevel.Value);
                        steps.Add(new { method = "SetFLCLevel", value = recipe.flcLevel.Value, result, status = "success" });
                    }

                    if (recipe.flcSwitch != null)
                    {
                        var result = InvokeRequired(control, "SetFLCSwitch", deviceIndex, recipe.flcSwitch.Value);
                        steps.Add(new { method = "SetFLCSwitch", value = recipe.flcSwitch.Value, result, status = "success" });
                    }
                }

                Application.DoEvents();
                WaitWithEvents(LightingSettleDelayMs);
                return new { status = "success", recipe, steps = steps.ToArray() };
            }
            catch (Exception error)
            {
                optionalErrors.Add(new
                {
                    field = "lightingRecipe",
                    code = "LIGHTING_RECIPE_FAILED",
                    recipe = recipe.name,
                    message = FormatExceptionMessage(error)
                });
                return new { status = "error", recipe, steps = steps.ToArray(), error = new { code = "LIGHTING_RECIPE_FAILED", message = FormatExceptionMessage(error) } };
            }
        }

        private static bool IsSuccessfulApply(object apply)
        {
            var status = apply.GetType().GetProperty("status")?.GetValue(apply, null);
            return Convert.ToString(status) == "success";
        }

        private static object CaptureJpg(object control, string outputPath, string captureKind, string lightingRecipe, string sdkMethod)
        {
            var timestamp = DateTimeOffset.UtcNow;
            var saved = Convert.ToBoolean(InvokeRequired(control, "SaveFrameJPG", outputPath, 90, 1.0));
            if (!saved || !File.Exists(outputPath))
            {
                throw new InvalidOperationException("SaveFrameJPG did not produce " + outputPath + ".");
            }

            return CaptureRecord(outputPath, captureKind, lightingRecipe, "success", timestamp, null);
        }

        private static object TryOptionalSdkCapture(object control, int deviceIndex, string outputPath, string captureKind, string lightingRecipe, string sdkMethod, List<object> optionalErrors)
        {
            var timestamp = DateTimeOffset.UtcNow;
            object? result = null;
            try
            {
                if (sdkMethod == "SaveEDR")
                {
                    result = InvokeRequired(control, "SaveEDR", deviceIndex, outputPath);
                }
                else if (sdkMethod == "SaveEDOF")
                {
                    result = InvokeRequired(control, "SaveEDOF", deviceIndex, 3, outputPath);
                }
                else
                {
                    throw new InvalidOperationException("Unsupported optional SDK capture method: " + sdkMethod);
                }

                Application.DoEvents();
                var poll = PollForNonEmptyFile(outputPath, OptionalCapturePollTimeoutMs);
                if (!poll.available || !poll.exists || poll.byteSize <= 0)
                {
                    return UnavailableCapture(
                        Path.GetDirectoryName(outputPath) ?? "",
                        Path.GetFileName(outputPath),
                        captureKind,
                        lightingRecipe,
                        sdkMethod + "_NO_OUTPUT_TIMEOUT",
                        sdkMethod + " did not produce a non-empty output file before the polling timeout.",
                        new
                        {
                            method = sdkMethod,
                            result,
                            poll,
                            outputPath
                        });
                }

                return CaptureRecord(outputPath, captureKind, lightingRecipe, "success", timestamp, new { method = sdkMethod, result, poll });
            }
            catch (Exception error)
            {
                optionalErrors.Add(new
                {
                    field = sdkMethod,
                    code = sdkMethod + "_FAILED",
                    message = FormatExceptionMessage(error)
                });
                return UnavailableCapture(
                    Path.GetDirectoryName(outputPath) ?? "",
                    Path.GetFileName(outputPath),
                    captureKind,
                    lightingRecipe,
                    sdkMethod + "_FAILED",
                    FormatExceptionMessage(error),
                    new { method = sdkMethod, result, outputPath });
            }
        }

        private static object CaptureRecord(string outputPath, string captureKind, string lightingRecipe, string status, DateTimeOffset timestamp, object? error)
        {
            return new
            {
                path = outputPath,
                filename = Path.GetFileName(outputPath),
                sha256 = File.Exists(outputPath) ? ComputeSha256WithRetry(outputPath, OptionalCapturePollTimeoutMs) : null,
                byteSize = File.Exists(outputPath) ? GetFileSizeWithRetry(outputPath, OptionalCapturePollTimeoutMs) : 0,
                mimeType = "image/jpeg",
                timestamp = timestamp.ToString("o"),
                captureKind,
                lightingRecipe,
                status,
                diagnostics = error
            };
        }

        private static object UnavailableCapture(string packageDir, string fileName, string captureKind, string lightingRecipe, string code, string message, object? diagnostics)
        {
            return new
            {
                path = Path.Combine(packageDir, fileName),
                filename = fileName,
                sha256 = (string?)null,
                byteSize = 0,
                mimeType = "image/jpeg",
                timestamp = DateTimeOffset.UtcNow.ToString("o"),
                captureKind,
                lightingRecipe,
                status = "unavailable",
                error = new { code, message },
                diagnostics
            };
        }

        private static FilePollResult PollForNonEmptyFile(string path, int timeoutMs)
        {
            var stopwatch = Stopwatch.StartNew();
            var checks = 0;
            string? lastError = null;
            while (stopwatch.ElapsedMilliseconds <= timeoutMs)
            {
                checks += 1;
                Application.DoEvents();
                try
                {
                    if (File.Exists(path))
                    {
                        var byteSize = new FileInfo(path).Length;
                        if (byteSize > 0)
                        {
                            return new FilePollResult(true, true, byteSize, checks, stopwatch.ElapsedMilliseconds, null);
                        }
                    }
                }
                catch (IOException error)
                {
                    lastError = error.Message;
                }
                catch (UnauthorizedAccessException error)
                {
                    lastError = error.Message;
                }
                Thread.Sleep(OptionalCapturePollIntervalMs);
            }

            try
            {
                var exists = File.Exists(path);
                var byteSize = exists ? new FileInfo(path).Length : 0;
                return new FilePollResult(true, exists, byteSize, checks, stopwatch.ElapsedMilliseconds, lastError);
            }
            catch (Exception error)
            {
                return new FilePollResult(false, true, 0, checks, stopwatch.ElapsedMilliseconds, error.Message);
            }
        }

        private static void WaitWithEvents(int milliseconds)
        {
            var stopwatch = Stopwatch.StartNew();
            while (stopwatch.ElapsedMilliseconds < milliseconds)
            {
                Application.DoEvents();
                Thread.Sleep(50);
            }
        }

        private static string? GetDeviceIdFromDeviceObject(object device)
        {
            return Convert.ToString(device.GetType().GetProperty("deviceId")?.GetValue(device, null));
        }

        private static string? ExtractUsbPid(string? deviceId)
        {
            if (string.IsNullOrWhiteSpace(deviceId)) return null;
            var lower = deviceId!.ToLowerInvariant();
            var marker = "pid_";
            var index = lower.IndexOf(marker, StringComparison.Ordinal);
            if (index < 0 || index + marker.Length + 4 > lower.Length) return null;
            return lower.Substring(index + marker.Length, 4);
        }

        private static bool IsKnownFlcPid(string? pid)
        {
            if (string.IsNullOrWhiteSpace(pid)) return false;
            return string.Compare(pid, "0960", StringComparison.OrdinalIgnoreCase) >= 0 &&
                string.Compare(pid, "099f", StringComparison.OrdinalIgnoreCase) <= 0;
        }

        private static bool IsKnownLedPid(string? pid)
        {
            if (string.IsNullOrWhiteSpace(pid)) return false;
            return string.Compare(pid, "0970", StringComparison.OrdinalIgnoreCase) >= 0 &&
                string.Compare(pid, "099f", StringComparison.OrdinalIgnoreCase) <= 0;
        }

        private static void WriteManifestAndReport(string manifestPath, string previewReportPath, object manifest, List<object> captures)
        {
            var serializer = new JavaScriptSerializer();
            File.WriteAllText(manifestPath, serializer.Serialize(manifest));

            using (var writer = new StreamWriter(previewReportPath))
            {
                writer.WriteLine("<!doctype html><html><head><meta charset=\"utf-8\"><title>Dino-Lite capture package preview</title>");
                writer.WriteLine("<style>body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#1f2937}h1{font-size:24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}.item{border:1px solid #d1d5db;padding:12px;border-radius:6px}img{max-width:100%;height:auto;border:1px solid #e5e7eb}.meta{font-size:12px;color:#4b5563;word-break:break-all}</style></head><body>");
                writer.WriteLine("<h1>Dino-Lite capture package preview -- not a certified grade.</h1>");
                writer.WriteLine("<p>This local preview is for hardware/demo inspection only. It is not a certified AI grade.</p>");
                writer.WriteLine("<div class=\"grid\">");
                foreach (var capture in captures)
                {
                    var type = capture.GetType();
                    var filename = Convert.ToString(type.GetProperty("filename")?.GetValue(capture, null)) ?? "";
                    var status = Convert.ToString(type.GetProperty("status")?.GetValue(capture, null)) ?? "";
                    var kind = Convert.ToString(type.GetProperty("captureKind")?.GetValue(capture, null)) ?? "";
                    var recipe = Convert.ToString(type.GetProperty("lightingRecipe")?.GetValue(capture, null)) ?? "";
                    var sha = Convert.ToString(type.GetProperty("sha256")?.GetValue(capture, null)) ?? "";
                    var byteSize = Convert.ToString(type.GetProperty("byteSize")?.GetValue(capture, null)) ?? "";
                    writer.WriteLine("<section class=\"item\">");
                    writer.WriteLine("<h2>" + Html(filename) + "</h2>");
                    if (status == "success")
                    {
                        writer.WriteLine("<img src=\"" + Html(filename) + "\" alt=\"" + Html(filename) + "\">");
                    }
                    writer.WriteLine("<p class=\"meta\">kind: " + Html(kind) + "<br>status: " + Html(status) + "<br>recipe: " + Html(recipe) + "<br>sha256: " + Html(sha.Length > 16 ? sha.Substring(0, 16) + "..." : sha) + "<br>bytes: " + Html(byteSize) + "</p>");
                    writer.WriteLine("</section>");
                }
                writer.WriteLine("</div></body></html>");
            }
        }

        public static object[] BuildOperatorPlanForTests(string? plan)
        {
            return BuildOperatorPlan(plan, "sharp_90", true).ToArray();
        }

        private static string NormalizeCornerProfile(string? cornerProfile)
        {
            var normalized = string.IsNullOrWhiteSpace(cornerProfile) ? "sharp_90" : cornerProfile!.Trim().ToLowerInvariant();
            return normalized == "sharp_90" ? normalized : "sharp_90";
        }

        private static List<OperatorTarget> BuildOperatorPlan(string? plan, string cornerProfile, bool captureGuides)
        {
            var normalizedPlan = string.IsNullOrWhiteSpace(plan) ? "corners-basic" : plan!.Trim();
            var targets = new List<OperatorTarget>();
            if (normalizedPlan == "operator-smoke-single")
            {
                targets.Add(BuildOperatorTarget("center-surface", "Center surface", "surface", "center_surface", "Place the target detail under the microscope, adjust focus manually, then click Capture.", cornerProfile, captureGuides));
                return targets;
            }

            if (normalizedPlan == "card-interim" || normalizedPlan == "experimental-card-grading")
            {
                targets.Add(BuildOperatorTarget(
                    "full-card-overview",
                    "Full-card overview",
                    "interim_macro_overview",
                    "interim_full_card_overview",
                    "Raise/zoom out/refocus the Dino-Lite so as much of the full card as possible is visible. This is an interim overview until the dedicated macro camera is integrated.",
                    cornerProfile,
                    captureGuides));
            }

            if (normalizedPlan == "corners-basic" || normalizedPlan == "card-basic" || normalizedPlan == "card-interim" || normalizedPlan == "experimental-card-grading")
            {
                targets.Add(BuildOperatorTarget("top-left-corner", "Top-left corner", "corner", "top_left_corner", "Move the card so the top-left corner is centered under the microscope. Adjust focus manually, then confirm capture.", cornerProfile, captureGuides));
                targets.Add(BuildOperatorTarget("top-right-corner", "Top-right corner", "corner", "top_right_corner", "Move the card so the top-right corner is centered under the microscope. Adjust focus manually, then confirm capture.", cornerProfile, captureGuides));
                targets.Add(BuildOperatorTarget("bottom-right-corner", "Bottom-right corner", "corner", "bottom_right_corner", "Move the card so the bottom-right corner is centered under the microscope. Adjust focus manually, then confirm capture.", cornerProfile, captureGuides));
                targets.Add(BuildOperatorTarget("bottom-left-corner", "Bottom-left corner", "corner", "bottom_left_corner", "Move the card so the bottom-left corner is centered under the microscope. Adjust focus manually, then confirm capture.", cornerProfile, captureGuides));
            }

            if (normalizedPlan == "experimental-card-grading")
            {
                targets.Add(BuildOperatorTarget("top-edge", "Top edge", "edge", "top_edge", "Move the card so the top edge midpoint is centered under the microscope. Adjust focus manually, then confirm capture.", cornerProfile, captureGuides));
                targets.Add(BuildOperatorTarget("right-edge", "Right edge", "edge", "right_edge", "Move the card so the right edge midpoint is centered under the microscope. Adjust focus manually, then confirm capture.", cornerProfile, captureGuides));
                targets.Add(BuildOperatorTarget("bottom-edge", "Bottom edge", "edge", "bottom_edge", "Move the card so the bottom edge midpoint is centered under the microscope. Adjust focus manually, then confirm capture.", cornerProfile, captureGuides));
                targets.Add(BuildOperatorTarget("left-edge", "Left edge", "edge", "left_edge", "Move the card so the left edge midpoint is centered under the microscope. Adjust focus manually, then confirm capture.", cornerProfile, captureGuides));
                targets.Add(BuildOperatorTarget("center-surface", "Center surface", "surface", "center_surface", "Move the card so the center surface is centered under the microscope. Adjust focus manually, then confirm capture.", cornerProfile, captureGuides));
                targets.Add(BuildOperatorTarget("upper-surface", "Upper surface", "surface", "upper_surface", "Move the card so the upper surface is centered under the microscope. Adjust focus manually, then confirm capture.", cornerProfile, captureGuides));
                targets.Add(BuildOperatorTarget("lower-surface", "Lower surface", "surface", "lower_surface", "Move the card so the lower surface is centered under the microscope. Adjust focus manually, then confirm capture.", cornerProfile, captureGuides));
                return targets;
            }

            if (normalizedPlan == "surface-basic")
            {
                targets.Add(BuildOperatorTarget("center-surface", "Center surface", "surface", "center_surface", "Move the card so the center surface is centered under the microscope. Adjust focus manually, then confirm capture.", cornerProfile, captureGuides));
                targets.Add(BuildOperatorTarget("upper-surface", "Upper surface", "surface", "upper_surface", "Move the card so the upper surface is centered under the microscope. Adjust focus manually, then confirm capture.", cornerProfile, captureGuides));
                targets.Add(BuildOperatorTarget("lower-surface", "Lower surface", "surface", "lower_surface", "Move the card so the lower surface is centered under the microscope. Adjust focus manually, then confirm capture.", cornerProfile, captureGuides));
            }
            else if (normalizedPlan == "card-basic" || normalizedPlan == "card-interim")
            {
                targets.Add(BuildOperatorTarget("center-surface", "Center surface", "surface", "center_surface", "Move the card so the center surface is centered under the microscope. Adjust focus manually, then confirm capture.", cornerProfile, captureGuides));
            }

            return targets;
        }

        private static OperatorTarget BuildOperatorTarget(string id, string name, string type, string reportLabel, string instruction, string cornerProfile, bool captureGuides)
        {
            var guide = captureGuides ? BuildCaptureGuide(id, type, cornerProfile) : "";
            var guideVisualKind = BuildGuideVisualKind(type);
            var guideVisualOrientation = BuildGuideVisualOrientation(id, type);
            var guideVisualLegend = captureGuides ? BuildGuideVisualLegend(id, type, cornerProfile) : "";
            return new OperatorTarget(id, name, type, reportLabel, instruction, guide, captureGuides, guideVisualKind, guideVisualOrientation, guideVisualLegend, type == "corner" ? cornerProfile : null);
        }

        private static string BuildCaptureGuide(string id, string type, string cornerProfile)
        {
            if (type == "interim_macro_overview")
            {
                return "Guide: fit as much of the card as possible inside the preview, keep all card edges visible, avoid excess background. This overview is interim and not calibrated macro capture.";
            }
            if (type == "corner")
            {
                return "Guide: place the corner tip at the center guide, include both edges, fill the frame mostly with card, avoid background. Corner profile: " + cornerProfile + ".";
            }
            if (type == "edge")
            {
                var direction = (id.Contains("top") || id.Contains("bottom")) ? "horizontal" : "vertical";
                return "Guide: align this " + direction + " edge along the center guide line, fill the frame with the card edge, include minimal background.";
            }
            if (type == "surface")
            {
                return "Guide: fill the central patch with card surface only, avoid border/background, and focus on the print surface.";
            }
            return "Guide: center the target under the microscope, fill the frame with the card, and avoid background.";
        }

        private static string BuildGuideVisualKind(string type)
        {
            if (type == "interim_macro_overview") return "full-card";
            if (type == "corner") return "corner";
            if (type == "edge") return "edge";
            if (type == "surface") return "surface";
            return "center";
        }

        private static string BuildGuideVisualOrientation(string id, string type)
        {
            if (type == "corner")
            {
                if (id.Contains("top-left")) return "top-left";
                if (id.Contains("top-right")) return "top-right";
                if (id.Contains("bottom-right")) return "bottom-right";
                if (id.Contains("bottom-left")) return "bottom-left";
                return "center";
            }
            if (type == "edge")
            {
                return id.Contains("top") || id.Contains("bottom") ? "horizontal" : "vertical";
            }
            return "center";
        }

        private static string BuildGuideVisualLegend(string id, string type, string cornerProfile)
        {
            if (type == "interim_macro_overview")
            {
                return "Fit as much of the card as possible inside the yellow rectangle; keep card edges visible.";
            }
            if (type == "corner")
            {
                return "Place the " + BuildGuideVisualOrientation(id, type) + " corner tip in the yellow box; align both card edges to the L guide. Profile: " + cornerProfile + ".";
            }
            if (type == "edge")
            {
                return BuildGuideVisualOrientation(id, type) == "horizontal"
                    ? "Align the card edge along the yellow horizontal guide line."
                    : "Align the card edge along the yellow vertical guide line.";
            }
            if (type == "surface")
            {
                return "Fill the yellow central patch with card surface only; avoid border and background.";
            }
            return "Center the requested target inside the yellow guide.";
        }

        private static object[] CaptureOperatorTargetArtifacts(
            object control,
            int deviceIndex,
            string sessionDir,
            OperatorTarget target,
            int targetIndex,
            int attempt,
            long? configBits,
            string? pid,
            object runtimeDependencies,
            bool includeFlcSweep,
            bool includeEdr,
            bool includeEdof,
            List<object> optionalErrors)
        {
            var artifacts = new List<object>();
            var stem = targetIndex.ToString("00") + "-" + target.id + "-attempt-" + attempt.ToString("00");
            artifacts.Add(CaptureJpg(control, Path.Combine(sessionDir, stem + "-normal.jpg"), "normal", target.id + "-normal", "SaveFrameJPG"));

            if (includeFlcSweep)
            {
                var recipes = new List<LightingRecipe>(BuildLightingSweepRecipes(configBits, pid));
                if (recipes.Count == 0)
                {
                    artifacts.Add(UnavailableCapture(sessionDir, stem + "-lighting-sweep-unavailable.jpg", "lightingSweep", target.id + "-lighting-sweep", "LIGHTING_SWEEP_UNSUPPORTED", "GetConfig did not report LED or FLC support.", null));
                }

                foreach (var recipe in recipes)
                {
                    var apply = ApplyLightingRecipe(control, deviceIndex, recipe, configBits, pid, optionalErrors);
                    if (!IsSuccessfulApply(apply))
                    {
                        artifacts.Add(UnavailableCapture(sessionDir, stem + "-" + recipe.name + ".jpg", "lightingSweep", recipe.name, "FLC_UNAVAILABLE", "Lighting recipe could not be applied.", apply));
                        continue;
                    }
                    artifacts.Add(CaptureJpg(control, Path.Combine(sessionDir, stem + "-" + recipe.name + ".jpg"), "lightingSweep", recipe.name, "SaveFrameJPG"));
                }
            }

            if (includeEdr)
            {
                artifacts.Add(TryOptionalSdkCapture(control, deviceIndex, Path.Combine(sessionDir, stem + "-edr.jpg"), "edr", target.id + "-edr", "SaveEDR", optionalErrors));
            }

            if (includeEdof)
            {
                if (!IsEdofSupported(configBits, pid))
                {
                    artifacts.Add(UnavailableCapture(sessionDir, stem + "-edof.jpg", "edof", target.id + "-edof", "EDOF_UNSUPPORTED", "GetConfig did not report EDOF support.", null));
                }
                else if (!IsEdofRuntimeReady(runtimeDependencies))
                {
                    artifacts.Add(UnavailableCapture(sessionDir, stem + "-edof.jpg", "edof", target.id + "-edof", "EDOF_RUNTIME_DEPENDENCIES_MISSING", "EDOF is reported by GetConfig, but required DNVideoX helper runtime files are not available from the configured SDK runtime directory.", runtimeDependencies));
                }
                else
                {
                    artifacts.Add(TryOptionalSdkCapture(control, deviceIndex, Path.Combine(sessionDir, stem + "-edof.jpg"), "edof", target.id + "-edof", "SaveEDOF", optionalErrors));
                }
            }

            return artifacts.ToArray();
        }

        private static object BuildOperatorTargetRecord(OperatorTarget target, int targetIndex, OperatorAction action, int attempt, string status, object[] artifacts)
        {
            return new
            {
                target = new
                {
                    target.id,
                    target.name,
                    target.type,
                    target.reportLabel,
                    target.instruction,
                    target.captureGuide,
                    target.captureGuidesEnabled,
                    target.guideVisualKind,
                    target.guideVisualOrientation,
                    target.guideVisualLegend,
                    target.cornerProfile
                },
                targetIndex,
                action = action.ToString().ToLowerInvariant(),
                attempt,
                status,
                artifacts
            };
        }

        private static string[] OperatorLimitations()
        {
            return new[]
            {
                "Dino-Lite operator workflow preview -- not a certified grade.",
                "Interim full-card overview is not production macro evidence.",
                "Interim full-card overview is not calibrated macro capture.",
                "Session output is not certified grading evidence.",
                "Manual fallback mode until GRBL stage motion is integrated."
            };
        }

        private static void WriteOperatorManifestAndReport(string manifestPath, string previewReportPath, object manifest, List<object> targetRecords)
        {
            var serializer = new JavaScriptSerializer();
            File.WriteAllText(manifestPath, serializer.Serialize(manifest));

            using (var writer = new StreamWriter(previewReportPath))
            {
                writer.WriteLine("<!doctype html><html><head><meta charset=\"utf-8\"><title>Dino-Lite operator workflow preview</title>");
                writer.WriteLine("<style>body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#1f2937}h1{font-size:24px}h2{font-size:18px;margin-top:28px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}.item{border:1px solid #d1d5db;padding:12px;border-radius:6px}img{max-width:100%;height:auto;border:1px solid #e5e7eb}.meta{font-size:12px;color:#4b5563;word-break:break-all}.warning{font-weight:600;color:#7c2d12}</style></head><body>");
                writer.WriteLine("<h1>Dino-Lite operator workflow preview -- not a certified grade.</h1>");
                writer.WriteLine("<p class=\"warning\">This manual fallback session is not production macro evidence, not calibrated macro capture, and not certified grading evidence.</p>");
                foreach (var targetRecord in targetRecords)
                {
                    var recordType = targetRecord.GetType();
                    var target = recordType.GetProperty("target")?.GetValue(targetRecord, null);
                    var targetType = target?.GetType();
                    var targetName = Convert.ToString(targetType?.GetProperty("name")?.GetValue(target, null)) ?? "";
                    var targetKind = Convert.ToString(targetType?.GetProperty("type")?.GetValue(target, null)) ?? "";
                    var reportLabel = Convert.ToString(targetType?.GetProperty("reportLabel")?.GetValue(target, null)) ?? "";
                    var action = Convert.ToString(recordType.GetProperty("action")?.GetValue(targetRecord, null)) ?? "";
                    var status = Convert.ToString(recordType.GetProperty("status")?.GetValue(targetRecord, null)) ?? "";
                    writer.WriteLine("<section>");
                    writer.WriteLine("<h2>" + Html(targetName) + "</h2>");
                    writer.WriteLine("<p class=\"meta\">target type: " + Html(targetKind) + "<br>report label: " + Html(reportLabel) + "<br>action: " + Html(action) + "<br>status: " + Html(status) + "</p>");
                    writer.WriteLine("<div class=\"grid\">");
                    var artifacts = recordType.GetProperty("artifacts")?.GetValue(targetRecord, null) as object[] ?? new object[0];
                    foreach (var artifact in artifacts)
                    {
                        var artifactType = artifact.GetType();
                        var filename = Convert.ToString(artifactType.GetProperty("filename")?.GetValue(artifact, null)) ?? "";
                        var artifactStatus = Convert.ToString(artifactType.GetProperty("status")?.GetValue(artifact, null)) ?? "";
                        var kind = Convert.ToString(artifactType.GetProperty("captureKind")?.GetValue(artifact, null)) ?? "";
                        var recipe = Convert.ToString(artifactType.GetProperty("lightingRecipe")?.GetValue(artifact, null)) ?? "";
                        var sha = Convert.ToString(artifactType.GetProperty("sha256")?.GetValue(artifact, null)) ?? "";
                        var byteSize = Convert.ToString(artifactType.GetProperty("byteSize")?.GetValue(artifact, null)) ?? "";
                        writer.WriteLine("<article class=\"item\">");
                        writer.WriteLine("<h3>" + Html(filename) + "</h3>");
                        if (artifactStatus == "success")
                        {
                            writer.WriteLine("<img src=\"" + Html(filename) + "\" alt=\"" + Html(filename) + "\">");
                        }
                        writer.WriteLine("<p class=\"meta\">kind: " + Html(kind) + "<br>status: " + Html(artifactStatus) + "<br>recipe: " + Html(recipe) + "<br>sha256: " + Html(sha.Length > 16 ? sha.Substring(0, 16) + "..." : sha) + "<br>bytes: " + Html(byteSize) + "</p>");
                        writer.WriteLine("</article>");
                    }
                    writer.WriteLine("</div></section>");
                }
                writer.WriteLine("</body></html>");
            }
        }

        private static string SanitizeFilePart(string value)
        {
            var sanitized = "";
            foreach (var ch in value)
            {
                sanitized += char.IsLetterOrDigit(ch) || ch == '-' || ch == '_' ? ch : '-';
            }
            return sanitized.Trim('-').Length == 0 ? "capture-package" : sanitized.Trim('-');
        }

        private static string Html(string value)
        {
            return SecurityElement.Escape(value) ?? "";
        }

        private static object ReadVideoCaps(object control, List<object> optionalErrors)
        {
            return new
            {
                value = Convert.ToString(InvokeOptional(control, "GetVideoCaps", optionalErrors))
            };
        }

        private static object ReadVideoFormat(object control, List<object> optionalErrors)
        {
            try
            {
                var args = new object[] { 0, 0 };
                var result = InvokeRequired(control, "GetVideoFormat", args);
                return new
                {
                    width = Convert.ToInt32(args[0]),
                    height = Convert.ToInt32(args[1]),
                    result
                };
            }
            catch (Exception error)
            {
                optionalErrors.Add(new
                {
                    field = "GetVideoFormat",
                    code = "OPTIONAL_FIELD_UNAVAILABLE",
                    message = FormatExceptionMessage(error)
                });
                return new { unavailable = true };
            }
        }

        private static object ReadLongPair(object control, string methodName, int deviceIndex, List<object> optionalErrors)
        {
            try
            {
                var args = new object[] { deviceIndex, 0, 0 };
                InvokeRequired(control, methodName, args);
                return new
                {
                    upper = Convert.ToInt32(args[1]),
                    lower = Convert.ToInt32(args[2])
                };
            }
            catch (Exception error)
            {
                optionalErrors.Add(new
                {
                    field = methodName,
                    code = "OPTIONAL_FIELD_UNAVAILABLE",
                    message = FormatExceptionMessage(error)
                });
                return new { unavailable = true };
            }
        }

        private static object RealCommandError(string code, Exception error, bool comActiveXInstantiated, CleanupState cleanup)
        {
            return new
            {
                adapter = "dnvideox",
                status = "SDK_NOT_READY",
                comActiveXInstantiated,
                connectedDuringCommand = comActiveXInstantiated,
                previewDuringCommand = false,
                cleanup,
                error = new
                {
                    code,
                    message = FormatExceptionMessage(error)
                },
                forbiddenOperationsInvoked = false
            };
        }

        private static void CleanupControl(object? control, CleanupState cleanup, bool stopPreview)
        {
            if (control == null) return;

            if (stopPreview)
            {
                try
                {
                    SetProperty(control, "Preview", false);
                    cleanup.previewStopped = true;
                }
                catch (Exception error)
                {
                    cleanup.cleanupErrors.Add(new { field = "Preview", message = FormatExceptionMessage(error) });
                }
            }

            try
            {
                SetProperty(control, "Connected", false);
                cleanup.disconnected = true;
            }
            catch (Exception error)
            {
                cleanup.cleanupErrors.Add(new { field = "Connected", message = FormatExceptionMessage(error) });
            }
        }

        private static string ComputeSha256(string path)
        {
            using (var stream = File.OpenRead(path))
            using (var sha256 = SHA256.Create())
            {
                return BitConverter.ToString(sha256.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            }
        }

        private static string ComputeSha256WithRetry(string path, int timeoutMs)
        {
            var stopwatch = Stopwatch.StartNew();
            Exception? lastError = null;
            while (stopwatch.ElapsedMilliseconds <= timeoutMs)
            {
                try
                {
                    return ComputeSha256(path);
                }
                catch (IOException error)
                {
                    lastError = error;
                }
                catch (UnauthorizedAccessException error)
                {
                    lastError = error;
                }

                WaitWithEvents(OptionalCapturePollIntervalMs);
            }

            throw new IOException("Timed out waiting to read file for SHA-256: " + path, lastError);
        }

        private static long GetFileSizeWithRetry(string path, int timeoutMs)
        {
            var stopwatch = Stopwatch.StartNew();
            Exception? lastError = null;
            while (stopwatch.ElapsedMilliseconds <= timeoutMs)
            {
                try
                {
                    return new FileInfo(path).Length;
                }
                catch (IOException error)
                {
                    lastError = error;
                }
                catch (UnauthorizedAccessException error)
                {
                    lastError = error;
                }

                WaitWithEvents(OptionalCapturePollIntervalMs);
            }

            throw new IOException("Timed out waiting to read file size: " + path, lastError);
        }

        public static object InspectRuntimeDependenciesForTests(string? runtimeDir, string? repoRoot)
        {
            return InspectRuntimeDependencies(runtimeDir, repoRoot);
        }

        private static object InspectRuntimeDependencies(string? runtimeDir, string? repoRoot = null)
        {
            var baseDir = AppDomain.CurrentDomain.BaseDirectory;
            var currentDir = Environment.CurrentDirectory;
            var configuredRuntimeDir = string.IsNullOrWhiteSpace(runtimeDir) ? null : Path.GetFullPath(runtimeDir!);
            var detectedRepoRoot = string.IsNullOrWhiteSpace(repoRoot) ? FindRepoRoot(currentDir) : Path.GetFullPath(repoRoot!);
            var runtimeDirExists = configuredRuntimeDir != null && Directory.Exists(configuredRuntimeDir);
            var runtimeDirInsideRepo = configuredRuntimeDir != null && detectedRepoRoot != null && IsPathInside(configuredRuntimeDir, detectedRepoRoot);
            var runtimeDirUsable = runtimeDirExists && !runtimeDirInsideRepo;
            var requiredFiles = BuildDependencyPresence(RequiredEdofRuntimeFiles, configuredRuntimeDir, baseDir, currentDir);
            var optionalFiles = BuildDependencyPresence(OptionalRuntimeFiles, configuredRuntimeDir, baseDir, currentDir);
            var edofHelperAvailable = runtimeDirUsable && AllPresentInRuntimeDir(requiredFiles);

            return new
            {
                adapter = "dnvideox",
                baseDirectory = baseDir,
                currentDirectory = currentDir,
                configuredRuntimeDir,
                runtimeDirConfigured = configuredRuntimeDir != null,
                runtimeDirExists,
                runtimeDirInsideRepo,
                runtimeDirUsable,
                repoRoot = detectedRepoRoot,
                requiredFiles,
                optionalFiles,
                edofHelperAvailable,
                pathMutation = runtimeDirUsable
                    ? "During manual capture package and operator workflow commands only, bridge temporarily sets current directory and Win32 DLL search directory to configuredRuntimeDir, then restores both in finally."
                    : "none"
            };
        }

        private static object[] BuildDependencyPresence(IEnumerable<string> fileNames, string? runtimeDir, string baseDir, string currentDir)
        {
            var results = new List<object>();
            foreach (var fileName in fileNames)
            {
                results.Add(DependencyPresence(fileName, runtimeDir, baseDir, currentDir));
            }

            return results.ToArray();
        }

        private static object DependencyPresence(string fileName, string? runtimeDir, string baseDir, string currentDir)
        {
            var runtimePath = runtimeDir == null ? null : Path.Combine(runtimeDir, fileName);
            var basePath = Path.Combine(baseDir, fileName);
            var currentPath = Path.Combine(currentDir, fileName);
            return new
            {
                fileName,
                runtimeDirectoryPresent = runtimePath != null && File.Exists(runtimePath),
                baseDirectoryPresent = File.Exists(basePath),
                currentDirectoryPresent = File.Exists(currentPath)
            };
        }

        private static bool AllPresentInRuntimeDir(object[] dependencies)
        {
            foreach (var dependency in dependencies)
            {
                var present = dependency.GetType().GetProperty("runtimeDirectoryPresent")?.GetValue(dependency, null);
                if (Convert.ToBoolean(present) != true)
                {
                    return false;
                }
            }

            return true;
        }

        private static bool IsEdofRuntimeReady(object diagnostics)
        {
            var value = diagnostics.GetType().GetProperty("edofHelperAvailable")?.GetValue(diagnostics, null);
            return Convert.ToBoolean(value);
        }

        private static string? FindRepoRoot(string startDirectory)
        {
            var directory = new DirectoryInfo(Path.GetFullPath(startDirectory));
            while (directory != null)
            {
                if (Directory.Exists(Path.Combine(directory.FullName, ".git")))
                {
                    return directory.FullName;
                }

                directory = directory.Parent;
            }

            return null;
        }

        private static bool IsPathInside(string candidate, string root)
        {
            var normalizedCandidate = Path.GetFullPath(candidate).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var normalizedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            return normalizedCandidate.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase);
        }

        private static string? GetOcxVersion()
        {
            try
            {
                return FileVersionInfo.GetVersionInfo(ActiveXPath).FileVersion;
            }
            catch
            {
                return null;
            }
        }

        private static string FormatExceptionMessage(Exception error)
        {
            if (error is TargetInvocationException && error.InnerException != null)
            {
                return error.Message + " Inner: " + error.InnerException.Message;
            }

            return error.Message;
        }

        private sealed class HiddenDnVideoXHost : IDisposable
        {
            private readonly Form form;
            private readonly DnVideoXAxHost axHost;

            private HiddenDnVideoXHost(Form form, DnVideoXAxHost axHost)
            {
                this.form = form;
                this.axHost = axHost;
            }

            public object ControlInstance => axHost.ControlInstance;

            public static HiddenDnVideoXHost Create()
            {
                var form = new Form
                {
                    ShowInTaskbar = false,
                    StartPosition = FormStartPosition.Manual,
                    FormBorderStyle = FormBorderStyle.FixedToolWindow,
                    Location = new Point(-32000, -32000),
                    Opacity = 0,
                    Width = 1,
                    Height = 1
                };
                var axHost = new DnVideoXAxHost
                {
                    Width = 1,
                    Height = 1
                };

                form.Controls.Add(axHost);
                form.CreateControl();
                axHost.CreateControl();
                form.Show();
                Application.DoEvents();

                return new HiddenDnVideoXHost(form, axHost);
            }

            public void Dispose()
            {
                axHost.Dispose();
                form.Dispose();
            }
        }

        private sealed class OperatorDnVideoXHost : IDisposable
        {
            private readonly Form form;
            private readonly DnVideoXAxHost axHost;
            private readonly PreviewGuideOverlayForm previewOverlay;
            private readonly Label titleLabel;
            private readonly Label typeLabel;
            private readonly GuideDiagramControl guideDiagram;
            private readonly Label guideLabel;
            private readonly Label instructionLabel;
            private readonly Label progressLabel;
            private readonly Label overviewNoticeLabel;
            private readonly Label fallbackLabel;
            private OperatorAction? requestedAction;

            private OperatorDnVideoXHost(
                Form form,
                DnVideoXAxHost axHost,
                PreviewGuideOverlayForm previewOverlay,
                Label titleLabel,
                Label typeLabel,
                GuideDiagramControl guideDiagram,
                Label guideLabel,
                Label instructionLabel,
                Label progressLabel,
                Label overviewNoticeLabel,
                Label fallbackLabel)
            {
                this.form = form;
                this.axHost = axHost;
                this.previewOverlay = previewOverlay;
                this.titleLabel = titleLabel;
                this.typeLabel = typeLabel;
                this.guideDiagram = guideDiagram;
                this.guideLabel = guideLabel;
                this.instructionLabel = instructionLabel;
                this.progressLabel = progressLabel;
                this.overviewNoticeLabel = overviewNoticeLabel;
                this.fallbackLabel = fallbackLabel;
            }

            public object ControlInstance => axHost.ControlInstance;

            public static OperatorDnVideoXHost Create()
            {
                var form = new Form
                {
                    Text = "Ten Kings Dino-Lite Operator Workflow",
                    ShowInTaskbar = true,
                    StartPosition = FormStartPosition.CenterScreen,
                    WindowState = FormWindowState.Normal,
                    TopMost = true,
                    Width = 1180,
                    Height = 820,
                    MinimumSize = new Size(900, 650)
                };

                var split = new SplitContainer
                {
                    Dock = DockStyle.Fill,
                    Orientation = Orientation.Vertical,
                    SplitterDistance = 760
                };
                var axHost = new DnVideoXAxHost { Dock = DockStyle.Fill };
                split.Panel1.Controls.Add(axHost);

                var panel = new TableLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    ColumnCount = 1,
                    RowCount = 9,
                    Padding = new Padding(16)
                };
                panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 56));
                panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
                panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 180));
                panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 110));
                panel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
                panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 92));
                panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
                panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
                panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 80));

                var titleLabel = BuildOperatorLabel(16, true);
                var typeLabel = BuildOperatorLabel(10, false);
                var guideDiagram = new GuideDiagramControl { Dock = DockStyle.Fill };
                var guideLabel = BuildOperatorLabel(11, true);
                var instructionLabel = BuildOperatorLabel(12, false);
                var overviewNoticeLabel = BuildOperatorLabel(10, true);
                var progressLabel = BuildOperatorLabel(11, false);
                var fallbackLabel = BuildOperatorLabel(9, false);
                fallbackLabel.Text = "Manual fallback mode until GRBL stage motion is integrated. Adjust focus manually, then confirm capture.";

                var buttons = new FlowLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    FlowDirection = FlowDirection.LeftToRight,
                    WrapContents = true
                };
                buttons.Controls.Add(BuildOperatorButton("Capture / continue", () => { }));
                buttons.Controls.Add(BuildOperatorButton("Skip target", () => { }));
                buttons.Controls.Add(BuildOperatorButton("Retake current target", () => { }));
                buttons.Controls.Add(BuildOperatorButton("Abort session safely", () => { }));

                var captureButton = (Button)buttons.Controls[0];
                var skipButton = (Button)buttons.Controls[1];
                var retakeButton = (Button)buttons.Controls[2];
                var abortButton = (Button)buttons.Controls[3];

                var previewOverlay = new PreviewGuideOverlayForm();
                var host = new OperatorDnVideoXHost(form, axHost, previewOverlay, titleLabel, typeLabel, guideDiagram, guideLabel, instructionLabel, progressLabel, overviewNoticeLabel, fallbackLabel);
                captureButton.Click += (_, __) => host.requestedAction = OperatorAction.Capture;
                skipButton.Click += (_, __) => host.requestedAction = OperatorAction.Skip;
                retakeButton.Click += (_, __) => host.requestedAction = OperatorAction.Retake;
                abortButton.Click += (_, __) => host.requestedAction = OperatorAction.Abort;
                form.FormClosing += (_, __) => host.requestedAction = OperatorAction.Abort;
                form.Move += (_, __) => host.UpdatePreviewOverlayBounds();
                form.Resize += (_, __) => host.UpdatePreviewOverlayBounds();
                split.SplitterMoved += (_, __) => host.UpdatePreviewOverlayBounds();
                axHost.Resize += (_, __) => host.UpdatePreviewOverlayBounds();

                panel.Controls.Add(titleLabel, 0, 0);
                panel.Controls.Add(typeLabel, 0, 1);
                panel.Controls.Add(guideDiagram, 0, 2);
                panel.Controls.Add(guideLabel, 0, 3);
                panel.Controls.Add(instructionLabel, 0, 4);
                panel.Controls.Add(overviewNoticeLabel, 0, 5);
                panel.Controls.Add(progressLabel, 0, 6);
                panel.Controls.Add(fallbackLabel, 0, 7);
                panel.Controls.Add(buttons, 0, 8);
                split.Panel2.Controls.Add(panel);
                form.Controls.Add(split);

                form.CreateControl();
                axHost.CreateControl();
                form.Show();
                previewOverlay.Show(form);
                host.UpdatePreviewOverlayBounds();
                form.BringToFront();
                form.Activate();
                var topMostTimer = new System.Windows.Forms.Timer { Interval = 1500 };
                topMostTimer.Tick += (_, __) =>
                {
                    topMostTimer.Stop();
                    topMostTimer.Dispose();
                    if (!form.IsDisposed)
                    {
                        form.TopMost = false;
                    }
                };
                topMostTimer.Start();
                Application.DoEvents();
                return host;
            }

            public OperatorAction WaitForAction(OperatorTarget target, int targetIndex, int totalTargets, bool showPostOverviewNotice)
            {
                requestedAction = null;
                titleLabel.Text = target.name;
                typeLabel.Text = "Target type: " + target.type;
                guideDiagram.SetTarget(target);
                previewOverlay.SetTarget(target);
                UpdatePreviewOverlayBounds();
                guideLabel.Text = string.IsNullOrWhiteSpace(target.captureGuide) ? "Guide: center the target in the preview and keep background out of the frame." : target.captureGuide;
                instructionLabel.Text = target.instruction + Environment.NewLine + Environment.NewLine + "Adjust focus manually, then confirm capture.";
                overviewNoticeLabel.Text = showPostOverviewNotice
                    ? "Now zoom/refocus for close-up detail captures before continuing to corners/surface targets."
                    : "";
                progressLabel.Text = "Capture " + targetIndex + " / " + totalTargets;
                fallbackLabel.Text = "Manual fallback mode until GRBL stage motion is integrated.";
                form.Activate();
                Application.DoEvents();

                while (requestedAction == null && !form.IsDisposed)
                {
                    Application.DoEvents();
                    Thread.Sleep(50);
                }

                return requestedAction ?? OperatorAction.Abort;
            }

            public void UpdatePreviewOverlayBounds()
            {
                if (form.IsDisposed || axHost.IsDisposed || previewOverlay.IsDisposed)
                {
                    return;
                }

                var screenBounds = axHost.RectangleToScreen(axHost.ClientRectangle);
                previewOverlay.Bounds = screenBounds;
                previewOverlay.Visible = form.Visible && form.WindowState != FormWindowState.Minimized && screenBounds.Width > 0 && screenBounds.Height > 0;
                previewOverlay.Invalidate();
                previewOverlay.BringToFront();
            }

            private static Label BuildOperatorLabel(float size, bool bold)
            {
                return new Label
                {
                    Dock = DockStyle.Fill,
                    AutoSize = false,
                    Font = new Font("Segoe UI", size, bold ? FontStyle.Bold : FontStyle.Regular),
                    TextAlign = ContentAlignment.MiddleLeft
                };
            }

            private static Button BuildOperatorButton(string text, Action noop)
            {
                var button = new Button
                {
                    Text = text,
                    Width = 168,
                    Height = 42,
                    Margin = new Padding(0, 0, 8, 8)
                };
                noop();
                return button;
            }

            public void Dispose()
            {
                previewOverlay.Close();
                previewOverlay.Dispose();
                axHost.Dispose();
                form.Dispose();
            }
        }

        private sealed class PreviewGuideOverlayForm : Form
        {
            private static readonly Color TransparentColor = Color.FromArgb(255, 0, 255);
            private OperatorTarget? target;

            public PreviewGuideOverlayForm()
            {
                ShowInTaskbar = false;
                FormBorderStyle = FormBorderStyle.None;
                StartPosition = FormStartPosition.Manual;
                BackColor = TransparentColor;
                TransparencyKey = TransparentColor;
                TopMost = true;
                DoubleBuffered = true;
                Font = new Font("Segoe UI", 10, FontStyle.Bold);
            }

            protected override bool ShowWithoutActivation => true;

            protected override CreateParams CreateParams
            {
                get
                {
                    const int wsExToolWindow = 0x00000080;
                    const int wsExNoActivate = 0x08000000;
                    const int wsExTransparent = 0x00000020;
                    var cp = base.CreateParams;
                    cp.ExStyle |= wsExToolWindow | wsExNoActivate | wsExTransparent;
                    return cp;
                }
            }

            public void SetTarget(OperatorTarget nextTarget)
            {
                target = nextTarget;
                Invalidate();
            }

            protected override void OnPaint(PaintEventArgs e)
            {
                base.OnPaint(e);
                var g = e.Graphics;
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                using (var guidePen = new Pen(Color.FromArgb(255, 214, 64), Math.Max(4, Width / 160)))
                using (var accentPen = new Pen(Color.FromArgb(94, 234, 212), Math.Max(2, Width / 260)))
                using (var shadowPen = new Pen(Color.FromArgb(20, 24, 32), Math.Max(6, Width / 120)))
                using (var textBack = new SolidBrush(Color.FromArgb(170, 15, 23, 42)))
                using (var textBrush = new SolidBrush(Color.White))
                {
                    var canvas = new Rectangle(18, 18, Math.Max(40, Width - 36), Math.Max(40, Height - 58));
                    var kind = target?.guideVisualKind ?? "surface";
                    var orientation = target?.guideVisualOrientation ?? "center";
                    DrawCenterTickMarks(g, accentPen, canvas);
                    if (kind == "full-card")
                    {
                        DrawFullCardGuide(g, shadowPen, canvas);
                        DrawFullCardGuide(g, guidePen, canvas);
                    }
                    else if (kind == "corner")
                    {
                        DrawCornerGuide(g, shadowPen, shadowPen, canvas, orientation);
                        DrawCornerGuide(g, guidePen, accentPen, canvas, orientation);
                    }
                    else if (kind == "edge")
                    {
                        DrawEdgeGuide(g, shadowPen, canvas, orientation);
                        DrawEdgeGuide(g, guidePen, canvas, orientation);
                    }
                    else
                    {
                        DrawSurfaceGuide(g, shadowPen, shadowPen, canvas);
                        DrawSurfaceGuide(g, guidePen, accentPen, canvas);
                    }

                    var legend = target?.guideVisualLegend ?? "Align the target to the yellow guide.";
                    var legendRect = new RectangleF(14, Math.Max(8, Height - 42), Math.Max(80, Width - 28), 30);
                    g.FillRectangle(textBack, legendRect);
                    g.DrawString(legend, Font, textBrush, legendRect);
                }
            }

            private static void DrawCenterTickMarks(Graphics g, Pen pen, Rectangle canvas)
            {
                var cx = canvas.Left + canvas.Width / 2;
                var cy = canvas.Top + canvas.Height / 2;
                var tick = Math.Min(canvas.Width, canvas.Height) / 12;
                g.DrawLine(pen, cx - tick, cy, cx + tick, cy);
                g.DrawLine(pen, cx, cy - tick, cx, cy + tick);
            }

            private static void DrawFullCardGuide(Graphics g, Pen pen, Rectangle canvas)
            {
                var rect = Rectangle.Inflate(canvas, -canvas.Width / 6, -canvas.Height / 8);
                g.DrawRectangle(pen, rect);
            }

            private static void DrawCornerGuide(Graphics g, Pen pen, Pen accentPen, Rectangle canvas, string orientation)
            {
                var cx = canvas.Left + canvas.Width / 2;
                var cy = canvas.Top + canvas.Height / 2;
                var len = Math.Min(canvas.Width, canvas.Height) / 3;
                var left = orientation.Contains("left");
                var top = orientation.Contains("top");
                var xEnd = left ? cx + len : cx - len;
                var yEnd = top ? cy + len : cy - len;
                g.DrawLine(pen, cx, cy, xEnd, cy);
                g.DrawLine(pen, cx, cy, cx, yEnd);
                g.DrawRectangle(accentPen, cx - 10, cy - 10, 20, 20);
            }

            private static void DrawEdgeGuide(Graphics g, Pen pen, Rectangle canvas, string orientation)
            {
                var cx = canvas.Left + canvas.Width / 2;
                var cy = canvas.Top + canvas.Height / 2;
                if (orientation == "vertical")
                {
                    g.DrawLine(pen, cx, canvas.Top + canvas.Height / 8, cx, canvas.Bottom - canvas.Height / 8);
                }
                else
                {
                    g.DrawLine(pen, canvas.Left + canvas.Width / 8, cy, canvas.Right - canvas.Width / 8, cy);
                }
            }

            private static void DrawSurfaceGuide(Graphics g, Pen pen, Pen accentPen, Rectangle canvas)
            {
                var rect = Rectangle.Inflate(canvas, -canvas.Width / 4, -canvas.Height / 4);
                g.DrawRectangle(pen, rect);
                g.DrawEllipse(accentPen, rect);
            }
        }

        private sealed class GuideDiagramControl : Control
        {
            private OperatorTarget? target;

            public GuideDiagramControl()
            {
                DoubleBuffered = true;
                BackColor = Color.FromArgb(18, 25, 38);
                ForeColor = Color.White;
                Font = new Font("Segoe UI", 10, FontStyle.Bold);
            }

            public void SetTarget(OperatorTarget nextTarget)
            {
                target = nextTarget;
                Invalidate();
            }

            protected override void OnPaint(PaintEventArgs e)
            {
                base.OnPaint(e);
                var g = e.Graphics;
                g.Clear(BackColor);
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                using (var borderPen = new Pen(Color.FromArgb(76, 154, 255), 2))
                using (var guidePen = new Pen(Color.FromArgb(255, 214, 64), 5))
                using (var accentPen = new Pen(Color.FromArgb(94, 234, 212), 3))
                using (var mutedPen = new Pen(Color.FromArgb(148, 163, 184), 1))
                using (var brush = new SolidBrush(Color.White))
                using (var mutedBrush = new SolidBrush(Color.FromArgb(203, 213, 225)))
                {
                    var canvas = new Rectangle(18, 18, Math.Max(40, Width - 36), Math.Max(40, Height - 58));
                    g.DrawRectangle(borderPen, canvas);
                    DrawCenterCrosshair(g, mutedPen, canvas);

                    var kind = target?.guideVisualKind ?? "surface";
                    var orientation = target?.guideVisualOrientation ?? "center";
                    if (kind == "full-card")
                    {
                        DrawFullCardGuide(g, guidePen, canvas);
                    }
                    else if (kind == "corner")
                    {
                        DrawCornerGuide(g, guidePen, accentPen, canvas, orientation);
                    }
                    else if (kind == "edge")
                    {
                        DrawEdgeGuide(g, guidePen, canvas, orientation);
                    }
                    else
                    {
                        DrawSurfaceGuide(g, guidePen, accentPen, canvas);
                    }

                    var legend = target?.guideVisualLegend ?? "Align the target to the yellow guide.";
                    g.DrawString(legend, Font, brush, new RectangleF(18, Height - 35, Width - 36, 30));
                    g.DrawString("Blue frame = preview area. Yellow = target alignment guide.", new Font("Segoe UI", 8, FontStyle.Regular), mutedBrush, new PointF(20, 2));
                }
            }

            private static void DrawCenterCrosshair(Graphics g, Pen pen, Rectangle canvas)
            {
                var cx = canvas.Left + canvas.Width / 2;
                var cy = canvas.Top + canvas.Height / 2;
                g.DrawLine(pen, cx, canvas.Top + 8, cx, canvas.Bottom - 8);
                g.DrawLine(pen, canvas.Left + 8, cy, canvas.Right - 8, cy);
            }

            private static void DrawFullCardGuide(Graphics g, Pen pen, Rectangle canvas)
            {
                var rect = Rectangle.Inflate(canvas, -canvas.Width / 6, -canvas.Height / 8);
                g.DrawRectangle(pen, rect);
            }

            private static void DrawCornerGuide(Graphics g, Pen pen, Pen accentPen, Rectangle canvas, string orientation)
            {
                var cx = canvas.Left + canvas.Width / 2;
                var cy = canvas.Top + canvas.Height / 2;
                var len = Math.Min(canvas.Width, canvas.Height) / 3;
                var left = orientation.Contains("left");
                var top = orientation.Contains("top");
                var xEnd = left ? cx + len : cx - len;
                var yEnd = top ? cy + len : cy - len;
                g.DrawLine(pen, cx, cy, xEnd, cy);
                g.DrawLine(pen, cx, cy, cx, yEnd);
                g.DrawRectangle(accentPen, cx - 9, cy - 9, 18, 18);
            }

            private static void DrawEdgeGuide(Graphics g, Pen pen, Rectangle canvas, string orientation)
            {
                var cx = canvas.Left + canvas.Width / 2;
                var cy = canvas.Top + canvas.Height / 2;
                if (orientation == "vertical")
                {
                    g.DrawLine(pen, cx, canvas.Top + 16, cx, canvas.Bottom - 16);
                }
                else
                {
                    g.DrawLine(pen, canvas.Left + 16, cy, canvas.Right - 16, cy);
                }
            }

            private static void DrawSurfaceGuide(Graphics g, Pen pen, Pen accentPen, Rectangle canvas)
            {
                var rect = Rectangle.Inflate(canvas, -canvas.Width / 4, -canvas.Height / 4);
                g.DrawRectangle(pen, rect);
                g.DrawEllipse(accentPen, rect);
            }
        }

        private sealed class DnVideoXAxHost : AxHost
        {
            public DnVideoXAxHost()
                : base(Clsid)
            {
            }

            public object ControlInstance => GetOcx();
        }

        private enum OperatorAction
        {
            Capture,
            Skip,
            Retake,
            Abort
        }

        public sealed class OperatorTarget
        {
            public OperatorTarget(
                string id,
                string name,
                string type,
                string reportLabel,
                string instruction,
                string captureGuide,
                bool captureGuidesEnabled,
                string guideVisualKind,
                string guideVisualOrientation,
                string guideVisualLegend,
                string? cornerProfile)
            {
                this.id = id;
                this.name = name;
                this.type = type;
                this.reportLabel = reportLabel;
                this.instruction = instruction;
                this.captureGuide = captureGuide;
                this.captureGuidesEnabled = captureGuidesEnabled;
                this.guideVisualKind = guideVisualKind;
                this.guideVisualOrientation = guideVisualOrientation;
                this.guideVisualLegend = guideVisualLegend;
                this.cornerProfile = cornerProfile;
            }

            public string id { get; }
            public string name { get; }
            public string type { get; }
            public string reportLabel { get; }
            public string instruction { get; }
            public string captureGuide { get; }
            public bool captureGuidesEnabled { get; }
            public string guideVisualKind { get; }
            public string guideVisualOrientation { get; }
            public string guideVisualLegend { get; }
            public string? cornerProfile { get; }
        }

        private sealed class LightingRecipe
        {
            public LightingRecipe(string name, int? ledState, int? flcSwitch, int? flcLevel)
            {
                this.name = name;
                this.ledState = ledState;
                this.flcSwitch = flcSwitch;
                this.flcLevel = flcLevel;
            }

            public string name { get; }
            public int? ledState { get; }
            public int? flcSwitch { get; }
            public int? flcLevel { get; }
        }

        private sealed class FilePollResult
        {
            public FilePollResult(bool available, bool exists, long byteSize, int checks, long elapsedMs, string? lastError)
            {
                this.available = available;
                this.exists = exists;
                this.byteSize = byteSize;
                this.checks = checks;
                this.elapsedMs = elapsedMs;
                this.lastError = lastError;
            }

            public bool available { get; }
            public bool exists { get; }
            public long byteSize { get; }
            public int checks { get; }
            public long elapsedMs { get; }
            public string? lastError { get; }
        }

        private sealed class CleanupState
        {
            public bool previewStopped { get; set; }
            public bool disconnected { get; set; }
            public bool hostDisposed { get; set; }
            public object? finalLightingRecipe { get; set; }
            public List<object> cleanupErrors { get; } = new List<object>();
        }

        private sealed class RuntimeDirectoryScope : IDisposable
        {
            private readonly string originalCurrentDirectory;
            private bool entered;

            private RuntimeDirectoryScope(string originalCurrentDirectory)
            {
                this.originalCurrentDirectory = originalCurrentDirectory;
            }

            public static RuntimeDirectoryScope? TryEnter(string? runtimeDir, object diagnostics)
            {
                if (!IsEdofRuntimeReady(diagnostics) || string.IsNullOrWhiteSpace(runtimeDir))
                {
                    return null;
                }

                var scope = new RuntimeDirectoryScope(Environment.CurrentDirectory);
                var absoluteRuntimeDir = Path.GetFullPath(runtimeDir!);
                Environment.CurrentDirectory = absoluteRuntimeDir;
                SetDllDirectory(absoluteRuntimeDir);
                scope.entered = true;
                return scope;
            }

            public void Dispose()
            {
                if (!entered)
                {
                    return;
                }

                SetDllDirectory(null);
                Environment.CurrentDirectory = originalCurrentDirectory;
                entered = false;
            }
        }
    }
}
