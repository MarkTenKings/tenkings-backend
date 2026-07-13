using System.Runtime.InteropServices;
using System.Security.Cryptography;
using OpenCvSharp;
using TenKings.AiGrader.Vision;

namespace TenKings.AiGrader.Replay;

public sealed class SyntheticFrameGenerator
{
    public const int Width = 640;
    public const int Height = 480;
    public const string SyntheticCalibrationDigest = "a1b98ef8c90f6dc7712a83b698852c4c1a88698c61f081fc57b103b180dd40b6";
    public const string OfflineReplayCalibrationId = "offline-replay-coordinate-calibration-v1";
    public const string OfflineReplayCalibrationDigest = "90e4068a4c28764ce1a34d26e0bb96a0495c3b798286acbdc305068c724a73db";

    public GeneratedReplayFrame Generate(ReplayCaseSpec spec, int seed)
    {
        var random = new Random(unchecked(seed * 397) ^ StableHash(spec.Id));
        var background = spec.Polarity.ToLowerInvariant() switch
        {
            "light_on_dark" => 28,
            "neutral" => 128,
            _ => 220,
        };
        var nominalCard = spec.Polarity.Equals("light_on_dark", StringComparison.OrdinalIgnoreCase) ? 218 : 38;
        var card = spec.Effects.Contains("no_gradient", StringComparer.OrdinalIgnoreCase)
            ? background
            : spec.BorderContrast <= 5
                ? Math.Clamp(background + (background > 128 ? -3 : 3), 0, 255)
                : nominalCard;
        using var image = new Mat(Height, Width, MatType.CV_8UC1, Scalar.All(background));
        IReadOnlyList<PointD>? truth = null;
        if (spec.ExpectedCard && !spec.Effects.Contains("no_card", StringComparer.OrdinalIgnoreCase))
        {
            var corners = CardCorners(spec);
            truth = corners.Select(static point => new PointD(point.X, point.Y)).ToArray();
            var integerCorners = corners.Select(static point => new Point((int)Math.Round(point.X), (int)Math.Round(point.Y))).ToArray();
            Cv2.FillConvexPoly(image, integerCorners, Scalar.All(card), LineTypes.AntiAlias);
            var contrast = Math.Clamp(spec.BorderContrast, 0, 255);
            var border = spec.Polarity.Equals("light_on_dark", StringComparison.OrdinalIgnoreCase)
                ? Math.Clamp(card - contrast, 0, 255)
                : Math.Clamp(card + contrast, 0, 255);
            if (!spec.Effects.Contains("no_gradient", StringComparer.OrdinalIgnoreCase))
            {
                Cv2.Polylines(image, new[] { integerCorners }, true, Scalar.All(border), 4, LineTypes.AntiAlias);
                DrawArtwork(image, corners, card, random);
                ApplyCardEffects(image, spec, corners, background, random);
            }
        }

        ApplyNegativeEffects(image, spec, background);
        var bytes = new byte[Width * Height];
        Marshal.Copy(image.Data, bytes, 0, bytes.Length);
        var identityKey = spec.FrozenOf ?? spec.Id;
        var blockId = (ulong)StableHash(identityKey);
        var epochs = new FrameEpochs("synthetic-session", 1, spec.PreviewEpoch, spec.SideEpoch, spec.Side);
        var identity = new FrameIdentity(
            $"synthetic-{identityKey}", blockId, (ulong)blockId * 1_000,
            DateTimeOffset.UnixEpoch.AddMilliseconds(blockId % 1_000_000), StableHash(identityKey) * 1_000L);
        var mirrorSupport = (spec.MirrorHorizontal ? SensorMirrorSupport.Horizontal : SensorMirrorSupport.None) |
            (spec.MirrorVertical ? SensorMirrorSupport.Vertical : SensorMirrorSupport.None);
        var orientation = new SensorOrientation(spec.SensorRotationDegrees, spec.MirrorHorizontal, spec.MirrorVertical, mirrorSupport);
        var calibration = new VisionCalibration(
            "synthetic-coordinate-calibration-v1",
            NormalizedRoi.SafeDefault,
            null,
            SyntheticCalibrationDigest,
            orientation);
        return new GeneratedReplayFrame(
            new Mono8Frame(bytes, Width, Height, Width, identity, epochs, calibration, 0),
            truth);
    }

