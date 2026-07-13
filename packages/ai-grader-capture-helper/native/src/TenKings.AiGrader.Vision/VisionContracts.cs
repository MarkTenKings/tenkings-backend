using System.Collections.ObjectModel;
using System.Diagnostics;

namespace TenKings.AiGrader.Vision;

public enum CardSide
{
    Front,
    Back,
}

public enum DetectorMode
{
    PcaBaseline,
    ContourQuad,
    LineRecovery,
    Fused,
}

public enum GeometryStatus
{
    NotDetected,
    AdjustCard,
    Ready,
}

public enum GeometryReasonCode
{
    None,
    WarmingUp,
    EmptyFrame,
    InvalidFrame,
    WrongEpoch,
    StaleFrame,
    FrozenFrame,
    NoBoundary,
    NoGradientSupport,
    LowConfidence,
    UnsafeAspect,
    UnsafeCoverage,
    ClippedBoundary,
    ExcessPerspective,
    InconsistentEvidence,
    Uncalibrated,
    InvalidOrientation,
    InvalidHomography,
    UnsupportedEdge,
    UnsafeContinuity,
    ExcessResidual,
}

public enum GeometryAuthorityRejectionCode
{
    FrameIdentityMismatch,
    BlockIdentityMismatch,
    EpochMismatch,
    SideMismatch,
    CalibrationMismatch,
    Uncalibrated,
    InvalidOrientation,
    RejectedStatus,
    FailedReason,
    StaleFrame,
    FrozenFrame,
    InvalidSourceDimensions,
    InvalidCorners,
    InvalidLines,
    InvalidHomography,
    UnsafeVisibility,
    UnsafeClearance,
    UnsafeAspect,
    UnsafeCoverage,
    ExcessPerspective,
    LowConfidence,
    UnsupportedEdge,
    UnsafeContinuity,
    ExcessResidual,
    UnsupportedLensTransform,
    InvalidNormalization,
}

public enum CardEdge
{
    // Image/display ordering only. This never infers the card's printed orientation.
    Top,
    Right,
    Bottom,
    Left,
}

public readonly record struct PointD(double X, double Y)
{
    public static PointD Lerp(PointD from, PointD to, double amount) =>
        new(from.X + ((to.X - from.X) * amount), from.Y + ((to.Y - from.Y) * amount));
}

public sealed record FrameIdentity(
    string FrameId,
    ulong? BlockId,
    ulong? HardwareTimestamp,
    DateTimeOffset CaptureTimestampUtc,
    long ReceiveMonotonicTicks)
{
    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(FrameId) || FrameId.Length > 96)
        {
            throw new ArgumentException("FrameId must contain 1-96 safe characters.", nameof(FrameId));
        }

        if (FrameId.Any(static c => char.IsControl(c) || c is '/' or '\\'))
        {
            throw new ArgumentException("FrameId contains unsafe characters.", nameof(FrameId));
        }

        if (ReceiveMonotonicTicks < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(ReceiveMonotonicTicks), "Receive monotonic ticks must be non-negative.");
        }
    }
}

public sealed record FrameEpochs(
    string SessionEpoch,
    long WorkerEpoch,
    long PreviewEpoch,
    long SideEpoch,
    CardSide Side)
{
    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(SessionEpoch) || SessionEpoch.Length > 96 ||
            SessionEpoch.Any(static c => char.IsControl(c) || c is '/' or '\\'))
        {
            throw new ArgumentException("SessionEpoch must contain 1-96 safe characters.", nameof(SessionEpoch));
        }

        if (WorkerEpoch < 0 || PreviewEpoch < 0 || SideEpoch < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(WorkerEpoch), "Epoch counters must be non-negative.");
        }
    }
}

public sealed record NormalizedRoi(double X, double Y, double Width, double Height)
{
    public static NormalizedRoi SafeDefault { get; } = new(0.015, 0.015, 0.97, 0.97);

    public void Validate()
    {
        if (!double.IsFinite(X) || !double.IsFinite(Y) || !double.IsFinite(Width) || !double.IsFinite(Height) ||
            X < 0 || Y < 0 || Width <= 0 || Height <= 0 || X + Width > 1 || Y + Height > 1)
        {
            throw new ArgumentOutOfRangeException(nameof(Width), "ROI must be a finite normalized rectangle inside the frame.");
        }
    }
}

