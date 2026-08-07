using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TenKings.AiGrader.NfcHelper;

public sealed record TenKingsV2NfcSignedJob(
    string SchemaVersion,
    string Algorithm,
    string SigningKeyId,
    string Purpose,
    string Nonce,
    string CardId,
    string PublicToken,
    string Url,
    string ChipType,
    string SecurityMode,
    string ProgrammingProfile,
    string IssuedAt,
    string ExpiresAt,
    string Signature);

public sealed record TenKingsV2NfcTerminalResult(
    string SchemaVersion,
    string Algorithm,
    string WorkstationKeyId,
    string JobEnvelopeSha256,
    string Nonce,
    string CardId,
    string PublicToken,
    string Url,
    string ChipType,
    string SecurityMode,
    string ProgrammingProfile,
    string ReaderModel,
    string AdapterIdentity,
    string AdapterVersion,
    string ReadbackPayloadSha256,
    string WriteProtectionState,
    string ReaderResultCode,
    string HelperCapability,
    string ObservedAt,
    string Signature);

public static partial class TenKingsV2NfcProtocol
{
    public const string JobSchema = "ten-kings-v2-nfc-job-v1";
    public const string ResultSchema = "ten-kings-v2-nfc-result-v1";
    public const string Algorithm = "ecdsa-p256-sha256-p1363";
    public const string Purpose = "program-permanent-card-url";
    public const string Origin = "https://collect.tenkings.co";
    public const string UrlPrefix = Origin + "/c/";
    public const string ChipType = "FEIJU_F8215";
    public const string SecurityMode = "static_url_v1";
    public const string ProgrammingProfile = "gototags_manual_start_v1";
    public const string ReaderModel = "ACS_ACR1552U";
    public const string AdapterIdentity = "gototags_desktop";
    public const string AdapterVersion = "4.37.0.1";
    public const string WriteProtectionState = "permanently_read_only_verified";
    public const string ReaderResultCode = "write_locked_verified_gototags_readback";
    public const string HelperCapability = "ten-kings-v2-f8215-static-url-v1";
    public static readonly TimeSpan MaximumJobLifetime = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan MaximumClockSkew = TimeSpan.FromSeconds(30);

    private const string TimestampFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";

    private static readonly HashSet<string> JobJsonKeys = new(StringComparer.Ordinal)
    {
        "algorithm", "cardId", "chipType", "expiresAt", "issuedAt", "nonce",
        "programmingProfile", "publicToken", "purpose", "schemaVersion", "securityMode",
        "signature", "signingKeyId", "url"
    };

    public static TenKingsV2NfcSignedJob ParseSignedJobJson(ReadOnlySpan<byte> json)
    {
        if (json.Length is 0 or > NfcProtocol.MaxJsonBytes) throw Invalid("The V2 NFC job body is invalid.");
        var copy = json.ToArray();
        try
        {
            using var document = JsonDocument.Parse(copy, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 4
            });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw Invalid("The V2 NFC job must be an exact JSON object.");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in root.EnumerateObject())
            {
                if (!JobJsonKeys.Contains(property.Name) || !seen.Add(property.Name) || property.Value.ValueKind != JsonValueKind.String)
                    throw Invalid("The V2 NFC job contains missing, duplicate, unknown, or non-string fields.");
            }
            if (!seen.SetEquals(JobJsonKeys)) throw Invalid("The V2 NFC job contains missing fields.");

