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
const string Challenge = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const string OtherChallenge = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";

var tests = new (string Name, Func<Task> Run)[]
{
    ("hardware-free staged build verification", TestBuildVerification),
    ("operational attestation canonical signing and tamper", TestAttestation),
    ("NDEF URI/TLV and URL digest", TestNdef),
    ("NTAG215 CC and APDU safety", TestLayoutAndCommands),
    ("blank write/readback and redaction", TestWriteAndReadback),
    ("overwrite confirmation", TestOverwrite),
    ("reader and tag failures", TestReaderFailures),
    ("partial write and readback mismatch", TestWriteFailures),
    ("single writer, timeout, and idempotency", TestConcurrency),
    ("definite pre-write retry and uncertain failure recovery", TestRetryClassification),
    ("approved one-shot hardware gate contract", TestHardwareGate),
    ("loopback HTTP pairing/auth/origin/bounds", TestHttp),
    ("Windows CNG and installer static safety contracts", TestProvisioningContracts)
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
        Console.Error.WriteLine($"FAIL {test.Name}: {error}");
    }
}
Console.WriteLine($"{tests.Length - failed}/{tests.Length} NFC helper test groups passed");
return failed == 0 ? 0 : 1;

static Task TestBuildVerification()
{
    var result = NfcBuildVerification.Verify();
    True(result.Ok);
    Equal(NfcProtocol.HelperVersion, result.HelperVersion);
    Equal(NfcProtocol.ProtocolVersion, result.HelperProtocolVersion);
    Equal(NfcProtocol.AttestationSchemaVersion, result.AttestationSchemaVersion);
    Equal(NfcProtocol.AttestationAlgorithm, result.AttestationAlgorithm);
    False(result.HardwareAccessed);
    False(result.ProductionKeyAccessed);
    return Task.CompletedTask;
}

