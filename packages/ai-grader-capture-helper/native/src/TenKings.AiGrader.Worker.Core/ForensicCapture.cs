using System.Buffers.Binary;
using System.IO.Compression;
using System.Security.Cryptography;

namespace TenKings.AiGrader.Worker.Core;

public enum ForensicCaptureProfile
{
    FullForensic,
    ProductionFast,
}

public static class ForensicRoles
{
    public static readonly IReadOnlyList<string> Required =
    [
        "dark_control",
        "all_on",
        "accepted_profile",
        "channel_1",
        "channel_2",
        "channel_3",
        "channel_4",
        "channel_5",
        "channel_6",
        "channel_7",
        "channel_8",
    ];
}

public sealed record ForensicSidePlan(
    string CaptureRequestId,
    string CaptureId,
    CardSide Side,
    Epochs Epochs,
    ForensicCaptureProfile Profile,
    IReadOnlyList<string> Roles);

public sealed record ForensicArtifact(
    string Role,
    string FileName,
    string Sha256,
    long ByteSize,
    string MimeType,
    int Width,
    int Height,
    string FrameId,
    string? BlockId,
    long? HardwareTimestampTicks,
    DateTimeOffset ReceiveTimestampUtc,
    double GrabMilliseconds,
    double WriteMilliseconds,
    double HashMilliseconds);

public sealed record ForensicSideResult(
    CardSide Side,
    Epochs Epochs,
    ForensicCaptureProfile Profile,
    IReadOnlyList<ForensicArtifact> Artifacts,
    double LightingAcknowledgementMilliseconds,
    double GrabMilliseconds,
    double WriteMilliseconds,
    double HashMilliseconds,
    bool SafeOffCompleted,
    GeometryResult AuthoritativeAllOnGeometry,
    ForensicTransformProvenance AuthoritativeTransform);

public sealed record ForensicTransformProvenance(
    string SourceRole,
    string SourceFrameId,
    string SourceSha256,
    int SourceWidth,
    int SourceHeight,
    int NormalizedWidth,
    int NormalizedHeight,
    IReadOnlyList<double> Homography,
    IReadOnlyList<string> ReusedByRoles);

public static class ForensicPlanValidator
{
    public static void Validate(ForensicSidePlan plan)
    {
        ValidateSafeIdentifier(plan.CaptureRequestId, 64, "capture request ID");
        ValidateSafeIdentifier(plan.CaptureId, 128, "capture ID");
        if (plan.Side is not (CardSide.Front or CardSide.Back))
        {
            throw new InvalidDataException("A forensic side plan must select front or back.");
        }

        if (plan.Roles.Count != ForensicRoles.Required.Count)
        {
            throw new InvalidDataException("Forensic plan must contain exactly eleven roles.");
        }

        if (plan.Roles.Distinct(StringComparer.Ordinal).Count() != plan.Roles.Count)
        {
            throw new InvalidDataException("Forensic plan contains a duplicate role.");
        }

        for (var index = 0; index < ForensicRoles.Required.Count; index++)
        {
            if (!string.Equals(plan.Roles[index], ForensicRoles.Required[index], StringComparison.Ordinal))
            {
                throw new InvalidDataException($"Forensic role at position {index} is missing or out of order.");
            }
        }
    }

    private static void ValidateSafeIdentifier(string value, int maxLength, string name)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > maxLength ||
            !value.All(static character => char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or ':' or '-'))
        {
            throw new InvalidDataException($"Invalid {name}.");
        }
    }
}

public sealed class ForensicCaptureWriter
{
    private readonly string _outputRoot;

    public ForensicCaptureWriter(string outputRoot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(outputRoot);
        _outputRoot = Path.GetFullPath(outputRoot);
    }

