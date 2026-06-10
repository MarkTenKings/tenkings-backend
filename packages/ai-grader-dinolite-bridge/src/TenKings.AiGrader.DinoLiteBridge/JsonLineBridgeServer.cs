using System;
using System.IO;
using System.Web.Script.Serialization;

namespace TenKings.AiGrader.DinoLiteBridge
{
    public sealed class JsonLineBridgeServer
    {
        private readonly IDinoLiteBridgeAdapter adapter;
        private readonly TextReader input;
        private readonly TextWriter output;
        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer();

        public JsonLineBridgeServer(IDinoLiteBridgeAdapter adapter, TextReader input, TextWriter output)
        {
            this.adapter = adapter;
            this.input = input;
            this.output = output;
        }

        public int Run()
        {
            string? line;
            while ((line = input.ReadLine()) != null)
            {
                if (line.Trim().Length == 0)
                {
                    continue;
                }

                var shouldExit = HandleLine(line);
                if (shouldExit)
                {
                    return 0;
                }
            }

            return 0;
        }

        private bool HandleLine(string line)
        {
            BridgeRequest? request = null;
            try
            {
                request = serializer.Deserialize<BridgeRequest>(line);
                var requestedCommand = request?.command ?? request?.type;
                if (request == null || string.IsNullOrWhiteSpace(requestedCommand))
                {
                    WriteError(request?.id, "INVALID_REQUEST", "Request must include a command or type.");
                    return false;
                }

                var command = requestedCommand!.Trim();
                switch (command)
                {
                    case "health":
                        WriteResult(request.id, adapter.Health());
                        return false;
                    case "sdkInfo":
                        WriteResult(request.id, adapter.SdkInfo());
                        return false;
                    case "listDevices":
                        WriteResult(request.id, adapter.ListDevices());
                        return false;
                    case "capabilities":
                        WriteResult(request.id, adapter.Capabilities());
                        return false;
                    case "dinolite.enumerateDevices":
                        WriteResult(request.id, adapter.EnumerateDevices());
                        return false;
                    case "dinolite.status":
                        WriteResult(request.id, adapter.Status(request.deviceIndex ?? 0));
                        return false;
                    case "dinolite.captureStillJpg":
                        WriteResult(request.id, adapter.CaptureStillJpg(request.deviceIndex ?? 0, request.outputDir));
                        return false;
                    case "dinolite.advancedStatus":
                        WriteResult(request.id, adapter.Status(request.deviceIndex ?? 0));
                        return false;
                    case "dinolite.getLightingStatus":
                        WriteResult(request.id, adapter.GetLightingStatus(request.deviceIndex ?? 0));
                        return false;
                    case "dinolite.setLightingRecipe":
                        WriteResult(request.id, adapter.SetLightingRecipe(request.deviceIndex ?? 0, request.label));
                        return false;
                    case "dinolite.runtimeDiagnostics":
                        WriteResult(request.id, adapter.RuntimeDiagnostics());
                        return false;
                    case "dinolite.capturePackage":
                    case "dinolite.captureDemoPackage":
                        WriteResult(
                            request.id,
                            adapter.CapturePackage(
                                request.deviceIndex ?? 0,
                                request.outputDir,
                                request.label,
                                request.includeLightingSweep == true,
                                request.includeEdr == true,
                                request.includeEdof == true));
                        return false;
                    case "dinolite.operatorWorkflow":
                        WriteResult(
                            request.id,
                            adapter.OperatorWorkflow(
                                request.deviceIndex ?? 0,
                                request.outputDir,
                                request.label,
                                request.plan,
                                request.includeFlcSweep == true || request.includeLightingSweep == true,
                                request.includeEdr == true,
                                request.includeEdof == true,
                                request.cornerProfile,
                                request.captureGuides != false));
                        return false;
                    case "exit":
                        WriteResult(request.id, new { status = "BYE" });
                        return true;
                    default:
                        WriteError(request.id, "INVALID_COMMAND", "Unsupported command: " + command);
                        return false;
                }
            }
            catch (Exception error)
            {
                WriteError(request?.id, "BAD_JSON", error.Message);
                return false;
            }
        }

        private void WriteResult(string? id, object result)
        {
            output.WriteLine(serializer.Serialize(new { id, ok = true, result }));
            output.Flush();
        }

        private void WriteError(string? id, string code, string message)
        {
            output.WriteLine(serializer.Serialize(new { id, ok = false, error = new { code, message } }));
            output.Flush();
        }
    }
}