static Task TestAttestation()
{
    using var signer = new EphemeralTestWorkstationAttestationSigner();
    var fields = new WorkstationAttestationFields(
        "attempt_attestation_0001",
        Challenge,
        TagId,
        Url,
        new string('a', 64),
        NdefCodec.UrlSha256(Url),
        "write_verified_pcsc_readback",
        NfcProtocol.ProtocolVersion,
        "2026-07-13T12:34:56.789Z");
    var canonical = WorkstationAttestation.CanonicalStatement(fields);
    Equal(
        string.Join('\n',
            "ai-grader-nfc-helper-attestation-v1",
            "attempt_attestation_0001",
            Challenge,
            TagId,
            Url,
            new string('a', 64),
            NdefCodec.UrlSha256(Url),
            "write_verified_pcsc_readback",
            "tenkings-ai-grader-nfc-loopback-v2",
            "2026-07-13T12:34:56.789Z"),
        canonical);
    False(canonical.EndsWith('\n'));

    var attestation = WorkstationAttestation.Create(signer, fields);
    Equal(NfcProtocol.AttestationSchemaVersion, attestation.SchemaVersion);
    Equal(NfcProtocol.AttestationAlgorithm, attestation.Algorithm);
    Equal(Challenge, attestation.AttestationChallenge);
    Equal(86, attestation.Signature.Length);
    False(attestation.Signature.Contains('='));
    Equal(1, signer.SignCount);
    var spki = signer.ExportPublicSpki();
    try
    {
        Equal(WorkstationAttestation.KeyId(spki), attestation.WorkstationKeyId);
        True(WorkstationAttestation.Verify(spki, fields, attestation.Signature));
        foreach (var tampered in new[]
        {
            fields with { AttemptId = "attempt_attestation_0002" },
            fields with { AttestationChallenge = OtherChallenge },
            fields with { PublicTagId = OtherTagId, NormalizedUrl = OtherUrl },
            fields with { UidFingerprintSha256 = new string('b', 64) },
            fields with { ReadbackPayloadSha256 = new string('c', 64) },
            fields with { ReaderResultCode = "already_programmed_exact" },
            fields with { ObservedAt = "2026-07-13T12:34:57.789Z" }
        })
        {
            False(WorkstationAttestation.Verify(spki, tampered, attestation.Signature));
        }
        var changedSignature = attestation.Signature[..^1] + (attestation.Signature[^1] == 'A' ? "B" : "A");
        False(WorkstationAttestation.Verify(spki, fields, changedSignature));
        False(WorkstationAttestation.Verify(spki, fields, null));
        False(WorkstationAttestation.Verify(
            spki,
            fields with { HelperProtocolVersion = "tenkings-ai-grader-nfc-loopback-v1" },
            attestation.Signature));
    }
    finally
    {
        CryptographicOperations.ZeroMemory(spki);
    }

    Throws(
        "invalid_attestation_context",
        () => WorkstationAttestation.CanonicalStatement(fields with { HelperProtocolVersion = "tenkings-ai-grader-nfc-loopback-v1" }));
    Throws(
        "invalid_attestation_context",
        () => WorkstationAttestation.CanonicalStatement(fields with { NormalizedUrl = OtherUrl }));
    Throws(
        "invalid_attestation_context",
        () => WorkstationAttestation.CanonicalStatement(fields with { ObservedAt = "2026-07-13T12:34:56+00:00" }));
    return Task.CompletedTask;
}

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
    using var signer = new EphemeralTestWorkstationAttestationSigner();
    var service = new NfcOperationsService(backend, signer, logger);
    await ThrowsAsync("invalid_request_context", () =>
        service.WriteAsync(
            new NfcWriteRequest(
                "attempt_0001",
                "idempotency_wrong_tag",
                OtherTagId,
                Challenge,
                Url),
            "req_wrong_tag",
            CancellationToken.None));
    await ThrowsAsync("invalid_attestation_context", () =>
        service.WriteAsync(
            new NfcWriteRequest(
                "attempt_0001",
                "idempotency_wrong_challenge",
                TagId,
                Challenge[..^1],
                Url),
            "req_wrong_challenge",
            CancellationToken.None));
    Equal(0, signer.SignCount);
    Equal(0, backend.Writes.Count);
    var readBlank = await service.ReadAsync(new("attempt_0001"), "req_read", CancellationToken.None);
    Equal("blank_ntag215", readBlank.ReaderResultCode);
    True(readBlank.NormalizedUrl is null);
    True(backend.LastUidBuffer is not null && backend.LastUidBuffer.All(value => value == 0));
    var writeRequest = WriteRequest("attempt_0001", "idempotency_0001");
    var written = await service.WriteAsync(writeRequest, "req_write", CancellationToken.None);
    Equal(Url, written.NormalizedUrl);
    Equal(NdefCodec.UrlSha256(Url), written.ReadbackPayloadSha256);
    Equal("NTAG215", written.ChipType);
    Equal("write_verified_pcsc_readback", written.ReaderResultCode);
    True(written.OperationalAttestation is not null);
    Equal(Challenge, written.OperationalAttestation!.AttestationChallenge);
    Equal(1, signer.SignCount);
    True(backend.Writes.Count >= 2);
    Equal(4, backend.Writes[0].Page);
    Equal((byte)0, backend.Writes[0].Data[1]);
    Equal(4, backend.Writes[^1].Page);
    True(backend.Writes[^1].Data[1] > 0);
    True(backend.Writes.All(write => write.Page is >= 4 and <= 127));
    var writeCount = backend.Writes.Count;
    var repeated = await service.WriteAsync(writeRequest, "req_retry", CancellationToken.None);
    Equal(written, repeated);
    Equal(1, signer.SignCount);
    Equal(writeCount, backend.Writes.Count);
    var read = await service.ReadAsync(new("attempt_0001"), "req_readback", CancellationToken.None);
    Equal(Url, read.NormalizedUrl);
    Equal(NdefCodec.UrlSha256(Url), read.ReadbackPayloadSha256);
    Equal(written.UidFingerprintSha256, read.UidFingerprintSha256);
    False(logger.Entries.Any(entry => entry.Contains("04112233445566", StringComparison.OrdinalIgnoreCase)));
    False(logger.Entries.Any(entry =>
        entry.Contains(Challenge, StringComparison.Ordinal) ||
        entry.Contains(written.OperationalAttestation.Signature, StringComparison.Ordinal) ||
        entry.Contains(written.OperationalAttestation.WorkstationKeyId, StringComparison.Ordinal)));

    var exactAgain = await service.WriteAsync(
        WriteRequest("attempt_0001", "idempotency_exact_again"),
        "req_exact_again",
        CancellationToken.None);
    Equal("already_programmed_exact", exactAgain.ReaderResultCode);
    True(exactAgain.OperationalAttestation is not null);
    Equal(2, signer.SignCount);
    Equal(writeCount, backend.Writes.Count);
}

