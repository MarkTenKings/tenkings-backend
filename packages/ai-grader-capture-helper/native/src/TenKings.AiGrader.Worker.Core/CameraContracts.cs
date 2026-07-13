using System.Diagnostics;

namespace TenKings.AiGrader.Worker.Core;

public enum CardSide
{
    None,
    Front,
    Back,
}

public enum WorkerState
{
    Uninitialized,
    IdleSafe,
    Previewing,
    Draining,
    CaptureReady,
    Capturing,
    Resuming,
    TerminalFault,
    Shutdown,
}

public sealed record Epochs(
    long WorkerEpoch,
    long SessionEpoch,
    long PreviewEpoch,
    long SideEpoch);

public sealed record CameraCapabilities(
    int SensorWidth,
    int SensorHeight,
    int MaxPreviewFramesPerSecond,
    bool HasHardwareBlockId,
    bool HasHardwareTimestamp,
    string PixelFormat = "Mono8");

public sealed record CameraFrame(
    string FrameId,
    long Sequence,
    string? BlockId,
    long? HardwareTimestampTicks,
    long MonotonicReceiveTicks,
    DateTimeOffset ReceiveTimestampUtc,
    int Width,
    int Height,
    int Stride,
    byte[] Mono8)
{
    public const int MaximumDimension = 8192;
    public const int MaximumBufferBytes = 96 * 1024 * 1024;
    public long SourceDroppedFrames { get; init; }

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(FrameId) || FrameId.Length > 128)
        {
            throw new InvalidDataException("Frame identity is missing or too long.");
        }

        if (SourceDroppedFrames < 0)
        {
            throw new InvalidDataException("Source dropped-frame count must be nonnegative.");
        }

        var requiredBytes = checked((long)Stride * Height);
        if (Width <= 0 || Width > MaximumDimension || Height <= 0 || Height > MaximumDimension ||
            Stride < Width || requiredBytes > MaximumBufferBytes || Mono8.LongLength < requiredBytes ||
            Mono8.LongLength > MaximumBufferBytes)
        {
            throw new InvalidDataException("Invalid Mono8 frame dimensions or buffer length.");
        }

        if (BlockId is not null &&
            (!ulong.TryParse(
                BlockId,
                System.Globalization.NumberStyles.None,
                System.Globalization.CultureInfo.InvariantCulture,
                out _) ||
             (BlockId.Length > 1 && BlockId[0] == '0')))
        {
            throw new InvalidDataException("BlockID must be a canonical unsigned 64-bit decimal string.");
        }
    }
}

public sealed record PointD(double X, double Y);

public sealed record LineD(double A, double B, double C);

public sealed record EdgeEvidence(
    double GradientSupport,
    double Continuity,
    double Residual,
    bool Recovered);

public sealed record GeometryMetrics(
    IReadOnlyList<EdgeEvidence> Edges,
    double AspectScore,
    double Coverage,
    double PerspectiveScore,
    double ResidualScore,
    double ConvexityScore,
    double ClearanceScore,
    bool FullVisibility = false)
{
    public double AspectRatio { get; init; }
    public double ClearanceFraction { get; init; }
    public double PerspectiveSkew { get; init; }
    public double EdgeSupportScore { get; init; }
    public double ContinuityScore { get; init; }
    public double MeanResidualPixels { get; init; }
}

public sealed record HysteresisEvidence(
    int SupportingFrames,
    int RequiredFrames,
    bool CurrentFrameQualifies,
    string ResetReason);

public sealed record SensorOrientationResult(
    int SensorToPortraitRotationDegrees,
    bool MirrorHorizontal,
    bool MirrorVertical,
    bool SupportsMirrorHorizontal,
    bool SupportsMirrorVertical);

public sealed record CurrentFrameAuthorityResult(
    bool NormalizationSafe,
    bool CaptureReady,
    IReadOnlyList<string> RejectionCodes)
{
    public static CurrentFrameAuthorityResult Unsafe(string reason = "authority_not_evaluated") =>
        new(false, false, [reason]);
}

