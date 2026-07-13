using System.Text.Json.Serialization;

namespace TenKings.AiGrader.NfcHelper;

public static class NfcProtocol
{
    public const string HelperVersion = "tenkings-ai-grader-nfc-helper-v2";
    public const string ProtocolVersion = "tenkings-ai-grader-nfc-loopback-v2";
    public const string AttestationSchemaVersion = "ai-grader-nfc-helper-attestation-v1";
    public const string AttestationAlgorithm = "ecdsa-p256-sha256-p1363";
    public const string WorkstationKeyName = "TenKings.AiGrader.Nfc.WorkstationAttestation.v1";
    public const string ChipType = "NTAG215";
    public const string SecurityMode = "static_url_v1";
    public const string ProductionOrigin = "https://collect.tenkings.co";
    public const string ProductionUrlPrefix = "https://collect.tenkings.co/nfc/";
    public const string HardwareGateTestUrl = "https://collect.tenkings.co/nfc/test";
    public const int MaxJsonBytes = 32 * 1024;
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
    string? ErrorCode = null);

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

public sealed record WorkstationKeyMetadata(
    string KeyName,
    string KeyId,
    string Algorithm);

public sealed record WorkstationPublicKeyExport(
    string KeyId,
    string Algorithm,
    string PublicSpkiDerBase64);

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
[JsonSerializable(typeof(NfcOperationalAttestation))]
[JsonSerializable(typeof(WorkstationKeyMetadata))]
[JsonSerializable(typeof(WorkstationPublicKeyExport))]
[JsonSerializable(typeof(ApiEnvelope<PairResponse>))]
[JsonSerializable(typeof(ApiEnvelope<HelperStatusResponse>))]
[JsonSerializable(typeof(ApiEnvelope<NfcReadResponse>))]
[JsonSerializable(typeof(ApiEnvelope<NfcWriteResponse>))]
[JsonSerializable(typeof(ApiEnvelope<object>))]
[JsonSerializable(typeof(HardwareGateResult))]
public partial class NfcJsonContext : JsonSerializerContext;