    public GeneratedReplayFrame LoadPrivate(ReplayCaseSpec spec, string privateRoot)
    {
        if (string.IsNullOrWhiteSpace(spec.PrivateFile) || string.IsNullOrWhiteSpace(spec.PermittedSha256))
            throw new InvalidDataException("Private fixture entries require a relative file and permitted SHA-256.");
        var root = Path.GetFullPath(privateRoot);
        var fullPath = Path.GetFullPath(Path.Combine(root, spec.PrivateFile));
        var relative = Path.GetRelativePath(root, fullPath);
        if (Path.IsPathRooted(relative) || relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw new InvalidDataException("Private fixture escaped its allowed root.");
        var fileInfo = new FileInfo(fullPath);
        if (!fileInfo.Exists || fileInfo.Length is <= 0 or > Mono8Frame.MaxBufferBytes)
            throw new InvalidDataException("Private fixture file size is invalid.");
        var bytesOnDisk = File.ReadAllBytes(fullPath);
        var digest = Convert.ToHexString(SHA256.HashData(bytesOnDisk)).ToLowerInvariant();
        if (!digest.Equals(spec.PermittedSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Private fixture hash was not permitted by its redacted manifest.");
        using var decoded = Cv2.ImDecode(bytesOnDisk, ImreadModes.Grayscale);
        if (decoded.Empty() || decoded.Width is < 64 or > Mono8Frame.MaxDimension ||
            decoded.Height is < 64 or > Mono8Frame.MaxDimension ||
            (long)decoded.Width * decoded.Height > Mono8Frame.MaxBufferBytes)
            throw new InvalidDataException("Private fixture was not a bounded decodable grayscale image.");
        var mono = new byte[decoded.Width * decoded.Height];
        if (decoded.IsContinuous()) Marshal.Copy(decoded.Data, mono, 0, mono.Length);
        else
        {
            for (var row = 0; row < decoded.Height; row++)
                Marshal.Copy(decoded.Ptr(row), mono, row * decoded.Width, decoded.Width);
        }

        var key = spec.FrozenOf ?? spec.Id;
        var blockId = (ulong)StableHash(key);
        var epochs = new FrameEpochs("private-session", 1, spec.PreviewEpoch, spec.SideEpoch, spec.Side);
        var identity = new FrameIdentity($"private-{key}", blockId, null, DateTimeOffset.UnixEpoch, StableHash(key) * 1_000L);
        var mirrorSupport = (spec.MirrorHorizontal ? SensorMirrorSupport.Horizontal : SensorMirrorSupport.None) |
            (spec.MirrorVertical ? SensorMirrorSupport.Vertical : SensorMirrorSupport.None);
        var orientation = new SensorOrientation(spec.SensorRotationDegrees, spec.MirrorHorizontal, spec.MirrorVertical, mirrorSupport);
        var calibration = new VisionCalibration(
            OfflineReplayCalibrationId,
            NormalizedRoi.SafeDefault,
            null,
            OfflineReplayCalibrationDigest,
            orientation);
        var truth = ValidatePrivateGroundTruth(spec, decoded.Width, decoded.Height);
        return new GeneratedReplayFrame(
            new Mono8Frame(mono, decoded.Width, decoded.Height, decoded.Width, identity, epochs, calibration, 0),
            truth);
    }

    private static IReadOnlyList<PointD>? ValidatePrivateGroundTruth(ReplayCaseSpec spec, int width, int height)
    {
        if (spec.GroundTruthCorners is null)
        {
            if (spec.ExpectedCard)
                throw new InvalidDataException("Expected-card private fixtures require four raw-source ground-truth corners.");
            return null;
        }

        if (spec.GroundTruthCorners.Count != 4 || spec.GroundTruthCorners.Any(point =>
                !double.IsFinite(point.X) || !double.IsFinite(point.Y) ||
                point.X < 0 || point.X > width - 1 || point.Y < 0 || point.Y > height - 1))
            throw new InvalidDataException("Private fixture ground truth must be four finite raw-source corners inside the decoded frame.");
        return spec.GroundTruthCorners.ToArray();
    }

    private static Point2f[] CardCorners(ReplayCaseSpec spec)
    {
        const double halfWidth = 105;
        const double halfHeight = 147;
        var centerX = (Width / 2d) + (spec.TranslationX * Width);
        var centerY = (Height / 2d) + (spec.TranslationY * Height);
        if (spec.Clipping > 0) centerX = halfWidth - (spec.Clipping * Width);
        var perspective = Math.Clamp(spec.Perspective, -0.3, 0.3);
        var points = new[]
        {
            new Point2f((float)(-halfWidth * (1 - perspective)), (float)-halfHeight),
            new Point2f((float)(halfWidth * (1 - perspective)), (float)-halfHeight),
            new Point2f((float)(halfWidth * (1 + perspective)), (float)halfHeight),
            new Point2f((float)(-halfWidth * (1 + perspective)), (float)halfHeight),
        };
        var radians = spec.RotationDegrees * Math.PI / 180;
        var cosine = Math.Cos(radians);
        var sine = Math.Sin(radians);
        return points.Select(point => new Point2f(
            (float)(centerX + (point.X * cosine) - (point.Y * sine)),
            (float)(centerY + (point.X * sine) + (point.Y * cosine)))).ToArray();
    }

    private static void DrawArtwork(Mat image, IReadOnlyList<Point2f> corners, int card, Random random)
    {
        var center = new Point(
            (int)Math.Round(corners.Average(static point => point.X)),
            (int)Math.Round(corners.Average(static point => point.Y)));
        var ink = card > 128 ? 90 : 165;
        Cv2.Ellipse(image, center, new Size(45, 58), 0, 0, 360, Scalar.All(ink), -1, LineTypes.AntiAlias);
        for (var index = 0; index < 5; index++)
        {
            var y = center.Y - 90 + (index * 42);
            Cv2.Line(image, new Point(center.X - 58, y), new Point(center.X + 58, y + random.Next(-3, 4)), Scalar.All(ink), 2, LineTypes.AntiAlias);
        }
    }

    private static void ApplyCardEffects(Mat image, ReplayCaseSpec spec, IReadOnlyList<Point2f> corners, int background, Random random)
    {
        var center = new Point(
            (int)Math.Round(corners.Average(static point => point.X)),
            (int)Math.Round(corners.Average(static point => point.Y)));
        if (spec.Effects.Contains("foil", StringComparer.OrdinalIgnoreCase))
        {
            for (var offset = -100; offset <= 100; offset += 18)
                Cv2.Line(image, new Point(center.X - 80, center.Y + offset), new Point(center.X + 80, center.Y + offset + 35), Scalar.All(random.Next(95, 210)), 3);
        }

        if (spec.Effects.Contains("glare", StringComparer.OrdinalIgnoreCase))
            Cv2.Ellipse(image, new Point(center.X + 35, center.Y - 20), new Size(55, 105), 18, 0, 360, Scalar.All(250), -1, LineTypes.AntiAlias);
        if (spec.Effects.Contains("shadow", StringComparer.OrdinalIgnoreCase))
        {
            var shadow = corners.Select(point => new Point((int)point.X, (int)point.Y)).ToArray();
            shadow[1].X = center.X;
            shadow[2].X = center.X;
            Cv2.FillConvexPoly(image, shadow, Scalar.All(18), LineTypes.AntiAlias);
        }

        if (spec.Effects.Contains("worn_corners", StringComparer.OrdinalIgnoreCase))
        {
            foreach (var corner in corners)
                Cv2.Circle(image, new Point((int)corner.X, (int)corner.Y), 10, Scalar.All(background), -1, LineTypes.AntiAlias);
        }

        if (spec.Effects.Contains("gap_edges", StringComparer.OrdinalIgnoreCase))
        {
            foreach (var edge in Enumerable.Range(0, 4))
            {
                var start = corners[edge];
                var end = corners[(edge + 1) % 4];
                var a = new Point((int)(start.X + ((end.X - start.X) * 0.38)), (int)(start.Y + ((end.Y - start.Y) * 0.38)));
                var b = new Point((int)(start.X + ((end.X - start.X) * 0.62)), (int)(start.Y + ((end.Y - start.Y) * 0.62)));
                Cv2.Line(image, a, b, Scalar.All(background), 8, LineTypes.AntiAlias);
            }
        }
    }

    private static void ApplyNegativeEffects(Mat image, ReplayCaseSpec spec, int background)
    {
        if (spec.Effects.Contains("hands", StringComparer.OrdinalIgnoreCase))
        {
            Cv2.Ellipse(image, new Point(180, 260), new Size(90, 55), 22, 0, 360, Scalar.All(140), -1);
            Cv2.Ellipse(image, new Point(455, 225), new Size(85, 52), -18, 0, 360, Scalar.All(155), -1);
        }

        if (spec.Effects.Contains("ruler", StringComparer.OrdinalIgnoreCase))
        {
            Cv2.Rectangle(image, new Rect(65, 215, 510, 52), Scalar.All(180), -1);
            for (var x = 75; x < 565; x += 15) Cv2.Line(image, new Point(x, 215), new Point(x, 235), Scalar.All(40), 2);
        }

        if (spec.Effects.Contains("wrong_object", StringComparer.OrdinalIgnoreCase))
            Cv2.Circle(image, new Point(320, 240), 125, Scalar.All(background > 128 ? 35 : 220), -1, LineTypes.AntiAlias);

        if (spec.Effects.Contains("internal_rectangle", StringComparer.OrdinalIgnoreCase))
        {
            var artworkTone = background > 128 ? 220 : 36;
            Cv2.Rectangle(image, new Rect(220, 100, 200, 280), Scalar.All(artworkTone), 4, LineTypes.AntiAlias);
            Cv2.Line(image, new Point(245, 170), new Point(395, 170), Scalar.All(artworkTone), 2, LineTypes.AntiAlias);
            Cv2.Line(image, new Point(245, 305), new Point(395, 305), Scalar.All(artworkTone), 2, LineTypes.AntiAlias);
        }
    }

    private static int StableHash(string value)
    {
        unchecked
        {
            var hash = 17;
            foreach (var character in value) hash = (hash * 31) + character;
            return hash == int.MinValue ? int.MaxValue : Math.Abs(hash);
        }
    }
}
