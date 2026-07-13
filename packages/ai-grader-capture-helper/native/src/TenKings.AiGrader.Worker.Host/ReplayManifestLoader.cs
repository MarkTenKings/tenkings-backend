using System.Text.Json;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using TenKings.AiGrader.Worker.Core;

namespace TenKings.AiGrader.Worker.Host;

internal static class ReplayManifestLoader
{
    private static readonly Regex SafeIdentifier = new(
        "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);

    public static IReadOnlyList<CameraFrame> Load(string manifestPath)
    {
        var fullManifestPath = Path.GetFullPath(manifestPath);
        var root = Path.GetDirectoryName(fullManifestPath) ?? throw new InvalidDataException("Replay manifest has no directory.");
        using var stream = File.OpenRead(fullManifestPath);
        using var document = JsonDocument.Parse(stream, new JsonDocumentOptions
        {
            AllowTrailingCommas = false,
            CommentHandling = JsonCommentHandling.Disallow,
            MaxDepth = 16,
        });
        var top = document.RootElement;
        RequireKeys(top, ["schemaVersion", "frames"]);
        if (top.GetProperty("schemaVersion").GetString() != "tenkings.native-replay.v1")
        {
            throw new InvalidDataException("Replay manifest schema is unsupported.");
        }

        var frames = new List<CameraFrame>();
        foreach (var frame in top.GetProperty("frames").EnumerateArray())
        {
            RequireKeys(frame, ["frameId", "blockId", "hardwareTimestampTicks", "width", "height", "stride", "mono8File", "sha256"]);
            var relative = frame.GetProperty("mono8File").GetString() ?? throw new InvalidDataException("Replay frame file is missing.");
            if (Path.IsPathRooted(relative) || relative.Contains("..", StringComparison.Ordinal))
            {
                throw new InvalidDataException("Replay frame file must be a safe relative path.");
            }

            var path = Path.GetFullPath(Path.Combine(root, relative));
            var rootedPrefix = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!path.StartsWith(rootedPrefix, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("Replay frame escaped its manifest directory.");
            }

            var width = frame.GetProperty("width").GetInt32();
            var height = frame.GetProperty("height").GetInt32();
            var stride = frame.GetProperty("stride").GetInt32();
            var pixels = File.ReadAllBytes(path);
            var permittedSha256 = frame.GetProperty("sha256").GetString() ?? throw new InvalidDataException("Replay frame SHA-256 is missing.");
            if (permittedSha256.Length != 64 ||
                permittedSha256.Any(static character => character is not (>= '0' and <= '9') and not (>= 'a' and <= 'f')) ||
                !string.Equals(Convert.ToHexString(SHA256.HashData(pixels)).ToLowerInvariant(), permittedSha256, StringComparison.Ordinal))
            {
                throw new InvalidDataException("Replay frame SHA-256 is invalid or does not match.");
            }
            var frameId = ValidateSafeId(frame.GetProperty("frameId"), "frameId");
            var blockIdElement = frame.GetProperty("blockId");
            var blockId = blockIdElement.ValueKind == JsonValueKind.Null
                ? null
                : ValidateBlockId(blockIdElement);
            var cameraFrame = new CameraFrame(
                frameId,
                frames.Count + 1,
                blockId,
                ParseOptionalInt64String(frame.GetProperty("hardwareTimestampTicks")),
                MonotonicClock.NowTicks,
                DateTimeOffset.UtcNow,
                width,
                height,
                stride,
                pixels);
            cameraFrame.Validate();
            frames.Add(cameraFrame);
        }

        return frames.Count > 0 ? frames : throw new InvalidDataException("Replay manifest contains no frames.");
    }

    private static string ValidateSafeId(JsonElement value, string name)
    {
        if (value.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException($"Replay {name} must be a string.");
        }

        var text = value.GetString() ?? string.Empty;
        if (text.Length is < 1 or > 128 || !SafeIdentifier.IsMatch(text))
        {
            throw new InvalidDataException($"Replay {name} is not a bounded safe identifier.");
        }

        return text;
    }

    private static string ValidateBlockId(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException("Replay BlockID must be a decimal string or null.");
        }

        var text = value.GetString() ?? string.Empty;
        if (!ulong.TryParse(
                text,
                System.Globalization.NumberStyles.None,
                System.Globalization.CultureInfo.InvariantCulture,
                out _) ||
            (text.Length > 1 && text[0] == '0'))
        {
            throw new InvalidDataException("Replay BlockID must be canonical unsigned 64-bit decimal.");
        }

        return text;
    }

    private static long? ParseOptionalInt64String(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        return value.ValueKind == JsonValueKind.String &&
            long.TryParse(value.GetString(), System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var parsed) &&
            parsed >= 0
            ? parsed
            : throw new InvalidDataException("Replay hardware timestamp must be a nonnegative decimal string.");
    }

    private static void RequireKeys(JsonElement element, IReadOnlyCollection<string> expected)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException("Replay manifest entry must be an object.");
        }

        var actual = element.EnumerateObject().Select(static property => property.Name).ToArray();
        if (actual.Length != expected.Count || expected.Any(name => !actual.Contains(name, StringComparer.Ordinal)))
        {
            throw new InvalidDataException("Replay manifest fields are incomplete or unknown.");
        }
    }
}
