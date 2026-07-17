using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace TenKings.AiGrader.NfcHelper;

public sealed record EncodedNdefUrl(string Url, string PublicTagId, byte[] Message, string PayloadSha256);

public sealed record ParsedNdefUrl(string Url, string PublicTagId, byte[] Message, string PayloadSha256);

public sealed record Type2NdefLocation(
    bool Exists,
    int TypeOffset,
    int LengthOffset,
    int ValueOffset,
    int ValueLength,
    int EndOffset,
    int? TerminatorOffset,
    bool HasFollowingTlv);

public static partial class NdefCodec
{
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    [GeneratedRegex("^[A-Za-z0-9_-]{32}$", RegexOptions.CultureInvariant)]
    private static partial Regex PublicTagIdPattern();

    public static EncodedNdefUrl EncodeProductionUrl(string url)
    {
        var publicTagId = ValidateProductionUrl(url);
        return EncodeUrl(url, publicTagId, $"collect.tenkings.co/nfc/{publicTagId}");
    }

    private static EncodedNdefUrl EncodeUrl(string url, string publicTagId, string remainder)
    {
        var remainderBytes = StrictUtf8.GetBytes(remainder);
        var payloadLength = checked(remainderBytes.Length + 1);
        if (payloadLength > byte.MaxValue)
        {
            throw new NfcHelperException("ndef_payload_too_large", "The NFC URL is too large for the supported short URI record.");
        }

        var message = new byte[4 + payloadLength];
        message[0] = 0xD1; // MB=1, ME=1, SR=1, TNF=well-known.
        message[1] = 0x01;
        message[2] = checked((byte)payloadLength);
        message[3] = 0x55; // NFC Forum URI RTD type "U".
        message[4] = 0x04; // URI Identifier Code: https://
        remainderBytes.CopyTo(message, 5);
        return new EncodedNdefUrl(url, publicTagId, message, UrlSha256(url));
    }

    public static ParsedNdefUrl ParseProductionUrl(ReadOnlySpan<byte> message)
        => ParseUrl(message, ValidateProductionUrl);

    private static ParsedNdefUrl ParseUrl(ReadOnlySpan<byte> message, Func<string, string> validateUrl)
    {
        if (message.Length < 5 || message[0] != 0xD1 || message[1] != 0x01 || message[3] != 0x55)
        {
            throw new NfcHelperException("unsupported_ndef_record", "The tag does not contain the supported single NFC Forum URI record.");
        }

        var payloadLength = message[2];
        if (payloadLength < 1 || message.Length != 4 + payloadLength || message[4] != 0x04)
        {
            throw new NfcHelperException("unsupported_ndef_record", "The tag URI record is malformed or uses an unsupported URI prefix.");
        }

        string remainder;
        try
        {
            remainder = StrictUtf8.GetString(message[5..]);
        }
        catch (DecoderFallbackException)
        {
            throw new NfcHelperException("malformed_ndef_utf8", "The tag URI record is not valid UTF-8.");
        }

        var url = $"https://{remainder}";
        var publicTagId = validateUrl(url);
        var bytes = message.ToArray();
        return new ParsedNdefUrl(url, publicTagId, bytes, UrlSha256(url));
    }