static async Task TestOverwrite()
{
    var backend = new FakeNfcReaderBackend();
    backend.LoadUrl(OtherUrl);
    using var signer = new EphemeralTestWorkstationAttestationSigner();
    var service = new NfcOperationsService(backend, signer);
    var required = await service.WriteAsync(WriteRequest("attempt_0002", "idempotency_0002"), "req_overwrite", CancellationToken.None);
    True(required.OverwriteRequired);
    Equal("overwrite_confirmation_required", required.ReaderResultCode);
    True(required.OperationalAttestation is null);
    Equal(0, signer.SignCount);
    True(required.ObservedPayloadSha256 is { Length: 64 });
    Equal(0, backend.Writes.Count);
    await ThrowsAsync("overwrite_confirmation_mismatch", () =>
        service.WriteAsync(
            WriteRequest("attempt_0002", "idempotency_0003", overwrite: new(true, new string('0', 64))),
            "req_mismatch",
            CancellationToken.None));
    var written = await service.WriteAsync(
        WriteRequest("attempt_0002", "idempotency_0004", overwrite: new(true, required.ObservedPayloadSha256!)),
        "req_confirmed",
        CancellationToken.None);
    Equal(Url, written.NormalizedUrl);
    False(written.OverwriteRequired);
    True(written.OperationalAttestation is not null);
    Equal(1, signer.SignCount);
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
    using var partialSigner = new EphemeralTestWorkstationAttestationSigner();
    await ThrowsAsync("tag_removed_mid_write", () =>
        new NfcOperationsService(partial, partialSigner).WriteAsync(
            WriteRequest("attempt_0004", "idempotency_0005"),
            "req_partial",
            CancellationToken.None));
    Equal(1, partial.Writes.Count);
    Equal((byte)0, partial.DataArea[1]);
    Equal(0, partialSigner.SignCount);
    var corrupt = new FakeNfcReaderBackend { CorruptReadbackAfterWrite = true };
    using var corruptSigner = new EphemeralTestWorkstationAttestationSigner();
    await ThrowsAsync("readback_mismatch", () =>
        new NfcOperationsService(corrupt, corruptSigner).WriteAsync(
            WriteRequest("attempt_0004", "idempotency_0006"),
            "req_corrupt",
            CancellationToken.None));
    Equal(0, corruptSigner.SignCount);

    var recoverableCorrupt = new FakeNfcReaderBackend { CorruptReadbackAfterWrite = true };
    using var recoverableCorruptSigner = new EphemeralTestWorkstationAttestationSigner();
    var recoverableCorruptService = new NfcOperationsService(recoverableCorrupt, recoverableCorruptSigner);
    var recoverableCorruptRequest = WriteRequest("attempt_0004", "idempotency_0006_recovery");
    await ThrowsAsync("readback_mismatch", () =>
        recoverableCorruptService.WriteAsync(
            recoverableCorruptRequest,
            "req_corrupt_recoverable",
            CancellationToken.None));
    var writesBeforeRecovery = recoverableCorrupt.Writes.Count;
    Equal(0, recoverableCorruptSigner.SignCount);
    recoverableCorrupt.CorruptReadbackAfterWrite = false;
    var recovered = await recoverableCorruptService.WriteAsync(
        recoverableCorruptRequest,
        "req_corrupt_exact_retry",
        CancellationToken.None);
    Equal("already_programmed_exact", recovered.ReaderResultCode);
    Equal(writesBeforeRecovery, recoverableCorrupt.Writes.Count);
    Equal(1, recoverableCorruptSigner.SignCount);
}

