using System.Text.Json.Serialization;

namespace TenKings.AiGrader.NfcHelper;

public static class NfcProtocol
{
    public const string HelperVersion = "tenkings-ai-grader-nfc-helper-v3";
    public const string ProtocolVersion = "tenkings-ai-grader-nfc-loopback-v2";
    public const string AttestationSchemaVersion = "ai-grader-nfc-helper-attestation-v1";
    public const string MultiProfileAttestationSchemaVersion = "ai-grader-nfc-helper-attestation-v2";
    public const string AttestationAlgorithm = "ecdsa-p256-sha256-p1363";
    public const string WorkstationKeyName = "TenKings.AiGrader.Nfc.WorkstationAttestation.v1";
    public const string ChipType = "NTAG215";
    public const string SecurityMode = "static_url_v1";
    public const string Ntag215ProgrammingProfile = "ntag215_direct_pcsc_v1";
    public const string FeijuChipType = "FEIJU_F8215";
    public const string FeijuProgrammingProfile = "gototags_manual_start_v1";
    public const string FeijuAdapterIdentity = "gototags_desktop";
    public const string ApprovedGoToTagsVersion = "4.37.0.1";
    public const string ApprovedGoToTagsExecutableSha256 = "d21adfdef57393b948ce4e6d8771f6daa215041fa27c777ef33de24057883774";
    public const string ApprovedGoToTagsProgId = "AppXtamynr710a4k4xderv2ath0xe29hgtkd";
    public const string ApprovedGoToTagsAppUserModelId = "Desktopapp_14h5dv7m6vvvy!GoToTags";
    public const string ApprovedGoToTagsPackageResourcePrefix = "@{Desktopapp_4.37.0.1_x64__14h5dv7m6vvvy?";
    public const string ApprovedGoToTagsDelegateExecute = "{BFEC0C93-0B7D-4F2C-B09C-AFFFC4BDAE78}";
    public const string ApprovedGoToTagsTemplateSha256 = "31bfcca6cfd0e947d5368643a0aeed2ce730b9e0ad2ed9d0a503cfd5e5e05c3d";
    public const string FeijuReaderResultCode = "write_locked_verified_gototags_readback";
    public const string FeijuQuarantineConfirmation = "I removed and quarantined the exact F8215 tag for this attempt.";
    public const string FeijuWriteProtectionState = "permanently_read_only_verified";
    public const string Ntag424ChipType = "NTAG424_DNA";
    public const string Ntag424ProgrammingProfile = "ntag424_dna_unimplemented";
    public const string ProductionOrigin = "https://collect.tenkings.co";
    public const string ProductionUrlPrefix = "https://collect.tenkings.co/nfc/";
    public const string HardwareGateTestUrl = "https://collect.tenkings.co/nfc/test";
    public const int MaxJsonBytes = 32 * 1024;
    public const int MaxGoToTagsCallbackBytes = 64 * 1024;
    public const int DefaultPort = 47662;
    public const int DefaultOperationTimeoutMs = 10_000;
}

public sealed record HelperStatusResponse(
    string HelperProtocolVersion,
    bool ReaderConnected,
    bool PcscReady,
    string TagState,
    bool Busy,
    string ReaderModel,
    ReaderCapability Capability,
    string? ErrorCode = null,
    IReadOnlyList<SupportedNfcProfile>? SupportedProfiles = null,
    bool FeijuF8215Enabled = false,
    bool GoToTagsReady = false,
    string? GoToTagsErrorCode = null);

public sealed record SupportedNfcProfile(
    string ChipType,
    string SecurityMode,
    string ProgrammingProfile,
    string AdapterIdentity,
    bool Implemented,
    bool PermanentlyLocksTag);

public sealed record ReaderCapability(
    string ChipType,
    string SecurityMode,
    bool ReadSupported,
    bool WriteSupported,
    bool MultipleTagDetectionSupported,
    string TagSelectionEvidence);

public sealed record NfcReadResponse(
    string HelperProtocolVersion,
    string ChipType,
    string? NormalizedUrl,
    string? ReadbackPayloadSha256,
    string UidFingerprintSha256,
    string ReaderResultCode);

public sealed record NfcReadRequest(string AttemptId);

public sealed record OverwriteConfirmationRequest(bool Confirmed, string? ObservedPayloadSha256);

public sealed record NfcWriteRequest(
    string AttemptId,
    string IdempotencyKey,
    string PublicTagId,
    string AttestationChallenge,
    string Url,
    OverwriteConfirmationRequest? OverwriteConfirmation = null);

public sealed record NfcOperationalAttestation(
    string SchemaVersion,
    string WorkstationKeyId,
    string Algorithm,
    string AttestationChallenge,
    string ObservedAt,
    string Signature);

public sealed record NfcWriteResponse(
    string HelperProtocolVersion,
    string ChipType,
    string NormalizedUrl,
    string ReadbackPayloadSha256,
    string UidFingerprintSha256,
    string ReaderResultCode,
    NfcOperationalAttestation? OperationalAttestation = null,
    bool OverwriteRequired = false,
    string? ObservedPayloadSha256 = null);