    public async ValueTask<ForensicArtifact> WriteAsync(
        string sessionDirectoryName,
        CardSide side,
        string role,
        ForensicCaptureProfile profile,
        CameraFrame frame,
        double grabMilliseconds,
        CancellationToken cancellationToken)
    {
        frame.Validate();
        ValidateSafeName(sessionDirectoryName, nameof(sessionDirectoryName));
        if (!ForensicRoles.Required.Contains(role, StringComparer.Ordinal))
        {
            throw new InvalidDataException("Unknown forensic role.");
        }

        var sideName = side switch
        {
            CardSide.Front => "front",
            CardSide.Back => "back",
            _ => throw new InvalidDataException("Forensic write requires front or back."),
        };

        var extension = profile == ForensicCaptureProfile.FullForensic ? ".png" : ".tiff";
        var mimeType = profile == ForensicCaptureProfile.FullForensic ? "image/png" : "image/tiff";
        var fileName = $"{role}{extension}";
        var directory = Path.GetFullPath(Path.Combine(_outputRoot, sessionDirectoryName, sideName));
        EnsureContained(directory, _outputRoot);
        Directory.CreateDirectory(directory);
        var finalPath = Path.Combine(directory, fileName);
        var temporaryPath = Path.Combine(directory, $".{fileName}.{Guid.NewGuid():N}.tmp");

        if (File.Exists(finalPath))
        {
            throw new IOException("Immutable forensic artifact already exists.");
        }

        var encodeStart = MonotonicClock.NowTicks;
        var bytes = profile == ForensicCaptureProfile.FullForensic
            ? LosslessMono8Encoder.EncodePng(frame)
            : LosslessMono8Encoder.EncodeTiff(frame);
        var encodeMilliseconds = MonotonicClock.ElapsedMilliseconds(encodeStart);

        var hashStart = MonotonicClock.NowTicks;
        var sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var hashMilliseconds = MonotonicClock.ElapsedMilliseconds(hashStart);

        try
        {
            await using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                131_072,
                FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
                stream.Flush(flushToDisk: true);
            }

            File.Move(temporaryPath, finalPath, overwrite: false);
        }
        catch
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }

            throw;
        }

        return new ForensicArtifact(
            role,
            fileName,
            sha256,
            bytes.LongLength,
            mimeType,
            frame.Width,
            frame.Height,
            frame.FrameId,
            frame.BlockId,
            frame.HardwareTimestampTicks,
            frame.ReceiveTimestampUtc,
            grabMilliseconds,
            encodeMilliseconds,
            hashMilliseconds);
    }

    private static void ValidateSafeName(string value, string paramName)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 128 || value.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || value.Contains("..", StringComparison.Ordinal))
        {
            throw new ArgumentException("Unsafe output directory name.", paramName);
        }
    }

    private static void EnsureContained(string candidate, string root)
    {
        var rootedPrefix = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(rootedPrefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("Output escaped the configured root.");
        }
    }
}

internal static class LosslessMono8Encoder
{
    private static ReadOnlySpan<byte> PngSignature => [137, 80, 78, 71, 13, 10, 26, 10];

    public static byte[] EncodePng(CameraFrame frame)
    {
        using var output = new MemoryStream();
        output.Write(PngSignature);

        Span<byte> ihdr = stackalloc byte[13];
        BinaryPrimitives.WriteInt32BigEndian(ihdr[..4], frame.Width);
        BinaryPrimitives.WriteInt32BigEndian(ihdr.Slice(4, 4), frame.Height);
        ihdr[8] = 8;
        ihdr[9] = 0;
        WritePngChunk(output, "IHDR"u8, ihdr);

        using var raw = new MemoryStream(checked((frame.Width + 1) * frame.Height));
        for (var y = 0; y < frame.Height; y++)
        {
            raw.WriteByte(0);
            raw.Write(frame.Mono8, y * frame.Stride, frame.Width);
        }

        raw.Position = 0;
        using var compressed = new MemoryStream();
        using (var zlib = new ZLibStream(compressed, CompressionLevel.Fastest, leaveOpen: true))
        {
            raw.CopyTo(zlib);
        }

        WritePngChunk(output, "IDAT"u8, compressed.ToArray());
        WritePngChunk(output, "IEND"u8, []);
        return output.ToArray();
    }