static async Task TestConcurrency()
{
    using var blocker = new ManualResetEventSlim(false);
    var backend = new FakeNfcReaderBackend { WriteBlocker = blocker };
    using var signer = new EphemeralTestWorkstationAttestationSigner();
    var service = new NfcOperationsService(backend, signer, operationTimeoutMs: 150);
    var firstRequest = WriteRequest("attempt_0005", "idempotency_0007");
    var first = service.WriteAsync(firstRequest, "req_blocked", CancellationToken.None);
    await WaitUntil(() => service.Busy);
    await ThrowsAsync("reader_busy", () =>
        service.ReadAsync(new("attempt_0005"), "req_read_contended", CancellationToken.None));
    await ThrowsAsync("writer_busy", () =>
        service.WriteAsync(WriteRequest("attempt_0005", "idempotency_0008"), "req_contended", CancellationToken.None));
    var timeoutError = await ThrowsAsync("reader_timeout", () => first);
    True(timeoutError.Message.Contains("Keep the same physical tag", StringComparison.Ordinal));
    True(!timeoutError.Message.Contains("remove the tag", StringComparison.OrdinalIgnoreCase));
    Equal(0, signer.SignCount);
    True(service.Busy);
    blocker.Set();
    await WaitUntil(() => !service.Busy);
    var recovered = await service.WriteAsync(
        firstRequest,
        "req_recovered",
        CancellationToken.None);
    Equal(Url, recovered.NormalizedUrl);
    Equal(1, signer.SignCount);
    var recoveredWriteCount = backend.Writes.Count;
    var cachedRecovery = await service.WriteAsync(
        firstRequest,
        "req_recovered_cached",
        CancellationToken.None);
    Equal(recovered, cachedRecovery);
    Equal(recoveredWriteCount, backend.Writes.Count);
    Equal(1, signer.SignCount);
    var contentionRetry = await service.WriteAsync(
        WriteRequest("attempt_0005", "idempotency_0008"),
        "req_contention_retry",
        CancellationToken.None);
    Equal(Url, contentionRetry.NormalizedUrl);

    using var cancelBlocker = new ManualResetEventSlim(false);
    var cancelBackend = new FakeNfcReaderBackend { WriteBlocker = cancelBlocker };
    using var cancelSigner = new EphemeralTestWorkstationAttestationSigner();
    var cancelService = new NfcOperationsService(cancelBackend, cancelSigner, operationTimeoutMs: 2_000);
    using var cancelled = new CancellationTokenSource();
    var cancelledWrite = cancelService.WriteAsync(
        WriteRequest("attempt_0005", "idempotency_cancelled"),
        "req_cancelled",
        cancelled.Token);
    await WaitUntil(() => cancelService.Busy);
    cancelled.Cancel();
    var cancellationError = await ThrowsAsync("request_cancelled", () => cancelledWrite);
    True(cancellationError.Message.Contains("Keep the same physical tag", StringComparison.Ordinal));
    True(cancelService.Busy);
    cancelBlocker.Set();
    await WaitUntil(() => !cancelService.Busy);
    var cancelledRetry = await cancelService.WriteAsync(
        WriteRequest("attempt_0005", "idempotency_cancelled"),
        "req_cancelled_retry",
        CancellationToken.None);
    Equal(Url, cancelledRetry.NormalizedUrl);

    var idempotentBackend = new FakeNfcReaderBackend();
    using var idempotentSigner = new EphemeralTestWorkstationAttestationSigner();
    var idempotentService = new NfcOperationsService(idempotentBackend, idempotentSigner);
    var request = WriteRequest("attempt_0006", "idempotency_0009");
    var one = idempotentService.WriteAsync(request, "req_one", CancellationToken.None);
    var two = idempotentService.WriteAsync(request, "req_two", CancellationToken.None);
    await Task.WhenAll(one, two);
    var count = idempotentBackend.Writes.Count;
    True(count > 0);
    Equal(count, idempotentBackend.Writes.Count);
    Equal(1, idempotentSigner.SignCount);
    await ThrowsAsync("idempotency_conflict", () =>
        idempotentService.WriteAsync(
            WriteRequest("attempt_0006", "idempotency_0009", OtherUrl),
            "req_conflict",
            CancellationToken.None));
    await ThrowsAsync("idempotency_conflict", () =>
        idempotentService.WriteAsync(
            WriteRequest("attempt_0006", "idempotency_0009", challenge: OtherChallenge),
            "req_challenge_conflict",
            CancellationToken.None));
}