public sealed record F8215PrepareRequest(
    string AttemptId,
    string IdempotencyKey,
    string PublicTagId,
    string AttestationChallenge,
    string Url,
    string AttemptExpiresAt,
    string ChipType,
    string ProgrammingProfile);

public sealed record F8215OperationStatusRequest(string AttemptId);

public sealed record F8215OperationAcknowledgeRequest(string AttemptId);

public sealed record F8215PrepareResponse(
    string HelperProtocolVersion,
    string AttemptId,
    string ChipType,
    string ProgrammingProfile,
    string Phase);

public sealed record F8215CompletionEvidence(
    string HelperProtocolVersion,
    string ChipType,
    string SecurityMode,
    string ProgrammingProfile,
    string AdapterIdentity,
    string AdapterVersion,
    string NormalizedUrl,
    string UidFingerprintSha256,
    string ReadbackPayloadSha256,
    string WriteProtectionState,
    string ReaderResultCode,
    NfcOperationalAttestation OperationalAttestation);

public sealed record F8215OperationStatusResponse(
    string HelperProtocolVersion,
    string AttemptId,
    string ChipType,
    string ProgrammingProfile,
    string Phase,
    bool Terminal,
    bool Retryable,
    string? ErrorCode = null,
    F8215CompletionEvidence? Evidence = null);

public sealed record F8215OperationAcknowledgeResponse(
    string HelperProtocolVersion,
    string AttemptId,
    bool Cleaned);

public sealed record F8215AbandonedResolutionResult(
    string HelperProtocolVersion,
    string AttemptFingerprintSha256,
    string PriorPhase,
    string Resolution,
    bool ProtectedArtifactsRemoved,
    bool OperationGateReleasedOnNextStart,
    bool EncodingSuccessClaimed);

public sealed record WorkstationKeyMetadata(
    string KeyName,
    string KeyId,
    string Algorithm);

public sealed record WorkstationPublicKeyExport(
    string KeyId,
    string Algorithm,
    string PublicSpkiDerBase64);

public sealed record NfcBuildVerificationResult(
    bool Ok,
    string HelperVersion,
    string HelperProtocolVersion,
    string AttestationSchemaVersion,
    string MultiProfileAttestationSchemaVersion,
    string AttestationAlgorithm,
    bool HardwareAccessed,
    bool ProductionKeyAccessed);

public sealed record PairRequest(string PairingCode);

public sealed record PairResponse(
    string WorkstationToken);

public sealed record HardwareGateResult(
    string ResultCode,
    bool ReaderDetected,
    bool TagRead,
    bool WriteAttempted,
    bool ExactReadbackVerified,
    bool OverwriteConfirmationRequired);

public sealed record F8215HardwareGateResult(
    string ResultCode,
    bool ExactTestUrlReadbackVerified,
    bool PermanentLockReported,
    bool PostWriteVerificationReported,
    bool TerminalCallbackVerified,
    int CallbackCount,
    long TotalElapsedMs);

public sealed record ApiEnvelope<T>(bool Ok, T? Result, ApiError? Error)
{
    public static ApiEnvelope<T> Success(T result) => new(true, result, null);
    public static ApiEnvelope<T> Failure(string code, string message, bool retryable = false) =>
        new(false, default, new ApiError(code, message, retryable));
}

public sealed record ApiError(string Code, string Message, bool Retryable);

public sealed class NfcHelperException : Exception
{
    public NfcHelperException(string code, string safeMessage, bool retryable = false, int httpStatus = 400)
        : base(safeMessage)
    {
        Code = code;
        Retryable = retryable;
        HttpStatus = httpStatus;
    }

    public string Code { get; }
    public bool Retryable { get; }
    public int HttpStatus { get; }
}

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow)]
[JsonSerializable(typeof(PairRequest))]
[JsonSerializable(typeof(NfcReadRequest))]
[JsonSerializable(typeof(NfcWriteRequest))]
[JsonSerializable(typeof(F8215PrepareRequest))]
[JsonSerializable(typeof(F8215OperationStatusRequest))]
[JsonSerializable(typeof(F8215OperationAcknowledgeRequest))]
[JsonSerializable(typeof(NfcOperationalAttestation))]
[JsonSerializable(typeof(WorkstationKeyMetadata))]
[JsonSerializable(typeof(WorkstationPublicKeyExport))]
[JsonSerializable(typeof(NfcBuildVerificationResult))]
[JsonSerializable(typeof(ApiEnvelope<PairResponse>))]
[JsonSerializable(typeof(ApiEnvelope<HelperStatusResponse>))]
[JsonSerializable(typeof(ApiEnvelope<NfcReadResponse>))]
[JsonSerializable(typeof(ApiEnvelope<NfcWriteResponse>))]
[JsonSerializable(typeof(ApiEnvelope<F8215PrepareResponse>))]
[JsonSerializable(typeof(ApiEnvelope<F8215OperationStatusResponse>))]
[JsonSerializable(typeof(ApiEnvelope<F8215OperationAcknowledgeResponse>))]
[JsonSerializable(typeof(F8215AbandonedResolutionResult))]
[JsonSerializable(typeof(ApiEnvelope<object>))]
[JsonSerializable(typeof(HardwareGateResult))]
[JsonSerializable(typeof(F8215HardwareGateResult))]
public partial class NfcJsonContext : JsonSerializerContext;