public sealed record LensCalibration(
    IReadOnlyList<double> CameraMatrix,
    IReadOnlyList<double> DistortionCoefficients)
{
    public void Validate()
    {
        const double maximumFocalLength = Mono8Frame.MaxDimension * 16d;
        if (CameraMatrix.Count != 9 || DistortionCoefficients.Count is < 4 or > 14 ||
            CameraMatrix.Any(static value => !double.IsFinite(value)) ||
            DistortionCoefficients.Any(static value => !double.IsFinite(value)) ||
            CameraMatrix[0] is < 1 or > maximumFocalLength || CameraMatrix[4] is < 1 or > maximumFocalLength ||
            Math.Abs(CameraMatrix[1]) > Mono8Frame.MaxDimension ||
            CameraMatrix[2] is < 0 or > Mono8Frame.MaxDimension ||
            Math.Abs(CameraMatrix[3]) > 1e-12 || CameraMatrix[5] is < 0 or > Mono8Frame.MaxDimension ||
            Math.Abs(CameraMatrix[6]) > 1e-12 || Math.Abs(CameraMatrix[7]) > 1e-12 ||
            Math.Abs(CameraMatrix[8] - 1) > 1e-12 ||
            (DistortionCoefficients.Count > 12 && DistortionCoefficients.Skip(12).Any(static value => Math.Abs(value) > 1e-12)))
        {
            throw new ArgumentException("Lens calibration must use a bounded canonical OpenCV camera matrix and supported 4-12 coefficient model; tilt coefficients must be zero.");
        }
    }
}

[Flags]
public enum SensorMirrorSupport
{
    None = 0,
    Horizontal = 1,
    Vertical = 2,
}

/// <summary>
/// Declares the fixed transform from raw sensor pixels to the calibrated portrait display frame.
/// It describes rig mounting only and never infers a card's printed top/bottom from artwork.
/// Mirrors are legal only when the trusted calibration explicitly declares support for that axis.
/// </summary>
public sealed record SensorOrientation(
    int SensorToPortraitRotationDegrees,
    bool MirrorHorizontal,
    bool MirrorVertical,
    SensorMirrorSupport SupportedMirrors)
{
    public static SensorOrientation Identity { get; } = new(0, false, false, SensorMirrorSupport.None);

    public void Validate()
    {
        if (SensorToPortraitRotationDegrees is not (0 or 90 or 180 or 270) ||
            (SupportedMirrors & ~(SensorMirrorSupport.Horizontal | SensorMirrorSupport.Vertical)) != 0 ||
            (MirrorHorizontal && !SupportedMirrors.HasFlag(SensorMirrorSupport.Horizontal)) ||
            (MirrorVertical && !SupportedMirrors.HasFlag(SensorMirrorSupport.Vertical)))
        {
            throw new ArgumentException("Sensor orientation is not a supported bounded rig transform.");
        }
    }
}

public sealed record VisionCalibration(
    string CalibrationId,
    NormalizedRoi SafeRoi,
    LensCalibration? Lens,
    string? CalibrationDigest = null,
    SensorOrientation? Orientation = null)
{
    public static VisionCalibration Uncalibrated { get; } = new("uncalibrated", NormalizedRoi.SafeDefault, null, null, null);

    public bool IsAuthorityCalibrated =>
        !CalibrationId.Equals("uncalibrated", StringComparison.OrdinalIgnoreCase) &&
        IsCanonicalSha256(CalibrationDigest) &&
        Orientation is not null;

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(CalibrationId) || CalibrationId.Length > 96 ||
            CalibrationId.Any(static c => char.IsControl(c) || c is '/' or '\\'))
        {
            throw new ArgumentException("CalibrationId must contain 1-96 safe characters.", nameof(CalibrationId));
        }

        SafeRoi.Validate();
        Lens?.Validate();
        Orientation?.Validate();
        if (CalibrationDigest is not null && !IsCanonicalSha256(CalibrationDigest))
        {
            throw new ArgumentException("CalibrationDigest must be a canonical lowercase SHA-256 digest.", nameof(CalibrationDigest));
        }
    }

    private static bool IsCanonicalSha256(string? value) =>
        value is { Length: 64 } && value.All(static character =>
            character is >= '0' and <= '9' or >= 'a' and <= 'f');
}

public sealed record Mono8Frame(
    ReadOnlyMemory<byte> Buffer,
    int Width,
    int Height,
    int Stride,
    FrameIdentity Identity,
    FrameEpochs Epochs,
    VisionCalibration Calibration,
    long DroppedFrames)
{
    public const int MaxDimension = 8192;
    public const int MaxBufferBytes = 96 * 1024 * 1024;

    public void Validate()
    {
        Identity.Validate();
        Epochs.Validate();
        Calibration.Validate();
        if (Width is < 64 or > MaxDimension || Height is < 64 or > MaxDimension || Stride < Width ||
            Buffer.Length < checked(Stride * Height) || Buffer.Length > MaxBufferBytes || DroppedFrames < 0)
        {
            throw new ArgumentException("Mono8 frame dimensions, stride, buffer, or drop count are invalid.");
        }
    }
}

