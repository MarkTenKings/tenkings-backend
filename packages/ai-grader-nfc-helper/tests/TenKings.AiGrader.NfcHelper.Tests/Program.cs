using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TenKings.AiGrader.NfcHelper;

const string TagId = "0123456789abcdefghijklmnopqrstuv";
const string OtherTagId = "ZYXWVUTSRQPONMLKJIHGFEDCBA987654";
const string Url = NfcProtocol.ProductionUrlPrefix + TagId;
const string OtherUrl = NfcProtocol.ProductionUrlPrefix + OtherTagId;

var tests = new (string Name, Func<Task> Run)[]
{
    ("NDEF URI/TLV and URL digest", TestNdef),
    ("NTAG215 CC and APDU safety", TestLayoutAndCommands),
    ("blank write/readback and redaction", TestWriteAndReadback),
    ("overwrite confirmation", TestOverwrite),
    ("reader and tag failures", TestReaderFailures),
    ("partial write and readback mismatch", TestWriteFailures),
    ("single writer, timeout, and idempotency", TestConcurrency),
    ("approved one-shot hardware gate contract", TestHardwareGate),
    ("loopback HTTP pairing/auth/origin/bounds", TestHttp)
};

var failed = 0;
foreach (var test in tests)
{
    try
    {
        await test.Run();
        Console.WriteLine($"PASS {test.Name}");
    }
    catch (Exception error)
    {
        failed++;
        Console.Error.WriteLine($"FAIL {test.Name}: {error.GetType().Name}: {error.Message}");
    }
}
Console.WriteLine($"{tests.Length - failed}/{tests.Length} NFC helper test groups passed");
return failed == 0 ? 0 : 1;

static Task TestNdef()
{
    var encoded = NdefCodec.EncodeProductionUrl(Url);
    Equal(TagId, encoded.PublicTagId);
    Sequence(
        [0xD1, 0x01, 0x39, 0x55, 0x04],
        encoded.Message.AsSpan(0, 5));
    Equal(NdefCodec.Sha256Hex(Encoding.UTF8.GetBytes(Url)), encoded.PayloadSha256);
    NotEqual(NdefCodec.Sha256Hex(encoded.Message), encoded.PayloadSha256);
    var parsed = NdefCodec.ParseProductionUrl(encoded.Message);
    Equal(Url, parsed.Url);
    Equal(encoded.PayloadSha256, parsed.PayloadSha256);
    Sequence(encoded.Message, parsed.Message);
    var tlv = NdefCodec.EncodeType2Tlv(encoded);
    Equal((byte)0x03, tlv[0]);
    Equal((byte)encoded.Message.Length, tlv[1]);
    Equal((byte)0xFE, tlv[^1]);
    var location = NdefCodec.LocateNdef(tlv);
    True(location.Exists);
    Equal(encoded.Message.Length, location.ValueLength);
    Throws("invalid_nfc_url", () => NdefCodec.EncodeProductionUrl("http://collect.tenkings.co/nfc/" + TagId));
    Throws("invalid_nfc_url", () => NdefCodec.EncodeProductionUrl(Url + "?redirect=https://example.com"));
    Throws("invalid_public_tag_id", () => NdefCodec.EncodeProductionUrl(NfcProtocol.ProductionUrlPrefix + TagId[..31]));
    Throws("invalid_public_tag_id", () => NdefCodec.EncodeProductionUrl(NfcProtocol.HardwareGateTestUrl));
    Throws("unsupported_ndef_record", () => NdefCodec.ParseProductionUrl([0xD1, 0x01, 0x01, 0x54, 0x00]));
    return Task.CompletedTask;
}

