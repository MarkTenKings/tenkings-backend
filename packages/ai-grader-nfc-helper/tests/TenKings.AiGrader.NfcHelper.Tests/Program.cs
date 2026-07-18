using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.IO.Compression;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
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
    ("ACR1552 PICC and SAM reader selection", TestPcscReaderSelection),
    ("ACR1552 initial empty-reader PCSC classification", TestPcscInitialConnectClassification),
    ("operational attestation canonical signing and tamper", TestAttestation),
    ("multi-profile attestation canonical signing and tamper", TestMultiProfileAttestation),
    ("GoToTags terminal callback strict evidence and redaction", TestGoToTagsCallback),
    ("F8215 protected job lifecycle and idempotency", TestF8215JobLifecycle),
    ("F8215 helper restart and terminal callback recovery", TestF8215RestartRecovery),
    ("F8215 expired and rejected-callback quarantine recovery", TestF8215QuarantineRecovery),
    ("F8215 loopback callback HTTP boundary", TestF8215HttpCallback),
    ("NDEF URI/TLV and URL digest", TestNdef),
    ("NTAG215 CC and APDU safety", TestLayoutAndCommands),
    ("blank write/readback and redaction", TestWriteAndReadback),
    ("overwrite confirmation", TestOverwrite),
    ("reader and tag failures", TestReaderFailures),
    ("partial write and readback mismatch", TestWriteFailures),
    ("single writer, timeout, and idempotency", TestConcurrency),
    ("definite pre-write retry and uncertain failure recovery", TestRetryClassification),
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

static Task TestPcscReaderSelection()
{
    const string Picc = "ACS ACR1552 1S CL Reader PICC 0";
    const string Sam = "ACS ACR1552 1S CL Reader SAM 0";

    var onePhysicalReader = Pcsc.SelectAcr1552PiccReaders([Picc, Sam]);
    Equal(1, onePhysicalReader.Count);
    Equal(Picc, onePhysicalReader[0]);

    var twoPhysicalReaders = Pcsc.SelectAcr1552PiccReaders([
        Picc,
        Sam,
        "ACS ACR1552 1S CL Reader PICC 1",
        "ACS ACR1552 1S CL Reader SAM 1"
    ]);
    Equal(2, twoPhysicalReaders.Count);

    var rejected = Pcsc.SelectAcr1552PiccReaders([
        Sam,
        "ACS ACR1252 1S CL Reader PICC 0",
        "ACS ACR1552 1S CL Reader ICC 0",
        "ACS ACR15520 1S CL Reader PICC 0",
        "ACS ACR1552 1S CL Reader PICC SAM 0",
        ""
    ]);
    Equal(0, rejected.Count);

    var caseInsensitive = Pcsc.SelectAcr1552PiccReaders([
        "acs acr1552 1s cl reader picc 0",
        "acs acr1552 1s cl reader sam 0"
    ]);
    Equal(1, caseInsensitive.Count);
    return Task.CompletedTask;
}

