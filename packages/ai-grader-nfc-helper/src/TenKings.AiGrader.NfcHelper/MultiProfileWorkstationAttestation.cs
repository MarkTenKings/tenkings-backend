using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace TenKings.AiGrader.NfcHelper;

public sealed record MultiProfileAttestationFields(
    string AttemptId,
    string AttestationChallenge,
    string PublicTagId,
    string NormalizedUrl,
    string ChipType,
    string SecurityMode,
    string ProgrammingProfile,
    string AdapterIdentity,
    string AdapterVersion,
    string UidFingerprintSha256,
    string ReadbackPayloadSha256,
    string WriteProtectionState,
    string ReaderResultCode,
    string HelperProtocolVersion,
    string ObservedAt);

public static partial class MultiProfileWorkstationAttestation
{
    public static NfcOperationalAttestation Create(
        IWorkstationAttestationSigner signer,
        MultiProfileAttestationFields fields)
    {
        Validate(fields);
        if (!string.Equals(signer.Algorithm, NfcProtocol.AttestationAlgorithm, StringComparison.Ordinal) ||
            !Sha256Pattern().IsMatch(signer.WorkstationKeyId))
        {
            throw Invalid("The NFC workstation attestation signer is not configured safely.");
        }

        var statementBytes = Encoding.UTF8.GetBytes(CanonicalStatement(fields));
        byte[]? signature = null;
        try
        {
            signature = signer.SignData(statementBytes);
            if (signature.Length != 64) throw Invalid("The NFC workstation could not produce the required operational attestation.");
            return new NfcOperationalAttestation(
                NfcProtocol.MultiProfileAttestationSchemaVersion,
                signer.WorkstationKeyId,
                signer.Algorithm,
                fields.AttestationChallenge,
                fields.ObservedAt,
                Base64Url(signature));
        }
        catch (NfcHelperException)
        {
            throw;
        }
        catch (Exception error) when (error is CryptographicException or ObjectDisposedException)
        {
            throw Invalid("The NFC workstation could not produce the required operational attestation.");
        }
        finally
        {
            CryptographicOperations.ZeroMemory(statementBytes);
            if (signature is not null) CryptographicOperations.ZeroMemory(signature);
        }
    }

    public static string CanonicalStatement(MultiProfileAttestationFields fields)
    {
        Validate(fields);
        return string.Join('\n',
            NfcProtocol.MultiProfileAttestationSchemaVersion,
            fields.AttemptId,
            fields.AttestationChallenge,
            fields.PublicTagId,
            fields.NormalizedUrl,
            fields.ChipType,
            fields.SecurityMode,
            fields.ProgrammingProfile,
            fields.AdapterIdentity,
            fields.AdapterVersion,
            fields.UidFingerprintSha256,
            fields.ReadbackPayloadSha256,
            fields.WriteProtectionState,
            fields.ReaderResultCode,
            fields.HelperProtocolVersion,
            fields.ObservedAt);
    }

    public static bool Verify(
        ReadOnlySpan<byte> publicSpki,
        MultiProfileAttestationFields fields,
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
            if (signatureBytes.Length != 64 || !string.Equals(Base64Url(signatureBytes), signature, StringComparison.Ordinal)) return false;
            statementBytes = Encoding.UTF8.GetBytes(CanonicalStatement(fields));
            using var verifier = ECDsa.Create();
            verifier.ImportSubjectPublicKeyInfo(publicSpki, out var read);
            return read == publicSpki.Length && verifier.KeySize == 256 && verifier.VerifyData(
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

    private static void Validate(MultiProfileAttestationFields fields)
    {
        if (!ContextPattern().IsMatch(fields.AttemptId)) throw Invalid("The NFC attempt identity is invalid.");
        WorkstationAttestation.ValidateChallenge(fields.AttestationChallenge);
        if (!PublicTagIdPattern().IsMatch(fields.PublicTagId) ||
            !string.Equals(fields.NormalizedUrl, NfcProtocol.ProductionUrlPrefix + fields.PublicTagId, StringComparison.Ordinal))
            throw Invalid("The NFC URL does not match the public tag identity.");
        if (fields.ChipType != NfcProtocol.FeijuChipType ||
            fields.SecurityMode != NfcProtocol.SecurityMode ||
            fields.ProgrammingProfile != NfcProtocol.FeijuProgrammingProfile ||
            fields.AdapterIdentity != NfcProtocol.FeijuAdapterIdentity ||
            fields.AdapterVersion != NfcProtocol.ApprovedGoToTagsVersion ||
            fields.WriteProtectionState != NfcProtocol.FeijuWriteProtectionState ||
            fields.ReaderResultCode != NfcProtocol.FeijuReaderResultCode ||
            fields.HelperProtocolVersion != NfcProtocol.ProtocolVersion)
            throw Invalid("The Feiju NFC completion profile is invalid.");
        if (!Sha256Pattern().IsMatch(fields.UidFingerprintSha256) ||
            !Sha256Pattern().IsMatch(fields.ReadbackPayloadSha256))
            throw Invalid("The NFC completion digests are invalid.");
        if (!DateTimeOffset.TryParseExact(
                fields.ObservedAt,
                "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var observed) ||
            !string.Equals(WorkstationAttestation.FormatObservedAt(observed), fields.ObservedAt, StringComparison.Ordinal))
            throw Invalid("The NFC completion timestamp is invalid.");
    }

    private static NfcHelperException Invalid(string message) =>
        new("invalid_attestation_context", message, false, 400);

    private static string Base64Url(ReadOnlySpan<byte> bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] DecodeBase64Url(string value)
    {
        var source = value.Replace('-', '+').Replace('_', '/');
        source += (source.Length % 4) switch { 0 => string.Empty, 2 => "==", 3 => "=", _ => throw new FormatException() };
        return Convert.FromBase64String(source);
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{8,128}$", RegexOptions.CultureInvariant)]
    private static partial Regex ContextPattern();
    [GeneratedRegex("^[A-Za-z0-9_-]{32}$", RegexOptions.CultureInvariant)]
    private static partial Regex PublicTagIdPattern();
    [GeneratedRegex("^[a-f0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256Pattern();
    [GeneratedRegex("^[A-Za-z0-9_-]{86}$", RegexOptions.CultureInvariant)]
    private static partial Regex SignaturePattern();
}
