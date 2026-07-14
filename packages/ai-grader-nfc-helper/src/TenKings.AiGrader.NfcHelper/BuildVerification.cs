using System.Security.Cryptography;

namespace TenKings.AiGrader.NfcHelper;

public static class NfcBuildVerification
{
    private const string VerificationTagId = "buildverify0123456789abcdefghijk";
    private const string VerificationChallenge = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    public static NfcBuildVerificationResult Verify()
    {
        var url = NfcProtocol.ProductionUrlPrefix + VerificationTagId;
        var encoded = NdefCodec.EncodeProductionUrl(url);
        var parsed = NdefCodec.ParseProductionUrl(encoded.Message);
        if (!string.Equals(parsed.Url, url, StringComparison.Ordinal) ||
            !string.Equals(parsed.PayloadSha256, encoded.PayloadSha256, StringComparison.Ordinal))
        {
            throw VerificationFailed();
        }

        using var signer = new EphemeralTestWorkstationAttestationSigner();
        var fields = new WorkstationAttestationFields(
            "build_verification_attempt",
            VerificationChallenge,
            VerificationTagId,
            url,
            new string('a', 64),
            encoded.PayloadSha256,
            "already_programmed_exact",
            NfcProtocol.ProtocolVersion,
            "2026-01-01T00:00:00.000Z");
        var attestation = WorkstationAttestation.Create(signer, fields);
        var spki = signer.ExportPublicSpki();
        try
        {
            if (!WorkstationAttestation.Verify(spki, fields, attestation.Signature))
                throw VerificationFailed();
        }
        finally
        {
            CryptographicOperations.ZeroMemory(spki);
        }

        return new NfcBuildVerificationResult(
            true,
            NfcProtocol.HelperVersion,
            NfcProtocol.ProtocolVersion,
            NfcProtocol.AttestationSchemaVersion,
            NfcProtocol.AttestationAlgorithm,
            false,
            false);
    }

    private static NfcHelperException VerificationFailed() =>
        new(
            "build_verification_failed",
            "The staged NFC helper failed its hardware-free build verification.",
            false,
            503);
}