static async Task TestPcscInitialConnectClassification()
{
    foreach (var initialEmptyResult in new[] { Pcsc.NoSmartcard, Pcsc.RemovedCard })
    {
        True(Pcsc.IsInitialConnectAbsent(initialEmptyResult));
        var backendStatus = WindowsPcscNfcReaderBackend.ClassifyInitialConnectForStatus(initialEmptyResult);
        True(backendStatus.Connected);
        True(backendStatus.PcscReady);
        Equal("absent", backendStatus.TagState);
        True(backendStatus.ErrorCode is null);

        using var statusSigner = new EphemeralTestWorkstationAttestationSigner();
        var initialBackend = new InitialConnectResultBackend(initialEmptyResult);
        var initialService = new NfcOperationsService(initialBackend, statusSigner);
        var helperStatus = initialService.Status();
        True(helperStatus.ReaderConnected);
        True(helperStatus.PcscReady);
        Equal("absent", helperStatus.TagState);
        Equal("ACS ACR1552U", helperStatus.ReaderModel);
        True(helperStatus.ErrorCode is null);
        Equal(0, statusSigner.SignCount);
        False(JsonSerializer.Serialize(helperStatus).Contains("signature", StringComparison.OrdinalIgnoreCase));

        await ThrowsAsync("no_tag", () =>
            initialService.WriteAsync(
                WriteRequest($"attempt_initial_{unchecked((uint)initialEmptyResult):x8}", $"idempotency_initial_{unchecked((uint)initialEmptyResult):x8}"),
                "req_initial_connect_absent",
                CancellationToken.None));
        Equal(1, initialBackend.OpenSessionCount);
        Equal(0, statusSigner.SignCount);
        False(initialService.Busy);

        try
        {
            WindowsPcscNfcReaderBackend.RequireInitialSessionConnection(initialEmptyResult);
            throw new Exception("Expected initial empty reader to produce no_tag.");
        }
        catch (NfcHelperException error)
        {
            Equal("no_tag", error.Code);
            True(error.Retryable);
            Equal(409, error.HttpStatus);
        }
    }

    False(Pcsc.IsInitialConnectAbsent(Pcsc.ReaderUnavailable));
    var unavailable = WindowsPcscNfcReaderBackend.ClassifyInitialConnectForStatus(Pcsc.ReaderUnavailable);
    False(unavailable.Connected);
    False(unavailable.PcscReady);
    Equal("unknown", unavailable.TagState);
    Equal("reader_disconnected", unavailable.ErrorCode);
    Throws("reader_disconnected", () =>
        WindowsPcscNfcReaderBackend.RequireInitialSessionConnection(Pcsc.ReaderUnavailable));

    True(Pcsc.IsRemoved(Pcsc.RemovedCard));
    Throws("tag_removed_mid_operation", () =>
        WindowsPcscNfcReaderBackend.RequireActiveOperationTransmit(Pcsc.RemovedCard));

    var connected = WindowsPcscNfcReaderBackend.ClassifyInitialConnectForStatus(Pcsc.Success);
    True(connected.Connected);
    True(connected.PcscReady);
    Equal("present", connected.TagState);
    True(connected.ErrorCode is null);
    WindowsPcscNfcReaderBackend.RequireInitialSessionConnection(Pcsc.Success);
    WindowsPcscNfcReaderBackend.RequireActiveOperationTransmit(Pcsc.Success);

    var retryBackend = new FakeNfcReaderBackend { TagCount = 0 };
    using var retrySigner = new EphemeralTestWorkstationAttestationSigner();
    var retryService = new NfcOperationsService(retryBackend, retrySigner);
    var retryRequest = WriteRequest("attempt_initial_empty_retry", "idempotency_initial_empty_retry");
    await ThrowsAsync("no_tag", () =>
        retryService.WriteAsync(retryRequest, "req_initial_empty", CancellationToken.None));
    Equal(0, retrySigner.SignCount);
    Equal(0, retryBackend.Writes.Count);
    False(retryService.Busy);
    retryBackend.TagCount = 1;
    var retryResult = await retryService.WriteAsync(
        WriteRequest("attempt_initial_present_new", "idempotency_initial_present_new"),
        "req_initial_present",
        CancellationToken.None);
    Equal("write_verified_pcsc_readback", retryResult.ReaderResultCode);
    True(retryResult.OperationalAttestation is not null);
    Equal(1, retrySigner.SignCount);
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

static Task TestMultiProfileAttestation()
{
    using var signer = new EphemeralTestWorkstationAttestationSigner();
    var fields = new MultiProfileAttestationFields(
        "nfc_attempt_multi_profile_0001",
        Challenge,
        TagId,
        Url,
        NfcProtocol.FeijuChipType,
        NfcProtocol.SecurityMode,
        NfcProtocol.FeijuProgrammingProfile,
        NfcProtocol.FeijuAdapterIdentity,
        NfcProtocol.ApprovedGoToTagsVersion,
        new string('a', 64),
        new string('b', 64),
        NfcProtocol.FeijuWriteProtectionState,
        NfcProtocol.FeijuReaderResultCode,
        NfcProtocol.ProtocolVersion,
        "2026-07-16T22:36:52.279Z");
    var canonical = MultiProfileWorkstationAttestation.CanonicalStatement(fields);
    True(canonical.Contains(NfcProtocol.FeijuProgrammingProfile, StringComparison.Ordinal));
    True(canonical.Contains(NfcProtocol.FeijuWriteProtectionState, StringComparison.Ordinal));
    var attestation = MultiProfileWorkstationAttestation.Create(signer, fields);
    Equal(NfcProtocol.MultiProfileAttestationSchemaVersion, attestation.SchemaVersion);
    var spki = signer.ExportPublicSpki();
    try
    {
        True(MultiProfileWorkstationAttestation.Verify(spki, fields, attestation.Signature));
        False(MultiProfileWorkstationAttestation.Verify(
            spki,
            fields with { AdapterVersion = "4.38.0.0" },
            attestation.Signature));
        False(MultiProfileWorkstationAttestation.Verify(
            spki,
            fields with { WriteProtectionState = "unknown" },
            attestation.Signature));
    }
    finally
    {
        CryptographicOperations.ZeroMemory(spki);
    }
    return Task.CompletedTask;
}

static Task TestGoToTagsCallback()
{
    const string correlation = "synthetic_callback_correlation_0001";
    var body = GoToTagsCallback(correlation, Url);
    Equal(NfcProtocol.ApprovedGoToTagsVersion, GoToTagsCallbackParser.SafeReportedAppVersion(body));
    var result = GoToTagsCallbackParser.Parse(body, correlation, Url);
    var observedVersionBody = GoToTagsCallback(correlation, Url, appVersion: $"v{NfcProtocol.ApprovedGoToTagsVersion}");
    Equal(NfcProtocol.ApprovedGoToTagsVersion, GoToTagsCallbackParser.SafeReportedAppVersion(observedVersionBody));
    _ = GoToTagsCallbackParser.Parse(observedVersionBody, correlation, Url);
    var wrongVersionBody = GoToTagsCallback(correlation, Url, appVersion: $"V{NfcProtocol.ApprovedGoToTagsVersion}");
    Throws("gototags_version_unapproved", () => GoToTagsCallbackParser.Parse(wrongVersionBody, correlation, Url));
    True(System.Text.RegularExpressions.Regex.IsMatch(result.UidFingerprintSha256, "^[a-f0-9]{64}$"));
    True(System.Text.RegularExpressions.Regex.IsMatch(result.ReadbackPayloadSha256, "^[a-f0-9]{64}$"));
    True(System.Text.RegularExpressions.Regex.IsMatch(result.CallbackBodySha256, "^[a-f0-9]{64}$"));
    var callbackText = Encoding.UTF8.GetString(body);
    False(result.ToString().Contains("04112233445566", StringComparison.OrdinalIgnoreCase));
    Throws("gototags_correlation_mismatch", () => GoToTagsCallbackParser.Parse(body, "synthetic_callback_correlation_0002", Url));
    var wrongUrl = GoToTagsCallback(correlation, Url, readbackUrl: OtherUrl);
    Throws("gototags_readback_mismatch", () => GoToTagsCallbackParser.Parse(wrongUrl, correlation, Url));
    var unlocked = GoToTagsCallback(correlation, Url, locked: false);
    Throws("gototags_lock_missing", () => GoToTagsCallbackParser.Parse(unlocked, correlation, Url));
    var wrongChip = GoToTagsCallback(correlation, Url, chipType: "FM11NT041");
    Throws("gototags_chip_mismatch", () => GoToTagsCallbackParser.Parse(wrongChip, correlation, Url));
    Equal(
        "I removed and quarantined the exact NFC tag used for this F8215 attempt.",
        NfcProtocol.FeijuQuarantineConfirmation);
    True(callbackText.Contains("04112233445566", StringComparison.Ordinal));
    CryptographicOperations.ZeroMemory(body);
    CryptographicOperations.ZeroMemory(observedVersionBody);
    CryptographicOperations.ZeroMemory(wrongVersionBody);
    CryptographicOperations.ZeroMemory(wrongUrl);
    CryptographicOperations.ZeroMemory(unlocked);
    CryptographicOperations.ZeroMemory(wrongChip);
    return Task.CompletedTask;
}

static Task TestF8215JobLifecycle()
{
    if (!OperatingSystem.IsWindows()) return Task.CompletedTask;
    var root = CreateProtectedTestDirectory();
    try
    {
        var templatePath = Path.Combine(root, "f8215-gototags-manual-start-v1.json");
        File.Copy(
            Path.Combine(FindRepoRoot(), "packages", "ai-grader-nfc-helper", "src", "TenKings.AiGrader.NfcHelper", "Templates", "f8215-gototags-manual-start-v1.json"),
            templatePath);
        Equal(NfcProtocol.ApprovedGoToTagsTemplateSha256, Sha256File(templatePath));
        var options = new GoToTagsAdapterOptions(
            Path.Combine(root, "fake.exe"),
            templatePath,
            NfcProtocol.ApprovedGoToTagsTemplateSha256,
            root);
        File.WriteAllBytes(options.ExecutablePath, [0x4d, 0x5a]);
        var runtime = new FakeGoToTagsRuntime();
        using var signer = new EphemeralTestWorkstationAttestationSigner();
        using var gate = new NfcOperationGate();
        var coordinator = new F8215JobCoordinator(
            options,
            runtime,
            new GoToTagsOperationFactory(),
            signer,
            gate,
            47662,
            new CollectingSafeLogger());
        var request = new F8215PrepareRequest(
            "nfc_attempt_f8215_lifecycle_0001",
            "prepare_idempotency_f8215_0001",
            TagId,
            Challenge,
            Url,
            DateTimeOffset.UtcNow.AddMinutes(10).ToString("O"),
            NfcProtocol.FeijuChipType,
            NfcProtocol.FeijuProgrammingProfile);
        var prepared = coordinator.Prepare(request, "prepare_test");
        Equal("awaiting_manual_start", prepared.Phase);
        True(gate.Busy);
        Equal(runtime.LaunchedPath, runtime.LaunchedPath is null ? null : Path.GetFullPath(runtime.LaunchedPath));
        AssertProtectedLeaf(Path.Combine(root, "active-job.json"));
        AssertProtectedLeaf(runtime.LaunchedPath!);
        var repeated = coordinator.Prepare(request, "prepare_repeated");
        Equal("awaiting_manual_start", repeated.Phase);
        Throws("gototags_job_conflict", () => coordinator.Prepare(
            request with { AttemptId = "nfc_attempt_f8215_lifecycle_0002" },
            "prepare_conflict"));

        var generated = ReadGeneratedOperation(runtime.LaunchedPath!);
        var integrationUrl = generated["integrations"]!.AsArray()[0]!["urlString"]!.GetValue<string>();
        var callbackIdentity = new Uri(integrationUrl).AbsolutePath.Split('/').Last();
        var correlation = generated["tags"]!.AsArray()[0]!["encoding"]!["correlationId"]!.GetValue<string>();
        var body = GoToTagsCallback(correlation, Url);
        try
        {
            coordinator.AcceptCallback(callbackIdentity, body, "callback_test");
        }
        finally
        {
            CryptographicOperations.ZeroMemory(body);
        }
        var status = coordinator.Status(new F8215OperationStatusRequest(request.AttemptId));
        Equal("completed", status.Phase);
        True(status.Terminal);
        True(status.Evidence is not null);
        Equal(NfcProtocol.FeijuReaderResultCode, status.Evidence!.ReaderResultCode);
        Equal(NfcProtocol.MultiProfileAttestationSchemaVersion, status.Evidence.OperationalAttestation.SchemaVersion);
        False(File.Exists(runtime.LaunchedPath));
        True(File.Exists(Path.Combine(root, "active-job.json")));
        AssertProtectedLeaf(Path.Combine(root, "active-job.json"));
        Throws("gototags_callback_replayed", () => coordinator.AcceptCallback(callbackIdentity, GoToTagsCallback(correlation, Url), "callback_replay"));
        var acknowledged = coordinator.Acknowledge(new F8215OperationAcknowledgeRequest(request.AttemptId), "ack_test");
        True(acknowledged.Cleaned);
        False(gate.Busy);
        False(File.Exists(Path.Combine(root, "active-job.json")));
        var nextRequest = request with
        {
            AttemptId = "nfc_attempt_f8215_lifecycle_0002",
            IdempotencyKey = "prepare_idempotency_f8215_0002",
        };
        Equal("awaiting_manual_start", coordinator.Prepare(nextRequest, "prepare_after_ack").Phase);
        True(gate.Busy);
    }
    finally
    {
        Directory.Delete(root, true);
    }
    return Task.CompletedTask;
}

static Task TestF8215RestartRecovery()
{
    if (!OperatingSystem.IsWindows()) return Task.CompletedTask;
    var root = CreateProtectedTestDirectory();
    try
    {
        var templatePath = Path.Combine(root, "f8215-gototags-manual-start-v1.json");
        File.Copy(
            Path.Combine(FindRepoRoot(), "packages", "ai-grader-nfc-helper", "src", "TenKings.AiGrader.NfcHelper", "Templates", "f8215-gototags-manual-start-v1.json"),
            templatePath);
        var options = new GoToTagsAdapterOptions(
            Path.Combine(root, "fake.exe"),
            templatePath,
            NfcProtocol.ApprovedGoToTagsTemplateSha256,
            root);
        File.WriteAllBytes(options.ExecutablePath, [0x4d, 0x5a]);
        var runtime = new FakeGoToTagsRuntime();
        using var signer = new EphemeralTestWorkstationAttestationSigner();
        using var firstGate = new NfcOperationGate();
        var first = new F8215JobCoordinator(
            options,
            runtime,
            new GoToTagsOperationFactory(),
            signer,
            firstGate,
            47662,
            new CollectingSafeLogger());
        var request = new F8215PrepareRequest(
            $"nfc_attempt_{new string('a', 43)}",
            "prepare_idempotency_f8215_restart_0001",
            TagId,
            Challenge,
            Url,
            DateTimeOffset.UtcNow.AddMinutes(10).ToString("O"),
            NfcProtocol.FeijuChipType,
            NfcProtocol.FeijuProgrammingProfile);
        first.Prepare(request, "prepare_restart");
        var generated = ReadGeneratedOperation(runtime.LaunchedPath!);
        var integrationUrl = generated["integrations"]!.AsArray()[0]!["urlString"]!.GetValue<string>();
        var callbackIdentity = new Uri(integrationUrl).AbsolutePath.Split('/').Last();
        var correlation = generated["tags"]!.AsArray()[0]!["encoding"]!["correlationId"]!.GetValue<string>();

        using var recoveryGate = new NfcOperationGate();
        var recovered = new F8215JobCoordinator(
            options,
            new FakeGoToTagsRuntime(),
            new GoToTagsOperationFactory(),
            signer,
            recoveryGate,
            47662,
            new CollectingSafeLogger());
        Equal("uncertain", recovered.Status(new F8215OperationStatusRequest(request.AttemptId)).Phase);
        Throws("gototags_job_mismatch", () => recovered.Status(new F8215OperationStatusRequest($"nfc_attempt_{new string('b', 43)}")));
        var body = GoToTagsCallback(correlation, Url);
        try
        {
            Throws("gototags_job_terminal", () => recovered.AcceptCallback(callbackIdentity, body, "callback_after_restart"));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(body);
        }
        var uncertain = recovered.Status(new F8215OperationStatusRequest(request.AttemptId));
        Equal("uncertain", uncertain.Phase);
        True(uncertain.Evidence is null);
        True(recoveryGate.Busy);
        var resolution = F8215JobCoordinator.ResolveAbandonedJob(
            root,
            request.AttemptId,
            NfcProtocol.FeijuInstalledResolverCompatibilityToken);
        Equal("quarantined_abandoned_job_resolved", resolution.Resolution);
        False(resolution.EncodingSuccessClaimed);
        AssertProtectedLeaf(Path.Combine(root, "abandoned-job-audit.jsonl"));
    }
    finally
    {
        Directory.Delete(root, true);
    }
    return Task.CompletedTask;
}

static Task TestF8215QuarantineRecovery()
{
    if (!OperatingSystem.IsWindows()) return Task.CompletedTask;
    var root = CreateProtectedTestDirectory();
    try
    {
        var templatePath = Path.Combine(root, "f8215-gototags-manual-start-v1.json");
        File.Copy(
            Path.Combine(FindRepoRoot(), "packages", "ai-grader-nfc-helper", "src", "TenKings.AiGrader.NfcHelper", "Templates", "f8215-gototags-manual-start-v1.json"),
            templatePath);
        var options = new GoToTagsAdapterOptions(
            Path.Combine(root, "fake.exe"),
            templatePath,
            NfcProtocol.ApprovedGoToTagsTemplateSha256,
            root);
        File.WriteAllBytes(options.ExecutablePath, [0x4d, 0x5a]);
        var runtime = new FakeGoToTagsRuntime();
        using var signer = new EphemeralTestWorkstationAttestationSigner();
        using var firstGate = new NfcOperationGate();
        var clock = new MutableTimeProvider(DateTimeOffset.Parse("2026-07-16T20:00:00.000Z"));
        var first = new F8215JobCoordinator(
            options,
            runtime,
            new GoToTagsOperationFactory(),
            signer,
            firstGate,
            47662,
            new CollectingSafeLogger(),
            clock);
        var quarantineAttemptId = "nfc_attempt_" + new string('Q', 43);
        var request = new F8215PrepareRequest(
            quarantineAttemptId,
            "prepare_idempotency_f8215_quarantine_0001",
            TagId,
            Challenge,
            Url,
            clock.GetUtcNow().AddMinutes(5).ToString("O"),
            NfcProtocol.FeijuChipType,
            NfcProtocol.FeijuProgrammingProfile);
        first.Prepare(request, "prepare_quarantine");
        var generated = ReadGeneratedOperation(runtime.LaunchedPath!);
        var integrationUrl = generated["integrations"]!.AsArray()[0]!["urlString"]!.GetValue<string>();
        var callbackIdentity = new Uri(integrationUrl).AbsolutePath.Split('/').Last();
        var correlation = generated["tags"]!.AsArray()[0]!["encoding"]!["correlationId"]!.GetValue<string>();
        AssertProtectedLeaf(Path.Combine(root, "active-job.json"));
        AssertProtectedLeaf(runtime.LaunchedPath!);
        var wrongCallback = GoToTagsCallback(correlation, Url, chipType: "FM11NT041");
        try
        {
            Throws("gototags_chip_mismatch", () => first.AcceptCallback(callbackIdentity, wrongCallback, "rejected_wrong_chip_callback"));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(wrongCallback);
        }
        True(File.Exists(Path.Combine(root, "active-job.json")));
        var rejectedState = JsonNode.Parse(File.ReadAllBytes(Path.Combine(root, "active-job.json")))!.AsObject();
        True(rejectedState["evidence"] is null);
        True(rejectedState["callbackBodySha256"] is null);
        False(rejectedState.ToJsonString().Contains("FM11NT041", StringComparison.Ordinal));
        False(rejectedState.ToJsonString().Contains("signature", StringComparison.OrdinalIgnoreCase));
        AssertProtectedLeaf(Path.Combine(root, "active-job.json"));
        AssertProtectedLeaf(runtime.LaunchedPath!);
        clock.Advance(TimeSpan.FromMinutes(6));
        Equal("uncertain", first.Status(new F8215OperationStatusRequest(request.AttemptId)).Phase);
        AssertProtectedLeaf(Path.Combine(root, "active-job.json"));

        using var restartGate = new NfcOperationGate();
        var restarted = new F8215JobCoordinator(
            options,
            new FakeGoToTagsRuntime(),
            new GoToTagsOperationFactory(),
            signer,
            restartGate,
            47662,
            new CollectingSafeLogger(),
            clock);
        Equal("uncertain", restarted.Status(new F8215OperationStatusRequest(request.AttemptId)).Phase);
        True(restartGate.Busy);
        Throws("gototags_job_mismatch", () => F8215JobCoordinator.ResolveAbandonedJob(
            root,
            "nfc_attempt_" + new string('R', 43),
            NfcProtocol.FeijuInstalledResolverCompatibilityToken,
            clock));
        Throws("gototags_quarantine_confirmation_required", () => F8215JobCoordinator.ResolveAbandonedJob(
            root,
            request.AttemptId,
            "tag removed",
            clock));
        True(File.Exists(Path.Combine(root, "active-job.json")));
        Throws("gototags_quarantine_confirmation_required", () => F8215JobCoordinator.ResolveAbandonedJob(
            root,
            request.AttemptId,
            NfcProtocol.FeijuQuarantineConfirmation,
            clock));
        True(File.Exists(Path.Combine(root, "active-job.json")));

        var resolution = F8215JobCoordinator.ResolveAbandonedJob(
            root,
            request.AttemptId,
            NfcProtocol.FeijuInstalledResolverCompatibilityToken,
            clock);
        Equal("uncertain", resolution.PriorPhase);
        Equal("quarantined_abandoned_job_resolved", resolution.Resolution);
        True(resolution.ProtectedArtifactsRemoved);
        False(resolution.EncodingSuccessClaimed);
        False(File.Exists(Path.Combine(root, "active-job.json")));
        False(File.Exists(runtime.LaunchedPath));
        var audit = File.ReadAllText(Path.Combine(root, "abandoned-job-audit.jsonl"));
        True(audit.Contains("removed_and_quarantined", StringComparison.Ordinal));
        False(audit.Contains(request.AttemptId, StringComparison.Ordinal));
        False(audit.Contains(NfcProtocol.FeijuQuarantineConfirmation, StringComparison.Ordinal));
        False(audit.Contains(NfcProtocol.FeijuInstalledResolverCompatibilityToken, StringComparison.Ordinal));
        AssertProtectedLeaf(Path.Combine(root, "abandoned-job-audit.jsonl"));

        using var nextGate = new NfcOperationGate();
        var nextRuntime = new FakeGoToTagsRuntime();
        var next = new F8215JobCoordinator(
            options,
            nextRuntime,
            new GoToTagsOperationFactory(),
            signer,
            nextGate,
            47662,
            new CollectingSafeLogger(),
            clock);
        False(next.HasActiveJob);
        False(nextGate.Busy);
        var nextRequest = request with
        {
            AttemptId = "nfc_attempt_" + new string('S', 43),
            IdempotencyKey = "prepare_idempotency_f8215_quarantine_0002",
            AttemptExpiresAt = clock.GetUtcNow().AddMinutes(5).ToString("O"),
        };
        Equal("awaiting_manual_start", next.Prepare(nextRequest, "prepare_after_quarantine").Phase);
        True(nextGate.Busy);
        AssertProtectedLeaf(Path.Combine(root, "active-job.json"));
        AssertProtectedLeaf(nextRuntime.LaunchedPath!);
    }
    finally
    {
        Directory.Delete(root, true);
    }
    return Task.CompletedTask;
}

static async Task TestF8215HttpCallback()
{
    if (!OperatingSystem.IsWindows()) return;
    var root = CreateProtectedTestDirectory();
    var pairingState = Path.Combine(root, "pairing.state");
    try
    {
        var templatePath = Path.Combine(root, "f8215-gototags-manual-start-v1.json");
        File.Copy(
            Path.Combine(FindRepoRoot(), "packages", "ai-grader-nfc-helper", "src", "TenKings.AiGrader.NfcHelper", "Templates", "f8215-gototags-manual-start-v1.json"),
            templatePath);
        var adapterOptions = new GoToTagsAdapterOptions(
            Path.Combine(root, "fake.exe"),
            templatePath,
            NfcProtocol.ApprovedGoToTagsTemplateSha256,
            root);
        File.WriteAllBytes(adapterOptions.ExecutablePath, [0x4d, 0x5a]);
        var runtime = new FakeGoToTagsRuntime();
        using var signer = new EphemeralTestWorkstationAttestationSigner();
        using var gate = new NfcOperationGate();
        var port = FreePort();
        var coordinator = new F8215JobCoordinator(
            adapterOptions,
            runtime,
            new GoToTagsOperationFactory(),
            signer,
            gate,
            port,
            new CollectingSafeLogger());
        var request = new F8215PrepareRequest(
            "nfc_attempt_f8215_http_0001",
            "prepare_idempotency_f8215_http_0001",
            TagId,
            Challenge,
            Url,
            DateTimeOffset.UtcNow.AddMinutes(10).ToString("O"),
            NfcProtocol.FeijuChipType,
            NfcProtocol.FeijuProgrammingProfile);
        coordinator.Prepare(request, "prepare_http");
        var generated = ReadGeneratedOperation(runtime.LaunchedPath!);
        var integrationUrl = generated["integrations"]!.AsArray()[0]!["urlString"]!.GetValue<string>();
        var callbackPath = new Uri(integrationUrl).AbsolutePath;
        var correlation = generated["tags"]!.AsArray()[0]!["encoding"]!["correlationId"]!.GetValue<string>();
        var token = Base64Url(RandomNumberGenerator.GetBytes(32));
        var options = new NfcHttpServerOptions(
            port,
            NfcProtocol.ProductionOrigin,
            token,
            null,
            DateTimeOffset.MinValue,
            pairingState);
        var logger = new CollectingSafeLogger();
        await using var server = new NfcHttpServer(
            options,
            new NfcOperationsService(new FakeNfcReaderBackend(), signer, logger, operationGate: gate),
            logger,
            coordinator);
        using var stop = new CancellationTokenSource();
        var running = server.RunAsync(stop.Token);
        using var client = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{port}"), Timeout = TimeSpan.FromSeconds(2) };
        await WaitHttp(client, running);

        using (var wrongMethod = new HttpRequestMessage(HttpMethod.Get, callbackPath))
        using (var wrongMethodResponse = await client.SendAsync(wrongMethod))
            Equal(HttpStatusCode.MethodNotAllowed, wrongMethodResponse.StatusCode);

        var body = GoToTagsCallback(correlation, Url);
        try
        {
            using (var wrongHost = new HttpRequestMessage(HttpMethod.Post, callbackPath)
            {
                Content = new ByteArrayContent(body),
            })
            {
                wrongHost.Headers.Host = $"localhost:{port}";
                wrongHost.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
                using var wrongHostResponse = await client.SendAsync(wrongHost);
                Equal(HttpStatusCode.Forbidden, wrongHostResponse.StatusCode);
            }
            using (var missingType = new HttpRequestMessage(HttpMethod.Post, callbackPath)
            {
                Content = new ByteArrayContent(body),
            })
            using (var missingTypeResponse = await client.SendAsync(missingType))
                Equal(HttpStatusCode.UnsupportedMediaType, missingTypeResponse.StatusCode);

            using (var valid = new HttpRequestMessage(HttpMethod.Post, callbackPath)
            {
                Content = new ByteArrayContent(body),
            })
            {
                valid.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
                using var validResponse = await client.SendAsync(valid);
                Equal(HttpStatusCode.NoContent, validResponse.StatusCode);
            }
            using (var replay = new HttpRequestMessage(HttpMethod.Post, callbackPath)
            {
                Content = new ByteArrayContent(body),
            })
            {
                replay.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
                using var replayResponse = await client.SendAsync(replay);
                Equal(HttpStatusCode.Conflict, replayResponse.StatusCode);
            }
        }
        finally
        {
            CryptographicOperations.ZeroMemory(body);
        }

        using var status = Request(
            HttpMethod.Post,
            "/operation-status",
            token,
            content: JsonContent.Create(new F8215OperationStatusRequest(request.AttemptId), NfcJsonContext.Default.F8215OperationStatusRequest));
        using var statusResponse = await client.SendAsync(status);
        Equal(HttpStatusCode.OK, statusResponse.StatusCode);
        var statusText = await statusResponse.Content.ReadAsStringAsync();
        True(statusText.Contains("\"phase\":\"completed\"", StringComparison.Ordinal));
        False(statusText.Contains("04112233445566", StringComparison.OrdinalIgnoreCase));
        False(logger.Entries.Any(entry => entry.Contains("04112233445566", StringComparison.OrdinalIgnoreCase)));
        coordinator.Acknowledge(new F8215OperationAcknowledgeRequest(request.AttemptId), "ack_http");
        stop.Cancel();
        await running;
    }
    finally
    {
        Directory.Delete(root, true);
    }
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
    Throws("invalid_public_tag_id", () => NdefCodec.EncodeProductionUrl("https://collect.tenkings.co/nfc/test"));
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
    Equal("overwrite_confirmation_required", exactAgain.ReaderResultCode);
    True(exactAgain.OperationalAttestation is null);
    Equal(1, signer.SignCount);
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
    await ThrowsAsync("readback_mismatch", () => recoverableCorruptService.WriteAsync(
        recoverableCorruptRequest,
        "req_corrupt_exact_retry",
        CancellationToken.None));
    Equal(writesBeforeRecovery, recoverableCorrupt.Writes.Count);
    Equal(0, recoverableCorruptSigner.SignCount);
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
    True(timeoutError.Message.Contains("quarantine", StringComparison.OrdinalIgnoreCase));
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
    await ThrowsAsync("writer_busy", () => service.WriteAsync(
        WriteRequest("attempt_0005", "idempotency_0008"),
        "req_contention_retry",
        CancellationToken.None));

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
    True(cancellationError.Message.Contains("quarantine", StringComparison.OrdinalIgnoreCase));
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
    definiteBackend.TagCount = 1;
    await ThrowsAsync("no_tag", () =>
        definiteService.WriteAsync(definiteRequest, "req_same_attempt_disallowed", CancellationToken.None));
    Equal(0, definiteBackend.Writes.Count);
    Equal(0, definiteSigner.SignCount);
    var newAttempt = await definiteService.WriteAsync(
        WriteRequest("attempt_retry_new_0001", "idempotency_retry_new_0001"),
        "req_new_attempt",
        CancellationToken.None);
    Equal("write_verified_pcsc_readback", newAttempt.ReaderResultCode);
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
    await ThrowsAsync("tag_removed_mid_write", () =>
        uncertainService.WriteAsync(uncertainRequest, "req_partial_same_attempt_disallowed", CancellationToken.None));
    Equal(writesAfterFailure, uncertainBackend.Writes.Count);
    Equal(0, uncertainSigner.SignCount);
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
    var configureFeiju = File.ReadAllText(Path.Combine(root, "scripts", "ai-grader-nfc", "configure-ai-grader-nfc-feiju-f8215.ps1"));
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
    True(install.Contains("tenkings-ai-grader-nfc-helper-v3", StringComparison.Ordinal));
    True(install.Contains(NfcProtocol.MultiProfileAttestationSchemaVersion, StringComparison.Ordinal));
    True(configureFeiju.Contains(NfcProtocol.ApprovedGoToTagsVersion, StringComparison.Ordinal));
    True(configureFeiju.Contains("CN=GoToTags, O=GoToTags, S=Washington, C=US", StringComparison.Ordinal));
    False(configureFeiju.Contains("feijuF8215Enabled", StringComparison.Ordinal));
    False(configureFeiju.Contains("Set-Service", StringComparison.OrdinalIgnoreCase));
    False(start.Contains("TENKINGS_NFC_FEIJU_F8215_ENABLED", StringComparison.Ordinal));
    True(start.Contains("TENKINGS_NFC_GOTOTAGS_JOB_ROOT", StringComparison.Ordinal));

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

static byte[] GoToTagsCallback(
    string correlation,
    string encodedUrl,
    string? readbackUrl = null,
    bool locked = true,
    string? appVersion = null,
    string chipType = "F8215",
    string manufacturer = "FEIJU")
{
    var record = new JsonObject { ["type"] = "WEBSITE", ["url"] = encodedUrl };
    var readback = new JsonObject { ["type"] = "WEBSITE", ["url"] = readbackUrl ?? encodedUrl };
    var root = new JsonObject
    {
        ["status"] = "VERIFIED",
        ["client"] = new JsonObject { ["appVersion"] = appVersion ?? NfcProtocol.ApprovedGoToTagsVersion },
        ["reader"] = new JsonObject
        {
            ["hardware"] = "ACR1552U",
            ["name"] = "ACS ACR1552U (TEST-READER-0001) (PCSC2)",
        },
        ["encoding"] = new JsonObject
        {
            ["correlationId"] = correlation,
            ["lock"] = true,
            ["ndef"] = new JsonObject
            {
                ["lock"] = true,
                ["records"] = new JsonArray(record),
            },
        },
        ["tag"] = new JsonObject
        {
            ["manufacturer"] = manufacturer,
            ["chipType"] = chipType,
            ["tagType"] = "TYPE_2",
            ["tech"] = "TYPE2",
            ["technology"] = "NFC",
            ["format"] = "NDEF",
            ["uid"] = "04112233445566",
            ["locked"] = locked,
            ["lockedStatic"] = locked,
            ["cc"] = new JsonObject { ["ndefVersion"] = "V1_0", ["memorySize"] = 496 },
            ["ndef"] = new JsonObject
            {
                ["message"] = new JsonObject { ["records"] = new JsonArray(readback) },
            },
        },
    };
    return JsonSerializer.SerializeToUtf8Bytes(root);
}

static string CreateProtectedTestDirectory()
{
    var path = Path.Combine(Path.GetTempPath(), $"tenkings-f8215-{Guid.NewGuid():N}");
    Directory.CreateDirectory(path);
    var current = WindowsIdentity.GetCurrent().User ?? throw new Exception("Current Windows identity unavailable.");
    var security = new DirectorySecurity();
    security.SetAccessRuleProtection(true, false);
    foreach (var identity in new IdentityReference[]
    {
        current,
        new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
        new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
    })
    {
        security.AddAccessRule(new FileSystemAccessRule(
            identity,
            FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
            PropagationFlags.None,
            AccessControlType.Allow));
    }
    new DirectoryInfo(path).SetAccessControl(security);
    return path;
}

static void AssertProtectedLeaf(string path)
{
    var info = new FileInfo(path);
    True(info.Exists);
    False(info.Attributes.HasFlag(FileAttributes.ReparsePoint));
    var security = info.GetAccessControl(AccessControlSections.Access);
    True(security.AreAccessRulesProtected);
    var allowed = new HashSet<string>(StringComparer.Ordinal)
    {
        (WindowsIdentity.GetCurrent().User ?? throw new Exception("Current Windows identity unavailable.")).Value,
        new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null).Value,
        new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null).Value,
    };
    var fullControl = new HashSet<string>(StringComparer.Ordinal);
    foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
    {
        True(rule.AccessControlType == AccessControlType.Allow);
        True(allowed.Contains(rule.IdentityReference.Value));
        False(rule.IsInherited);
        if ((rule.FileSystemRights & FileSystemRights.FullControl) == FileSystemRights.FullControl)
            fullControl.Add(rule.IdentityReference.Value);
    }
    True(allowed.SetEquals(fullControl));
}