    public static byte[] EncodeTiff(CameraFrame frame)
    {
        const ushort entryCount = 11;
        const int ifdOffset = 8;
        var ifdSize = 2 + (entryCount * 12) + 4;
        var xResolutionOffset = ifdOffset + ifdSize;
        var yResolutionOffset = xResolutionOffset + 8;
        var pixelsOffset = yResolutionOffset + 8;
        var pixelCount = checked(frame.Width * frame.Height);
        var bytes = new byte[checked(pixelsOffset + pixelCount)];

        bytes[0] = (byte)'I';
        bytes[1] = (byte)'I';
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(2, 2), 42);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(4, 4), ifdOffset);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(ifdOffset, 2), entryCount);

        var entryOffset = ifdOffset + 2;
        WriteTiffEntry(bytes, ref entryOffset, 256, 4, 1, (uint)frame.Width);
        WriteTiffEntry(bytes, ref entryOffset, 257, 4, 1, (uint)frame.Height);
        WriteTiffEntry(bytes, ref entryOffset, 258, 3, 1, 8);
        WriteTiffEntry(bytes, ref entryOffset, 259, 3, 1, 1);
        WriteTiffEntry(bytes, ref entryOffset, 262, 3, 1, 1);
        WriteTiffEntry(bytes, ref entryOffset, 273, 4, 1, (uint)pixelsOffset);
        WriteTiffEntry(bytes, ref entryOffset, 277, 3, 1, 1);
        WriteTiffEntry(bytes, ref entryOffset, 278, 4, 1, (uint)frame.Height);
        WriteTiffEntry(bytes, ref entryOffset, 279, 4, 1, (uint)pixelCount);
        WriteTiffEntry(bytes, ref entryOffset, 282, 5, 1, (uint)xResolutionOffset);
        WriteTiffEntry(bytes, ref entryOffset, 283, 5, 1, (uint)yResolutionOffset);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(entryOffset, 4), 0);

        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(xResolutionOffset, 4), 72);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(xResolutionOffset + 4, 4), 1);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(yResolutionOffset, 4), 72);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(yResolutionOffset + 4, 4), 1);

        for (var y = 0; y < frame.Height; y++)
        {
            frame.Mono8.AsSpan(y * frame.Stride, frame.Width).CopyTo(bytes.AsSpan(pixelsOffset + (y * frame.Width), frame.Width));
        }

        return bytes;
    }

    private static void WritePngChunk(Stream destination, ReadOnlySpan<byte> type, ReadOnlySpan<byte> data)
    {
        Span<byte> length = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(length, data.Length);
        destination.Write(length);
        destination.Write(type);
        destination.Write(data);

        var crc = Crc32(type, data);
        Span<byte> crcBytes = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(crcBytes, crc);
        destination.Write(crcBytes);
    }

    private static uint Crc32(ReadOnlySpan<byte> first, ReadOnlySpan<byte> second)
    {
        var crc = uint.MaxValue;
        foreach (var value in first)
        {
            crc = UpdateCrc(crc, value);
        }

        foreach (var value in second)
        {
            crc = UpdateCrc(crc, value);
        }

        return ~crc;
    }

    private static uint UpdateCrc(uint crc, byte value)
    {
        crc ^= value;
        for (var bit = 0; bit < 8; bit++)
        {
            crc = (crc & 1) == 1 ? (crc >> 1) ^ 0xedb88320U : crc >> 1;
        }

        return crc;
    }

    private static void WriteTiffEntry(byte[] destination, ref int offset, ushort tag, ushort type, uint count, uint value)
    {
        BinaryPrimitives.WriteUInt16LittleEndian(destination.AsSpan(offset, 2), tag);
        BinaryPrimitives.WriteUInt16LittleEndian(destination.AsSpan(offset + 2, 2), type);
        BinaryPrimitives.WriteUInt32LittleEndian(destination.AsSpan(offset + 4, 4), count);
        BinaryPrimitives.WriteUInt32LittleEndian(destination.AsSpan(offset + 8, 4), value);
        offset += 12;
    }
}
