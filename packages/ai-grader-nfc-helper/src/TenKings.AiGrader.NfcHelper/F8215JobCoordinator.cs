using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TenKings.AiGrader.NfcHelper;

internal sealed record F8215PersistedJob(
    string AttemptId,
    string RequestDigest,
    string PublicTagId,
    string AttestationChallenge,
    string Url,
    string AttemptExpiresAt,
    string CallbackIdentity,
    string CorrelationId,
    string OperationFileName,
    string Phase,
    bool Retryable,
    string? ErrorCode,
    string? CallbackBodySha256,
    F8215CompletionEvidence? Evidence,
    string CreatedAt,
    string UpdatedAt);

public sealed partial class F8215JobCoordinator
{
    private const string StateFileName = "active-job.json";
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
    private readonly ISafeLogger _logger;
    private readonly TimeProvider _timeProvider;
    private readonly int _callbackPort;
    private readonly string? _statePath;
    private F8215PersistedJob? _job;
    private bool _ownsOperationGate;

    public F8215JobCoordinator(
        GoToTagsAdapterOptions options,
        IGoToTagsAdapterRuntime runtime,
        GoToTagsOperationFactory operationFactory,
        IWorkstationAttestationSigner signer,
        NfcOperationGate operationGate,
        int callbackPort,
        ISafeLogger? logger = null,
        TimeProvider? timeProvider = null)
    {
        _options = options;
        _runtime = runtime;
        _operationFactory = operationFactory;
        _signer = signer;
        _operationGate = operationGate;
        _callbackPort = callbackPort;
        _logger = logger ?? new ConsoleSafeLogger();
        _timeProvider = timeProvider ?? TimeProvider.System;
        if (!_options.IsConfigured) return;
        _options.ValidateConfiguration();
        _statePath = ProtectedJobDirectory.ContainedFile(_options.JobRoot, StateFileName);
        RecoverPersistedState();
    }

    public bool HasActiveJob
    {
        get { lock (_sync) return _job is not null; }
    }

    public GoToTagsAdapterInspection Inspect() => _runtime.Inspect(_options);

    public F8215PrepareResponse Prepare(F8215PrepareRequest request, string requestId)
    {
        ValidatePrepare(request);
        lock (_sync)
        {
            var digest = RequestDigest(request);
            if (_job is not null)
            {
                if (!SecureEquals(_job.AttemptId, request.AttemptId) || !SecureEquals(_job.RequestDigest, digest))
                    throw Error("gototags_job_conflict", "Finish or recover the active NFC job before preparing another one.", false, 409);
                return PrepareResponse(_job);
            }

            var inspection = _runtime.Inspect(_options);
            if (!inspection.Ready)
                throw Error(inspection.ErrorCode ?? "gototags_dependency_unavailable", "GoToTags is not ready for Feiju encoding.", true, 503);
            if (!_operationGate.TryEnterAsync(CancellationToken.None).GetAwaiter().GetResult())
                throw Error("reader_busy", "Another NFC operation is already active.", true, 409);
            _ownsOperationGate = true;

            var now = UtcNow();
            var callbackIdentity = RandomIdentity(32);
            var correlationId = RandomIdentity(32);
            var operationFileName = $"f8215-{RandomIdentity(16)}.gototags";
            var job = new F8215PersistedJob(
                request.AttemptId,
                digest,
                request.PublicTagId,
                request.AttestationChallenge,
                request.Url,
                CanonicalUtc(ParseAttemptExpiry(request.AttemptExpiresAt)),
                callbackIdentity,
                correlationId,
                operationFileName,
                "awaiting_manual_start",
                false,
                null,
                null,
                null,
                CanonicalUtc(now),
                CanonicalUtc(now));
            try
            {
                _job = job;
                Persist(job);
                var operationPath = _operationFactory.Create(
                    _options,
                    operationFileName,
                    request.AttemptId,
                    correlationId,
                    callbackIdentity,
                    request.Url,
                    _callbackPort,
                    now);
                _runtime.LaunchOperation(_options, operationPath);
                _logger.Info("gototags_job_prepared", requestId, "awaiting_manual_start");
                return PrepareResponse(job);
            }
            catch
            {
                CleanupOperationFile(operationFileName);
                DeleteStateFile();
                _job = null;
                ReleaseOperationGate();
                throw;
            }
        }
    }

