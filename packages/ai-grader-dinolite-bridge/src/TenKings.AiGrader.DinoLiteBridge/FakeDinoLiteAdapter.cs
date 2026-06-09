namespace TenKings.AiGrader.DinoLiteBridge
{
    public sealed class FakeDinoLiteAdapter : IDinoLiteBridgeAdapter
    {
        public object Health()
        {
            return new
            {
                status = "OK",
                adapter = "fake",
                hardwareAccess = "disabled",
                comActiveXInstantiated = false,
                message = "Fake Dino-Lite bridge adapter is healthy; no COM or hardware access is active."
            };
        }

        public object SdkInfo()
        {
            return new
            {
                adapter = "fake",
                sdk = "DNVideoX",
                mode = "simulated",
                registeredActiveXPath = @"C:\Windows\SysWOW64\DNVideoX.ocx",
                targetFramework = ".NET Framework 4.8",
                platform = "x86",
                threadingModel = "STA",
                comActiveXInstantiated = false
            };
        }

        public object ListDevices()
        {
            return new
            {
                adapter = "fake",
                devices = new[]
                {
                    new
                    {
                        id = "fake-dinolite-af7915mztl-001",
                        model = "Dino-Lite Edge AF7915MZTL",
                        serial = "FAKE-AF7915MZTL-0001",
                        displayName = "Fake Dino-Lite Edge AF7915MZTL",
                        simulated = true
                    }
                }
            };
        }

        public object Capabilities()
        {
            return new
            {
                adapter = "fake",
                simulated = true,
                stillCapture = true,
                amr = true,
                flc = true,
                edr = true,
                edof = true,
                controlsImplemented = false,
                captureImplemented = false
            };
        }
    }
}