static async Task TestRetryClassification()
{
    var definiteBackend = new FakeNfcReaderBackend { TagCount = 0 };
    using var definiteSigner = new EphemeralTestWorkstationAttestationSigner();
    var definiteService = new NfcOperationsService(definiteBackend, definiteSigner);
    var definiteRequest = WriteRequest("attempt_retry_0001", "idempotency_retry_0001");
    await ThrowsAsync("no_tag", () =>
        definiteService.WriteAsync(definiteRequest, "req_no_tag", CancellationToken.None));
    Equal(0, definiteSigner.SignCount);
    definiteBackend.TagCount = 1;
    var recovered = await definiteService.WriteAsync(definiteRequest, "req_tag_present", CancellationToken.None);
    Equal("write_verified_pcsc_readback", recovered.ReaderResultCode);
    Equal(1, definiteSigner.SignCount);

    var uncertainBackend = new FakeNfcReaderBackend { DisconnectAfterWriteCount = 1 };
    using var uncertainSigner = new EphemeralTestWorkstationAttestationSigner();
    var uncertainService = new NfcOperationsService(uncertainBackend, uncertainSigner);
    var uncertainRequest = WriteRequest("attempt_retry_0002", "idempotency_retry_0002");
    await ThrowsAsync("tag_removed_mid_write", () =>
        uncertainService.WriteAsync(uncertainRequest, "req_partial_first", CancellationToken.None));
    var writesAfterFailure = uncertainBackend.Writes.Count;
    True(writesAfterFailure > 0);
    uncertainBackend.ReaderConnected = true;
    uncertainBackend.DisconnectAfterWriteCount = -1;
    var recoveredPartial = await uncertainService.WriteAsync(
        uncertainRequest,
        "req_partial_exact_retry",
        CancellationToken.None);
    Equal("write_verified_pcsc_readback", recoveredPartial.ReaderResultCode);
    True(recoveredPartial.OperationalAttestation is not null);
    True(uncertainBackend.Writes.Count > writesAfterFailure);
    Equal(1, uncertainSigner.SignCount);
    var recoveredWriteCount = uncertainBackend.Writes.Count;
    var cachedPartial = await uncertainService.WriteAsync(
        uncertainRequest,
        "req_partial_exact_cached",
        CancellationToken.None);
    Equal(recoveredPartial, cachedPartial);
    Equal(recoveredWriteCount, uncertainBackend.Writes.Count);
    Equal(1, uncertainSigner.SignCount);

    var swappedBackend = new FakeNfcReaderBackend { DisconnectAfterWriteCount = 1 };
    using var swappedSigner = new EphemeralTestWorkstationAttestationSigner();
    var swappedService = new NfcOperationsService(swappedBackend, swappedSigner);
    var swappedRequest = WriteRequest("attempt_retry_0003", "idempotency_retry_0003");
    await ThrowsAsync("tag_removed_mid_write", () =>
        swappedService.WriteAsync(swappedRequest, "req_swapped_partial", CancellationToken.None));
    var swappedWrites = swappedBackend.Writes.Count;
    swappedBackend.ReaderConnected = true;
    swappedBackend.DisconnectAfterWriteCount = -1;
    swappedBackend.Uid = [0x04, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22];
    var swappedTag = await swappedService.WriteAsync(
        swappedRequest,
        "req_swapped_uid_retry",
        CancellationToken.None);
    True(swappedTag.OverwriteRequired);
    True(swappedTag.OperationalAttestation is null);
    Equal(swappedWrites, swappedBackend.Writes.Count);
    Equal(0, swappedSigner.SignCount);
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
    using var signer = new EphemeralTestWorkstationAttestationSigner();
    var service = new NfcOperationsService(new FakeNfcReaderBackend(), signer, logger);
    await using var server = new NfcHttpServer(options, service, logger);
    using var stop = new CancellationTokenSource();
    var running = server.RunAsync(stop.Token);
    using var client = new HttpClient
    {
        BaseAddress = new Uri($"http://127.0.0.1:{port}"),
        Timeout = TimeSpan.FromSeconds(2)
    };
    await WaitHttp(client, running);

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
    False(statusText.Contains(signer.WorkstationKeyId, StringComparison.Ordinal));

    var httpWriteRequest = WriteRequest("attempt_http_0001", "idempotency_http_0001");
    using var write = Request(
        HttpMethod.Post,
        "/write",
        token,
        content: JsonContent.Create(httpWriteRequest, NfcJsonContext.Default.NfcWriteRequest));
    using var writeResponse = await client.SendAsync(write);
    Equal(HttpStatusCode.OK, writeResponse.StatusCode);
    var writeText = await writeResponse.Content.ReadAsStringAsync();
    using var writeJson = JsonDocument.Parse(writeText);
    var writeResult = writeJson.RootElement.GetProperty("result");
    Equal("write_verified_pcsc_readback", writeResult.GetProperty("readerResultCode").GetString());
    var operationalAttestation = writeResult.GetProperty("operationalAttestation");
    Equal(NfcProtocol.AttestationSchemaVersion, operationalAttestation.GetProperty("schemaVersion").GetString());
    Equal(NfcProtocol.AttestationAlgorithm, operationalAttestation.GetProperty("algorithm").GetString());
    Equal(Challenge, operationalAttestation.GetProperty("attestationChallenge").GetString());
    Equal(86, operationalAttestation.GetProperty("signature").GetString()!.Length);
    Equal(1, signer.SignCount);

    using var extraCommand = Request(
        HttpMethod.Post,
        "/read",
        token,
        content: new StringContent(
            """{"attemptId":"attempt_extra_0001","apdu":"FF000000"}""",
            Encoding.UTF8,
            "application/json"));
    using var extraCommandResponse = await client.SendAsync(extraCommand);
    Equal(HttpStatusCode.BadRequest, extraCommandResponse.StatusCode);

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
    False(logger.Entries.Any(entry =>
        entry.Contains(token, StringComparison.Ordinal) ||
        entry.Contains(code, StringComparison.Ordinal) ||
        entry.Contains(Challenge, StringComparison.Ordinal) ||
        entry.Contains(operationalAttestation.GetProperty("signature").GetString()!, StringComparison.Ordinal) ||
        entry.Contains(operationalAttestation.GetProperty("workstationKeyId").GetString()!, StringComparison.Ordinal)));
    True(File.Exists(pairingState));
    False(File.ReadAllText(pairingState).Contains(code, StringComparison.Ordinal));

    var restartPort = FreePort();
    var restartOptions = options with { Port = restartPort };
    using var restartSigner = new EphemeralTestWorkstationAttestationSigner();
    await using var restartedServer = new NfcHttpServer(
        restartOptions,
        new NfcOperationsService(new FakeNfcReaderBackend(), restartSigner),
        logger);
    using var restartStop = new CancellationTokenSource();
    var restarted = restartedServer.RunAsync(restartStop.Token);
    using var restartClient = new HttpClient
    {
        BaseAddress = new Uri($"http://127.0.0.1:{restartPort}"),
        Timeout = TimeSpan.FromSeconds(2)
    };
    await WaitHttp(restartClient, restarted);
    using var persistedReplay = Request(HttpMethod.Post, "/pair", null, content: JsonContent.Create(new { pairingCode = code }));
    using var persistedReplayResponse = await restartClient.SendAsync(persistedReplay);
    Equal(HttpStatusCode.Conflict, persistedReplayResponse.StatusCode);
    restartStop.Cancel();
    await restarted;
    File.Delete(pairingState);
}