    public F8215OperationStatusResponse Status(F8215OperationStatusRequest request)
    {
        ValidateContext(request.AttemptId, "attemptId");
        lock (_sync)
        {
            var job = RequireMatchingJob(request.AttemptId);
            if (!IsTerminal(job.Phase) && UtcNow() > ParseAttemptExpiry(job.AttemptExpiresAt))
            {
                job = job with
                {
                    Phase = "uncertain",
                    ErrorCode = "gototags_attempt_expired",
                    Retryable = false,
                    UpdatedAt = CanonicalUtc(UtcNow()),
                };
                _job = job;
                Persist(job);
            }
            return StatusResponse(job);
        }
    }

    public F8215OperationAcknowledgeResponse Acknowledge(F8215OperationAcknowledgeRequest request, string requestId)
    {
        ValidateContext(request.AttemptId, "attemptId");
        lock (_sync)
        {
            var job = RequireMatchingJob(request.AttemptId);
            if (!string.Equals(job.Phase, "completed", StringComparison.Ordinal) || job.Evidence is null)
                throw Error("gototags_job_not_completed", "Only an exact completed Feiju job may be acknowledged and cleaned.", false, 409);
            CleanupOperationFile(job.OperationFileName);
            DeleteStateFile();
            _job = null;
            ReleaseOperationGate();
            _logger.Info("gototags_job_acknowledged", requestId, "protected_artifacts_removed");
            return new F8215OperationAcknowledgeResponse(NfcProtocol.ProtocolVersion, request.AttemptId, true);
        }
    }

    public static F8215AbandonedResolutionResult ResolveAbandonedJob(
        string jobRoot,
        string attemptId,
        string confirmation,
        TimeProvider? timeProvider = null)
    {
        if (!HostedAttemptPattern().IsMatch(attemptId))
            throw Error("invalid_request_context", "attemptId is invalid.", false, 400);
        if (!string.Equals(confirmation, NfcProtocol.FeijuQuarantineConfirmation, StringComparison.Ordinal))
            throw Error(
                "gototags_quarantine_confirmation_required",
                "Exact confirmation that the physical tag was removed and quarantined is required.",
                false,
                400);
        ProtectedJobDirectory.Assert(jobRoot);
        var statePath = ProtectedJobDirectory.ContainedFile(jobRoot, StateFileName);
        if (!File.Exists(statePath))
            throw Error("gototags_job_not_found", "No protected Feiju job exists for this attempt.", false, 404);

        var bytes = File.ReadAllBytes(statePath);
        F8215PersistedJob job;
        try
        {
            if (bytes.Length is <= 0 or > NfcProtocol.MaxJsonBytes) throw new JsonException();
            job = JsonSerializer.Deserialize<F8215PersistedJob>(bytes, PersistedJson) ?? throw new JsonException();
            ValidatePersisted(job);
        }
        catch (JsonException)
        {
            throw Error("gototags_recovery_state_invalid", "The protected Feiju recovery state requires operator review.", false, 503);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
        }

        if (!SecureEquals(job.AttemptId, attemptId))
            throw Error("gototags_job_mismatch", "The protected Feiju job belongs to a different hosted attempt.", false, 409);
        if (job.Phase is not ("failed" or "uncertain"))
            throw Error(
                "gototags_abandoned_job_not_resolvable",
                "Only a failed or uncertain Feiju job may be resolved through quarantine maintenance.",
                false,
                409);

        var operationPath = ProtectedJobDirectory.ContainedFile(jobRoot, job.OperationFileName);
        var auditPath = ProtectedJobDirectory.ContainedFile(jobRoot, "abandoned-job-audit.jsonl");
        var fingerprint = Sha256(attemptId);
        AppendResolutionAudit(auditPath, new
        {
            schemaVersion = "tenkings-ai-grader-nfc-abandoned-resolution-v1",
            attemptFingerprintSha256 = fingerprint,
            priorPhase = job.Phase,
            errorCode = job.ErrorCode,
            physicalTagDisposition = "removed_and_quarantined",
            action = "quarantine_resolution_authorized",
            encodingSuccessClaimed = false,
            resolvedAt = CanonicalUtc((timeProvider ?? TimeProvider.System).GetUtcNow()),
        });

        // The exact local recovery identity is intentionally removed last.
        // A failed operation-file cleanup leaves state available for a bounded retry.
        TryDelete(operationPath);
        TryDelete(statePath);
        return new F8215AbandonedResolutionResult(
            NfcProtocol.ProtocolVersion,
            fingerprint,
            job.Phase,
            "quarantined_abandoned_job_resolved",
            true,
            true,
            false);
    }