static Task TestLayoutAndCommands()
{
    Ntag215Layout.ValidateGetVersion(Ntag215Layout.GetVersionResponse);
    Ntag215Layout.ValidateCapabilityContainer(Ntag215Layout.WritableCapabilityContainer, true);
    Throws("unsupported_tag", () => Ntag215Layout.ValidateGetVersion([0, 1, 2]));
    Throws("invalid_capability_container", () => Ntag215Layout.ValidateCapabilityContainer([0xE1, 0x10, 0x12, 0x00], true));
    Throws("tag_read_only", () => Ntag215Layout.ValidateCapabilityContainer([0xE1, 0x10, 0x3E, 0x0F], true));
    Equal(4, Ntag215Layout.PageForDataOffset(0));
    Equal(127, Ntag215Layout.PageForDataOffset(495));
    Sequence([0xFF, 0x00, 0x00, 0x00, 0x01, 0x60], Acr1552NativeCommands.GetVersion());
    Sequence([0xFF, 0x00, 0x00, 0x00, 0x02, 0x30, 0x7C], Acr1552NativeCommands.Read(124));
    Sequence([0xFF, 0x00, 0x00, 0x00, 0x06, 0xA2, 0x7F, 1, 2, 3, 4], Acr1552NativeCommands.Write(127, [1, 2, 3, 4]));
    Acr1552NativeCommands.RequireWriteAck([0x0A]);
    Throws("unsafe_page_read", () => Acr1552NativeCommands.Read(125));
    Throws("unsafe_page_write", () => Acr1552NativeCommands.Write(128, [1, 2, 3, 4]));
    Throws("tag_write_nak", () => Acr1552NativeCommands.RequireWriteAck([0x00]));
    return Task.CompletedTask;
}

static async Task TestWriteAndReadback()
{
    var backend = new FakeNfcReaderBackend();
    var logger = new CollectingSafeLogger();
    var service = new NfcOperationsService(backend, logger);
    var readBlank = await service.ReadAsync(new("attempt_0001"), "req_read", CancellationToken.None);
    Equal("blank_ntag215", readBlank.ReaderResultCode);
    True(readBlank.NormalizedUrl is null);
    True(backend.LastUidBuffer is not null && backend.LastUidBuffer.All(value => value == 0));
    var writeRequest = new NfcWriteRequest("attempt_0001", "idempotency_0001", Url);
    var written = await service.WriteAsync(writeRequest, "req_write", CancellationToken.None);
    Equal(Url, written.NormalizedUrl);
    Equal(NdefCodec.UrlSha256(Url), written.ReadbackPayloadSha256);
    Equal("NTAG215", written.ChipType);
    Equal("write_verified_pcsc_readback", written.ReaderResultCode);
    True(backend.Writes.Count >= 2);
    Equal(4, backend.Writes[0].Page);
    Equal((byte)0, backend.Writes[0].Data[1]);
    Equal(4, backend.Writes[^1].Page);
    True(backend.Writes[^1].Data[1] > 0);
    True(backend.Writes.All(write => write.Page is >= 4 and <= 127));
    var writeCount = backend.Writes.Count;
    var repeated = await service.WriteAsync(writeRequest, "req_retry", CancellationToken.None);
    Equal(written, repeated);
    Equal(writeCount, backend.Writes.Count);
    var read = await service.ReadAsync(new("attempt_0001"), "req_readback", CancellationToken.None);
    Equal(Url, read.NormalizedUrl);
    Equal(NdefCodec.UrlSha256(Url), read.ReadbackPayloadSha256);
    Equal(written.UidFingerprintSha256, read.UidFingerprintSha256);
    False(logger.Entries.Any(entry => entry.Contains("04112233445566", StringComparison.OrdinalIgnoreCase)));
}

static async Task TestOverwrite()
{
    var backend = new FakeNfcReaderBackend();
    backend.LoadUrl(OtherUrl);
    var service = new NfcOperationsService(backend);
    var required = await service.WriteAsync(new("attempt_0002", "idempotency_0002", Url), "req_overwrite", CancellationToken.None);
    True(required.OverwriteRequired);
    Equal("overwrite_confirmation_required", required.ReaderResultCode);
    True(required.ObservedPayloadSha256 is { Length: 64 });
    Equal(0, backend.Writes.Count);
    await ThrowsAsync("overwrite_confirmation_mismatch", () =>
        service.WriteAsync(
            new("attempt_0002", "idempotency_0003", Url, new(true, new string('0', 64))),
            "req_mismatch",
            CancellationToken.None));
    var written = await service.WriteAsync(
        new("attempt_0002", "idempotency_0004", Url, new(true, required.ObservedPayloadSha256!)),
        "req_confirmed",
        CancellationToken.None);
    Equal(Url, written.NormalizedUrl);
    False(written.OverwriteRequired);
}