static Task TestProvisioningContracts()
{
    if (OperatingSystem.IsWindows())
    {
        var parameters = WindowsCngWorkstationAttestationSigner.CreateKeyCreationParameters();
        Equal(CngProvider.MicrosoftSoftwareKeyStorageProvider, parameters.Provider);
        Equal(CngExportPolicies.None, parameters.ExportPolicy);
        Equal(CngKeyUsages.Signing, parameters.KeyUsage);
        Equal(CngKeyCreationOptions.None, parameters.KeyCreationOptions);
        Throws(
            "attestation_key_invalid",
            () => WindowsCngWorkstationAttestationSigner.Open("not-the-approved-key", new string('0', 64)));
    }
    else
    {
        Throws("windows_required", () => WindowsCngWorkstationAttestationSigner.EnsureNamedKey());
        Throws(
            "windows_required",
            () => WindowsCngWorkstationAttestationSigner.Open(NfcProtocol.WorkstationKeyName, new string('0', 64)));
    }

    var root = FindRepoRoot();
    var signerSource = File.ReadAllText(Path.Combine(
        root,
        "packages",
        "ai-grader-nfc-helper",
        "src",
        "TenKings.AiGrader.NfcHelper",
        "WindowsCngWorkstationAttestationSigner.cs"));
    True(signerSource.Contains("CngExportPolicies.None", StringComparison.Ordinal));
    True(signerSource.Contains("CngKey.Exists", StringComparison.Ordinal));
    True(signerSource.Contains("CngKeyCreationOptions.None", StringComparison.Ordinal));
    True(signerSource.Contains("CngKeyUsages.Signing", StringComparison.Ordinal));
    False(signerSource.Contains("OverwriteExistingKey", StringComparison.Ordinal));
    False(signerSource.Contains("CngKeyCreationOptions.MachineKey", StringComparison.Ordinal));
    False(signerSource.Contains("EccPrivateBlob", StringComparison.Ordinal));
    False(signerSource.Contains("ExportPkcs8PrivateKey", StringComparison.Ordinal));

    var install = File.ReadAllText(Path.Combine(root, "scripts", "ai-grader-nfc", "install-ai-grader-nfc-helper.ps1"));
    var common = File.ReadAllText(Path.Combine(root, "scripts", "ai-grader-nfc", "ai-grader-nfc-helper-common.ps1"));
    var start = File.ReadAllText(Path.Combine(root, "scripts", "ai-grader-nfc", "start-ai-grader-nfc-helper.ps1"));
    var export = File.ReadAllText(Path.Combine(root, "scripts", "ai-grader-nfc", "export-ai-grader-nfc-workstation-public-key.ps1"));
    var update = File.ReadAllText(Path.Combine(root, "scripts", "ai-grader-nfc", "update-ai-grader-nfc-helper.ps1"));
    var rotate = File.ReadAllText(Path.Combine(root, "scripts", "ai-grader-nfc", "rotate-ai-grader-nfc-helper-token.ps1"));
    True(install.Contains("--ensure-workstation-attestation-key", StringComparison.Ordinal));
    True(common.Contains("workstationKeyName", StringComparison.Ordinal));
    True(common.Contains("workstationKeyId", StringComparison.Ordinal));
    True(start.Contains("TENKINGS_NFC_WORKSTATION_KEY_NAME", StringComparison.Ordinal));
    True(start.Contains("TENKINGS_NFC_WORKSTATION_KEY_ID", StringComparison.Ordinal));
    True(export.Contains("--export-workstation-attestation-public-key", StringComparison.Ordinal));
    True(update.Contains("Invoke-NfcWithWorkstationKeyEnvironment", StringComparison.Ordinal));
    True(export.Contains("Invoke-NfcWithWorkstationKeyEnvironment", StringComparison.Ordinal));
    False(update.Contains(@"Remove-Item Env:\TENKINGS_NFC_WORKSTATION_KEY", StringComparison.Ordinal));
    False(export.Contains(@"Remove-Item Env:\TENKINGS_NFC_WORKSTATION_KEY", StringComparison.Ordinal));
    True(common.Contains("GetEnvironmentVariable", StringComparison.Ordinal));
    True(common.Contains("SetEnvironmentVariable", StringComparison.Ordinal));
    False(install.Contains("attestation-key --rotate", StringComparison.OrdinalIgnoreCase));
    False(export.Contains("private", StringComparison.OrdinalIgnoreCase));
    var publishIndex = update.IndexOf("& dotnet publish", StringComparison.Ordinal);
    var stagedVerifyIndex = update.IndexOf("Invoke-NfcBuildVerification -DllPath $stagedDll", StringComparison.Ordinal);
    var preStopMarkerIndex = update.IndexOf("Everything above is hardware-free", StringComparison.Ordinal);
    var stopIndex = update.IndexOf("Stop-NfcUpdateProcess -Config $config", preStopMarkerIndex, StringComparison.Ordinal);
    True(publishIndex >= 0 && publishIndex < stagedVerifyIndex && stagedVerifyIndex < preStopMarkerIndex && preStopMarkerIndex < stopIndex);
    True(update.Contains("Get-NfcPreservedStateSnapshot", StringComparison.Ordinal));
    True(update.Contains("Assert-NfcPreservedState", StringComparison.Ordinal));
    True(update.Contains("Invoke-NfcInstallDirectoryReplacement", StringComparison.Ordinal));
    True(update.Contains("Copy-NfcStableMaintenancePayload", StringComparison.Ordinal));
    True(update.Contains("--export-workstation-attestation-public-key", StringComparison.Ordinal));
    False(update.Contains("Initialize-NfcConfig", StringComparison.Ordinal));
    False(update.Contains("--ensure-workstation-attestation-key", StringComparison.Ordinal));
    False(update.Contains("RotateToken", StringComparison.Ordinal));
    False(update.Contains("RotatePairingCode", StringComparison.Ordinal));
    False(update.Contains("capture-helper", StringComparison.OrdinalIgnoreCase));
    True(install.Contains("Use update-ai-grader-nfc-helper.ps1", StringComparison.Ordinal));
    False(install.Contains("-RotatePairingCode", StringComparison.Ordinal));
    True(install.Contains("newly created files/config/task/shortcut were removed", StringComparison.Ordinal));
    True(install.Contains("CNG key, if created, was preserved", StringComparison.Ordinal));
    True(install.Contains("$script:NfcStableStartScript", StringComparison.Ordinal));
    True(install.Contains("$script:NfcStableOpenScript", StringComparison.Ordinal));
    True(rotate.Contains("-not $RotateToken -and -not $RotatePairingCode", StringComparison.Ordinal));
    True(common.Contains("Assert-NfcPathWithinRoot", StringComparison.Ordinal));
    True(common.Contains("Assert-NfcProtectedAcl", StringComparison.Ordinal));
    True(common.Contains("Copy-NfcStableMaintenancePayload", StringComparison.Ordinal));
    True(common.Contains("Assert-NfcScheduledTaskDefinition", StringComparison.Ordinal));
    True(common.Contains("the prior working install was restored", StringComparison.Ordinal));

    var publicOnly = JsonSerializer.Serialize(
        new WorkstationPublicKeyExport(new string('a', 64), NfcProtocol.AttestationAlgorithm, "public-spki-only"),
        NfcJsonContext.Default.WorkstationPublicKeyExport);
    True(publicOnly.Contains("publicSpkiDerBase64", StringComparison.Ordinal));
    False(publicOnly.Contains("keyName", StringComparison.OrdinalIgnoreCase));
    False(publicOnly.Contains("private", StringComparison.OrdinalIgnoreCase));
    return Task.CompletedTask;
}

