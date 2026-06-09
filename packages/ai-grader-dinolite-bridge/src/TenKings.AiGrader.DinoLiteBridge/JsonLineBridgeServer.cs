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
                if (request == null || string.IsNullOrWhiteSpace(request.command))
                {
                    WriteError(request?.id, "INVALID_REQUEST", "Request must include a command.");
                    return false;
                }

                var command = request.command!.Trim();
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
