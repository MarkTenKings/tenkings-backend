using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using System.Text.RegularExpressions;

namespace TenKings.AiGrader.NfcHelper;

public sealed partial record NfcHttpServerOptions(
    int Port,
    string AllowedOrigin,
    string WorkstationToken,
    string? PairingCode,
    DateTimeOffset PairingExpiresAt,
    string? PairingConsumptionPath = null)
{
    public static NfcHttpServerOptions FromEnvironment()
    {
        var portText = Environment.GetEnvironmentVariable("TENKINGS_NFC_HELPER_PORT");
        var port = string.IsNullOrWhiteSpace(portText) ? NfcProtocol.DefaultPort :
            int.TryParse(portText, out var parsedPort) ? parsedPort :
            throw new NfcHelperException("invalid_helper_config", "The NFC helper port configuration is invalid.");
        var allowedOrigin = Environment.GetEnvironmentVariable("TENKINGS_NFC_ALLOWED_ORIGIN")?.Trim()
            ?? NfcProtocol.ProductionOrigin;
        var token = Environment.GetEnvironmentVariable("TENKINGS_NFC_HELPER_TOKEN")?.Trim() ?? string.Empty;
        var pairingCode = Environment.GetEnvironmentVariable("TENKINGS_NFC_PAIRING_CODE")?.Trim();
        var expiryText = Environment.GetEnvironmentVariable("TENKINGS_NFC_PAIRING_EXPIRES_AT")?.Trim();
        var expiry = string.IsNullOrWhiteSpace(expiryText)
            ? DateTimeOffset.MinValue
            : DateTimeOffset.TryParse(expiryText, out var parsedExpiry)
                ? parsedExpiry
                : throw new NfcHelperException("invalid_helper_config", "The NFC pairing expiry configuration is invalid.");
        var consumptionPath = Environment.GetEnvironmentVariable("TENKINGS_NFC_PAIRING_CONSUMPTION_PATH")?.Trim();
        var options = new NfcHttpServerOptions(port, allowedOrigin, token, pairingCode, expiry, consumptionPath);
        options.Validate();
        return options;
    }

    public void Validate()
    {
        if (Port is < 1024 or > 65535)
            throw new NfcHelperException("invalid_helper_config", "The NFC helper port must be an unprivileged TCP port.");
        if (!string.Equals(AllowedOrigin, NfcProtocol.ProductionOrigin, StringComparison.Ordinal))
            throw new NfcHelperException("invalid_helper_config", "The NFC helper browser origin must be the exact production origin.");
        if (!SecretPattern().IsMatch(WorkstationToken))
            throw new NfcHelperException("invalid_helper_config", "The NFC helper workstation token configuration is invalid.");
        if (PairingCode is not null && !ContextPattern().IsMatch(PairingCode))
            throw new NfcHelperException("invalid_helper_config", "The NFC helper pairing code configuration is invalid.");
        if (PairingCode is not null && PairingExpiresAt == DateTimeOffset.MinValue)
            throw new NfcHelperException("invalid_helper_config", "The NFC helper pairing expiry is required when pairing is enabled.");
        if (PairingCode is not null &&
            (string.IsNullOrWhiteSpace(PairingConsumptionPath) ||
             PairingConsumptionPath.Length > 512 ||
             !Path.IsPathFullyQualified(PairingConsumptionPath)))
            throw new NfcHelperException("invalid_helper_config", "The NFC helper pairing-consumption path configuration is invalid.");
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{32,160}$", RegexOptions.CultureInvariant)]
    private static partial Regex SecretPattern();
    [GeneratedRegex("^[A-Za-z0-9_-]{8,128}$", RegexOptions.CultureInvariant)]
    private static partial Regex ContextPattern();
}

public sealed class NfcHttpServer : IAsyncDisposable
{
    private const string TokenHeader = "x-tenkings-nfc-token";
    private readonly HttpListener _listener = new();
    private readonly NfcHttpServerOptions _options;
    private readonly NfcOperationsService _operations;
    private readonly F8215JobCoordinator? _f8215;
    private readonly ISafeLogger _logger;
    private readonly ConcurrentDictionary<long, Task> _requests = new();
    private long _requestSequence;
    private int _pairingConsumed;
    private readonly object _pairingGate = new();
    private bool _started;

    public NfcHttpServer(
        NfcHttpServerOptions options,
        NfcOperationsService operations,
        ISafeLogger? logger = null,
        F8215JobCoordinator? f8215 = null)
    {
        options.Validate();
        _options = options;
        _operations = operations;
        _f8215 = f8215;
        _logger = logger ?? new ConsoleSafeLogger();
        _listener.Prefixes.Add($"http://127.0.0.1:{options.Port}/");
        _listener.IgnoreWriteExceptions = true;
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        if (_started) throw new InvalidOperationException("The NFC helper server is already running.");
        _started = true;
        _listener.Start();
        using var registration = cancellationToken.Register(Stop);
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                HttpListenerContext context;
                try
                {
                    context = await _listener.GetContextAsync().WaitAsync(cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    break;
                }
                catch (HttpListenerException) when (cancellationToken.IsCancellationRequested || !_listener.IsListening)
                {
                    break;
                }
                var sequence = Interlocked.Increment(ref _requestSequence);
                var task = ProcessContextAsync(context, cancellationToken);
                _requests[sequence] = task;
                _ = task.ContinueWith(
                    completed => _requests.TryRemove(sequence, out _),
                    CancellationToken.None,
                    TaskContinuationOptions.ExecuteSynchronously,
                    TaskScheduler.Default);
            }
        }
        finally
        {
            Stop();
            await Task.WhenAll(_requests.Values);
        }
    }

    public void Stop()
    {
        if (_listener.IsListening) _listener.Stop();
    }

    private async Task ProcessContextAsync(HttpListenerContext context, CancellationToken serverCancellation)
    {
        var requestId = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(serverCancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(50));
        try
        {
            var path = context.Request.Url?.AbsolutePath ?? string.Empty;
            if (path.StartsWith("/gototags/callback/", StringComparison.Ordinal))
            {
                await HandleGoToTagsCallbackAsync(context, path, requestId, timeout.Token);
                return;
            }
            ValidateNetworkBoundary(context.Request);
            ApplyCors(context.Response);
            if (string.Equals(context.Request.HttpMethod, "OPTIONS", StringComparison.Ordinal))
            {
                ValidatePreflight(context.Request);
                context.Response.StatusCode = (int)HttpStatusCode.NoContent;
                context.Response.Close();
                return;
            }

            switch (path)
            {
                case "/pair":
                    RequireMethod(context.Request, "POST");
                    await HandlePairAsync(context, requestId, timeout.Token);
                    break;
                case "/status":
                    RequireMethod(context.Request, "GET");
                    RequireToken(context.Request);
                    RequireEmptyBody(context.Request);
                    await WriteSuccessAsync(context.Response, Status(), NfcJsonContext.Default.ApiEnvelopeHelperStatusResponse, timeout.Token);
                    break;
                case "/read":
                    RequireMethod(context.Request, "POST");
                    RequireToken(context.Request);
                    var read = await ReadJsonAsync(context.Request, NfcJsonContext.Default.NfcReadRequest, timeout.Token);
                    var readResult = await _operations.ReadAsync(read, requestId, timeout.Token);
                    await WriteSuccessAsync(context.Response, readResult, NfcJsonContext.Default.ApiEnvelopeNfcReadResponse, timeout.Token);
                    break;
                case "/write":
                    RequireMethod(context.Request, "POST");
                    RequireToken(context.Request);
                    var write = await ReadJsonAsync(context.Request, NfcJsonContext.Default.NfcWriteRequest, timeout.Token);
                    var writeResult = await _operations.WriteAsync(write, requestId, timeout.Token);
                    await WriteSuccessAsync(context.Response, writeResult, NfcJsonContext.Default.ApiEnvelopeNfcWriteResponse, timeout.Token);
                    break;
                case "/prepare":
                    RequireMethod(context.Request, "POST");
                    RequireToken(context.Request);
                    var prepare = await ReadJsonAsync(context.Request, NfcJsonContext.Default.F8215PrepareRequest, timeout.Token);
                    var prepareResult = RequireF8215().Prepare(prepare, requestId);
                    await WriteSuccessAsync(context.Response, prepareResult, NfcJsonContext.Default.ApiEnvelopeF8215PrepareResponse, timeout.Token);
                    break;
                case "/operation-status":
                    RequireMethod(context.Request, "POST");
                    RequireToken(context.Request);
                    var operationStatus = await ReadJsonAsync(context.Request, NfcJsonContext.Default.F8215OperationStatusRequest, timeout.Token);
                    var operationStatusResult = RequireF8215().Status(operationStatus);
                    await WriteSuccessAsync(context.Response, operationStatusResult, NfcJsonContext.Default.ApiEnvelopeF8215OperationStatusResponse, timeout.Token);
                    break;
                case "/operation-ack":
                    RequireMethod(context.Request, "POST");
                    RequireToken(context.Request);
                    var acknowledge = await ReadJsonAsync(context.Request, NfcJsonContext.Default.F8215OperationAcknowledgeRequest, timeout.Token);
                    var acknowledgeResult = RequireF8215().Acknowledge(acknowledge, requestId);
                    await WriteSuccessAsync(context.Response, acknowledgeResult, NfcJsonContext.Default.ApiEnvelopeF8215OperationAcknowledgeResponse, timeout.Token);
                    break;
                default:
                    throw new NfcHelperException("route_not_found", "The NFC helper route does not exist.", false, 404);
            }
        }
        catch (JsonException)
        {
            await TryWriteErrorAsync(context.Response, "invalid_json", "The NFC helper request JSON is invalid.", false, 400, CancellationToken.None);
        }
        catch (NfcHelperException error)
        {
            _logger.Error("nfc_http_request_failed", requestId, error.Code);
            await TryWriteErrorAsync(context.Response, error.Code, error.Message, error.Retryable, error.HttpStatus, CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
            _logger.Error("nfc_http_request_failed", requestId, "request_timeout");
            await TryWriteErrorAsync(context.Response, "request_timeout", "The NFC helper request timed out. Keep the same physical tag on the reader and retry the same attempt only after status is no longer busy.", true, 504, CancellationToken.None);
        }
        catch (Exception)
        {
            _logger.Error("nfc_http_request_failed", requestId, "internal_error");
            await TryWriteErrorAsync(context.Response, "internal_error", "The NFC helper could not complete the request.", false, 500, CancellationToken.None);
        }
    }

    private HelperStatusResponse Status()
    {
        var status = _operations.Status();
        var inspection = _f8215?.Inspect() ?? new GoToTagsAdapterInspection(false, "feiju_f8215_disabled");
        return status with
        {
            SupportedProfiles =
            [
                new SupportedNfcProfile(
                    NfcProtocol.ChipType,
                    NfcProtocol.SecurityMode,
                    NfcProtocol.Ntag215ProgrammingProfile,
                    "native_pcsc",
                    true,
                    false),
                new SupportedNfcProfile(
                    NfcProtocol.FeijuChipType,
                    NfcProtocol.SecurityMode,
                    NfcProtocol.FeijuProgrammingProfile,
                    NfcProtocol.FeijuAdapterIdentity,
                    true,
                    true),
                new SupportedNfcProfile(
                    NfcProtocol.Ntag424ChipType,
                    "ntag424_sun_v1",
                    NfcProtocol.Ntag424ProgrammingProfile,
                    "unimplemented",
                    false,
                    false),
            ],
            FeijuF8215Enabled = _f8215?.Enabled == true,
            GoToTagsReady = inspection.Ready,
            GoToTagsErrorCode = inspection.ErrorCode,
        };
    }

    private F8215JobCoordinator RequireF8215() => _f8215 ??
        throw new NfcHelperException("feiju_f8215_disabled", "Feiju F8215 programming is disabled on this workstation.", false, 403);

    private async Task HandleGoToTagsCallbackAsync(
        HttpListenerContext context,
        string path,
        string requestId,
        CancellationToken cancellationToken)
    {
        ValidateGoToTagsBoundary(context.Request);
        var identity = path["/gototags/callback/".Length..];
        if (identity.Length == 0 || identity.Contains('/'))
            throw new NfcHelperException("gototags_callback_not_found", "The GoToTags callback identity is invalid.", false, 404);
        var body = await ReadGoToTagsBodyAsync(context.Request, cancellationToken);
        try
        {
            RequireF8215().AcceptCallback(identity, body, requestId);
            context.Response.StatusCode = (int)HttpStatusCode.NoContent;
            context.Response.Headers["Cache-Control"] = "no-store";
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            context.Response.Close();
        }
        finally
        {
            CryptographicOperations.ZeroMemory(body);
        }
    }

    private void ValidateGoToTagsBoundary(HttpListenerRequest request)
    {
        if (request.RemoteEndPoint is null || !IPAddress.IsLoopback(request.RemoteEndPoint.Address))
            throw new NfcHelperException("loopback_required", "The GoToTags callback accepts loopback requests only.", false, 403);
        if (!string.Equals(request.Headers["Host"], $"127.0.0.1:{_options.Port}", StringComparison.Ordinal))
            throw new NfcHelperException("invalid_host", "The GoToTags callback Host header is not allowed.", false, 403);
        if (!string.Equals(request.HttpMethod, "POST", StringComparison.Ordinal))
            throw new NfcHelperException("method_not_allowed", "The GoToTags callback method is not allowed.", false, 405);
        if (request.Url?.Query.Length > 0)
            throw new NfcHelperException("query_not_allowed", "The GoToTags callback does not accept query parameters.", false, 400);
        if (!string.IsNullOrEmpty(request.Headers["Transfer-Encoding"]) || request.ContentLength64 < 1)
            throw new NfcHelperException("gototags_callback_length_required", "The GoToTags callback requires a bounded content length.", false, 411);
        if (!string.Equals(request.ContentType?.Split(';', 2)[0].Trim(), "application/json", StringComparison.OrdinalIgnoreCase))
            throw new NfcHelperException("content_type_required", "The GoToTags callback accepts application/json only.", false, 415);
    }

    private static async Task<byte[]> ReadGoToTagsBodyAsync(HttpListenerRequest request, CancellationToken cancellationToken)
    {
        if (request.ContentLength64 > NfcProtocol.MaxGoToTagsCallbackBytes)
            throw new NfcHelperException("body_too_large", "The GoToTags callback body is too large.", false, 413);
        var expected = checked((int)request.ContentLength64);
        var body = new byte[expected];
        try
        {
            var offset = 0;
            while (offset < expected)
            {
                var read = await request.InputStream.ReadAsync(body.AsMemory(offset, expected - offset), cancellationToken);
                if (read == 0) throw new NfcHelperException("gototags_callback_truncated", "The GoToTags callback body was incomplete.", false, 400);
                offset += read;
            }
            if (request.InputStream.ReadByte() != -1)
                throw new NfcHelperException("body_too_large", "The GoToTags callback body is too large.", false, 413);
            return body;
        }
        catch
        {
            CryptographicOperations.ZeroMemory(body);
            throw;
        }
    }

    private async Task HandlePairAsync(HttpListenerContext context, string requestId, CancellationToken cancellationToken)
    {
        var request = await ReadJsonAsync(context.Request, NfcJsonContext.Default.PairRequest, cancellationToken);
        if (_options.PairingCode is null || DateTimeOffset.UtcNow > _options.PairingExpiresAt)
            throw new NfcHelperException("pairing_unavailable", "Generate a new NFC workstation pairing code.", false, 401);
        if (!SecureEquals(request.PairingCode, _options.PairingCode))
            throw new NfcHelperException("pairing_code_invalid", "The NFC workstation pairing code is invalid.", false, 401);
        lock (_pairingGate)
        {
            if (_pairingConsumed != 0 || IsPairingPersistentlyConsumed())
                throw new NfcHelperException("pairing_code_consumed", "Generate a new NFC workstation pairing code.", false, 409);
            PersistPairingConsumption();
            _pairingConsumed = 1;
        }
        _logger.Info("nfc_pairing_complete", requestId, "one_time_code_consumed");
        await WriteSuccessAsync(
            context.Response,
            new PairResponse(_options.WorkstationToken),
            NfcJsonContext.Default.ApiEnvelopePairResponse,
            cancellationToken);
    }

    private void ValidateNetworkBoundary(HttpListenerRequest request)
    {
        if (request.RemoteEndPoint is null || !IPAddress.IsLoopback(request.RemoteEndPoint.Address))
            throw new NfcHelperException("loopback_required", "The NFC helper accepts loopback requests only.", false, 403);
        var expectedHost = $"127.0.0.1:{_options.Port}";
        if (!string.Equals(request.Headers["Host"], expectedHost, StringComparison.Ordinal))
            throw new NfcHelperException("invalid_host", "The NFC helper Host header is not allowed.", false, 403);
        if (!string.Equals(request.Headers["Origin"], _options.AllowedOrigin, StringComparison.Ordinal))
            throw new NfcHelperException("invalid_origin", "The NFC helper browser origin is not allowed.", false, 403);
        if (request.Url?.Query.Length > 0)
            throw new NfcHelperException("query_not_allowed", "The NFC helper does not accept query parameters.", false, 400);
    }

    private static void ValidatePreflight(HttpListenerRequest request)
    {
        var method = request.Headers["Access-Control-Request-Method"];
        if (method is not ("GET" or "POST"))
            throw new NfcHelperException("preflight_rejected", "The NFC helper CORS preflight was rejected.", false, 403);
        var headers = request.Headers["Access-Control-Request-Headers"] ?? string.Empty;
        foreach (var header in headers.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!header.Equals("content-type", StringComparison.OrdinalIgnoreCase) &&
                !header.Equals(TokenHeader, StringComparison.OrdinalIgnoreCase))
                throw new NfcHelperException("preflight_rejected", "The NFC helper CORS preflight was rejected.", false, 403);
        }
    }

    private static void ApplyCors(HttpListenerResponse response)
    {
        response.Headers["Access-Control-Allow-Origin"] = NfcProtocol.ProductionOrigin;
        response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
        response.Headers["Access-Control-Allow-Headers"] = $"content-type, {TokenHeader}";
        response.Headers["Access-Control-Allow-Private-Network"] = "true";
        response.Headers["Vary"] = "Origin";
        response.Headers["Cache-Control"] = "no-store";
        response.Headers["X-Content-Type-Options"] = "nosniff";
    }

    private void RequireToken(HttpListenerRequest request)
    {
        var supplied = request.Headers[TokenHeader];
        if (supplied is null || supplied.Length > 192 || !SecureEquals(supplied, _options.WorkstationToken))
            throw new NfcHelperException("workstation_token_invalid", "Pair this NFC workstation before programming.", false, 401);
    }

    private static void RequireMethod(HttpListenerRequest request, string expected)
    {
        if (!string.Equals(request.HttpMethod, expected, StringComparison.Ordinal))
            throw new NfcHelperException("method_not_allowed", "The NFC helper HTTP method is not allowed.", false, 405);
    }

    private static void RequireEmptyBody(HttpListenerRequest request)
    {
        if (request.ContentLength64 > 0)
            throw new NfcHelperException("body_not_allowed", "This NFC helper request does not accept a body.", false, 400);
    }

    private static async Task<T> ReadJsonAsync<T>(
        HttpListenerRequest request,
        JsonTypeInfo<T> typeInfo,
        CancellationToken cancellationToken)
    {
        if (!string.Equals(request.ContentType?.Split(';', 2)[0].Trim(), "application/json", StringComparison.OrdinalIgnoreCase))
            throw new NfcHelperException("content_type_required", "The NFC helper accepts application/json only.", false, 415);
        if (request.ContentLength64 > NfcProtocol.MaxJsonBytes)
            throw new NfcHelperException("body_too_large", "The NFC helper request body is too large.", false, 413);
        using var body = new MemoryStream();
        var buffer = new byte[4096];
        while (true)
        {
            var read = await request.InputStream.ReadAsync(buffer, cancellationToken);
            if (read == 0) break;
            if (body.Length + read > NfcProtocol.MaxJsonBytes)
                throw new NfcHelperException("body_too_large", "The NFC helper request body is too large.", false, 413);
            body.Write(buffer, 0, read);
        }
        if (body.Length == 0) throw new NfcHelperException("body_required", "The NFC helper request body is required.", false, 400);
        body.Position = 0;
        return await JsonSerializer.DeserializeAsync(body, typeInfo, cancellationToken)
            ?? throw new NfcHelperException("invalid_json", "The NFC helper request JSON is invalid.", false, 400);
    }

    private static async Task WriteSuccessAsync<T>(
        HttpListenerResponse response,
        T result,
        JsonTypeInfo<ApiEnvelope<T>> typeInfo,
        CancellationToken cancellationToken)
    {
        response.StatusCode = 200;
        await WriteJsonAsync(response, ApiEnvelope<T>.Success(result), typeInfo, cancellationToken);
    }

    private static async Task TryWriteErrorAsync(
        HttpListenerResponse response,
        string code,
        string message,
        bool retryable,
        int status,
        CancellationToken cancellationToken)
    {
        try
        {
            if (response.OutputStream.CanWrite)
            {
                response.StatusCode = status;
                await WriteJsonAsync(
                    response,
                    ApiEnvelope<object>.Failure(code, message, retryable),
                    NfcJsonContext.Default.ApiEnvelopeObject,
                    cancellationToken);
            }
        }
        catch
        {
            response.Abort();
        }
    }

    private static async Task WriteJsonAsync<T>(
        HttpListenerResponse response,
        T value,
        JsonTypeInfo<T> typeInfo,
        CancellationToken cancellationToken)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, typeInfo);
        if (bytes.Length > NfcProtocol.MaxJsonBytes)
            throw new NfcHelperException("response_too_large", "The NFC helper response exceeded its safety bound.", false, 500);
        response.ContentType = "application/json; charset=utf-8";
        response.ContentLength64 = bytes.Length;
        await response.OutputStream.WriteAsync(bytes, cancellationToken);
        response.Close();
    }

    public static bool SecureEquals(string? left, string? right)
    {
        if (left is null || right is null) return false;
        if (left.Length > 512 || right.Length > 512) return false;
        var leftBytes = SHA256.HashData(Encoding.UTF8.GetBytes(left));
        var rightBytes = SHA256.HashData(Encoding.UTF8.GetBytes(right));
        try
        {
            return CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(leftBytes);
            CryptographicOperations.ZeroMemory(rightBytes);
        }
    }

    private bool IsPairingPersistentlyConsumed()
    {
        try
        {
            if (!File.Exists(_options.PairingConsumptionPath)) return false;
            var persisted = File.ReadAllText(_options.PairingConsumptionPath).Trim();
            return SecureEquals(persisted, PairingFingerprint());
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new NfcHelperException("pairing_state_unavailable", "The NFC helper pairing state is unavailable.", false, 503);
        }
    }

    private void PersistPairingConsumption()
    {
        var path = _options.PairingConsumptionPath!;
        var temporary = path + "." + Convert.ToHexString(RandomNumberGenerator.GetBytes(6)).ToLowerInvariant() + ".tmp";
        try
        {
            var directory = Path.GetDirectoryName(path);
            if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory))
                throw new IOException("Pairing state directory is unavailable.");
            File.WriteAllText(temporary, PairingFingerprint(), new UTF8Encoding(false));
            File.Move(temporary, path, true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new NfcHelperException("pairing_state_unavailable", "The NFC helper pairing state is unavailable.", false, 503);
        }
        finally
        {
            try
            {
                if (File.Exists(temporary)) File.Delete(temporary);
            }
            catch
            {
                // A stale random temporary file contains only a one-way digest, never a token or pairing code.
            }
        }
    }

    private string PairingFingerprint() =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(_options.PairingCode!))).ToLowerInvariant();

    public async ValueTask DisposeAsync()
    {
        Stop();
        if (_requests.Count > 0) await Task.WhenAll(_requests.Values);
        _listener.Close();
    }
}