static NfcWriteRequest WriteRequest(
    string attemptId,
    string idempotencyKey,
    string url = Url,
    string challenge = Challenge,
    OverwriteConfirmationRequest? overwrite = null)
{
    var publicTagId = url.StartsWith(NfcProtocol.ProductionUrlPrefix, StringComparison.Ordinal)
        ? url[NfcProtocol.ProductionUrlPrefix.Length..]
        : string.Empty;
    return new NfcWriteRequest(attemptId, idempotencyKey, publicTagId, challenge, url, overwrite);
}

static string FindRepoRoot()
{
    var current = new DirectoryInfo(AppContext.BaseDirectory);
    while (current is not null)
    {
        if (File.Exists(Path.Combine(current.FullName, "pnpm-workspace.yaml"))) return current.FullName;
        current = current.Parent;
    }
    throw new Exception("Repository root was not found.");
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

static async Task WaitHttp(HttpClient client, Task server)
{
    for (var attempt = 0; attempt < 50; attempt++)
    {
        if (server.IsCompleted)
        {
            await server;
            throw new Exception("HTTP helper stopped before accepting a request.");
        }
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

static async Task<NfcHelperException> ThrowsAsync(string code, Func<Task> action)
{
    try
    {
        await action();
    }
    catch (NfcHelperException error) when (error.Code == code)
    {
        return error;
    }
    throw new Exception($"Expected NFC error {code}.");
}