public sealed record DetectionContext(
    FrameEpochs ExpectedEpochs,
    long DetectStartMonotonicTicks,
    double MonotonicFrequency = 0)
{
    public double EffectiveFrequency => MonotonicFrequency > 0 ? MonotonicFrequency : Stopwatch.Frequency;
}

public sealed record DetectorOptions
{
    public DetectorMode Mode { get; init; } = DetectorMode.Fused;
    public int AnalysisMaxDimension { get; init; } = 1280;
    public int AdaptiveBlockSize { get; init; } = 31;
    public double AdaptiveConstant { get; init; } = 5;
    public double CannyLow { get; init; } = 35;
    public double CannyHigh { get; init; } = 110;
    public double CannySigma { get; init; } = 0.33;
    public double CannyLowFloor { get; init; } = 20;
    public double CannyHighCeiling { get; init; } = 180;
    public int MorphologyKernel { get; init; } = 7;
    public double ExpectedAspectRatio { get; init; } = 1.4;
    public double MinAspectRatio { get; init; } = 1.18;
    public double MaxAspectRatio { get; init; } = 1.72;
    public double MinCoverage { get; init; } = 0.12;
    public double MaxCoverage { get; init; } = 0.88;
    public double MinConfidence { get; init; } = 0.58;
    public double ReadyConfidence { get; init; } = 0.70;
    public double MinEdgeSupport { get; init; } = 0.30;
    public double MinEdgeContinuity { get; init; } = 0.34;
    public double MinExternalBoundaryContrast { get; init; } = 10;
    public double MinExternalBoundaryContinuity { get; init; } = 0.45;
    public double MaxMeanResidualPixels { get; init; } = 12;
    public double MinClearanceFraction { get; init; } = 0.008;
    public double MaxPerspectiveSkew { get; init; } = 0.36;
    public double MaxFrameAgeMs { get; init; } = 250;
    public int ReadyEvidenceFrames { get; init; } = 3;
    public double MaxReadyMotionFraction { get; init; } = 0.055;
    public double DisplaySmoothingAlpha { get; init; } = 0.68;
    public int NormalizedWidth { get; init; } = 1200;
    public int NormalizedHeight { get; init; } = 1680;

    public void Validate()
    {
        if (AnalysisMaxDimension is < 320 or > 4096 || AdaptiveBlockSize is < 3 or > 101 || AdaptiveBlockSize % 2 == 0 ||
            MorphologyKernel is < 1 or > 31 || MorphologyKernel % 2 == 0 ||
            CannyLow is <= 0 or >= 255 || CannyHigh <= CannyLow || CannyHigh > 255 ||
            CannySigma is <= 0 or > 1 || CannyLowFloor is <= 0 or >= 255 ||
            CannyHighCeiling <= CannyLowFloor || CannyHighCeiling > 255 ||
            MinCoverage <= 0 || MaxCoverage >= 1 || MinCoverage >= MaxCoverage ||
            MinConfidence is <= 0 or >= 1 || ReadyConfidence < MinConfidence || ReadyConfidence >= 1 ||
            MinEdgeSupport is <= 0 or >= 1 || MinEdgeContinuity is <= 0 or >= 1 ||
            MinExternalBoundaryContrast is <= 0 or > 128 || MinExternalBoundaryContinuity is <= 0 or >= 1 ||
            MaxMeanResidualPixels is <= 0 or > 100 || MinAspectRatio <= 0 || MaxAspectRatio <= MinAspectRatio ||
            ExpectedAspectRatio < MinAspectRatio || ExpectedAspectRatio > MaxAspectRatio ||
            MinClearanceFraction is < 0 or > 0.1 || MaxPerspectiveSkew is <= 0 or >= 1 ||
            MaxFrameAgeMs <= 0 || ReadyEvidenceFrames is < 1 or > 12 ||
            MaxReadyMotionFraction is <= 0 or > 0.5 || DisplaySmoothingAlpha is <= 0 or > 1 ||
            NormalizedWidth < 100 || NormalizedHeight < 100)
        {
            throw new ArgumentException("Detector options are outside bounded safe ranges.");
        }
    }
}

public sealed record FittedLine(
    CardEdge Edge,
    PointD Start,
    PointD End,
    double A,
    double B,
    double C,
    double ResidualPixels,
    double GradientSupport,
    double Continuity);

public sealed record EdgeEvidence(
    int Index,
    double LengthPixels,
    double GradientSupport,
    double Continuity,
    double ResidualFraction,
    double ResidualPixels,
    double Score);

public sealed record GeometryMetrics(
    double Confidence,
    double AspectRatio,
    double AspectScore,
    double Coverage,
    double CoverageScore,
    double ClearanceFraction,
    double ClearanceScore,
    bool FullVisibility,
    double PerspectiveSkew,
    double PerspectiveScore,
    double ConvexityScore,
    double ResidualScore,
    double MeanResidualPixels,
    double EdgeSupportScore,
    double ContinuityScore,
    IReadOnlyList<EdgeEvidence> Edges);