static async Task TestReaderFailures()
{
    foreach (var test in new (Action<FakeNfcReaderBackend> Setup, string Code)[]
    {
        (backend => backend.ReaderConnected = false, "reader_disconnected"),
        (backend => backend.PcscReady = false, "pcsc_unavailable"),
        (backend => backend.TagCount = 0, "no_tag"),
        (backend => backend.TagCount = 2, "multiple_tags"),
        (backend => backend.Version = [0, 0, 0, 0, 0, 0, 0, 0], "unsupported_tag")
    })
    {
        var backend = new FakeNfcReaderBackend();
        test.Setup(backend);
        await ThrowsAsync(test.Code, () =>
            new NfcOperationsService(backend).ReadAsync(new("attempt_0003"), "req_failure", CancellationToken.None));
    }
}

static async Task TestWriteFailures()
{
    var partial = new FakeNfcReaderBackend { DisconnectAfterWriteCount = 1 };
    await ThrowsAsync("tag_removed_mid_write", () =>
        new NfcOperationsService(partial).WriteAsync(new("attempt_0004", "idempotency_0005", Url), "req_partial", CancellationToken.None));
    Equal(1, partial.Writes.Count);
    Equal((byte)0, partial.DataArea[1]);
    var corrupt = new FakeNfcReaderBackend { CorruptReadbackAfterWrite = true };
    await ThrowsAsync("readback_mismatch", () =>
        new NfcOperationsService(corrupt).WriteAsync(new("attempt_0004", "idempotency_0006", Url), "req_corrupt", CancellationToken.None));
}

static async Task TestConcurrency()
{
    using var blocker = new ManualResetEventSlim(false);
    var backend = new FakeNfcReaderBackend { WriteBlocker = blocker };
    var service = new NfcOperationsService(backend, operationTimeoutMs: 150);
    var first = service.WriteAsync(new("attempt_0005", "idempotency_0007", Url), "req_blocked", CancellationToken.None);
    await WaitUntil(() => service.Busy);
    await ThrowsAsync("reader_busy", () =>
        service.ReadAsync(new("attempt_0005"), "req_read_contended", CancellationToken.None));
    await ThrowsAsync("writer_busy", () =>
        service.WriteAsync(new("attempt_0005", "idempotency_0008", Url), "req_contended", CancellationToken.None));
    await ThrowsAsync("reader_timeout", () => first);
    True(service.Busy);
    blocker.Set();
    await WaitUntil(() => !service.Busy);
    var recovered = await service.WriteAsync(
        new("attempt_0005", "idempotency_0007", Url),
        "req_recovered",
        CancellationToken.None);
    Equal(Url, recovered.NormalizedUrl);
    var contentionRetry = await service.WriteAsync(
        new("attempt_0005", "idempotency_0008", Url),
        "req_contention_retry",
        CancellationToken.None);
    Equal(Url, contentionRetry.NormalizedUrl);

    using var cancelBlocker = new ManualResetEventSlim(false);
    var cancelBackend = new FakeNfcReaderBackend { WriteBlocker = cancelBlocker };
    var cancelService = new NfcOperationsService(cancelBackend, operationTimeoutMs: 2_000);
    using var cancelled = new CancellationTokenSource();
    var cancelledWrite = cancelService.WriteAsync(
        new("attempt_0005", "idempotency_cancelled", Url),
        "req_cancelled",
        cancelled.Token);
    await WaitUntil(() => cancelService.Busy);
    cancelled.Cancel();
    await ThrowsAsync("request_cancelled", () => cancelledWrite);
    True(cancelService.Busy);
    cancelBlocker.Set();
    await WaitUntil(() => !cancelService.Busy);
    var cancelledRetry = await cancelService.WriteAsync(
        new("attempt_0005", "idempotency_cancelled", Url),
        "req_cancelled_retry",
        CancellationToken.None);
    Equal(Url, cancelledRetry.NormalizedUrl);

    var idempotentBackend = new FakeNfcReaderBackend();
    var idempotentService = new NfcOperationsService(idempotentBackend);
    var request = new NfcWriteRequest("attempt_0006", "idempotency_0009", Url);
    var one = idempotentService.WriteAsync(request, "req_one", CancellationToken.None);
    var two = idempotentService.WriteAsync(request, "req_two", CancellationToken.None);
    await Task.WhenAll(one, two);
    var count = idempotentBackend.Writes.Count;
    True(count > 0);
    Equal(count, idempotentBackend.Writes.Count);
    await ThrowsAsync("idempotency_conflict", () =>
        idempotentService.WriteAsync(new("attempt_0006", "idempotency_0009", OtherUrl), "req_conflict", CancellationToken.None));
}

