namespace TenKings.AiGrader.DinoLiteBridge
{
    public sealed class FakeDinoLiteAdapter : IDinoLiteBridgeAdapter
    {
        private const string FakeCaptureSha256 = "575b00ae2fefbbacf7b92d1fd8b839ecfb2979661cc2202b9b08052fb1e48a68";

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

        public object Status(int deviceIndex)
        {
            return new
            {
                adapter = "fake",
                simulated = true,
                comActiveXInstantiated = false,
                ocxVersion = "simulated",
                device = FakeDevice(deviceIndex),
                connectedDuringCommand = true,
                previewDuringCommand = false,
                config = new
                {
                    bitfield = 0x7c,
                    decoded = new { edof = true, amr = true, led = true, flc = true, axi = true }
                },
                amr = 42.5,
                videoCaps = new { value = "simulated-video-caps" },
                videoFormat = new { width = 1280, height = 1024, result = 0 },
                lensLimits = new { upper = 1000, lower = 0 },
                lensFineLimits = new { unavailable = true, code = "NOT_EXPOSED_BY_SDK_HEADER" },
                exposure = new { exposureValue = 12, gain = 3, autoExposure = 1 },
                ledState = 1,
                optionalErrors = new object[0],
                cleanup = new { previewStopped = false, disconnected = true, hostDisposed = true },
                forbiddenOperationsInvoked = false
            };
        }

        public object CaptureStillJpg(int deviceIndex, string? outputDir)
        {
            var fileName = "fake-dinolite-still-20260609T000000Z.jpg";
            var normalizedOutputDir = outputDir ?? "";
            return new
            {
                adapter = "fake",
                simulated = true,
                comActiveXInstantiated = false,
                device = FakeDevice(deviceIndex),
                outputFilePath = string.IsNullOrWhiteSpace(normalizedOutputDir) ? fileName : normalizedOutputDir.TrimEnd('\\') + "\\" + fileName,
                sha256 = FakeCaptureSha256,
                byteSize = 16,
                mimeType = "image/jpeg",
                timestamp = "2026-06-09T00:00:00.0000000Z",
                connectedDuringCommand = true,
                previewDuringCommand = true,
                config = new
                {
                    bitfield = 0x7c,
                    decoded = new { edof = true, amr = true, led = true, flc = true, axi = true }
                },
                amr = 42.5,
                cleanup = new { previewStopped = true, disconnected = true, hostDisposed = true },
                forbiddenOperationsInvoked = false
            };
        }

        private static object FakeDevice(int deviceIndex)
        {
            return new
            {
                index = deviceIndex,
                name = "Fake Dino-Lite Edge AF7915MZTL",
                description = "Simulated AF7915MZTL-like Dino-Lite microscope",
                deviceId = "FAKE-AF7915MZTL-0001"
            };
        }
    }
}