public sealed record GeometryResult(
    string Status,
    IReadOnlyList<string> ReasonCodes,
    IReadOnlyList<PointD> SourceCorners,
    IReadOnlyList<PointD> NormalizedCorners,
    IReadOnlyList<LineD> FittedLines,
    IReadOnlyList<double> SourceToNormalizedHomography,
    PointD Center,
    double Scale,
    double RotationDegrees,
    double Confidence,
    GeometryMetrics Metrics,
    string FrameId,
    string? BlockId,
    Epochs Epochs,
    CardSide Side,
    long DetectionMonotonicTicks,
    double ProcessingMilliseconds,
    double FrameAgeMilliseconds,
    long DroppedFrames,
    bool Frozen,
    bool Stale,
    double MotionDelta,
    bool RemovalFenceSatisfied,
    HysteresisEvidence Hysteresis)
{
    public string? CalibrationId { get; init; }
    public string? CalibrationSha256 { get; init; }
    public SensorOrientationResult? SensorOrientation { get; init; }
    public CurrentFrameAuthorityResult CurrentFrameAuthority { get; init; } = CurrentFrameAuthorityResult.Unsafe();
    public string Detector { get; init; } = "unknown";
    public string DetectorVersion { get; init; } = "unknown";
    public int SourceWidth { get; init; }
    public int SourceHeight { get; init; }
    public int NormalizedWidth { get; init; } = 1200;
    public int NormalizedHeight { get; init; } = 1680;

    public static GeometryResult NotDetected(CameraFrame frame, Epochs epochs, CardSide side, string reason, long drops = 0) =>
        new(
            "not_detected",
            [reason],
            [],
            [],
            [],
            [],
            new PointD(0, 0),
            0,
            0,
            0,
            new GeometryMetrics([], 0, 0, 0, 0, 0, 0),
            frame.FrameId,
            frame.BlockId,
            epochs,
            side,
            Stopwatch.GetTimestamp(),
            0,
            MonotonicClock.ElapsedMilliseconds(frame.MonotonicReceiveTicks),
            drops,
            false,
            false,
            0,
            false,
            new HysteresisEvidence(0, 1, false, reason))
        {
            CalibrationId = RigConfigurationDefaults.SafeFakeAttestation.CalibrationId,
            CalibrationSha256 = RigConfigurationDefaults.SafeFakeAttestation.CalibrationSha256,
            SensorOrientation = new SensorOrientationResult(0, false, false, false, false),
            Detector = "fused_four_edge",
            DetectorVersion = "native_four_edge_v2",
            SourceWidth = frame.Width,
            SourceHeight = frame.Height,
        };
}

public sealed record FrameAnalysis(GeometryResult Geometry, byte[] JpegBytes, double EncodeMilliseconds);

public interface IFrameAnalyzer
{
    ValueTask<GeometryResult> AnalyzeAsync(
        CameraFrame frame,
        Epochs epochs,
        CardSide side,
        long droppedFrames,
        CancellationToken cancellationToken);

    ValueTask<GeometryResult> AnalyzeForensicCurrentFrameAsync(
        CameraFrame frame,
        Epochs epochs,
        CardSide side,
        long droppedFrames,
        CancellationToken cancellationToken);

    void Reset(Epochs epochs, CardSide side, string reason);
}

public interface IPreviewFrameEncoder
{
    int JpegQuality { get; }
    ValueTask<PreviewJpeg> EncodeJpegAsync(CameraFrame frame, CancellationToken cancellationToken);
}

public sealed record PreviewJpeg(byte[] Bytes, int Width, int Height)
{
    // 512 KiB leaves deterministic headroom for base64 expansion, geometry,
    // telemetry and the NDJSON envelope under the one MiB protocol ceiling.
    public const int MaximumBytes = 512 * 1024;

    public void Validate()
    {
        if (Bytes.Length is < 4 or > MaximumBytes ||
            Bytes[0] != 0xff || Bytes[1] != 0xd8 || Bytes[^2] != 0xff || Bytes[^1] != 0xd9 ||
            Width <= 0 || Height <= 0)
        {
            throw new InvalidDataException("Preview encoder did not return a bounded JPEG image.");
        }
    }
}

public interface ICameraBackend : IAsyncDisposable
{
    string BackendKind { get; }
    bool IsOpen { get; }
    CameraCapabilities Capabilities { get; }
    IReadOnlyDictionary<string, double> TimingMilliseconds { get; }

    RigConfigurationAttestation LoadedRigConfiguration { get; }
    RigRuntimePolicy RuntimePolicy { get; }

    ValueTask OpenAndConfigureAsync(CancellationToken cancellationToken);

    ValueTask OpenAndConfigureAsync(
        RigConfigurationExpectation expectedConfiguration,
        CancellationToken cancellationToken)
    {
        LoadedRigConfiguration.Require(expectedConfiguration);
        return OpenAndConfigureAsync(cancellationToken);
    }

    ValueTask StartPreviewAsync(CancellationToken cancellationToken);
    ValueTask StopAndDrainAsync(CancellationToken cancellationToken);
    ValueTask<CameraFrame> GrabAsync(CancellationToken cancellationToken);
    ValueTask CloseAsync(CancellationToken cancellationToken);
}

public static class MonotonicClock
{
    public static long NowTicks => Stopwatch.GetTimestamp();

    public static double ElapsedMilliseconds(long start, long? end = null) =>
        ((end ?? Stopwatch.GetTimestamp()) - start) * 1000d / Stopwatch.Frequency;
}
