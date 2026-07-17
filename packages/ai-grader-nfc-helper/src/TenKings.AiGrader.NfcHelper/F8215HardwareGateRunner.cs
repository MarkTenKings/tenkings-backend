using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;

namespace TenKings.AiGrader.NfcHelper;

internal static class F8215HardwareGateRunner
{
    private const int DefaultPort = 47663;

    public static async Task<F8215HardwareGateResult> RunAsync(CancellationToken cancellationToken)
    {
        if (!string.Equals(
                Environment.GetEnvironmentVariable("TENKINGS_NFC_F8215_HARDWARE_GATE_CONFIRMED"),
                "true",
                StringComparison.Ordinal))
            throw Error("f8215_hardware_gate_approval_required", "The separate F8215 hardware-gate authorization is required.");

        var options = GoToTagsAdapterOptions.FromEnvironment();
        if (!options.Enabled) throw Error("feiju_f8215_disabled", "The isolated F8215 adapter is not enabled.");
        if (Directory.EnumerateFileSystemEntries(options.JobRoot).Any())
            throw Error("gototags_job_conflict", "The isolated F8215 job root must be empty.");

        var runtime = new WindowsGoToTagsAdapterRuntime();
        var inspection = runtime.Inspect(options);
        if (!inspection.Ready)
            throw Error(inspection.ErrorCode ?? "gototags_dependency_unavailable", "GoToTags is not ready for the isolated F8215 gate.");

        var port = ResolvePort();
        var attemptId = RandomIdentity(24);
        var correlationId = RandomIdentity(32);
        var callbackIdentity = RandomIdentity(32);
        var operationName = $"f8215-hardware-gate-{RandomIdentity(12)}.gototags";
        var operationPath = string.Empty;
        using var listener = new HttpListener();
        listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(15));
        var stopwatch = Stopwatch.StartNew();
        try
        {
            listener.Start();
            operationPath = new GoToTagsOperationFactory().Create(
                options,
                operationName,
                attemptId,
                correlationId,
                callbackIdentity,
                NfcProtocol.HardwareGateTestUrl,
                port,
                DateTimeOffset.UtcNow);
            runtime.LaunchOperation(options, operationPath);
            Console.WriteLine("{\"phase\":\"awaiting_manual_start\",\"exactTestUrlPrepared\":true,\"permanentLockRequested\":true,\"verifyAfterWriteRequested\":true}");
            Console.Out.Flush();

            var rejectedCallbacks = 0;
            while (true)
            {
                var context = await listener.GetContextAsync().WaitAsync(timeout.Token);
                var body = await ReadExactCallbackAsync(context, callbackIdentity, port, timeout.Token);
                try
                {
                    try
                    {
                        _ = GoToTagsCallbackParser.Parse(body, correlationId, NfcProtocol.HardwareGateTestUrl);
                        context.Response.StatusCode = (int)HttpStatusCode.NoContent;
                        context.Response.Headers["Cache-Control"] = "no-store";
                        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
                        context.Response.Close();
                        break;
                    }
                    catch (NfcHelperException error)
                    {
                        context.Response.StatusCode = (int)HttpStatusCode.Conflict;
                        context.Response.Headers["Cache-Control"] = "no-store";
                        context.Response.Close();
                        Console.WriteLine(JsonSerializer.Serialize(new
                        {
                            phase = "callback_rejected",
                            errorCode = error.Code,
                            reportedAppVersion = GoToTagsCallbackParser.SafeReportedAppVersion(body),
                        }));
                        Console.Out.Flush();
                        rejectedCallbacks++;
                        if (rejectedCallbacks >= 8)
                            throw Error("gototags_hardware_gate_rejected_callbacks", "The isolated F8215 gate rejected too many callbacks.");
                    }
                }
                finally
                {
                    CryptographicOperations.ZeroMemory(body);
                }
            }

            stopwatch.Stop();
            return new F8215HardwareGateResult(
                "gototags_f8215_two_click_implementation_callback_verified",
                true,
                true,
                true,
                true,
                1,
                stopwatch.ElapsedMilliseconds);
        }
        catch (OperationCanceledException)
        {
            throw Error("gototags_hardware_gate_timeout", "The isolated F8215 hardware gate timed out.");
        }
        finally
        {
            listener.Stop();
            if (!string.IsNullOrEmpty(operationPath) && File.Exists(operationPath)) File.Delete(operationPath);
        }
    }

    private static async Task<byte[]> ReadExactCallbackAsync(
        HttpListenerContext context,
        string callbackIdentity,
        int port,
        CancellationToken cancellationToken)
    {
        var request = context.Request;
        var expectedPath = $"/gototags/callback/{callbackIdentity}";
        if (request.RemoteEndPoint is null || !IPAddress.IsLoopback(request.RemoteEndPoint.Address) ||
            !string.Equals(request.Headers["Host"], $"127.0.0.1:{port}", StringComparison.Ordinal) ||
            !string.Equals(request.HttpMethod, "POST", StringComparison.Ordinal) ||
            !string.Equals(request.Url?.AbsolutePath, expectedPath, StringComparison.Ordinal) ||
            request.Url?.Query.Length > 0 ||
            !string.IsNullOrEmpty(request.Headers["Transfer-Encoding"]) ||
            request.ContentLength64 is < 1 or > NfcProtocol.MaxGoToTagsCallbackBytes ||
            !string.Equals(request.ContentType?.Split(';', 2)[0].Trim(), "application/json", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = (int)HttpStatusCode.BadRequest;
            context.Response.Close();
            throw Error("gototags_callback_boundary_rejected", "The isolated GoToTags callback boundary rejected the request.");
        }

        var expected = checked((int)request.ContentLength64);
        var body = new byte[expected];
        try
        {
            var offset = 0;
            while (offset < expected)
            {
                var read = await request.InputStream.ReadAsync(body.AsMemory(offset, expected - offset), cancellationToken);
                if (read == 0) throw Error("gototags_callback_truncated", "The isolated GoToTags callback was incomplete.");
                offset += read;
            }
            if (request.InputStream.ReadByte() != -1)
                throw Error("gototags_callback_boundary_rejected", "The isolated GoToTags callback exceeded its bound.");
            return body;
        }
        catch
        {
            CryptographicOperations.ZeroMemory(body);
            throw;
        }
    }

    private static int ResolvePort()
    {
        var raw = Environment.GetEnvironmentVariable("TENKINGS_NFC_F8215_HARDWARE_GATE_PORT")?.Trim();
        if (string.IsNullOrEmpty(raw)) return DefaultPort;
        return int.TryParse(raw, out var port) && port is >= 1024 and <= 65535
            ? port
            : throw Error("gototags_configuration_invalid", "The isolated F8215 callback port is invalid.");
    }

    private static string RandomIdentity(int bytes) =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static NfcHelperException Error(string code, string message) => new(code, message, false, 503);
}