            string Text(string name) => root.GetProperty(name).GetString() ?? throw Invalid("The V2 NFC job field is invalid.");
            var job = new TenKingsV2NfcSignedJob(
                Text("schemaVersion"),
                Text("algorithm"),
                Text("signingKeyId"),
                Text("purpose"),
                Text("nonce"),
                Text("cardId"),
                Text("publicToken"),
                Text("url"),
                Text("chipType"),
                Text("securityMode"),
                Text("programmingProfile"),
                Text("issuedAt"),
                Text("expiresAt"),
                Text("signature"));
            ValidateJob(job);
            return job;
        }
        catch (JsonException)
        {
            throw Invalid("The V2 NFC job JSON is invalid.");
        }
        finally
        {
            CryptographicOperations.ZeroMemory(copy);
        }
    }

    public static string CanonicalJobStatement(TenKingsV2NfcSignedJob job)
    {
        ValidateJob(job);
        return string.Join('\n',
            job.SchemaVersion,
            job.Algorithm,
            job.SigningKeyId,
            job.Purpose,
            job.Nonce,
            job.CardId,
            job.PublicToken,
            job.Url,
            job.ChipType,
            job.SecurityMode,
            job.ProgrammingProfile,
            job.IssuedAt,
            job.ExpiresAt);
    }

    public static bool VerifyJob(TenKingsV2NfcSignedJob job, ReadOnlySpan<byte> trustedPublicSpki)
    {
        byte[]? signature = null;
        byte[]? statement = null;
        try
        {
            ValidateJob(job);
            if (!FixedTimeAsciiEquals(WorkstationAttestation.KeyId(trustedPublicSpki), job.SigningKeyId)) return false;
            signature = DecodeCanonicalBase64Url(job.Signature, 64, "signature");
            statement = Encoding.UTF8.GetBytes(CanonicalJobStatement(job));
            using var verifier = ECDsa.Create();
            verifier.ImportSubjectPublicKeyInfo(trustedPublicSpki, out var read);
            if (read != trustedPublicSpki.Length || verifier.KeySize != 256) return false;
            var parameters = verifier.ExportParameters(false);
            if (!string.Equals(parameters.Curve.Oid.Value, "1.2.840.10045.3.1.7", StringComparison.Ordinal)) return false;
            return verifier.VerifyData(
                statement,
                signature,
                HashAlgorithmName.SHA256,
                DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        }
        catch (Exception error) when (error is CryptographicException or FormatException or NfcHelperException)
        {
            return false;
        }
        finally
        {
            if (signature is not null) CryptographicOperations.ZeroMemory(signature);
            if (statement is not null) CryptographicOperations.ZeroMemory(statement);
        }
    }

    public static void RequireMayStart(TenKingsV2NfcSignedJob job, DateTimeOffset now)
    {
        ValidateJob(job);
        var issuedAt = ParseTimestamp(job.IssuedAt, "issuedAt");
        var expiresAt = ParseTimestamp(job.ExpiresAt, "expiresAt");
        now = now.ToUniversalTime();
        if (now < issuedAt - MaximumClockSkew)
            throw new NfcHelperException("v2_nfc_job_not_yet_valid", "The V2 NFC job is not valid yet.", false, 409);
        if (now > expiresAt)
            throw new NfcHelperException("v2_nfc_job_expired", "The V2 NFC job expired before it started.", false, 409);
    }

    public static string JobEnvelopeSha256(TenKingsV2NfcSignedJob job)
    {
        var envelope = Encoding.UTF8.GetBytes(CanonicalJobStatement(job) + "\n" + job.Signature);
        try
        {
            return Convert.ToHexString(SHA256.HashData(envelope)).ToLowerInvariant();
        }
        finally
        {
            CryptographicOperations.ZeroMemory(envelope);
        }
    }

    public static TenKingsV2NfcTerminalResult CreateTerminalResult(
        TenKingsV2NfcSignedJob job,
        ReadOnlySpan<byte> trustedServerPublicSpki,
        IWorkstationAttestationSigner signer,
        string readbackPayloadSha256,
        string observedAt)
    {
        if (!VerifyJob(job, trustedServerPublicSpki)) throw Invalid("The V2 NFC server job signature is invalid.");
        if (!string.Equals(signer.Algorithm, Algorithm, StringComparison.Ordinal) || !Sha256Pattern().IsMatch(signer.WorkstationKeyId))
            throw Invalid("The V2 NFC workstation signer is invalid.");

        var unsigned = new TenKingsV2NfcTerminalResult(
            ResultSchema,
            Algorithm,
            signer.WorkstationKeyId,
            JobEnvelopeSha256(job),
            job.Nonce,
            job.CardId,
            job.PublicToken,
            job.Url,
            ChipType,
            SecurityMode,
            ProgrammingProfile,
            ReaderModel,
            AdapterIdentity,
            AdapterVersion,
            readbackPayloadSha256,
            WriteProtectionState,
            ReaderResultCode,
            HelperCapability,
            observedAt,
            string.Empty);
        ValidateResult(unsigned, job, requireSignature: false);

        var statement = Encoding.UTF8.GetBytes(CanonicalResultStatement(unsigned));
        byte[]? signature = null;
        try
        {
            signature = signer.SignData(statement);
            if (signature.Length != 64) throw Invalid("The V2 NFC workstation signature is invalid.");
            return unsigned with { Signature = Base64Url(signature) };
        }
        catch (Exception error) when (error is CryptographicException or ObjectDisposedException)
        {
            throw Invalid("The V2 NFC workstation could not sign the terminal result.");
        }
        finally
        {
            CryptographicOperations.ZeroMemory(statement);
            if (signature is not null) CryptographicOperations.ZeroMemory(signature);
        }
    }

    public static string CanonicalResultStatement(TenKingsV2NfcTerminalResult result)
    {
        ValidateResultShape(result, requireSignature: false);
        return string.Join('\n',
            result.SchemaVersion,
            result.Algorithm,
            result.WorkstationKeyId,
            result.JobEnvelopeSha256,
            result.Nonce,
            result.CardId,
            result.PublicToken,
            result.Url,
            result.ChipType,
            result.SecurityMode,
            result.ProgrammingProfile,
            result.ReaderModel,
            result.AdapterIdentity,
            result.AdapterVersion,
            result.ReadbackPayloadSha256,
            result.WriteProtectionState,
            result.ReaderResultCode,
            result.HelperCapability,
            result.ObservedAt);
    }

    public static bool VerifyTerminalResult(
        TenKingsV2NfcTerminalResult result,
        TenKingsV2NfcSignedJob job,
        ReadOnlySpan<byte> trustedWorkstationPublicSpki)
    {
        byte[]? signature = null;
        byte[]? statement = null;
        try
        {
            ValidateResult(result, job, requireSignature: true);
            if (!FixedTimeAsciiEquals(WorkstationAttestation.KeyId(trustedWorkstationPublicSpki), result.WorkstationKeyId)) return false;
            signature = DecodeCanonicalBase64Url(result.Signature, 64, "signature");
            statement = Encoding.UTF8.GetBytes(CanonicalResultStatement(result));
            using var verifier = ECDsa.Create();
            verifier.ImportSubjectPublicKeyInfo(trustedWorkstationPublicSpki, out var read);
            if (read != trustedWorkstationPublicSpki.Length || verifier.KeySize != 256) return false;
            var parameters = verifier.ExportParameters(false);
            if (!string.Equals(parameters.Curve.Oid.Value, "1.2.840.10045.3.1.7", StringComparison.Ordinal)) return false;
            return verifier.VerifyData(
                statement,
                signature,
                HashAlgorithmName.SHA256,
                DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        }
        catch (Exception error) when (error is CryptographicException or FormatException or NfcHelperException)
        {
            return false;
        }
        finally
        {
            if (signature is not null) CryptographicOperations.ZeroMemory(signature);
            if (statement is not null) CryptographicOperations.ZeroMemory(statement);
        }
    }

    private static void ValidateJob(TenKingsV2NfcSignedJob job)
    {
        if (job.SchemaVersion != JobSchema ||
            job.Algorithm != Algorithm ||
            job.Purpose != Purpose ||
            job.ChipType != ChipType ||
            job.SecurityMode != SecurityMode ||
            job.ProgrammingProfile != ProgrammingProfile)
            throw Invalid("The V2 NFC job profile is invalid.");
        if (!Sha256Pattern().IsMatch(job.SigningKeyId) ||
            !CardIdPattern().IsMatch(job.CardId) ||
            !PublicTokenPattern().IsMatch(job.PublicToken))
            throw Invalid("The V2 NFC job identity is invalid.");
        DecodeAndClear(job.Nonce, 32, "nonce");
        DecodeAndClear(job.Signature, 64, "signature");
        ValidateExactUrl(job.PublicToken, job.Url);
        var issuedAt = ParseTimestamp(job.IssuedAt, "issuedAt");
        var expiresAt = ParseTimestamp(job.ExpiresAt, "expiresAt");
        if (expiresAt <= issuedAt || expiresAt - issuedAt > MaximumJobLifetime)
            throw Invalid("The V2 NFC job lifetime is invalid.");
    }

    private static void ValidateResult(
        TenKingsV2NfcTerminalResult result,
        TenKingsV2NfcSignedJob job,
        bool requireSignature)
    {
        ValidateJob(job);
        ValidateResultShape(result, requireSignature);
        if (result.JobEnvelopeSha256 != JobEnvelopeSha256(job) ||
            result.Nonce != job.Nonce ||
            result.CardId != job.CardId ||
            result.PublicToken != job.PublicToken ||
            result.Url != job.Url ||
            result.ChipType != job.ChipType ||
            result.SecurityMode != job.SecurityMode ||
            result.ProgrammingProfile != job.ProgrammingProfile)
            throw Invalid("The V2 NFC result does not match the exact signed job.");
        var observedAt = ParseTimestamp(result.ObservedAt, "observedAt");
        var issuedAt = ParseTimestamp(job.IssuedAt, "issuedAt");
        var expiresAt = ParseTimestamp(job.ExpiresAt, "expiresAt");
        if (observedAt < issuedAt || observedAt > expiresAt)
            throw Invalid("The V2 NFC operation did not complete inside its signed job window.");
    }

    private static void ValidateResultShape(TenKingsV2NfcTerminalResult result, bool requireSignature)
    {
        if (result.SchemaVersion != ResultSchema ||
            result.Algorithm != Algorithm ||
            result.ChipType != ChipType ||
            result.SecurityMode != SecurityMode ||
            result.ProgrammingProfile != ProgrammingProfile ||
            result.ReaderModel != ReaderModel ||
            result.AdapterIdentity != AdapterIdentity ||
            result.AdapterVersion != AdapterVersion ||
            result.WriteProtectionState != WriteProtectionState ||
            result.ReaderResultCode != ReaderResultCode ||
            result.HelperCapability != HelperCapability)
            throw Invalid("The V2 NFC terminal result profile is invalid.");
        if (!Sha256Pattern().IsMatch(result.WorkstationKeyId) ||
            !Sha256Pattern().IsMatch(result.JobEnvelopeSha256) ||
            !Sha256Pattern().IsMatch(result.ReadbackPayloadSha256) ||
            !CardIdPattern().IsMatch(result.CardId) ||
            !PublicTokenPattern().IsMatch(result.PublicToken))
            throw Invalid("The V2 NFC terminal result identity is invalid.");
        DecodeAndClear(result.Nonce, 32, "nonce");
        if (requireSignature) DecodeAndClear(result.Signature, 64, "signature");
        else if (result.Signature.Length != 0) DecodeAndClear(result.Signature, 64, "signature");
        ValidateExactUrl(result.PublicToken, result.Url);
        ParseTimestamp(result.ObservedAt, "observedAt");
    }

    private static void ValidateExactUrl(string publicToken, string url)
    {
        var expected = UrlPrefix + publicToken;
        if (!string.Equals(url, expected, StringComparison.Ordinal) ||
            !Uri.TryCreate(url, UriKind.Absolute, out var parsed) ||
            !string.Equals(parsed.Scheme, Uri.UriSchemeHttps, StringComparison.Ordinal) ||
            !string.Equals(parsed.Host, "collect.tenkings.co", StringComparison.Ordinal) ||
            !string.Equals(parsed.Authority, "collect.tenkings.co", StringComparison.Ordinal) ||
            parsed.UserInfo.Length != 0 ||
            parsed.Query.Length != 0 ||
            parsed.Fragment.Length != 0 ||
            !string.Equals(parsed.AbsolutePath, "/c/" + publicToken, StringComparison.Ordinal))
            throw Invalid("The V2 NFC URL is not the exact permanent card URL.");
    }

    private static DateTimeOffset ParseTimestamp(string value, string label)
    {
        if (!DateTimeOffset.TryParseExact(
                value,
                TimestampFormat,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var result) ||
            !string.Equals(result.ToUniversalTime().ToString(TimestampFormat, CultureInfo.InvariantCulture), value, StringComparison.Ordinal))
            throw Invalid($"{label} is not a canonical UTC timestamp.");
        return result;
    }

    private static void DecodeAndClear(string value, int expectedBytes, string label)
    {
        var decoded = DecodeCanonicalBase64Url(value, expectedBytes, label);
        CryptographicOperations.ZeroMemory(decoded);
    }

    private static byte[] DecodeCanonicalBase64Url(string value, int expectedBytes, string label)
    {
        if (!Base64UrlPattern().IsMatch(value)) throw Invalid($"{label} is not base64url.");
        var standard = value.Replace('-', '+').Replace('_', '/');
        standard += (standard.Length % 4) switch
        {
            0 => string.Empty,
            2 => "==",
            3 => "=",
            _ => throw Invalid($"{label} is not canonical base64url.")
        };
        byte[] decoded;
        try
        {
            decoded = Convert.FromBase64String(standard);
        }
        catch (FormatException)
        {
            throw Invalid($"{label} is not canonical base64url.");
        }
        if (decoded.Length != expectedBytes || !string.Equals(Base64Url(decoded), value, StringComparison.Ordinal))
        {
            CryptographicOperations.ZeroMemory(decoded);
            throw Invalid($"{label} is not canonical base64url.");
        }
        return decoded;
    }

    private static string Base64Url(ReadOnlySpan<byte> value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static bool FixedTimeAsciiEquals(string left, string right)
    {
        var leftBytes = Encoding.ASCII.GetBytes(left);
        var rightBytes = Encoding.ASCII.GetBytes(right);
        try
        {
            return leftBytes.Length == rightBytes.Length && CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(leftBytes);
            CryptographicOperations.ZeroMemory(rightBytes);
        }
    }

    private static NfcHelperException Invalid(string message) =>
        new("v2_nfc_protocol_invalid", message, false, 400);

    [GeneratedRegex("^[a-f0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256Pattern();
    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$", RegexOptions.CultureInvariant)]
    private static partial Regex CardIdPattern();
    [GeneratedRegex("^tk2c_[A-Za-z0-9_-]{32}$", RegexOptions.CultureInvariant)]
    private static partial Regex PublicTokenPattern();
    [GeneratedRegex("^[A-Za-z0-9_-]+$", RegexOptions.CultureInvariant)]
    private static partial Regex Base64UrlPattern();
}
