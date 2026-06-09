using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Windows.Forms;

namespace TenKings.AiGrader.DinoLiteBridge
{
    public sealed class DnVideoXAdapter : IDinoLiteBridgeAdapter
    {
        private const string ProgId = "VIDEOCAPX.VideoCapXCtrl.1";
        private const string Clsid = "922FB007-DD9A-11D3-BD8D-DAAFCB8D9378";
        private const string ActiveXPath = @"C:\Windows\SysWOW64\DNVideoX.ocx";
        private readonly BridgeOptions options;

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
            var raw = InvokeOptional(control, "GetConfig", optionalErrors, deviceIndex);
            var bitfield = raw == null ? (long?)null : Convert.ToInt64(raw);
            return new
            {
                bitfield,
                decoded = bitfield == null
                    ? null
                    : new
                    {
                        edof = (bitfield.Value & 0x08) == 0x08,
                        amr = (bitfield.Value & 0x40) == 0x40,
                        led = (bitfield.Value & 0x10) == 0x10,
                        flc = (bitfield.Value & 0x20) == 0x20,
                        axi = (bitfield.Value & 0x04) == 0x04
                    }
            };
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

        private sealed class DnVideoXAxHost : AxHost
        {
            public DnVideoXAxHost()
                : base(Clsid)
            {
            }

            public object ControlInstance => GetOcx();
        }

        private sealed class CleanupState
        {
            public bool previewStopped { get; set; }
            public bool disconnected { get; set; }
            public bool hostDisposed { get; set; }
            public List<object> cleanupErrors { get; } = new List<object>();
        }
    }
}
