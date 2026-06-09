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

        public object EnumerateDevices()
        {
            return new
            {
                adapter = "fake",
                comActiveXInstantiated = false,
                connected = false,
                preview = false,
                deviceCount = 1,
                devices = new[]
                {
                    new
                    {
                        index = 0,
                        name = "Fake Dino-Lite Edge AF7915MZTL",
                        description = "Simulated AF7915MZTL-like Dino-Lite microscope",
                        deviceId = "FAKE-AF7915MZTL-0001",
                        simulated = true
                    }
                },
                sdk = new
                {
                    control = "DNVideoX",
                    version = "simulated",
                    progId = "VIDEOCAPX.VideoCapXCtrl.1"
                },
                forbiddenOperationsInvoked = false
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
