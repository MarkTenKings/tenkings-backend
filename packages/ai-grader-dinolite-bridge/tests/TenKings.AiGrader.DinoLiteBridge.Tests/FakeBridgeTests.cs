using System.IO;
using System.Linq;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace TenKings.AiGrader.DinoLiteBridge.Tests
{
    [TestClass]
    public sealed class FakeBridgeTests
    {
        [TestMethod]
        public void FakeBridgeReturnsHealthSdkInfoDevicesAndCapabilities()
        {
            var output = Run(
                "{\"id\":\"1\",\"command\":\"health\"}",
                "{\"id\":\"2\",\"command\":\"sdkInfo\"}",
                "{\"id\":\"3\",\"command\":\"listDevices\"}",
                "{\"id\":\"4\",\"command\":\"capabilities\"}",
                "{\"id\":\"5\",\"command\":\"dinolite.enumerateDevices\"}",
                "{\"id\":\"6\",\"command\":\"dinolite.status\",\"deviceIndex\":0}",
                "{\"id\":\"7\",\"command\":\"dinolite.captureStillJpg\",\"deviceIndex\":0,\"outputDir\":\"C:\\\\TenKings\\\\capture-data\\\\fake\"}",
                "{\"id\":\"8\",\"command\":\"dinolite.capturePackage\",\"deviceIndex\":0,\"outputDir\":\"C:\\\\TenKings\\\\capture-data\\\\fake\",\"label\":\"card-demo-001\",\"includeLightingSweep\":true,\"includeEdr\":true,\"includeEdof\":true}",
                "{\"id\":\"9\",\"command\":\"dinolite.runtimeDiagnostics\"}",
                "{\"id\":\"10\",\"command\":\"dinolite.operatorWorkflow\",\"deviceIndex\":0,\"outputDir\":\"C:\\\\TenKings\\\\capture-data\\\\fake\",\"label\":\"operator-demo\",\"plan\":\"card-interim\"}",
                "{\"id\":\"11\",\"command\":\"exit\"}");

            StringAssert.Contains(output, "\"id\":\"1\"");
            StringAssert.Contains(output, "\"status\":\"OK\"");
            StringAssert.Contains(output, "\"comActiveXInstantiated\":false");
            StringAssert.Contains(output, "\"Dino-Lite Edge AF7915MZTL\"");
            StringAssert.Contains(output, "\"stillCapture\":true");
            StringAssert.Contains(output, "\"flc\":true");
            StringAssert.Contains(output, "\"edr\":true");
            StringAssert.Contains(output, "\"edof\":true");
            StringAssert.Contains(output, "\"deviceCount\":1");
            StringAssert.Contains(output, "\"connected\":false");
            StringAssert.Contains(output, "\"preview\":false");
            StringAssert.Contains(output, "\"forbiddenOperationsInvoked\":false");
            StringAssert.Contains(output, "\"connectedDuringCommand\":true");
            StringAssert.Contains(output, "\"previewDuringCommand\":false");
            StringAssert.Contains(output, "\"previewDuringCommand\":true");
            StringAssert.Contains(output, "\"sha256\":\"575b00ae2fefbbacf7b92d1fd8b839ecfb2979661cc2202b9b08052fb1e48a68\"");
            StringAssert.Contains(output, "\"mimeType\":\"image/jpeg\"");
            StringAssert.Contains(output, "\"packageId\":\"dinolite-card-demo-001-20260609T000000000Z\"");
            StringAssert.Contains(output, "\"previewReportPath\"");
            StringAssert.Contains(output, "\"captureKind\":\"edr\"");
            StringAssert.Contains(output, "\"captureKind\":\"edof\"");
            StringAssert.Contains(output, "\"captureKind\":\"lightingSweep\"");
            StringAssert.Contains(output, "\"edofHelperAvailable\":true");
            StringAssert.Contains(output, "\"runtimeDirConfigured\":false");
            StringAssert.Contains(output, "\"sessionId\":\"dinolite-operator-operator-demo-20260609T000000000Z\"");
            StringAssert.Contains(output, "\"plan\":\"card-interim\"");
            StringAssert.Contains(output, "\"id\":\"full-card-overview\"");
            StringAssert.Contains(output, "\"type\":\"interim_macro_overview\"");
            StringAssert.Contains(output, "\"reportLabel\":\"interim_full_card_overview\"");
            StringAssert.Contains(output, "not production macro evidence");
            StringAssert.Contains(output, "not calibrated macro capture");
            StringAssert.Contains(output, "not certified grading evidence");
            StringAssert.Contains(output, "not a certified grade");
            StringAssert.Contains(output, "\"status\":\"BYE\"");
        }

        [TestMethod]
        public void CardInterimOperatorPlanStartsWithInterimOverview()
        {
            var plan = DnVideoXAdapter.BuildOperatorPlanForTests("card-interim");
            var first = plan[0];

            Assert.AreEqual("full-card-overview", first.GetType().GetProperty("id")!.GetValue(first, null));
            Assert.AreEqual("interim_macro_overview", first.GetType().GetProperty("type")!.GetValue(first, null));
            Assert.AreEqual("interim_full_card_overview", first.GetType().GetProperty("reportLabel")!.GetValue(first, null));
            StringAssert.Contains((string)first.GetType().GetProperty("instruction")!.GetValue(first, null)!, "interim overview");
            Assert.AreEqual(6, plan.Length);
        }

        [TestMethod]
        public void ExperimentalCardGradingPlanIncludesOverviewCornersEdgesAndSurface()
        {
            var plan = DnVideoXAdapter.BuildOperatorPlanForTests("experimental-card-grading");

            Assert.AreEqual(12, plan.Length);
            Assert.AreEqual("full-card-overview", plan[0].GetType().GetProperty("id")!.GetValue(plan[0], null));
            Assert.AreEqual("interim_macro_overview", plan[0].GetType().GetProperty("type")!.GetValue(plan[0], null));
            Assert.AreEqual("top-left-corner", plan[1].GetType().GetProperty("id")!.GetValue(plan[1], null));
            Assert.AreEqual("left-edge", plan[8].GetType().GetProperty("id")!.GetValue(plan[8], null));
            Assert.AreEqual("edge", plan[8].GetType().GetProperty("type")!.GetValue(plan[8], null));
            Assert.AreEqual("lower-surface", plan[11].GetType().GetProperty("id")!.GetValue(plan[11], null));
            Assert.AreEqual("surface", plan[11].GetType().GetProperty("type")!.GetValue(plan[11], null));
        }

        [TestMethod]
        public void OperatorSmokeSinglePlanHasOneCenterSurfaceTarget()
        {
            var plan = DnVideoXAdapter.BuildOperatorPlanForTests("operator-smoke-single");
            var first = plan[0];

            Assert.AreEqual(1, plan.Length);
            Assert.AreEqual("center-surface", first.GetType().GetProperty("id")!.GetValue(first, null));
            Assert.AreEqual("surface", first.GetType().GetProperty("type")!.GetValue(first, null));
            StringAssert.Contains((string)first.GetType().GetProperty("instruction")!.GetValue(first, null)!, "click Capture");
        }

        [TestMethod]
        public void FakeCapturePackageCanRepresentUnavailableOptionalFeatures()
        {
            var output = Run("{\"id\":\"pkg\",\"command\":\"dinolite.captureDemoPackage\",\"deviceIndex\":0,\"outputDir\":\"C:\\\\TenKings\\\\capture-data\\\\fake\",\"label\":\"unsupported-demo\",\"includeLightingSweep\":true,\"includeEdr\":true,\"includeEdof\":true}");

            StringAssert.Contains(output, "\"id\":\"pkg\"");
            StringAssert.Contains(output, "\"status\":\"unavailable\"");
            StringAssert.Contains(output, "\"code\":\"FAKE_UNAVAILABLE\"");
            StringAssert.Contains(output, "\"forbiddenOperationsInvoked\":false");
            StringAssert.Contains(output, "\"comActiveXInstantiated\":false");
        }

        [TestMethod]
        public void TypeAliasCanRequestManualEnumeration()
        {
            var output = Run("{\"id\":\"enum\",\"type\":\"dinolite.enumerateDevices\",\"adapter\":\"fake\"}");

            StringAssert.Contains(output, "\"id\":\"enum\"");
            StringAssert.Contains(output, "\"adapter\":\"fake\"");
            StringAssert.Contains(output, "\"deviceCount\":1");
            StringAssert.Contains(output, "\"comActiveXInstantiated\":false");
        }

        [TestMethod]
        public void DnVideoXConfig198DecodesUsingSdkBitLayout()
        {
            var config = DnVideoXAdapter.DecodeConfigForTests(198);
            var decoded = config.GetType().GetProperty("decoded")!.GetValue(config, null)!;

            Assert.AreEqual(198L, config.GetType().GetProperty("bitfield")!.GetValue(config, null));
            Assert.AreEqual(true, decoded.GetType().GetProperty("edof")!.GetValue(decoded, null));
            Assert.AreEqual(true, decoded.GetType().GetProperty("amr")!.GetValue(decoded, null));
            Assert.AreEqual(1L, decoded.GetType().GetProperty("ledMode")!.GetValue(decoded, null));
            Assert.AreEqual(true, decoded.GetType().GetProperty("led")!.GetValue(decoded, null));
            Assert.AreEqual(true, decoded.GetType().GetProperty("flc")!.GetValue(decoded, null));
            Assert.AreEqual(false, decoded.GetType().GetProperty("axi")!.GetValue(decoded, null));
        }

        [TestMethod]
        public void RuntimeDiagnosticsRequireOutsideRepoRuntimeDirAndRequiredFiles()
        {
            var tempRoot = Path.Combine(Path.GetTempPath(), "tenkings-dinolite-runtime-tests", Path.GetRandomFileName());
            var repoRoot = Path.Combine(tempRoot, "repo");
            var runtimeRoot = Path.Combine(tempRoot, "runtime");
            Directory.CreateDirectory(repoRoot);
            Directory.CreateDirectory(Path.Combine(repoRoot, ".git"));
            Directory.CreateDirectory(runtimeRoot);
            foreach (var fileName in new[] { "enfuse.exe", "SMIUtility.dll", "d3dx9_31.dll" })
            {
                File.WriteAllText(Path.Combine(runtimeRoot, fileName), "fake");
            }

            var diagnostics = DnVideoXAdapter.InspectRuntimeDependenciesForTests(runtimeRoot, repoRoot);
            var requiredFiles = (object[])diagnostics.GetType().GetProperty("requiredFiles")!.GetValue(diagnostics, null)!;

            Assert.AreEqual(true, diagnostics.GetType().GetProperty("runtimeDirExists")!.GetValue(diagnostics, null));
            Assert.AreEqual(false, diagnostics.GetType().GetProperty("runtimeDirInsideRepo")!.GetValue(diagnostics, null));
            Assert.AreEqual(true, diagnostics.GetType().GetProperty("runtimeDirUsable")!.GetValue(diagnostics, null));
            Assert.AreEqual(true, diagnostics.GetType().GetProperty("edofHelperAvailable")!.GetValue(diagnostics, null));
            Assert.AreEqual(3, requiredFiles.Count(file => (bool)file.GetType().GetProperty("runtimeDirectoryPresent")!.GetValue(file, null)!));
        }

        [TestMethod]
        public void RuntimeDiagnosticsRejectRepoRuntimeDirAndReportMissingFiles()
        {
            var tempRoot = Path.Combine(Path.GetTempPath(), "tenkings-dinolite-runtime-tests", Path.GetRandomFileName());
            var repoRoot = Path.Combine(tempRoot, "repo-missing");
            var runtimeRoot = Path.Combine(repoRoot, "runtime");
            Directory.CreateDirectory(runtimeRoot);
            Directory.CreateDirectory(Path.Combine(repoRoot, ".git"));
            File.WriteAllText(Path.Combine(runtimeRoot, "enfuse.exe"), "fake");

            var diagnostics = DnVideoXAdapter.InspectRuntimeDependenciesForTests(runtimeRoot, repoRoot);
            var requiredFiles = (object[])diagnostics.GetType().GetProperty("requiredFiles")!.GetValue(diagnostics, null)!;

            Assert.AreEqual(true, diagnostics.GetType().GetProperty("runtimeDirInsideRepo")!.GetValue(diagnostics, null));
            Assert.AreEqual(false, diagnostics.GetType().GetProperty("runtimeDirUsable")!.GetValue(diagnostics, null));
            Assert.AreEqual(false, diagnostics.GetType().GetProperty("edofHelperAvailable")!.GetValue(diagnostics, null));
            Assert.AreEqual(1, requiredFiles.Count(file => (bool)file.GetType().GetProperty("runtimeDirectoryPresent")!.GetValue(file, null)!));
        }

        [TestMethod]
        public void RealAdapterEnumerationFailsClosedWithoutManualFlag()
        {
            var input = new StringReader("{\"id\":\"manual\",\"command\":\"dinolite.enumerateDevices\"}");
            var output = new StringWriter();
            var server = new JsonLineBridgeServer(new DnVideoXAdapter(new BridgeOptions()), input, output);
            var code = server.Run();

            Assert.AreEqual(0, code);
            var text = output.ToString();
            StringAssert.Contains(text, "\"ok\":true");
            StringAssert.Contains(text, "\"status\":\"SDK_NOT_READY\"");
            StringAssert.Contains(text, "\"comActiveXInstantiated\":false");
            StringAssert.Contains(text, "--manual-enumerate");
        }

        [TestMethod]
        public void RealAdapterStatusAndCaptureFailClosedWithoutManualHardwareFlag()
        {
            var input = new StringReader(string.Join("\n",
                "{\"id\":\"status\",\"command\":\"dinolite.status\",\"deviceIndex\":0}",
                "{\"id\":\"capture\",\"command\":\"dinolite.captureStillJpg\",\"deviceIndex\":0,\"outputDir\":\"C:\\\\TenKings\\\\capture-data\\\\fake\"}",
                "{\"id\":\"pkg\",\"command\":\"dinolite.capturePackage\",\"deviceIndex\":0,\"outputDir\":\"C:\\\\TenKings\\\\capture-data\\\\fake\",\"label\":\"card-demo-001\",\"includeLightingSweep\":true,\"includeEdr\":true,\"includeEdof\":true}",
                "{\"id\":\"operator\",\"command\":\"dinolite.operatorWorkflow\",\"deviceIndex\":0,\"outputDir\":\"C:\\\\TenKings\\\\capture-data\\\\fake\",\"plan\":\"card-interim\"}"));
            var output = new StringWriter();
            var server = new JsonLineBridgeServer(new DnVideoXAdapter(new BridgeOptions()), input, output);
            var code = server.Run();

            Assert.AreEqual(0, code);
            var text = output.ToString();
            StringAssert.Contains(text, "\"id\":\"status\"");
            StringAssert.Contains(text, "\"id\":\"capture\"");
            StringAssert.Contains(text, "\"id\":\"pkg\"");
            StringAssert.Contains(text, "\"id\":\"operator\"");
            StringAssert.Contains(text, "\"status\":\"SDK_NOT_READY\"");
            StringAssert.Contains(text, "\"comActiveXInstantiated\":false");
            StringAssert.Contains(text, "--manual-hardware");
        }

        [TestMethod]
        public void InvalidCommandReturnsStructuredError()
        {
            var output = Run(
                "{\"id\":\"bad\",\"command\":\"capture\"}",
                "{\"id\":\"exit\",\"command\":\"exit\"}");

            StringAssert.Contains(output, "\"ok\":false");
            StringAssert.Contains(output, "\"code\":\"INVALID_COMMAND\"");
            StringAssert.Contains(output, "Unsupported command: capture");
        }

        private static string Run(params string[] lines)
        {
            var input = new StringReader(string.Join("\n", lines));
            var output = new StringWriter();
            var server = new JsonLineBridgeServer(new FakeDinoLiteAdapter(), input, output);
            var code = server.Run();
            Assert.AreEqual(0, code);
            return output.ToString();
        }
    }
}
