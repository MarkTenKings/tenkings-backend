using System.IO;
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
                "{\"id\":\"9\",\"command\":\"exit\"}");

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
            StringAssert.Contains(output, "not a certified grade");
            StringAssert.Contains(output, "\"status\":\"BYE\"");
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
                "{\"id\":\"pkg\",\"command\":\"dinolite.capturePackage\",\"deviceIndex\":0,\"outputDir\":\"C:\\\\TenKings\\\\capture-data\\\\fake\",\"label\":\"card-demo-001\",\"includeLightingSweep\":true,\"includeEdr\":true,\"includeEdof\":true}"));
            var output = new StringWriter();
            var server = new JsonLineBridgeServer(new DnVideoXAdapter(new BridgeOptions()), input, output);
            var code = server.Run();

            Assert.AreEqual(0, code);
            var text = output.ToString();
            StringAssert.Contains(text, "\"id\":\"status\"");
            StringAssert.Contains(text, "\"id\":\"capture\"");
            StringAssert.Contains(text, "\"id\":\"pkg\"");
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
