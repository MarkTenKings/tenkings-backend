using System.Text.Json;

namespace TenKings.AiGrader.NfcHelper;

/// Dedicated ATLAS trust. The legacy parser is a strict P-256/SPKI parser only;
/// keys must be supplied separately and cannot overlap the Ten Kings job authority.
public sealed class AtlasServerTrust : IDisposable
{
    private readonly TenKingsV2ServerTrust? _keys;
    private AtlasServerTrust(TenKingsV2ServerTrust? keys) { _keys = keys; }
    public bool Enabled => _keys is not null;
    public IReadOnlyList<string> KeyIds => _keys?.KeyIds ?? Array.Empty<string>();
    public static AtlasServerTrust FromEnvironment(TenKingsV2ServerTrust legacy) =>
        Parse(Environment.GetEnvironmentVariable("ATLAS_NFC_SERVER_JOB_PUBLIC_KEYS_JSON"), legacy.KeyIds);
    public static AtlasServerTrust Parse(string? raw, IReadOnlyList<string> legacyKeyIds)
    {
        if (raw is null) return new AtlasServerTrust(null);
        if (System.Text.Encoding.UTF8.GetByteCount(raw) is 0 or > 5000) throw Invalid();
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw Invalid();
            var names = root.EnumerateObject().Select(x => x.Name).ToArray();
            if (names.Length != 3 || !names.ToHashSet(StringComparer.Ordinal).SetEquals(new[] { "schemaVersion", "purpose", "keys" }) ||
                root.GetProperty("schemaVersion").GetString() != "atlas-nfc-helper-trust-v1" ||
                root.GetProperty("purpose").GetString() != AtlasNfcProtocol.Purpose) throw Invalid();
            var keys = TenKingsV2ServerTrust.ParseV4(root.GetProperty("keys").GetRawText());
            if (keys.KeyIds.Any(id => legacyKeyIds.Contains(id, StringComparer.Ordinal)))
            { keys.Dispose(); throw Invalid(); }
            return new AtlasServerTrust(keys);
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or NfcHelperException)
        { throw Invalid(); }
    }
    public bool TryCopyPublicSpki(string id, out byte[] spki)
    {
        if (_keys is not null) return _keys.TryCopyPublicSpki(id, out spki);
        spki = Array.Empty<byte>(); return false;
    }
    public void Dispose() => _keys?.Dispose();
    private static NfcHelperException Invalid() => new("atlas_nfc_server_trust_invalid", "Dedicated ATLAS server trust is invalid.", false, 503);
}