    private static void AppendResolutionAudit(string auditPath, object record)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(record, PersistedJson);
        try
        {
            if (bytes.Length > 4096 || File.Exists(auditPath) && new FileInfo(auditPath).Length + bytes.Length + 1 > 1024 * 1024)
                throw Error("gototags_resolution_audit_full", "The protected quarantine audit reached its reviewed size bound; no cleanup was performed.", false, 503);
            using var stream = new FileStream(auditPath, FileMode.OpenOrCreate, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough);
            stream.Seek(0, SeekOrigin.End);
            stream.Write(bytes);
            stream.WriteByte((byte)'\n');
            stream.Flush(true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw Error("gototags_resolution_audit_failed", "The protected quarantine audit could not be saved; no cleanup was performed.", false, 503);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
        }
    }

    public void AcceptCallback(string callbackIdentity, ReadOnlyMemory<byte> body, string requestId)
    {
        if (!CallbackPattern().IsMatch(callbackIdentity))
            throw Error("gototags_callback_not_found", "The GoToTags callback identity is invalid.", false, 404);
        lock (_sync)
        {
            var job = _job ?? throw Error("gototags_callback_not_found", "The GoToTags callback identity is not active.", false, 404);
            if (!SecureEquals(job.CallbackIdentity, callbackIdentity))
                throw Error("gototags_callback_not_found", "The GoToTags callback identity is not active.", false, 404);
            if (job.CallbackBodySha256 is not null || string.Equals(job.Phase, "completed", StringComparison.Ordinal))
                throw Error("gototags_callback_replayed", "The GoToTags completion callback was already consumed.", false, 409);
            if (IsTerminal(job.Phase))
                throw Error("gototags_job_terminal", "The Feiju job no longer accepts callbacks.", false, 409);
            if (UtcNow() > ParseAttemptExpiry(job.AttemptExpiresAt))
                throw Error("gototags_callback_stale", "The GoToTags completion arrived after the hosted attempt expired.", false, 410);

            var parsed = GoToTagsCallbackParser.Parse(body, job.CorrelationId, job.Url);
            var observedAt = WorkstationAttestation.FormatObservedAt(UtcNow());
            var attestation = MultiProfileWorkstationAttestation.Create(
                _signer,
                new MultiProfileAttestationFields(
                    job.AttemptId,
                    job.AttestationChallenge,
                    job.PublicTagId,
                    job.Url,
                    NfcProtocol.FeijuChipType,
                    NfcProtocol.SecurityMode,
                    NfcProtocol.FeijuProgrammingProfile,
                    NfcProtocol.FeijuAdapterIdentity,
                    NfcProtocol.ApprovedGoToTagsVersion,
                    parsed.UidFingerprintSha256,
                    parsed.ReadbackPayloadSha256,
                    NfcProtocol.FeijuWriteProtectionState,
                    NfcProtocol.FeijuReaderResultCode,
                    NfcProtocol.ProtocolVersion,
                    observedAt));
            var evidence = new F8215CompletionEvidence(
                NfcProtocol.ProtocolVersion,
                NfcProtocol.FeijuChipType,
                NfcProtocol.SecurityMode,
                NfcProtocol.FeijuProgrammingProfile,
                NfcProtocol.FeijuAdapterIdentity,
                NfcProtocol.ApprovedGoToTagsVersion,
                job.Url,
                parsed.UidFingerprintSha256,
                parsed.ReadbackPayloadSha256,
                NfcProtocol.FeijuWriteProtectionState,
                NfcProtocol.FeijuReaderResultCode,
                attestation);
            job = job with
            {
                Phase = "completed",
                Retryable = false,
                ErrorCode = null,
                CallbackBodySha256 = parsed.CallbackBodySha256,
                Evidence = evidence,
                UpdatedAt = CanonicalUtc(UtcNow()),
            };
            _job = job;
            Persist(job);
            if (!TryCleanupOperationFile(job.OperationFileName))
                _logger.Error("gototags_job_cleanup_deferred", requestId, "protected_operation_retained");
            _logger.Info("gototags_job_completed", requestId, NfcProtocol.FeijuReaderResultCode);
        }
    }

