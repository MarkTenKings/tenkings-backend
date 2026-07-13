using System.Globalization;
using V = TenKings.AiGrader.Vision;
using W = TenKings.AiGrader.Worker.Core;

namespace TenKings.AiGrader.Worker.Host;

internal sealed class VisionFrameAnalyzer : W.IFrameAnalyzer
{
    private readonly V.NativeEdgeDetector _detector = new();
    private readonly V.VisionCalibration _calibration;

    internal VisionFrameAnalyzer() : this(W.RigConfigurationDefaults.SafeFakeConfiguration)
    {
    }

    internal VisionFrameAnalyzer(W.TrustedRigConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        configuration.Validate();
        var source = configuration.Calibration;
        var supportedMirrors = V.SensorMirrorSupport.None;
        if (source.Orientation.SupportsMirrorX) supportedMirrors |= V.SensorMirrorSupport.Horizontal;
        if (source.Orientation.SupportsMirrorY) supportedMirrors |= V.SensorMirrorSupport.Vertical;
        _calibration = new V.VisionCalibration(
            source.CalibrationId,
            new V.NormalizedRoi(source.SafeRoi.X, source.SafeRoi.Y, source.SafeRoi.Width, source.SafeRoi.Height),
            source.Lens is null
                ? null
                : new V.LensCalibration(source.Lens.CameraMatrix, source.Lens.DistortionCoefficients),
            source.CalibrationSha256.ToLowerInvariant(),
            new V.SensorOrientation(
                source.Orientation.RotationDegrees,
                source.Orientation.MirrorX,
                source.Orientation.MirrorY,
                supportedMirrors));
        _calibration.Validate();
        if (!_calibration.IsAuthorityCalibrated)
        {
            throw new InvalidDataException("rig_calibration_not_authoritative");
        }
    }

    public ValueTask<W.GeometryResult> AnalyzeAsync(
        W.CameraFrame frame,
        W.Epochs epochs,
        W.CardSide side,
        long droppedFrames,
        CancellationToken cancellationToken) =>
        AnalyzeCore(frame, epochs, side, droppedFrames, forensicCurrentFrame: false, cancellationToken);

    public ValueTask<W.GeometryResult> AnalyzeForensicCurrentFrameAsync(
        W.CameraFrame frame,
        W.Epochs epochs,
        W.CardSide side,
        long droppedFrames,
        CancellationToken cancellationToken) =>
        AnalyzeCore(frame, epochs, side, droppedFrames, forensicCurrentFrame: true, cancellationToken);

    private ValueTask<W.GeometryResult> AnalyzeCore(
        W.CameraFrame frame,
        W.Epochs epochs,
        W.CardSide side,
        long droppedFrames,
        bool forensicCurrentFrame,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var visionEpochs = new V.FrameEpochs(
            epochs.SessionEpoch.ToString(CultureInfo.InvariantCulture),
            epochs.WorkerEpoch,
            epochs.PreviewEpoch,
            epochs.SideEpoch,
            side == W.CardSide.Back ? V.CardSide.Back : V.CardSide.Front);
        var identity = new V.FrameIdentity(
            frame.FrameId,
            ParseBlockId(frame.BlockId),
            frame.HardwareTimestampTicks is >= 0 ? (ulong)frame.HardwareTimestampTicks.Value : null,
            frame.ReceiveTimestampUtc,
            frame.MonotonicReceiveTicks);
        var input = new V.Mono8Frame(
            frame.Mono8,
            frame.Width,
            frame.Height,
            frame.Stride,
            identity,
            visionEpochs,
            _calibration,
            droppedFrames);
        var context = new V.DetectionContext(visionEpochs, W.MonotonicClock.NowTicks);
        var detected = forensicCurrentFrame
            ? _detector.DetectForensicCurrentFrame(
                input,
                context,
                new V.GeometryAuthorityExpectation(
                    identity.FrameId,
                    identity.BlockId,
                    visionEpochs,
                    visionEpochs.Side,
                    _calibration.CalibrationId,
                    _calibration.CalibrationDigest!,
                    _calibration.Orientation!))
            : _detector.Detect(input, context);
        return ValueTask.FromResult(Map(detected, frame, epochs, side));
    }

    public void Reset(W.Epochs epochs, W.CardSide side, string reason) => _detector.ResetTemporalState();

