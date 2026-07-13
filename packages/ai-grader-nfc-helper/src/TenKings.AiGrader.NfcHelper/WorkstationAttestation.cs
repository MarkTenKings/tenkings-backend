using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace TenKings.AiGrader.NfcHelper;

public sealed record WorkstationAttestationFields(
    string AttemptId,
    string AttestationChallenge,
    string PublicTagId,
    string NormalizedUrl,
    string UidFingerprintSha256,
    string ReadbackPayloadSha256,
    string ReaderResultCode,
    string HelperProtocolVersion,
    string ObservedAt);

public interface IWorkstationAttestationSigner : IDisposable
{
    string WorkstationKeyId { get; }
    string Algorithm { get; }
    byte[] ExportPublicSpki();
    byte[] SignData(ReadOnlySpan<byte> statement);
}

public static partial class WorkstationAttestation
{
    private const string ObservedAtFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";

    public static NfcOperationalAttestation Create(
        IWorkstationAttestationSigner signer,
        WorkstationAttestationFields fields)
    {
        if (!string.Equals(signer.Algorithm, NfcProtocol.AttestationAlgorithm, StringComparison.Ordinal) ||
            !KeyIdPattern().IsMatch(signer.WorkstationKeyId))
        {
            throw new NfcHelperException(
                "attestation_signer_invalid",
                "The NFC workstation attestation signer is not configured safely.",
                false,
                503);
        }

        var statement = CanonicalStatement(fields);
        var statementBytes = Encoding.UTF8.GetBytes(statement);
        byte[]? signatureBytes = null;
        try
        {
            signatureBytes = signer.SignData(statementBytes);
            if (signatureBytes.Length != 64)
            {
                throw new NfcHelperException(
                    "attestation_signing_failed",
                    "The NFC workstation could not produce the required operational attestation.",
                    false,
                    503);
            }
            return new NfcOperationalAttestation(
                NfcProtocol.AttestationSchemaVersion,
                signer.WorkstationKeyId,
                signer.Algorithm,
                fields.AttestationChallenge,
                fields.ObservedAt,
                Base64Url(signatureBytes));
        }
        catch (NfcHelperException)
        {
            throw;
        }
        catch (Exception error) when (error is CryptographicException or ObjectDisposedException)
        {
            throw new NfcHelperException(
                "attestation_signing_failed",
                "The NFC workstation could not produce the required operational attestation.",
                false,
                503);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(statementBytes);
            if (signatureBytes is not null) CryptographicOperations.ZeroMemory(signatureBytes);
        }
    }

    public static string CanonicalStatement(WorkstationAttestationFields fields)
    {
        ValidateFields(fields);
        return string.Join('\n',
            NfcProtocol.AttestationSchemaVersion,
            fields.AttemptId,
            fields.AttestationChallenge,
            fields.PublicTagId,
            fields.NormalizedUrl,
            fields.UidFingerprintSha256,
            fields.ReadbackPayloadSha256,
            fields.ReaderResultCode,
            fields.HelperProtocolVersion,
            fields.ObservedAt);
    }

    public static string FormatObservedAt(DateTimeOffset value) =>
        value.ToUniversalTime().ToString(ObservedAtFormat, CultureInfo.InvariantCulture);

    public static void ValidateChallenge(string? challenge)
    {
        if (string.IsNullOrWhiteSpace(challenge) || !ChallengePattern().IsMatch(challenge))
            throw InvalidContext("attestationChallenge must be an unpadded base64url encoding of exactly 32 bytes.");
        byte[] decoded;
        try
        {
            decoded = DecodeBase64Url(challenge);
        }
        catch (FormatException)
        {
            throw InvalidContext("attestationChallenge must be an unpadded base64url encoding of exactly 32 bytes.");
        }
        try
        {
            if (decoded.Length != 32 || !string.Equals(Base64Url(decoded), challenge, StringComparison.Ordinal))
                throw InvalidContext("attestationChallenge must be an unpadded base64url encoding of exactly 32 bytes.");
        }
        finally
        {
            CryptographicOperations.ZeroMemory(decoded);
        }
    }