    private void RecoverPersistedState()
    {
        if (_statePath is null || !File.Exists(_statePath)) return;
        try
        {
            var bytes = File.ReadAllBytes(_statePath);
            try
            {
                if (bytes.Length is <= 0 or > NfcProtocol.MaxJsonBytes) throw new JsonException();
                var job = JsonSerializer.Deserialize<F8215PersistedJob>(bytes, PersistedJson) ?? throw new JsonException();
                ValidatePersisted(job);
                if (!IsTerminal(job.Phase))
                {
                    job = job with
                    {
                        Phase = "uncertain",
                        Retryable = false,
                        ErrorCode = "gototags_helper_restarted",
                        UpdatedAt = CanonicalUtc(UtcNow()),
                    };
                    Persist(job);
                }
                if (!_operationGate.TryEnterAsync(CancellationToken.None).GetAwaiter().GetResult())
                    throw new NfcHelperException("gototags_recovery_conflict", "The protected Feiju recovery state conflicts with another NFC operation.", false, 503);
                _ownsOperationGate = true;
                _job = job;
            }
            finally
            {
                CryptographicOperations.ZeroMemory(bytes);
            }
        }
        catch (NfcHelperException)
        {
            throw;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            throw new NfcHelperException("gototags_recovery_state_invalid", "The protected Feiju recovery state requires operator review.", false, 503);
        }
    }

    private void ValidatePrepare(F8215PrepareRequest request)
    {
        _options.ValidateConfiguration();
        ValidateContext(request.AttemptId, "attemptId");
        ValidateContext(request.IdempotencyKey, "idempotencyKey");
        WorkstationAttestation.ValidateChallenge(request.AttestationChallenge);
        if (!PublicTagIdPattern().IsMatch(request.PublicTagId) ||
            !string.Equals(request.Url, NfcProtocol.ProductionUrlPrefix + request.PublicTagId, StringComparison.Ordinal))
            throw Error("invalid_request_context", "The Feiju URL must exactly match the hosted public tag identity.", false, 400);
        _ = NdefCodec.EncodeProductionUrl(request.Url);
        if (request.ChipType != NfcProtocol.FeijuChipType || request.ProgrammingProfile != NfcProtocol.FeijuProgrammingProfile)
            throw Error("unsupported_nfc_profile", "The selected NFC profile is not the exact Feiju F8215 workflow.", false, 422);
        var now = UtcNow();
        var expiry = ParseAttemptExpiry(request.AttemptExpiresAt);
        if (expiry <= now || expiry > now.AddMinutes(30))
            throw Error("invalid_request_context", "The hosted NFC attempt expiry is invalid.", false, 400);
    }

    private static void ValidatePersisted(F8215PersistedJob job)
    {
        ValidateContext(job.AttemptId, "attemptId");
        if (!Sha256Pattern().IsMatch(job.RequestDigest) || !PublicTagIdPattern().IsMatch(job.PublicTagId) ||
            !CallbackPattern().IsMatch(job.CallbackIdentity) || !CallbackPattern().IsMatch(job.CorrelationId) ||
            Path.GetFileName(job.OperationFileName) != job.OperationFileName ||
            !string.Equals(job.Url, NfcProtocol.ProductionUrlPrefix + job.PublicTagId, StringComparison.Ordinal) ||
            !AllowedPhase(job.Phase))
            throw new JsonException();
        WorkstationAttestation.ValidateChallenge(job.AttestationChallenge);
        _ = ParseAttemptExpiry(job.AttemptExpiresAt);
        if (job.CallbackBodySha256 is not null && !Sha256Pattern().IsMatch(job.CallbackBodySha256)) throw new JsonException();
        if (string.Equals(job.Phase, "completed", StringComparison.Ordinal) != (job.Evidence is not null)) throw new JsonException();
    }