static async Task TestHardwareGate()
{
    var blankBackend = new FakeNfcReaderBackend();
    var blank = await new NfcOperationsService(blankBackend).RunHardwareGateTestAsync(
        false,
        "hardware_gate_blank",
        CancellationToken.None);
    Equal("hardware_gate_exact_readback_verified", blank.ResultCode);
    True(blank.ReaderDetected && blank.TagRead && blank.WriteAttempted && blank.ExactReadbackVerified);
    False(blank.OverwriteConfirmationRequired);
    True(blankBackend.Writes.All(write => write.Page is >= 4 and <= 127));

    var nonblankBackend = new FakeNfcReaderBackend();
    nonblankBackend.LoadUrl(OtherUrl);
    var service = new NfcOperationsService(nonblankBackend);
    var blocked = await service.RunHardwareGateTestAsync(false, "hardware_gate_blocked", CancellationToken.None);
    True(blocked.OverwriteConfirmationRequired);
    False(blocked.WriteAttempted);
    Equal(0, nonblankBackend.Writes.Count);
    var confirmed = await service.RunHardwareGateTestAsync(true, "hardware_gate_confirmed", CancellationToken.None);
    Equal("hardware_gate_exact_readback_verified", confirmed.ResultCode);
    True(confirmed.WriteAttempted && confirmed.ExactReadbackVerified);
    False(confirmed.OverwriteConfirmationRequired);
}

static async Task TestHttp()
{
    var port = FreePort();
    var token = Base64Url(RandomNumberGenerator.GetBytes(32));
    var code = Base64Url(RandomNumberGenerator.GetBytes(18));
    var pairingState = Path.Combine(Path.GetTempPath(), $"tenkings-nfc-pairing-{Guid.NewGuid():N}.state");
    var options = new NfcHttpServerOptions(port, NfcProtocol.ProductionOrigin, token, code, DateTimeOffset.UtcNow.AddMinutes(5), pairingState);
    var logger = new CollectingSafeLogger();
    var service = new NfcOperationsService(new FakeNfcReaderBackend(), logger);
    await using var server = new NfcHttpServer(options, service, logger);
    using var stop = new CancellationTokenSource();
    var running = server.RunAsync(stop.Token);
    using var client = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{port}") };
    await WaitHttp(client);

    using var wrongOrigin = Request(HttpMethod.Get, "/status", token, "https://example.com");
    using var wrongOriginResponse = await client.SendAsync(wrongOrigin);
    Equal(HttpStatusCode.Forbidden, wrongOriginResponse.StatusCode);
    using var missingToken = Request(HttpMethod.Get, "/status", null);
    using var missingTokenResponse = await client.SendAsync(missingToken);
    Equal(HttpStatusCode.Unauthorized, missingTokenResponse.StatusCode);

    using var pair = Request(HttpMethod.Post, "/pair", null, content: JsonContent.Create(new { pairingCode = code }));
    using var pairResponse = await client.SendAsync(pair);
    Equal(HttpStatusCode.OK, pairResponse.StatusCode);
    var pairJson = JsonDocument.Parse(await pairResponse.Content.ReadAsByteArrayAsync());
    Equal(token, pairJson.RootElement.GetProperty("result").GetProperty("workstationToken").GetString());
    using var replay = Request(HttpMethod.Post, "/pair", null, content: JsonContent.Create(new { pairingCode = code }));
    using var replayResponse = await client.SendAsync(replay);
    Equal(HttpStatusCode.Conflict, replayResponse.StatusCode);

    using var status = Request(HttpMethod.Get, "/status", token);
    using var statusResponse = await client.SendAsync(status);
    Equal(HttpStatusCode.OK, statusResponse.StatusCode);
    var statusText = await statusResponse.Content.ReadAsStringAsync();
    False(statusText.Contains(token, StringComparison.Ordinal));
    False(statusText.Contains("04112233445566", StringComparison.OrdinalIgnoreCase));

    using var tooLarge = Request(
        HttpMethod.Post,
        "/read",
        token,
        content: new StringContent($"{{\"attemptId\":\"{new string('a', NfcProtocol.MaxJsonBytes)}\"}}", Encoding.UTF8, "application/json"));
    using var tooLargeResponse = await client.SendAsync(tooLarge);
    Equal(HttpStatusCode.RequestEntityTooLarge, tooLargeResponse.StatusCode);

    using var preflight = Request(HttpMethod.Options, "/write", null);
    preflight.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "POST");
    preflight.Headers.TryAddWithoutValidation("Access-Control-Request-Headers", "content-type,x-tenkings-nfc-token");
    using var preflightResponse = await client.SendAsync(preflight);
    Equal(HttpStatusCode.NoContent, preflightResponse.StatusCode);

    stop.Cancel();
    await running;
    False(logger.Entries.Any(entry => entry.Contains(token, StringComparison.Ordinal) || entry.Contains(code, StringComparison.Ordinal)));
    True(File.Exists(pairingState));
    False(File.ReadAllText(pairingState).Contains(code, StringComparison.Ordinal));

    var restartPort = FreePort();
    var restartOptions = options with { Port = restartPort };
    await using var restartedServer = new NfcHttpServer(restartOptions, new NfcOperationsService(new FakeNfcReaderBackend()), logger);
    using var restartStop = new CancellationTokenSource();
    var restarted = restartedServer.RunAsync(restartStop.Token);
    using var restartClient = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{restartPort}") };
    await WaitHttp(restartClient);
    using var persistedReplay = Request(HttpMethod.Post, "/pair", null, content: JsonContent.Create(new { pairingCode = code }));
    using var persistedReplayResponse = await restartClient.SendAsync(persistedReplay);
    Equal(HttpStatusCode.Conflict, persistedReplayResponse.StatusCode);
    restartStop.Cancel();
    await restarted;
    File.Delete(pairingState);
}