public sealed record HysteresisEvidence(
    int ConsecutiveAccepted,
    int Required,
    bool CurrentFrameAccepted,
    bool EpochReset,
    double MotionDeltaFraction,
    bool RemovalFenceSatisfied);

public sealed record GeometryAuthorityExpectation(
    string FrameId,
    ulong? BlockId,
    FrameEpochs Epochs,
    CardSide Side,
    string CalibrationId,
    string CalibrationDigest,
    SensorOrientation Orientation);

public sealed record CurrentFrameAuthority(
    bool NormalizationSafe,
    bool CaptureReady,
    IReadOnlyList<GeometryAuthorityRejectionCode> RejectionCodes)
{
    public static CurrentFrameAuthority Unsafe(params GeometryAuthorityRejectionCode[] reasons) =>
        new(false, false, ReadOnly.Wrap(reasons.Length == 0 ? new[] { GeometryAuthorityRejectionCode.RejectedStatus } : reasons));
}

public sealed record GeometryResult(
    GeometryStatus Status,
    GeometryReasonCode Reason,
    string Detector,
    string DetectorVersion,
    FrameIdentity Frame,
    FrameEpochs Epochs,
    string CalibrationId,
    int SourceWidth,
    int SourceHeight,
    int NormalizedWidth,
    int NormalizedHeight,
    IReadOnlyList<PointD> SourceCorners,
    IReadOnlyList<PointD> DisplayCorners,
    IReadOnlyList<PointD> NormalizedCorners,
    IReadOnlyList<FittedLine> FittedLines,
    IReadOnlyList<double> SourceToNormalizedHomography,
    PointD CenterSource,
    double ScaleFraction,
    double RotationDegrees,
    GeometryMetrics Metrics,
    long DetectStartMonotonicTicks,
    long DetectEndMonotonicTicks,
    double ProcessingMs,
    double FrameAgeMs,
    long DroppedFrames,
    bool Frozen,
    bool Stale,
    HysteresisEvidence Hysteresis)
{
    public string? CalibrationDigest { get; init; }
    public SensorOrientation? SensorOrientation { get; init; }
    /// <summary>
    /// True when detection was performed in an undistorted image but source
    /// coordinates were mapped back through a non-linear lens model. A single
    /// projective homography cannot describe that transform for interior
    /// points, so this result is display-only until the protocol carries an
    /// explicit non-linear normalization chain.
    /// </summary>
    public bool NonlinearLensCalibrationApplied { get; init; }
    public bool ExternalBoundaryCorroborated { get; init; }
    public CurrentFrameAuthority CurrentFrameAuthority { get; init; } = CurrentFrameAuthority.Unsafe();

    public static GeometryResult Rejected(
        Mono8Frame frame,
        DetectionContext context,
        GeometryReasonCode reason,
        bool stale = false,
        bool frozen = false,
        double frameAgeMs = 0,
        string detector = "fused")
    {
        var now = Stopwatch.GetTimestamp();
        return new GeometryResult(
            GeometryStatus.NotDetected,
            reason,
            detector,
            NativeEdgeDetector.DetectorVersion,
            frame.Identity,
            frame.Epochs,
            frame.Calibration.CalibrationId,
            frame.Width,
            frame.Height,
            1200,
            1680,
            Array.Empty<PointD>(),
            Array.Empty<PointD>(),
            Array.Empty<PointD>(),
            Array.Empty<FittedLine>(),
            Array.Empty<double>(),
            default,
            0,
            0,
            EmptyMetrics,
            context.DetectStartMonotonicTicks,
            now,
            Math.Max(0, (now - context.DetectStartMonotonicTicks) * 1000d / context.EffectiveFrequency),
            Math.Max(0, frameAgeMs),
            frame.DroppedFrames,
            frozen,
            stale,
            new HysteresisEvidence(0, 0, false, true, 0, false))
        {
            CalibrationDigest = frame.Calibration.CalibrationDigest,
            SensorOrientation = frame.Calibration.Orientation,
            NonlinearLensCalibrationApplied = frame.Calibration.Lens is not null,
        };
    }

    public static GeometryMetrics EmptyMetrics { get; } = new(
        0, 0, 0, 0, 0, 0, 0, false, 1, 0, 0, 0, 0, 0, 0, Array.Empty<EdgeEvidence>());
}

internal static class ReadOnly
{
    public static IReadOnlyList<T> Wrap<T>(IEnumerable<T> values) =>
        new ReadOnlyCollection<T>(values.ToArray());
}
