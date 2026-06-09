using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Reflection;
using System.Runtime.InteropServices;
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
                status = "SDK_NOT_READY",
                message = "COM/ActiveX enumeration is reserved for a later approved manual hardware slice."
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
                message = "Real microscope capture/control capabilities are not implemented in this PR."
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
    }
}
