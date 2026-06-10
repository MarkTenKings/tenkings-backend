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

        public object GetLightingStatus(int deviceIndex)
        {
            return new
            {
                adapter = "fake",
                simulated = true,
                comActiveXInstantiated = false,
                device = FakeDevice(deviceIndex),
                ledState = 1,
                flc = new { supported = true, switchValue = 15, level = 4 },
                cleanup = new { previewStopped = false, disconnected = false, hostDisposed = true },
                forbiddenOperationsInvoked = false
            };
        }

        public object SetLightingRecipe(int deviceIndex, string? recipeName)
        {
            return new
            {
                adapter = "fake",
                simulated = true,
                comActiveXInstantiated = false,
                device = FakeDevice(deviceIndex),
                recipe = new { name = string.IsNullOrWhiteSpace(recipeName) ? "safe-final-all-quadrants-level-3" : recipeName },
                applied = true,
                forbiddenOperationsInvoked = false
            };
        }

        public object CapturePackage(int deviceIndex, string? outputDir, string? label, bool includeLightingSweep, bool includeEdr, bool includeEdof)
        {
            var normalizedOutputDir = string.IsNullOrWhiteSpace(outputDir) ? "C:\\TenKings\\capture-data\\dinolite-demo" : outputDir!.TrimEnd('\\');
            var normalizedLabel = string.IsNullOrWhiteSpace(label) ? "fake-demo" : label!;
            var packageId = "dinolite-" + normalizedLabel + "-20260609T000000000Z";
            var packageDir = normalizedOutputDir + "\\" + packageId;
            var unsupported = normalizedLabel.Contains("unsupported");
            return new
            {
                adapter = "fake",
                simulated = true,
                comActiveXInstantiated = false,
                packageId,
                label = normalizedLabel,
                packageDir,
                manifestPath = packageDir + "\\manifest.json",
                previewReportPath = packageDir + "\\preview-report.html",
                timestamp = "2026-06-09T00:00:00.0000000Z",
                device = FakeDevice(deviceIndex),
                ocxVersion = "simulated",
                connectedDuringCommand = true,
                previewDuringCommand = true,
                config = new { bitfield = 0x7c, decoded = new { edof = true, amr = true, led = true, flc = true, axi = true } },
                amr = 42.5,
                runtimeDependencies = RuntimeDiagnostics(),
                captures = new object[]
                {
                    FakeCapture(packageDir, "normal", "normal", "normal-still", "success"),
                    includeLightingSweep ? FakeCapture(packageDir, "flc-all-level-3", "lightingSweep", "all-quadrants-level-3", unsupported ? "unavailable" : "success") : new { captureKind = "lightingSweep", status = "skipped" },
                    includeEdr ? FakeCapture(packageDir, "edr", "edr", "edr", unsupported ? "unavailable" : "success") : new { captureKind = "edr", status = "skipped" },
                    includeEdof ? FakeCapture(packageDir, "edof", "edof", "edof", unsupported ? "unavailable" : "success") : new { captureKind = "edof", status = "skipped" }
                },
                cleanup = new { previewStopped = true, disconnected = true, hostDisposed = true, finalLightingRecipe = "safe-final-all-quadrants-level-3" },
                limitations = new[] { "Dino-Lite capture package preview -- not a certified grade." },
                forbiddenOperationsInvoked = false
            };
        }

        public object OperatorWorkflow(int deviceIndex, string? outputDir, string? label, string? plan, bool includeFlcSweep, bool includeEdr, bool includeEdof)
        {
            var normalizedOutputDir = string.IsNullOrWhiteSpace(outputDir) ? "C:\\TenKings\\capture-data\\dinolite-operator" : outputDir!.TrimEnd('\\');
            var normalizedLabel = string.IsNullOrWhiteSpace(label) ? "fake-operator" : label!;
            var normalizedPlan = string.IsNullOrWhiteSpace(plan) ? "corners-basic" : plan!;
            var sessionId = "dinolite-operator-" + normalizedLabel + "-20260609T000000000Z";
            var sessionDir = normalizedOutputDir + "\\" + sessionId;
            var targets = normalizedPlan == "operator-smoke-single"
                ? new[]
                {
                    FakeTarget(sessionDir, "center-surface", "Center surface", "surface", "center_surface", 1)
                }
                : normalizedPlan == "card-interim"
                ? new[]
                {
                    FakeTarget(sessionDir, "full-card-overview", "Full-card overview", "interim_macro_overview", "interim_full_card_overview", 1),
                    FakeTarget(sessionDir, "top-left-corner", "Top-left corner", "corner", "top_left_corner", 2),
                    FakeTarget(sessionDir, "top-right-corner", "Top-right corner", "corner", "top_right_corner", 3),
                    FakeTarget(sessionDir, "bottom-right-corner", "Bottom-right corner", "corner", "bottom_right_corner", 4),
                    FakeTarget(sessionDir, "bottom-left-corner", "Bottom-left corner", "corner", "bottom_left_corner", 5),
                    FakeTarget(sessionDir, "center-surface", "Center surface", "surface", "center_surface", 6)
                }
                : new[]
                {
                    FakeTarget(sessionDir, "top-left-corner", "Top-left corner", "corner", "top_left_corner", 1),
                    FakeTarget(sessionDir, "top-right-corner", "Top-right corner", "corner", "top_right_corner", 2)
                };

            return new
            {
                adapter = "fake",
                simulated = true,
                comActiveXInstantiated = false,
                sessionId,
                label = normalizedLabel,
                plan = normalizedPlan,
                sessionDir,
                manifestPath = sessionDir + "\\manifest.json",
                previewReportPath = sessionDir + "\\preview-report.html",
                timestamp = "2026-06-09T00:00:00.0000000Z",
                status = normalizedLabel.Contains("abort") ? "aborted" : "completed",
                device = FakeDevice(deviceIndex),
                ocxVersion = "simulated",
                connectedDuringCommand = true,
                previewDuringCommand = true,
                config = new { bitfield = 0x7c, decoded = new { edof = true, amr = true, led = true, flc = true, axi = true } },
                amr = 42.5,
                options = new { includeFlcSweep, includeEdr, includeEdof },
                targets,
                cleanup = new { previewStopped = true, disconnected = true, hostDisposed = true, finalLightingRecipe = "safe-final-all-quadrants-level-3" },
                limitations = OperatorLimitations(),
                forbiddenOperationsInvoked = false
            };
        }

        public object RuntimeDiagnostics()
        {
            return new
            {
                adapter = "fake",
                simulated = true,
                configuredRuntimeDir = (string?)null,
                runtimeDirConfigured = false,
                runtimeDirUsable = false,
                edofHelperAvailable = true,
                requiredFiles = new[]
                {
                    new { fileName = "enfuse.exe", present = true },
                    new { fileName = "SMIUtility.dll", present = true },
                    new { fileName = "d3dx9_31.dll", present = true }
                },
                currentDirectory = "simulated",
                baseDirectory = "simulated",
                pathMutation = "none"
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

        private static object FakeCapture(string packageDir, string stem, string captureKind, string recipe, string status)
        {
            return new
            {
                path = packageDir + "\\" + stem + ".jpg",
                filename = stem + ".jpg",
                sha256 = FakeCaptureSha256,
                byteSize = status == "success" ? 16 : 0,
                mimeType = "image/jpeg",
                timestamp = "2026-06-09T00:00:00.0000000Z",
                captureKind,
                lightingRecipe = recipe,
                status,
                error = status == "success" ? null : new { code = "FAKE_UNAVAILABLE", message = "Simulated unsupported Dino-Lite feature." }
            };
        }

        private static object FakeTarget(string sessionDir, string id, string name, string type, string reportLabel, int index)
        {
            return new
            {
                target = new
                {
                    id,
                    name,
                    type,
                    reportLabel,
                    instruction = id == "full-card-overview"
                        ? "Raise/zoom out/refocus the Dino-Lite so as much of the full card as possible is visible. This is an interim overview until the dedicated macro camera is integrated."
                        : "Move the card so the " + name.ToLowerInvariant() + " is centered under the microscope. Adjust focus manually, then confirm capture."
                },
                targetIndex = index,
                action = "captured",
                attempt = 1,
                status = "success",
                artifacts = new[]
                {
                    FakeCapture(sessionDir, index.ToString("00") + "-" + id + "-normal", "normal", "operator-target-normal", "success")
                }
            };
        }

        private static string[] OperatorLimitations()
        {
            return new[]
            {
                "Dino-Lite operator workflow preview -- not a certified grade.",
                "Interim full-card overview is not production macro evidence.",
                "Interim full-card overview is not calibrated macro capture.",
                "Session output is not certified grading evidence."
            };
        }
    }
}
