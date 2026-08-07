using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TenKings.AiGrader.NfcHelper;

public sealed partial class TenKingsV2ServerTrust : IDisposable
{
    public const string ConfigV3 = "tenkings-ai-grader-nfc-helper-config-v3";
    public const string ConfigV4 = "tenkings-ai-grader-nfc-helper-config-v4";
    private const int MaximumTrustJsonBytes = 4096;
    private readonly Dictionary<string, byte[]> _keys;

    private TenKingsV2ServerTrust(bool enabled, Dictionary<string, byte[]> keys)
    {
        Enabled = enabled;
        _keys = keys;
    }

    public bool Enabled { get; }
    public IReadOnlyList<string> KeyIds => _keys.Keys.OrderBy(value => value, StringComparer.Ordinal).ToArray();

    public static TenKingsV2ServerTrust FromEnvironment()
    {
        var version = Environment.GetEnvironmentVariable("TENKINGS_NFC_CONFIG_SCHEMA_VERSION")?.Trim() ?? ConfigV3;
        if (version == ConfigV3) return new TenKingsV2ServerTrust(false, new());
        if (version != ConfigV4)
            throw Invalid("v2_nfc_config_version_invalid", "The NFC helper configuration version is invalid.");
        var raw = Environment.GetEnvironmentVariable("TENKINGS_NFC_V2_SERVER_JOB_PUBLIC_KEYS_JSON")?.Trim() ?? string.Empty;
        return ParseV4(raw);
    }

    public static TenKingsV2ServerTrust ParseV4(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw) || System.Text.Encoding.UTF8.GetByteCount(raw) > MaximumTrustJsonBytes)
            throw Invalid("v2_nfc_server_trust_invalid", "The NFC V2 server trust is invalid.");
        try
        {
            using var document = JsonDocument.Parse(raw, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 5,
            });
            var root = document.RootElement;
            RequireExactProperties(root, "current", "prior");
            var keys = new Dictionary<string, byte[]>(StringComparer.Ordinal);
            ParseEntry(root.GetProperty("current"), keys);
            var prior = root.GetProperty("prior");
            if (prior.ValueKind != JsonValueKind.Null) ParseEntry(prior, keys);
            if (keys.Count is < 1 or > 2)
                throw Invalid("v2_nfc_server_trust_invalid", "The NFC V2 server trust is invalid.");
            return new TenKingsV2ServerTrust(true, keys);
        }
        catch (NfcHelperException)
        {
            throw;
        }
        catch (Exception error) when (error is JsonException or CryptographicException or FormatException)
        {
            throw Invalid("v2_nfc_server_trust_invalid", "The NFC V2 server trust is invalid.");
        }
    }

    public bool TryCopyPublicSpki(string keyId, out byte[] publicSpki)
    {
        if (_keys.TryGetValue(keyId, out var stored))
        {
            publicSpki = stored.ToArray();
            return true;
        }
        publicSpki = Array.Empty<byte>();
        return false;
    }

    private static void ParseEntry(JsonElement entry, Dictionary<string, byte[]> keys)
    {
        RequireExactProperties(entry, "algorithm", "keyId", "publicSpkiDerBase64");
        var algorithm = entry.GetProperty("algorithm").GetString();
        var keyId = entry.GetProperty("keyId").GetString() ?? string.Empty;
        var encoded = entry.GetProperty("publicSpkiDerBase64").GetString() ?? string.Empty;
        if (algorithm != TenKingsV2NfcProtocol.Algorithm || !Sha256Pattern().IsMatch(keyId) ||
            !StandardBase64Pattern().IsMatch(encoded) || keys.ContainsKey(keyId))
            throw Invalid("v2_nfc_server_trust_invalid", "The NFC V2 server trust is invalid.");
        var der = Convert.FromBase64String(encoded);
        try
        {
            if (der.Length is < 64 or > 512 || Convert.ToBase64String(der) != encoded ||
                WorkstationAttestation.KeyId(der) != keyId)
                throw Invalid("v2_nfc_server_trust_invalid", "The NFC V2 server trust is invalid.");
            using var verifier = ECDsa.Create();
            verifier.ImportSubjectPublicKeyInfo(der, out var consumed);
            var parameters = verifier.ExportParameters(false);
            if (consumed != der.Length || verifier.KeySize != 256 ||
                parameters.Curve.Oid.Value != "1.2.840.10045.3.1.7")
                throw Invalid("v2_nfc_server_trust_invalid", "The NFC V2 server trust is invalid.");
            keys.Add(keyId, der.ToArray());
        }
        finally
        {
            CryptographicOperations.ZeroMemory(der);
        }
    }

    private static void RequireExactProperties(JsonElement element, params string[] expected)
    {
        if (element.ValueKind != JsonValueKind.Object) throw new JsonException();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            if (!seen.Add(property.Name)) throw new JsonException();
        }
        if (!seen.SetEquals(expected)) throw new JsonException();
    }

    public void Dispose()
    {
        foreach (var key in _keys.Values) CryptographicOperations.ZeroMemory(key);
        _keys.Clear();
    }

    private static NfcHelperException Invalid(string code, string message) => new(code, message, false, 503);

    [GeneratedRegex("^[a-f0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256Pattern();
    [GeneratedRegex("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$", RegexOptions.CultureInvariant)]
    private static partial Regex StandardBase64Pattern();
}
