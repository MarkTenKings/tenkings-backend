namespace TenKings.AiGrader.DinoLiteBridge
{
    public sealed class DnVideoXAdapter : IDinoLiteBridgeAdapter
    {
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
                registeredActiveXPath = @"C:\Windows\SysWOW64\DNVideoX.ocx",
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
    }
}