    public static string ValidateProductionUrl(string url)
    {
        if (string.IsNullOrWhiteSpace(url) || !url.StartsWith(NfcProtocol.ProductionUrlPrefix, StringComparison.Ordinal))
        {
            throw new NfcHelperException("invalid_nfc_url", "Only the Ten Kings production NFC URL form is allowed.");
        }

        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed) ||
            !string.Equals(parsed.Scheme, Uri.UriSchemeHttps, StringComparison.Ordinal) ||
            !string.Equals(parsed.Host, "collect.tenkings.co", StringComparison.Ordinal) ||
            parsed.Port != 443 ||
            !string.IsNullOrEmpty(parsed.Query) ||
            !string.IsNullOrEmpty(parsed.Fragment) ||
            !string.IsNullOrEmpty(parsed.UserInfo))
        {
            throw new NfcHelperException("invalid_nfc_url", "Only the Ten Kings production NFC URL form is allowed.");
        }

        var publicTagId = url[NfcProtocol.ProductionUrlPrefix.Length..];
        if (!PublicTagIdPattern().IsMatch(publicTagId) || parsed.AbsolutePath != $"/nfc/{publicTagId}" || parsed.AbsoluteUri != url)
        {
            throw new NfcHelperException("invalid_public_tag_id", "The NFC public tag identifier is malformed.");
        }

        return publicTagId;
    }

    public static Type2NdefLocation LocateNdef(ReadOnlySpan<byte> dataArea)
    {
        var offset = 0;
        int? firstNull = null;
        while (offset < dataArea.Length)
        {
            var type = dataArea[offset];
            if (type == 0x00)
            {
                firstNull ??= offset;
                offset++;
                continue;
            }

            if (type == 0xFE)
            {
                var insertion = firstNull ?? offset;
                return new Type2NdefLocation(false, insertion, insertion + 1, insertion + 2, 0, insertion + 2, offset, false);
            }

            if (offset + 1 >= dataArea.Length)
            {
                throw new NfcHelperException("malformed_type2_tlv", "The NFC Type 2 TLV header is truncated.");
            }

            var lengthByte = dataArea[offset + 1];
            int headerLength;
            int valueLength;
            if (lengthByte == 0xFF)
            {
                if (offset + 3 >= dataArea.Length)
                {
                    throw new NfcHelperException("malformed_type2_tlv", "The NFC Type 2 extended TLV length is truncated.");
                }
                headerLength = 4;
                valueLength = (dataArea[offset + 2] << 8) | dataArea[offset + 3];
                if (valueLength < 0xFF)
                {
                    throw new NfcHelperException("malformed_type2_tlv", "The NFC Type 2 extended TLV length is non-canonical.");
                }
            }
            else
            {
                headerLength = 2;
                valueLength = lengthByte;
            }

            var valueOffset = checked(offset + headerLength);
            var endOffset = checked(valueOffset + valueLength);
            if (endOffset > dataArea.Length)
            {
                throw new NfcHelperException("malformed_type2_tlv", "The NFC Type 2 TLV exceeds the advertised data area.");
            }

            if (type == 0x03)
            {
                var cursor = endOffset;
                while (cursor < dataArea.Length && dataArea[cursor] == 0x00) cursor++;
                var terminator = cursor < dataArea.Length && dataArea[cursor] == 0xFE ? cursor : (int?)null;
                var hasFollowing = cursor < dataArea.Length && dataArea[cursor] != 0xFE;
                return new Type2NdefLocation(true, offset, offset + 1, valueOffset, valueLength, endOffset, terminator, hasFollowing);
            }

            offset = endOffset;
            firstNull = null;
        }

        var fallback = firstNull ?? dataArea.Length;
        return new Type2NdefLocation(false, fallback, fallback + 1, fallback + 2, 0, fallback + 2, null, false);
    }

    public static byte[] EncodeType2Tlv(EncodedNdefUrl encoded)
    {
        if (encoded.Message.Length > 254)
        {
            throw new NfcHelperException("ndef_payload_too_large", "The NFC URL exceeds the supported Type 2 short TLV size.");
        }
        var tlv = new byte[encoded.Message.Length + 3];
        tlv[0] = 0x03;
        tlv[1] = checked((byte)encoded.Message.Length);
        encoded.Message.CopyTo(tlv, 2);
        tlv[^1] = 0xFE;
        return tlv;
    }

    public static string Sha256Hex(ReadOnlySpan<byte> value) => Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();

    public static string UrlSha256(string normalizedUrl) => Sha256Hex(StrictUtf8.GetBytes(normalizedUrl));
}

public static class Ntag215Layout
{
    public const int FirstNdefPage = 4;
    public const int LastNdefPage = 127;
    public const int NdefDataAreaBytes = 496;
    public static readonly byte[] GetVersionResponse = [0x00, 0x04, 0x04, 0x02, 0x01, 0x00, 0x11, 0x03];
    public static readonly byte[] WritableCapabilityContainer = [0xE1, 0x10, 0x3E, 0x00];

    public static void ValidateGetVersion(ReadOnlySpan<byte> version)
    {
        if (!version.SequenceEqual(GetVersionResponse))
        {
            throw new NfcHelperException("unsupported_tag", "Place one supported NTAG215 on the reader.", false, 422);
        }
    }

    public static void ValidateCapabilityContainer(ReadOnlySpan<byte> cc, bool requireWritable)
    {
        if (cc.Length != 4 || cc[0] != 0xE1 || (cc[1] & 0xF0) != 0x10 || cc[2] != 0x3E || (cc[3] & 0xF0) != 0x00)
        {
            throw new NfcHelperException("invalid_capability_container", "The tag Capability Container is not a supported NTAG215 Type 2 layout.", false, 422);
        }
        if (requireWritable && (cc[3] & 0x0F) != 0x00)
        {
            throw new NfcHelperException("tag_read_only", "The NTAG215 data area is not writable.", false, 409);
        }
    }

    public static int PageForDataOffset(int offset)
    {
        if (offset < 0 || offset >= NdefDataAreaBytes) throw new ArgumentOutOfRangeException(nameof(offset));
        return FirstNdefPage + offset / 4;
    }
}