static HttpRequestMessage Request(
    HttpMethod method,
    string path,
    string? token,
    string origin = NfcProtocol.ProductionOrigin,
    HttpContent? content = null)
{
    var request = new HttpRequestMessage(method, path) { Content = content };
    request.Headers.TryAddWithoutValidation("Origin", origin);
    if (token is not null) request.Headers.TryAddWithoutValidation("x-tenkings-nfc-token", token);
    return request;
}

static async Task WaitHttp(HttpClient client)
{
    for (var attempt = 0; attempt < 50; attempt++)
    {
        try
        {
            using var request = Request(HttpMethod.Get, "/status", "invalid_token_00000000000000000000");
            using var response = await client.SendAsync(request);
            return;
        }
        catch (HttpRequestException)
        {
            await Task.Delay(20);
        }
    }
    throw new Exception("HTTP helper did not start.");
}

static int FreePort()
{
    var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    var port = ((IPEndPoint)listener.LocalEndpoint).Port;
    listener.Stop();
    return port;
}

static string Base64Url(byte[] bytes) =>
    Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

static async Task WaitUntil(Func<bool> condition)
{
    for (var attempt = 0; attempt < 200; attempt++)
    {
        if (condition()) return;
        await Task.Delay(10);
    }
    throw new Exception("Condition was not reached.");
}

static void True(bool condition)
{
    if (!condition) throw new Exception("Expected true.");
}

static void False(bool condition) => True(!condition);

static void Equal<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
        throw new Exception($"Expected {expected}, got {actual}.");
}

static void NotEqual<T>(T first, T second)
{
    if (EqualityComparer<T>.Default.Equals(first, second))
        throw new Exception($"Expected unequal values, got {first}.");
}

static void Sequence(ReadOnlySpan<byte> expected, ReadOnlySpan<byte> actual)
{
    if (!expected.SequenceEqual(actual))
        throw new Exception($"Expected {Convert.ToHexString(expected)}, got {Convert.ToHexString(actual)}.");
}

static void Throws(string code, Action action)
{
    try
    {
        action();
    }
    catch (NfcHelperException error) when (error.Code == code)
    {
        return;
    }
    throw new Exception($"Expected NFC error {code}.");
}

static async Task ThrowsAsync(string code, Func<Task> action)
{
    try
    {
        await action();
    }
    catch (NfcHelperException error) when (error.Code == code)
    {
        return;
    }
    throw new Exception($"Expected NFC error {code}.");
}