    private static W.GeometryResult Map(V.GeometryResult result, W.CameraFrame frame, W.Epochs epochs, W.CardSide side)
    {
        var edgeMetrics = result.Metrics.Edges.Select(edge => new W.EdgeEvidence(
            edge.GradientSupport,
            edge.Continuity,
            edge.ResidualPixels,
            result.Detector.Contains("line", StringComparison.OrdinalIgnoreCase))).ToArray();
        var lines = result.FittedLines.Select(line => new W.LineD(line.A, line.B, line.C)).ToArray();
        var fullVisibility = !result.Stale && !result.Frozen &&
            result.Reason != V.GeometryReasonCode.ClippedBoundary &&
            result.Metrics.FullVisibility;
        return new W.GeometryResult(
            Status(result.Status),
            [Reason(result.Reason)],
            result.SourceCorners.Select(static point => new W.PointD(point.X, point.Y)).ToArray(),
            result.NormalizedCorners.Select(static point => new W.PointD(point.X, point.Y)).ToArray(),
            lines,
            result.SourceToNormalizedHomography,
            new W.PointD(result.CenterSource.X, result.CenterSource.Y),
            result.ScaleFraction,
            result.RotationDegrees,
            result.Metrics.Confidence,
            new W.GeometryMetrics(
                edgeMetrics,
                result.Metrics.AspectScore,
                result.Metrics.Coverage,
                result.Metrics.PerspectiveScore,
                result.Metrics.ResidualScore,
                result.Metrics.ConvexityScore,
                result.Metrics.ClearanceScore,
                fullVisibility),
            frame.FrameId,
            frame.BlockId,
            epochs,
            side,
            result.DetectEndMonotonicTicks,
            result.ProcessingMs,
            result.FrameAgeMs,
            result.DroppedFrames,
            result.Frozen,
            result.Stale,
            result.Hysteresis.MotionDeltaFraction,
            result.Hysteresis.RemovalFenceSatisfied,
            new W.HysteresisEvidence(
                result.Hysteresis.ConsecutiveAccepted,
                Math.Max(1, result.Hysteresis.Required),
                result.Hysteresis.CurrentFrameAccepted,
                result.Hysteresis.EpochReset ? "epoch_reset" : string.Empty))
        {
            CalibrationId = result.CalibrationId,
            CalibrationSha256 = result.CalibrationDigest,
            SensorOrientation = result.SensorOrientation is null
                ? null
                : new W.SensorOrientationResult(
                    result.SensorOrientation.SensorToPortraitRotationDegrees,
                    result.SensorOrientation.MirrorHorizontal,
                    result.SensorOrientation.MirrorVertical,
                    result.SensorOrientation.SupportedMirrors.HasFlag(V.SensorMirrorSupport.Horizontal),
                    result.SensorOrientation.SupportedMirrors.HasFlag(V.SensorMirrorSupport.Vertical)),
            CurrentFrameAuthority = new W.CurrentFrameAuthorityResult(
                result.CurrentFrameAuthority.NormalizationSafe,
                result.CurrentFrameAuthority.CaptureReady,
                result.CurrentFrameAuthority.RejectionCodes.Select(AuthorityReason).ToArray()),
            Detector = result.Detector,
            DetectorVersion = result.DetectorVersion,
            SourceWidth = result.SourceWidth,
            SourceHeight = result.SourceHeight,
            NormalizedWidth = result.NormalizedWidth,
            NormalizedHeight = result.NormalizedHeight,
            Metrics = new W.GeometryMetrics(
                edgeMetrics,
                result.Metrics.AspectScore,
                result.Metrics.Coverage,
                result.Metrics.PerspectiveScore,
                result.Metrics.ResidualScore,
                result.Metrics.ConvexityScore,
                result.Metrics.ClearanceScore,
                fullVisibility)
            {
                AspectRatio = result.Metrics.AspectRatio,
                ClearanceFraction = result.Metrics.ClearanceFraction,
                PerspectiveSkew = result.Metrics.PerspectiveSkew,
                EdgeSupportScore = result.Metrics.EdgeSupportScore,
                ContinuityScore = result.Metrics.ContinuityScore,
                MeanResidualPixels = result.Metrics.MeanResidualPixels,
            },
        };
    }

    private static ulong? ParseBlockId(string? value) =>
        ulong.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;

    private static string Status(V.GeometryStatus status) => status switch
    {
        V.GeometryStatus.Ready => "ready",
        V.GeometryStatus.AdjustCard => "adjust_card",
        _ => "not_detected",
    };

    private static string Reason(V.GeometryReasonCode reason)
    {
        var text = reason.ToString();
        return string.Concat(text.Select((character, index) => index > 0 && char.IsUpper(character) ? $"_{char.ToLowerInvariant(character)}" : char.ToLowerInvariant(character).ToString()));
    }

    private static string AuthorityReason(V.GeometryAuthorityRejectionCode reason)
    {
        var text = reason.ToString();
        return string.Concat(text.Select((character, index) => index > 0 && char.IsUpper(character) ? $"_{char.ToLowerInvariant(character)}" : char.ToLowerInvariant(character).ToString()));
    }
}