static JsonObject ReadGeneratedOperation(string path)
{
    using var stream = File.OpenRead(path);
    using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
    using var input = archive.GetEntry("file.gototags")!.Open();
    return JsonNode.Parse(input)!.AsObject();
}

static string Sha256File(string path)
{
    using var stream = File.OpenRead(path);
    return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
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

sealed class FakeGoToTagsRuntime : IGoToTagsAdapterRuntime
{
    public string? LaunchedPath { get; private set; }
    public GoToTagsAdapterInspection Inspect(GoToTagsAdapterOptions options) => new(true);
    public void LaunchOperation(GoToTagsAdapterOptions options, string operationPath) => LaunchedPath = Path.GetFullPath(operationPath);
}

sealed class InitialConnectResultBackend(int result) : INfcReaderBackend
{
    public string Name => "pcsc_initial_connect_test";
    public int OpenSessionCount { get; private set; }
    public ReaderBackendStatus GetStatus() => WindowsPcscNfcReaderBackend.ClassifyInitialConnectForStatus(result);
    public INfcTagSession OpenSession()
    {
        OpenSessionCount++;
        WindowsPcscNfcReaderBackend.RequireInitialSessionConnection(result);
        throw new InvalidOperationException("A successful PCSC connection is outside this initial-absence test backend.");
    }
}

sealed class MutableTimeProvider(DateTimeOffset initial) : TimeProvider
{
    private DateTimeOffset _utcNow = initial;
    public override DateTimeOffset GetUtcNow() => _utcNow;
    public void Advance(TimeSpan duration) => _utcNow = _utcNow.Add(duration);
}
