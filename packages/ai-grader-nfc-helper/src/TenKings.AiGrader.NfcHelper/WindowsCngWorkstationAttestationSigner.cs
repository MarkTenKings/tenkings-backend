using System.Security.Cryptography;

namespace TenKings.AiGrader.NfcHelper;

public sealed class WindowsCngWorkstationAttestationSigner : IWorkstationAttestationSigner
{
    private static readonly CngProvider Provider = CngProvider.MicrosoftSoftwareKeyStorageProvider;
    private readonly CngKey _key;
    private readonly ECDsaCng _signer;
    private bool _disposed;

    private WindowsCngWorkstationAttestationSigner(CngKey key, ECDsaCng signer, string keyId)
    {
        _key = key;
        _signer = signer;
        WorkstationKeyId = keyId;
    }

    public string WorkstationKeyId { get; }
    public string Algorithm => NfcProtocol.AttestationAlgorithm;

    public static WorkstationKeyMetadata EnsureNamedKey()
    {
        RequireWindows();
        try
        {
            CngKey key;
            if (CngKey.Exists(NfcProtocol.WorkstationKeyName, Provider, CngKeyOpenOptions.None))
            {
                key = OpenNamedKey();
            }
            else
            {
                try
                {
                    key = CngKey.Create(
                        CngAlgorithm.ECDsaP256,
                        NfcProtocol.WorkstationKeyName,
                        CreateKeyCreationParameters());
                }
                catch (CryptographicException) when (
                    CngKey.Exists(NfcProtocol.WorkstationKeyName, Provider, CngKeyOpenOptions.None))
                {
                    // A concurrent installer may have created the same fixed current-user key.
                    // Reopen and validate it; never overwrite or rotate it implicitly.
                    key = OpenNamedKey();
                }
            }

            using (key)
            using (var signer = new ECDsaCng(key))
            {
                var keyId = Inspect(key, signer);
                return new WorkstationKeyMetadata(NfcProtocol.WorkstationKeyName, keyId, NfcProtocol.AttestationAlgorithm);
            }
        }
        catch (NfcHelperException)
        {
            throw;
        }
        catch (Exception error) when (error is CryptographicException or PlatformNotSupportedException)
        {
            throw ConfigurationError();
        }
    }

    public static WindowsCngWorkstationAttestationSigner Open(string keyName, string expectedKeyId)
    {
        RequireWindows();
        if (!string.Equals(keyName, NfcProtocol.WorkstationKeyName, StringComparison.Ordinal) ||
            expectedKeyId.Length != 64 ||
            expectedKeyId.Any(character => !char.IsAsciiHexDigit(character) || char.IsAsciiLetterUpper(character)))
        {
            throw ConfigurationError();
        }

        CngKey? key = null;
        ECDsaCng? signer = null;
        try
        {
            key = OpenNamedKey();
            signer = new ECDsaCng(key);
            var keyId = Inspect(key, signer);
            if (!FixedTimeAsciiEquals(keyId, expectedKeyId)) throw ConfigurationError();
            var result = new WindowsCngWorkstationAttestationSigner(key, signer, keyId);
            key = null;
            signer = null;
            return result;
        }
        catch (NfcHelperException)
        {
            throw;
        }
        catch (Exception error) when (error is CryptographicException or PlatformNotSupportedException)
        {
            throw ConfigurationError();
        }
        finally
        {
            signer?.Dispose();
            key?.Dispose();
        }
    }

    public static WorkstationPublicKeyExport ExportPublicKey(string keyName, string expectedKeyId)
    {
        using var signer = Open(keyName, expectedKeyId);
        var spki = signer.ExportPublicSpki();
        try
        {
            return new WorkstationPublicKeyExport(
                signer.WorkstationKeyId,
                signer.Algorithm,
                Convert.ToBase64String(spki));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(spki);
        }
    }

    public static CngKeyCreationParameters CreateKeyCreationParameters() =>
        new()
        {
            Provider = Provider,
            ExportPolicy = CngExportPolicies.None,
            KeyUsage = CngKeyUsages.Signing,
            KeyCreationOptions = CngKeyCreationOptions.None
        };

    public byte[] ExportPublicSpki()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        return _signer.ExportSubjectPublicKeyInfo();
    }

    public byte[] SignData(ReadOnlySpan<byte> statement)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        try
        {
            return _signer.SignData(
                statement,
                HashAlgorithmName.SHA256,
                DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        }
        catch (CryptographicException)
        {
            throw new NfcHelperException(
                "attestation_signing_failed",
                "The NFC workstation could not produce the required operational attestation.",
                false,
                503);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _signer.Dispose();
        _key.Dispose();
    }

    private static CngKey OpenNamedKey()
    {
        try
        {
            return CngKey.Open(NfcProtocol.WorkstationKeyName, Provider, CngKeyOpenOptions.None);
        }
        catch (Exception error) when (error is CryptographicException or PlatformNotSupportedException)
        {
            throw ConfigurationError();
        }
    }

    private static string Inspect(CngKey key, ECDsaCng signer)
    {
        if (key.IsMachineKey ||
            key.IsEphemeral ||
            !string.Equals(key.KeyName, NfcProtocol.WorkstationKeyName, StringComparison.Ordinal) ||
            key.Provider != Provider ||
            key.Algorithm != CngAlgorithm.ECDsaP256 ||
            key.AlgorithmGroup != CngAlgorithmGroup.ECDsa ||
            key.KeyUsage != CngKeyUsages.Signing ||
            key.ExportPolicy != CngExportPolicies.None ||
            signer.KeySize != 256)
        {
            throw ConfigurationError();
        }

        var spki = signer.ExportSubjectPublicKeyInfo();
        try
        {
            if (spki.Length is < 64 or > 512) throw ConfigurationError();
            return WorkstationAttestation.KeyId(spki);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(spki);
        }
    }

    private static void RequireWindows()
    {
        if (!OperatingSystem.IsWindows())
            throw new NfcHelperException(
                "windows_required",
                "The production NFC workstation attestation key requires Windows CNG.",
                false,
                503);
    }

    private static NfcHelperException ConfigurationError() =>
        new(
            "attestation_key_invalid",
            "The named NFC workstation attestation key is missing or does not meet the current-user non-exportable P-256 policy.",
            false,
            503);

    private static bool FixedTimeAsciiEquals(string left, string right)
    {
        var leftBytes = System.Text.Encoding.ASCII.GetBytes(left);
        var rightBytes = System.Text.Encoding.ASCII.GetBytes(right);
        try
        {
            return CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(leftBytes);
            CryptographicOperations.ZeroMemory(rightBytes);
        }
    }
}