    private void Persist(F8215PersistedJob job)
    {
        if (_statePath is null) throw Error("gototags_configuration_invalid", "The protected Feiju recovery state is unavailable.", false, 503);
        var temporary = ProtectedJobDirectory.ContainedFile(_options.JobRoot, $"state-{RandomIdentity(12)}.tmp");
        var bytes = JsonSerializer.SerializeToUtf8Bytes(job, PersistedJson);
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                stream.Write(bytes);
                stream.Flush(true);
            }
            File.Move(temporary, _statePath, true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw Error("gototags_recovery_state_unavailable", "The protected Feiju recovery state could not be saved.", false, 503);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
            TryDelete(temporary);
        }
    }

    private void DeleteStateFile()
    {
        if (_statePath is not null) TryDelete(_statePath);
    }

    private void CleanupOperationFile(string name) => TryDelete(ProtectedJobDirectory.ContainedFile(_options.JobRoot, name));

    private bool TryCleanupOperationFile(string name)
    {
        try
        {
            CleanupOperationFile(name);
            return true;
        }
        catch (NfcHelperException error) when (error.Code == "gototags_cleanup_failed")
        {
            return false;
        }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw Error("gototags_cleanup_failed", "The protected Feiju job cleanup requires operator review.", false, 503);
        }
    }

    private F8215PersistedJob RequireMatchingJob(string attemptId)
    {
        var job = _job ?? throw Error("gototags_job_not_found", "No Feiju job exists for this hosted attempt.", false, 404);
        if (!SecureEquals(job.AttemptId, attemptId))
            throw Error("gototags_job_mismatch", "The active Feiju job belongs to a different hosted attempt.", false, 409);
        return job;
    }

    private void ReleaseOperationGate()
    {
        if (!_ownsOperationGate) return;
        _operationGate.Exit();
        _ownsOperationGate = false;
    }

    private static F8215PrepareResponse PrepareResponse(F8215PersistedJob job) => new(
        NfcProtocol.ProtocolVersion,
        job.AttemptId,
        NfcProtocol.FeijuChipType,
        NfcProtocol.FeijuProgrammingProfile,
        job.Phase);

    private static F8215OperationStatusResponse StatusResponse(F8215PersistedJob job) => new(
        NfcProtocol.ProtocolVersion,
        job.AttemptId,
        NfcProtocol.FeijuChipType,
        NfcProtocol.FeijuProgrammingProfile,
        job.Phase,
        IsTerminal(job.Phase),
        job.Retryable,
        job.ErrorCode,
        job.Evidence);

    private DateTimeOffset UtcNow() => _timeProvider.GetUtcNow();
    private static DateTimeOffset ParseAttemptExpiry(string value) =>
        DateTimeOffset.TryParse(value, out var parsed) && parsed.Offset == TimeSpan.Zero
            ? parsed
            : throw Error("invalid_request_context", "The hosted NFC attempt expiry is invalid.", false, 400);
    private static string CanonicalUtc(DateTimeOffset value) => value.ToUniversalTime().ToString("O");
    private static bool IsTerminal(string phase) => phase is "completed" or "failed" or "uncertain";
    private static bool AllowedPhase(string phase) => phase is
        "awaiting_manual_start" or "completed" or "failed" or "uncertain";
    private static void ValidateContext(string value, string field)
    {
        if (!ContextPattern().IsMatch(value)) throw Error("invalid_request_context", $"{field} is invalid.", false, 400);
    }
    private static string RequestDigest(F8215PrepareRequest request) => Sha256(string.Join('\n',
        "f8215-prepare-v1", request.AttemptId, request.IdempotencyKey, request.PublicTagId,
        request.AttestationChallenge, request.Url, request.AttemptExpiresAt, request.ChipType, request.ProgrammingProfile));
    private static string Sha256(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    private static string RandomIdentity(int bytes) => Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static bool SecureEquals(string left, string right) => NfcHttpServer.SecureEquals(left, right);
    private static NfcHelperException Error(string code, string message, bool retryable, int status) => new(code, message, retryable, status);

    [GeneratedRegex("^[A-Za-z0-9_-]{8,128}$", RegexOptions.CultureInvariant)]
    private static partial Regex ContextPattern();
    [GeneratedRegex("^[A-Za-z0-9_-]{32}$", RegexOptions.CultureInvariant)]
    private static partial Regex PublicTagIdPattern();
    [GeneratedRegex("^[A-Za-z0-9_-]{20,128}$", RegexOptions.CultureInvariant)]
    private static partial Regex CallbackPattern();
    [GeneratedRegex("^[a-f0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256Pattern();
    [GeneratedRegex("^nfc_attempt_[A-Za-z0-9_-]{43}$", RegexOptions.CultureInvariant)]
    private static partial Regex HostedAttemptPattern();
}
