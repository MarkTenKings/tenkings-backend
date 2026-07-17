using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TenKings.AiGrader.NfcHelper;

public sealed record GoToTagsTerminalResult(
    string UidFingerprintSha256,
    string ReadbackPayloadSha256,
    string CallbackBodySha256);

public static partial class GoToTagsCallbackParser
{
    public static string SafeReportedAppVersion(ReadOnlyMemory<byte> body)
    {
        try
        {
            using var document = JsonDocument.Parse(body, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 32,
            });
            var client = Object(document.RootElement, "client");
            var version = String(client, "appVersion");
            var normalized = NormalizeApprovedAppVersion(version);
            return SafeVersionPattern().IsMatch(normalized) ? normalized : "invalid";
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or NfcHelperException)
        {
            return "invalid";
        }
    }

    public static GoToTagsTerminalResult Parse(
        ReadOnlyMemory<byte> body,
        string expectedCorrelationId,
        string expectedUrl)
    {
        if (body.Length is <= 0 or > NfcProtocol.MaxGoToTagsCallbackBytes)
            throw Invalid("gototags_callback_size_invalid");
        try
        {
            using var document = JsonDocument.Parse(body, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 32,
            });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw Invalid("gototags_callback_invalid");
            var encoding = Object(root, "encoding");
            var encodingNdef = Object(encoding, "ndef");
            var encodedRecord = OneRecord(encodingNdef);
            var tag = Object(root, "tag");
            var tagCc = Object(tag, "cc");
            var tagNdef = Object(tag, "ndef");
            var tagMessage = Object(tagNdef, "message");
            var readbackRecord = OneRecord(tagMessage);
            var client = Object(root, "client");
            var reader = Object(root, "reader");

            RequireExact(String(encoding, "correlationId"), expectedCorrelationId, "gototags_correlation_mismatch");
            RequireExact(String(root, "status"), "VERIFIED", "gototags_terminal_status_missing");
            RequireTrue(encoding, "lock", "gototags_lock_missing");
            RequireTrue(encodingNdef, "lock", "gototags_lock_missing");
            RequireExact(String(encodedRecord, "type"), "WEBSITE", "gototags_record_invalid");
            RequireExact(String(encodedRecord, "url"), expectedUrl, "gototags_url_mismatch");

            RequireExact(
                NormalizeApprovedAppVersion(String(client, "appVersion")),
                NfcProtocol.ApprovedGoToTagsVersion,
                "gototags_version_unapproved");
            RequireExact(String(reader, "hardware"), "ACR1552U", "gototags_reader_mismatch");
            var readerName = String(reader, "name");
            if (!ReaderNamePattern().IsMatch(readerName) || readerName.Contains("ACR1252", StringComparison.OrdinalIgnoreCase))
                throw Invalid("gototags_reader_connection_mismatch");

            RequireExact(String(tag, "manufacturer"), "FEIJU", "gototags_chip_mismatch");
            RequireExact(String(tag, "chipType"), "F8215", "gototags_chip_mismatch");
            RequireExact(String(tag, "tagType"), "TYPE_2", "gototags_chip_mismatch");
            RequireExact(String(tag, "tech"), "TYPE2", "gototags_chip_mismatch");
            RequireExact(String(tag, "technology"), "NFC", "gototags_chip_mismatch");
            RequireExact(String(tag, "format"), "NDEF", "gototags_ndef_invalid");
            RequireExact(String(tagCc, "ndefVersion"), "V1_0", "gototags_ndef_invalid");
            if (Integer(tagCc, "memorySize") != 496) throw Invalid("gototags_capacity_mismatch");
            RequireTrue(tag, "locked", "gototags_lock_missing");
            RequireTrue(tag, "lockedStatic", "gototags_lock_missing");
            RequireExact(String(readbackRecord, "type"), "WEBSITE", "gototags_readback_invalid");
            RequireExact(String(readbackRecord, "url"), expectedUrl, "gototags_readback_mismatch");

            var rawUidText = String(tag, "uid");
            if (!RawUidPattern().IsMatch(rawUidText)) throw Invalid("gototags_uid_missing");
            byte[]? uidBytes = null;
            try
            {
                uidBytes = Convert.FromHexString(rawUidText);
                var uidFingerprint = Convert.ToHexString(SHA256.HashData(uidBytes)).ToLowerInvariant();
                var urlBytes = Encoding.UTF8.GetBytes(expectedUrl);
                try
                {
                    return new GoToTagsTerminalResult(
                        uidFingerprint,
                        Convert.ToHexString(SHA256.HashData(urlBytes)).ToLowerInvariant(),
                        Convert.ToHexString(SHA256.HashData(body.Span)).ToLowerInvariant());
                }
                finally
                {
                    CryptographicOperations.ZeroMemory(urlBytes);
                }
            }
            finally
            {
                if (uidBytes is not null) CryptographicOperations.ZeroMemory(uidBytes);
                rawUidText = string.Empty;
            }
        }
        catch (NfcHelperException)
        {
            throw;
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or FormatException)
        {
            throw Invalid("gototags_callback_invalid");
        }
    }

    private static JsonElement Object(JsonElement parent, string property)
    {
        if (!parent.TryGetProperty(property, out var value) || value.ValueKind != JsonValueKind.Object)
            throw Invalid("gototags_callback_invalid");
        return value;
    }

    private static JsonElement OneRecord(JsonElement parent)
    {
        if (!parent.TryGetProperty("records", out var records) || records.ValueKind != JsonValueKind.Array || records.GetArrayLength() != 1)
            throw Invalid("gototags_record_invalid");
        var record = records[0];
        if (record.ValueKind != JsonValueKind.Object) throw Invalid("gototags_record_invalid");
        return record;
    }

    private static string String(JsonElement parent, string property)
    {
        if (!parent.TryGetProperty(property, out var value) || value.ValueKind != JsonValueKind.String)
            throw Invalid("gototags_callback_invalid");
        return value.GetString() ?? throw Invalid("gototags_callback_invalid");
    }

    private static int Integer(JsonElement parent, string property)
    {
        if (!parent.TryGetProperty(property, out var value) || !value.TryGetInt32(out var result))
            throw Invalid("gototags_callback_invalid");
        return result;
    }

    private static void RequireTrue(JsonElement parent, string property, string code)
    {
        if (!parent.TryGetProperty(property, out var value) || value.ValueKind is not JsonValueKind.True)
            throw Invalid(code);
    }

    private static void RequireExact(string actual, string expected, string code)
    {
        if (!string.Equals(actual, expected, StringComparison.Ordinal)) throw Invalid(code);
    }

    private static string NormalizeApprovedAppVersion(string version)
    {
        if (string.Equals(version, NfcProtocol.ApprovedGoToTagsVersion, StringComparison.Ordinal) ||
            string.Equals(version, $"v{NfcProtocol.ApprovedGoToTagsVersion}", StringComparison.Ordinal))
            return NfcProtocol.ApprovedGoToTagsVersion;
        return version;
    }

    private static NfcHelperException Invalid(string code) =>
        new(code, "The GoToTags completion did not prove the exact Feiju write, readback, and permanent lock.", false, 409);

    [GeneratedRegex("^ACS ACR1552U \\([A-Za-z0-9-]{1,24}\\) \\(PCSC2\\)$", RegexOptions.CultureInvariant)]
    private static partial Regex ReaderNamePattern();
    [GeneratedRegex("^[A-Fa-f0-9]{14}$", RegexOptions.CultureInvariant)]
    private static partial Regex RawUidPattern();
    [GeneratedRegex("^[A-Za-z0-9._+-]{1,32}$", RegexOptions.CultureInvariant)]
    private static partial Regex SafeVersionPattern();
}