    public static bool Verify(
        ReadOnlySpan<byte> publicSpki,
        WorkstationAttestationFields fields,
        string? signature)
    {
        if (signature is null || !SignaturePattern().IsMatch(signature)) return false;
        byte[] signatureBytes;
        try
        {
            signatureBytes = DecodeBase64Url(signature);
        }
        catch (FormatException)
        {
            return false;
        }
        byte[]? statementBytes = null;
        try
        {
            if (!string.Equals(Base64Url(signatureBytes), signature, StringComparison.Ordinal)) return false;
            statementBytes = Encoding.UTF8.GetBytes(CanonicalStatement(fields));
            if (signatureBytes.Length != 64) return false;
            using var verifier = ECDsa.Create();
            verifier.ImportSubjectPublicKeyInfo(publicSpki, out var bytesRead);
            if (bytesRead != publicSpki.Length || verifier.KeySize != 256) return false;
            var parameters = verifier.ExportParameters(false);
            if (!string.Equals(parameters.Curve.Oid.Value, "1.2.840.10045.3.1.7", StringComparison.Ordinal)) return false;
            return verifier.VerifyData(
                statementBytes,
                signatureBytes,
                HashAlgorithmName.SHA256,
                DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        }
        catch (Exception error) when (error is CryptographicException or NfcHelperException)
        {
            return false;
        }
        finally
        {
            if (statementBytes is not null) CryptographicOperations.ZeroMemory(statementBytes);
            CryptographicOperations.ZeroMemory(signatureBytes);
        }
    }

    public static string KeyId(ReadOnlySpan<byte> publicSpki) =>
        Convert.ToHexString(SHA256.HashData(publicSpki)).ToLowerInvariant();

    private static void ValidateFields(WorkstationAttestationFields fields)
    {
        if (string.IsNullOrWhiteSpace(fields.AttemptId) || !ContextPattern().IsMatch(fields.AttemptId))
            throw InvalidContext("attemptId must be 8 to 128 URL-safe characters.");
        ValidateChallenge(fields.AttestationChallenge);
        if (string.IsNullOrWhiteSpace(fields.PublicTagId) || !PublicTagIdPattern().IsMatch(fields.PublicTagId))
            throw InvalidContext("publicTagId must be the exact 32-character server identity.");
        if (!string.Equals(fields.NormalizedUrl, NfcProtocol.ProductionUrlPrefix + fields.PublicTagId, StringComparison.Ordinal))
            throw InvalidContext("The normalized NFC URL does not match publicTagId.");
        if (string.IsNullOrWhiteSpace(fields.UidFingerprintSha256) ||
            string.IsNullOrWhiteSpace(fields.ReadbackPayloadSha256) ||
            !Sha256Pattern().IsMatch(fields.UidFingerprintSha256) ||
            !Sha256Pattern().IsMatch(fields.ReadbackPayloadSha256))
            throw InvalidContext("The operational attestation digests must be lowercase SHA-256 values.");
        if (fields.ReaderResultCode is not ("write_verified_pcsc_readback" or "already_programmed_exact"))
            throw InvalidContext("The NFC result is not eligible for operational attestation.");
        if (!string.Equals(fields.HelperProtocolVersion, NfcProtocol.ProtocolVersion, StringComparison.Ordinal))
            throw InvalidContext("The NFC helper protocol version is not current.");
        if (!DateTimeOffset.TryParseExact(
                fields.ObservedAt,
                ObservedAtFormat,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var observedAt) ||
            !string.Equals(FormatObservedAt(observedAt), fields.ObservedAt, StringComparison.Ordinal))
            throw InvalidContext("observedAt must be the strict UTC RFC3339 helper timestamp.");
    }

    private static NfcHelperException InvalidContext(string message) =>
        new("invalid_attestation_context", message, false, 400);

    private static string Base64Url(ReadOnlySpan<byte> bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] DecodeBase64Url(string value)
    {
        var standard = value.Replace('-', '+').Replace('_', '/');
        standard += (standard.Length % 4) switch { 0 => string.Empty, 2 => "==", 3 => "=", _ => throw new FormatException() };
        return Convert.FromBase64String(standard);
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{8,128}$", RegexOptions.CultureInvariant)]
    private static partial Regex ContextPattern();
    [GeneratedRegex("^[A-Za-z0-9_-]{43}$", RegexOptions.CultureInvariant)]
    private static partial Regex ChallengePattern();
    [GeneratedRegex("^[A-Za-z0-9_-]{32}$", RegexOptions.CultureInvariant)]
    private static partial Regex PublicTagIdPattern();
    [GeneratedRegex("^[a-f0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256Pattern();
    [GeneratedRegex("^[A-Za-z0-9_-]{86}$", RegexOptions.CultureInvariant)]
    private static partial Regex SignaturePattern();
    [GeneratedRegex("^[a-f0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex KeyIdPattern();
}

public sealed class EphemeralTestWorkstationAttestationSigner : IWorkstationAttestationSigner
{
    private readonly ECDsa _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private int _signCount;
    private bool _disposed;

    public EphemeralTestWorkstationAttestationSigner()
    {
        var spki = _key.ExportSubjectPublicKeyInfo();
        try
        {
            WorkstationKeyId = WorkstationAttestation.KeyId(spki);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(spki);
        }
    }

    public string WorkstationKeyId { get; }
    public string Algorithm => NfcProtocol.AttestationAlgorithm;
    public int SignCount => Volatile.Read(ref _signCount);

    public byte[] ExportPublicSpki()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        return _key.ExportSubjectPublicKeyInfo();
    }

    public byte[] SignData(ReadOnlySpan<byte> statement)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        Interlocked.Increment(ref _signCount);
        return _key.SignData(
            statement,
            HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _key.Dispose();
    }
}
