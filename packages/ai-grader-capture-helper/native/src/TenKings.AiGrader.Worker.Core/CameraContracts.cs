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
    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(FrameId) || FrameId.Length > 128)
        {
            throw new InvalidDataException("Frame identity is missing or too long.");
        }

        if (Width <= 0 || Height <= 0 || Stride < Width || Mono8.Length < checked(Stride * Height))
        {
            throw new InvalidDataException("Invalid Mono8 frame dimensions or buffer length.");
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
    bool FullVisibility = false);

public sealed record HysteresisEvidence(
    int SupportingFrames,
    int RequiredFrames,
    bool CurrentFrameQualifies,
    string ResetReason);

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
            new HysteresisEvidence(0, 1, false, reason));
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

    ValueTask OpenAndConfigureAsync(CancellationToken cancellationToken);
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
