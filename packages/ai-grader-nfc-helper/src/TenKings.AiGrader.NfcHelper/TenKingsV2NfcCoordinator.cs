using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TenKings.AiGrader.NfcHelper;

internal sealed record TenKingsV2PersistedOperation(
    TenKingsV2NfcSignedJob SignedJob,
    string JobEnvelopeSha256,
    string Url,
    string CorrelationId,
    string CallbackIdentity,
    string OperationFileName,
    string Phase,
    string? ErrorCode,
    string? DiscardAcknowledgementNonce,
    TenKingsV2NfcTerminalResult? TerminalResult,
    string CreatedAt,
    string UpdatedAt);

public sealed partial class TenKingsV2NfcCoordinator
{
    internal const string StateFileName = "active-v2-job.json";
    internal const string V1StateFileName = "active-job.json";
    private static readonly JsonSerializerOptions PersistedJson = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false,
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow,
    };

    private readonly object _sync = new();
    private readonly GoToTagsAdapterOptions _options;
    private readonly IGoToTagsAdapterRuntime _runtime;
    private readonly GoToTagsOperationFactory _operationFactory;
    private readonly IWorkstationAttestationSigner _signer;
    private readonly NfcOperationGate _operationGate;
    private readonly TenKingsV2ServerTrust _serverTrust;
    private readonly ISafeLogger _logger;
    private readonly TimeProvider _timeProvider;
    private readonly int _callbackPort;
    private readonly string? _statePath;
    private TenKingsV2PersistedOperation? _operation;
    private bool _ownsGate;

    public TenKingsV2NfcCoordinator(
        GoToTagsAdapterOptions options,
        IGoToTagsAdapterRuntime runtime,
        GoToTagsOperationFactory operationFactory,
        IWorkstationAttestationSigner signer,
        NfcOperationGate operationGate,
        TenKingsV2ServerTrust serverTrust,
        int callbackPort,
        ISafeLogger? logger = null,
        TimeProvider? timeProvider = null)
    {
        _options = options;
        _runtime = runtime;
        _operationFactory = operationFactory;
        _signer = signer;
        _operationGate = operationGate;
        _serverTrust = serverTrust;
        _callbackPort = callbackPort;
        _logger = logger ?? new ConsoleSafeLogger();
        _timeProvider = timeProvider ?? TimeProvider.System;
        if (!serverTrust.Enabled || !options.IsConfigured) return;
        options.ValidateConfiguration();
        _statePath = ProtectedJobDirectory.ContainedFile(options.JobRoot, StateFileName);
        AssertNoOrphanedV2TemporaryState();
        RecoverPersistedState();
    }

    public bool Available => _serverTrust.Enabled && _options.IsConfigured;
    public bool HasActiveOperation { get { lock (_sync) return _operation is not null; } }
    public IReadOnlyList<string> TrustedJobSigningKeyIds => _serverTrust.KeyIds;

    public TenKingsV2NfcOperationResponse Prepare(TenKingsV2NfcPrepareRequest request, string requestId)
    {
        if (!Available) throw Error("v2_nfc_unavailable", "NFC V2 is unavailable on this helper configuration.", false, 503);
        var job = request.Job ?? throw Error("v2_nfc_context_invalid", "The NFC V2 signed job is required.", false, 400);
        var spki = RequireTrustedJob(job);
        try { TenKingsV2NfcProtocol.RequireMayStart(job, UtcNow()); }
        finally { CryptographicOperations.ZeroMemory(spki); }
        var hash = TenKingsV2NfcProtocol.JobEnvelopeSha256(job);
        lock (_sync)
        {
            if (_operation is not null)
            {
                if (!SecureEquals(_operation.JobEnvelopeSha256, hash))
                    throw Error("v2_nfc_operation_conflict", "Finish the protected NFC operation before starting another card.", false, 409);
                return Response(_operation);
            }
            AssertNoPersistedStateBeforeStart();
            var inspection = _runtime.Inspect(_options);
            if (!inspection.Ready)
                throw Error(inspection.ErrorCode ?? "gototags_dependency_unavailable", "GoToTags is not ready for F8215 encoding.", true, 503);
            if (!_operationGate.TryEnterAsync(CancellationToken.None).GetAwaiter().GetResult())
                throw Error("reader_busy", "Another V1 or V2 NFC operation already owns the workstation.", true, 409);
            _ownsGate = true;

            var now = UtcNow();
            var callbackIdentity = RandomIdentity(32);
            var correlationId = RandomIdentity(32);
            var operationFileName = $"f8215-v2-{RandomIdentity(16)}.gototags";
            var operation = new TenKingsV2PersistedOperation(
                job,
                hash,
                job.Url,
                correlationId,
                callbackIdentity,
                operationFileName,
                "preparing",
                null,
                null,
                null,
                CanonicalUtc(now),
                CanonicalUtc(now));
            _operation = operation;
            try
            {
                Persist(operation);
                var path = _operationFactory.Create(
                    _options,
                    operationFileName,
                    job.CardId,
                    correlationId,
                    callbackIdentity,
                    job.Url,
                    _callbackPort,
                    now,
                    "gototags/v2/callback");
                _runtime.LaunchOperation(_options, path);
                operation = operation with { Phase = "awaiting_manual_start", UpdatedAt = CanonicalUtc(UtcNow()) };
                _operation = operation;
                Persist(operation);
                _logger.Info("v2_nfc_operation_prepared", requestId, "awaiting_manual_start");
                return Response(operation);
            }
            catch (Exception error)
            {
                operation = operation with
                {
                    Phase = "uncertain",
                    ErrorCode = error is NfcHelperException helperError ? helperError.Code : "v2_nfc_prepare_failed",
                    DiscardAcknowledgementNonce = RandomIdentity(24),
                    UpdatedAt = CanonicalUtc(UtcNow()),
                };
                _operation = operation;
                Persist(operation);
                throw;
            }
        }
    }

    public TenKingsV2NfcOperationResponse Status(TenKingsV2NfcStatusRequest request)
    {
        ValidateHash(request.JobEnvelopeSha256);
        lock (_sync)
        {
            var operation = RequireMatching(request.JobEnvelopeSha256);
            if (!Terminal(operation.Phase) && operation.Phase != "closing" &&
                UtcNow() > ParseTimestamp(operation.SignedJob.ExpiresAt))
            {
                operation = operation with
                {
                    Phase = "uncertain",
                    ErrorCode = "v2_nfc_job_expired",
                    DiscardAcknowledgementNonce = operation.DiscardAcknowledgementNonce ?? RandomIdentity(24),
                    UpdatedAt = CanonicalUtc(UtcNow()),
                };
                _operation = operation;
                Persist(operation);
            }
            return Response(operation);
        }
    }

    public TenKingsV2NfcAcknowledgeResponse AcknowledgeSuccess(
        TenKingsV2NfcSuccessAcknowledgeRequest request,
        string requestId)
    {
        ValidateHash(request.JobEnvelopeSha256);
        lock (_sync)
        {
            var operation = RequireMatching(request.JobEnvelopeSha256);
            if (operation.Phase != "completed" && !(operation.Phase == "closing" && operation.TerminalResult is not null))
                throw Error("v2_nfc_success_not_ready", "Only a completed NFC V2 result may be acknowledged.", false, 409);
            operation = operation with { Phase = "closing", ErrorCode = null, UpdatedAt = CanonicalUtc(UtcNow()) };
            _operation = operation;
            Persist(operation);
            Close(operation);
            _logger.Info("v2_nfc_success_acknowledged", requestId, "protected_operation_removed");
            return new TenKingsV2NfcAcknowledgeResponse(true);
        }
    }

    public TenKingsV2NfcAcknowledgeResponse AcknowledgeDiscard(
        TenKingsV2NfcDiscardAcknowledgeRequest request,
        string requestId)
    {
        ValidateHash(request.JobEnvelopeSha256);
        if (request.Phase is not ("failed" or "uncertain") ||
            string.IsNullOrEmpty(request.AcknowledgementNonce) ||
            !NoncePattern().IsMatch(request.AcknowledgementNonce))
            throw Error("v2_nfc_discard_ack_invalid", "The failed-tag discard acknowledgement is invalid.", false, 400);
        lock (_sync)
        {
            var operation = RequireMatching(request.JobEnvelopeSha256);
            var acceptedClosing = operation.Phase == "closing" &&
                operation.ErrorCode == $"closing_from_{request.Phase}";
            if ((!acceptedClosing && operation.Phase != request.Phase) ||
                operation.DiscardAcknowledgementNonce is null ||
                !SecureEquals(operation.DiscardAcknowledgementNonce, request.AcknowledgementNonce))
                throw Error("v2_nfc_discard_ack_mismatch", "The discard acknowledgement does not match the exact failed operation.", false, 409);
            operation = operation with
            {
                Phase = "closing",
                ErrorCode = $"closing_from_{request.Phase}",
                UpdatedAt = CanonicalUtc(UtcNow()),
            };
            _operation = operation;
            Persist(operation);
            Close(operation);
            _logger.Info("v2_nfc_discard_acknowledged", requestId, request.Phase);
            return new TenKingsV2NfcAcknowledgeResponse(true);
        }
    }

    public void AcceptCallback(string callbackIdentity, ReadOnlyMemory<byte> body, string requestId)
    {
        if (!CallbackPattern().IsMatch(callbackIdentity))
            throw Error("gototags_callback_not_found", "The GoToTags callback identity is invalid.", false, 404);
        lock (_sync)
        {
            var operation = _operation ?? throw Error("gototags_callback_not_found", "The GoToTags callback identity is not active.", false, 404);
            if (!SecureEquals(operation.CallbackIdentity, callbackIdentity))
                throw Error("gototags_callback_not_found", "The GoToTags callback identity is not active.", false, 404);
            if (operation.Phase == "completed")
                throw Error("gototags_callback_replayed", "The GoToTags callback was already consumed.", false, 409);
            if (Terminal(operation.Phase) || operation.Phase == "closing")
                throw Error("gototags_job_terminal", "The NFC operation no longer accepts callbacks.", false, 409);
            if (UtcNow() > ParseTimestamp(operation.SignedJob.ExpiresAt))
                throw Error("gototags_callback_stale", "The GoToTags completion arrived after the signed job expired.", false, 410);

            try
            {
                var parsed = GoToTagsCallbackParser.ParseV2(body, operation.CorrelationId, operation.Url);
                var spki = RequireTrustedJob(operation.SignedJob);
                TenKingsV2NfcTerminalResult result;
                try
                {
                    result = TenKingsV2NfcProtocol.CreateTerminalResult(
                        operation.SignedJob,
                        spki,
                        _signer,
                        parsed.ReadbackPayloadSha256,
                        WorkstationAttestation.FormatObservedAt(UtcNow()));
                }
                finally
                {
                    CryptographicOperations.ZeroMemory(spki);
                }
                operation = operation with
                {
                    Phase = "completed",
                    ErrorCode = null,
                    DiscardAcknowledgementNonce = null,
                    TerminalResult = result,
                    UpdatedAt = CanonicalUtc(UtcNow()),
                };
                _operation = operation;
                Persist(operation);
                _logger.Info("v2_nfc_operation_completed", requestId, TenKingsV2NfcProtocol.ReaderResultCode);
            }
            catch (NfcHelperException error)
            {
                operation = operation with
                {
                    Phase = "uncertain",
                    ErrorCode = error.Code,
                    DiscardAcknowledgementNonce = RandomIdentity(24),
                    UpdatedAt = CanonicalUtc(UtcNow()),
                };
                _operation = operation;
                Persist(operation);
                throw;
            }
        }
    }

    private byte[] RequireTrustedJob(TenKingsV2NfcSignedJob job)
    {
        if (!_serverTrust.TryCopyPublicSpki(job.SigningKeyId, out var spki) ||
            !TenKingsV2NfcProtocol.VerifyJob(job, spki))
        {
            if (spki.Length > 0) CryptographicOperations.ZeroMemory(spki);
            throw Error("v2_nfc_job_untrusted", "The NFC V2 server job is not trusted.", false, 403);
        }
        return spki;
    }

    private void RecoverPersistedState()
    {
        if (_statePath is null || !File.Exists(_statePath)) return;
        AssertNoDualPersistedState();
        try
        {
            ProtectedJobDirectory.AssertProtectedContainedLeaf(_options.JobRoot, _statePath);
            var bytes = File.ReadAllBytes(_statePath);
            try
            {
                if (bytes.Length is <= 0 or > NfcProtocol.MaxJsonBytes) throw new JsonException();
                var operation = JsonSerializer.Deserialize<TenKingsV2PersistedOperation>(bytes, PersistedJson) ?? throw new JsonException();
                ValidatePersisted(operation);
                if (!_operationGate.TryEnterAsync(CancellationToken.None).GetAwaiter().GetResult())
                    throw Error("v2_nfc_recovery_conflict", "Persisted V1 and V2 NFC operations conflict.", false, 503);
                _ownsGate = true;
                _operation = operation;
                if (operation.Phase is "preparing" or "awaiting_manual_start")
                {
                    operation = operation with
                    {
                        Phase = "uncertain",
                        ErrorCode = "v2_nfc_helper_restarted",
                        DiscardAcknowledgementNonce = operation.DiscardAcknowledgementNonce ?? RandomIdentity(24),
                        UpdatedAt = CanonicalUtc(UtcNow()),
                    };
                    _operation = operation;
                    Persist(operation);
                }
            }
            finally { CryptographicOperations.ZeroMemory(bytes); }
        }
        catch (NfcHelperException) { throw; }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            throw Error("v2_nfc_recovery_state_invalid", "The protected NFC V2 state requires review.", false, 503);
        }
    }

    private void ValidatePersisted(TenKingsV2PersistedOperation operation)
    {
        ValidateHash(operation.JobEnvelopeSha256);
        var successClosing = operation.Phase == "closing" &&
            operation.TerminalResult is not null &&
            operation.ErrorCode is null &&
            operation.DiscardAcknowledgementNonce is null;
        var discardClosing = operation.Phase == "closing" &&
            operation.TerminalResult is null &&
            operation.ErrorCode is "closing_from_failed" or "closing_from_uncertain" &&
            operation.DiscardAcknowledgementNonce is not null;
        var completed = operation.Phase == "completed" &&
            operation.TerminalResult is not null &&
            operation.ErrorCode is null &&
            operation.DiscardAcknowledgementNonce is null;
        var failedOrUncertain = operation.Phase is "failed" or "uncertain";
        if (!TryParseInternalTimestamp(operation.CreatedAt, out var createdAt) ||
            !TryParseInternalTimestamp(operation.UpdatedAt, out var updatedAt) ||
            updatedAt < createdAt)
            throw new JsonException();
        if (operation.JobEnvelopeSha256 != TenKingsV2NfcProtocol.JobEnvelopeSha256(operation.SignedJob) ||
            operation.Url != operation.SignedJob.Url ||
            !CallbackPattern().IsMatch(operation.CorrelationId) ||
            !CallbackPattern().IsMatch(operation.CallbackIdentity) ||
            !OperationFilePattern().IsMatch(operation.OperationFileName) ||
            !AllowedPhase(operation.Phase) ||
            operation.ErrorCode is not null && !ErrorCodePattern().IsMatch(operation.ErrorCode) ||
            operation.DiscardAcknowledgementNonce is not null && !NoncePattern().IsMatch(operation.DiscardAcknowledgementNonce) ||
            operation.Phase == "closing" && !successClosing && !discardClosing ||
            operation.Phase == "completed" && !completed ||
            failedOrUncertain && (operation.TerminalResult is not null || operation.DiscardAcknowledgementNonce is null || operation.ErrorCode is null) ||
            operation.Phase is "preparing" or "awaiting_manual_start" &&
                (operation.TerminalResult is not null || operation.DiscardAcknowledgementNonce is not null || operation.ErrorCode is not null))
            throw new JsonException();
        var spki = RequireTrustedJob(operation.SignedJob);
        try
        {
            if (operation.TerminalResult is not null)
            {
                var workstationSpki = _signer.ExportPublicSpki();
                try
                {
                    if (!TenKingsV2NfcProtocol.VerifyTerminalResult(operation.TerminalResult, operation.SignedJob, workstationSpki))
                        throw new JsonException();
                }
                finally { CryptographicOperations.ZeroMemory(workstationSpki); }
            }
        }
        finally { CryptographicOperations.ZeroMemory(spki); }
    }

    private void AssertNoDualPersistedState()
    {
        if (_statePath is null) return;
        var v1Path = ProtectedJobDirectory.ContainedFile(_options.JobRoot, V1StateFileName);
        if (File.Exists(v1Path) && File.Exists(_statePath))
            throw Error("v2_nfc_dual_recovery_state", "Persisted V1 and V2 NFC states conflict; no state was changed.", false, 503);
    }

    private void AssertNoOrphanedV2TemporaryState()
    {
        try
        {
            foreach (var path in Directory.EnumerateFiles(_options.JobRoot, "v2-state-*.tmp", SearchOption.TopDirectoryOnly))
            {
                if (TemporaryStateFilePattern().IsMatch(Path.GetFileName(path)))
                    throw Error("v2_nfc_recovery_state_invalid", "A protected NFC V2 state write requires review.", false, 503);
            }
        }
        catch (NfcHelperException) { throw; }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        { throw Error("v2_nfc_recovery_state_invalid", "The protected NFC V2 state directory requires review.", false, 503); }
    }

    private void AssertNoPersistedStateBeforeStart()
    {
        if (_statePath is null) return;
        var v1Path = ProtectedJobDirectory.ContainedFile(_options.JobRoot, V1StateFileName);
        if (File.Exists(v1Path) || File.Exists(_statePath))
            throw Error("v2_nfc_recovery_conflict", "A protected V1 or V2 NFC operation requires recovery before another card may start.", false, 503);
    }

    private void Persist(TenKingsV2PersistedOperation operation)
    {
        if (_statePath is null) throw Error("v2_nfc_unavailable", "NFC V2 protected state is unavailable.", false, 503);
        var temporary = ProtectedJobDirectory.ContainedFile(_options.JobRoot, $"v2-state-{RandomIdentity(12)}.tmp");
        var bytes = JsonSerializer.SerializeToUtf8Bytes(operation, PersistedJson);
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                stream.Write(bytes);
                stream.Flush(true);
            }
            ProtectedJobDirectory.ProtectContainedLeaf(_options.JobRoot, temporary);
            File.Move(temporary, _statePath, true);
            ProtectedJobDirectory.AssertProtectedContainedLeaf(_options.JobRoot, _statePath);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw Error("v2_nfc_state_unavailable", "The protected NFC V2 state could not be saved.", false, 503);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
            try { if (File.Exists(temporary)) File.Delete(temporary); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        }
    }

    private void Close(TenKingsV2PersistedOperation operation)
    {
        var operationPath = ProtectedJobDirectory.ContainedFile(_options.JobRoot, operation.OperationFileName);
        if (File.Exists(operationPath)) File.Delete(operationPath);
        if (_statePath is not null && File.Exists(_statePath)) File.Delete(_statePath);
        _operation = null;
        if (_ownsGate)
        {
            _operationGate.Exit();
            _ownsGate = false;
        }
    }

    private TenKingsV2PersistedOperation RequireMatching(string hash)
    {
        var operation = _operation ?? throw Error("v2_nfc_job_not_found", "No protected NFC V2 operation matches this browser state.", false, 404);
        if (!SecureEquals(operation.JobEnvelopeSha256, hash))
            throw Error("v2_nfc_job_mismatch", "A different NFC operation owns the workstation.", false, 409);
        return operation;
    }

    private static TenKingsV2NfcOperationResponse Response(TenKingsV2PersistedOperation operation) => new(
        NfcProtocol.ProtocolVersion,
        NfcProtocol.HelperVersion,
        TenKingsV2NfcProtocol.HelperCapability,
        operation.JobEnvelopeSha256,
        operation.SignedJob.CardId,
        operation.SignedJob.PublicToken,
        operation.Url,
        operation.Phase == "closing" && operation.TerminalResult is not null
            ? "closing_success"
            : operation.Phase == "closing" && operation.ErrorCode == "closing_from_failed"
                ? "closing_discard_failed"
                : operation.Phase == "closing" && operation.ErrorCode == "closing_from_uncertain"
                    ? "closing_discard_uncertain"
                    : operation.Phase,
        Terminal(operation.Phase) || operation.Phase == "closing",
        operation.ErrorCode,
        operation.DiscardAcknowledgementNonce,
        operation.TerminalResult);

    private static bool Terminal(string phase) => phase is "completed" or "failed" or "uncertain";
    private static bool AllowedPhase(string phase) => phase is "preparing" or "awaiting_manual_start" or "completed" or "failed" or "uncertain" or "closing";
    private DateTimeOffset UtcNow() => _timeProvider.GetUtcNow();
    private static string CanonicalUtc(DateTimeOffset value) => value.ToUniversalTime().ToString("O");
    private static DateTimeOffset ParseTimestamp(string value) => DateTimeOffset.Parse(value, null, System.Globalization.DateTimeStyles.RoundtripKind);
    private static bool TryParseInternalTimestamp(string value, out DateTimeOffset parsed) =>
        DateTimeOffset.TryParseExact(
            value,
            "O",
            System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.RoundtripKind,
            out parsed) &&
        parsed.Offset == TimeSpan.Zero &&
        string.Equals(parsed.ToUniversalTime().ToString("O"), value, StringComparison.Ordinal);
    private static string RandomIdentity(int bytes) => Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static bool SecureEquals(string left, string right) => NfcHttpServer.SecureEquals(left, right);
    private static void ValidateHash(string value) { if (string.IsNullOrEmpty(value) || !Sha256Pattern().IsMatch(value)) throw Error("v2_nfc_context_invalid", "The NFC V2 operation identity is invalid.", false, 400); }
    private static NfcHelperException Error(string code, string message, bool retryable, int status) => new(code, message, retryable, status);

    [GeneratedRegex("^[a-f0-9]{64}$", RegexOptions.CultureInvariant)] private static partial Regex Sha256Pattern();
    [GeneratedRegex("^[A-Za-z0-9_-]{43}$", RegexOptions.CultureInvariant)] private static partial Regex CallbackPattern();
    [GeneratedRegex("^[A-Za-z0-9_-]{32}$", RegexOptions.CultureInvariant)] private static partial Regex NoncePattern();
    [GeneratedRegex("^f8215-v2-[A-Za-z0-9_-]{22}\\.gototags$", RegexOptions.CultureInvariant)] private static partial Regex OperationFilePattern();
    [GeneratedRegex("^v2-state-[A-Za-z0-9_-]{16}\\.tmp$", RegexOptions.CultureInvariant)] private static partial Regex TemporaryStateFilePattern();
    [GeneratedRegex("^[a-z0-9_]{1,80}$", RegexOptions.CultureInvariant)] private static partial Regex ErrorCodePattern();
}
