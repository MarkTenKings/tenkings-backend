using System.Globalization;
using V = TenKings.AiGrader.Vision;
using W = TenKings.AiGrader.Worker.Core;

namespace TenKings.AiGrader.Pylon.Host;

internal sealed class PylonVisionFrameAnalyzer : W.IFrameAnalyzer
{
    private readonly V.NativeEdgeDetector _detector = new();
    private readonly V.VisionCalibration _calibration;

    internal PylonVisionFrameAnalyzer(W.TrustedRigConfiguration configuration)
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
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var (input, context) = BuildInput(frame, epochs, side, droppedFrames);
        return ValueTask.FromResult(Map(_detector.Detect(input, context), frame, epochs, side));
    }

    public ValueTask<W.GeometryResult> AnalyzeForensicCurrentFrameAsync(
        W.CameraFrame frame,
        W.Epochs epochs,
        W.CardSide side,
        long droppedFrames,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var (input, context) = BuildInput(frame, epochs, side, droppedFrames);
        var orientation = _calibration.Orientation
            ?? throw new InvalidDataException("rig_calibration_orientation_missing");
        var expectation = new V.GeometryAuthorityExpectation(
            input.Identity.FrameId,
            input.Identity.BlockId,
            input.Epochs,
            input.Epochs.Side,
            _calibration.CalibrationId,
            _calibration.CalibrationDigest
                ?? throw new InvalidDataException("rig_calibration_digest_missing"),
            orientation);
        var detected = _detector.DetectForensicCurrentFrame(input, context, expectation);
        return ValueTask.FromResult(Map(detected, frame, epochs, side));
    }

    public void Reset(W.Epochs epochs, W.CardSide side, string reason) => _detector.ResetTemporalState();

    private (V.Mono8Frame Input, V.DetectionContext Context) BuildInput(
        W.CameraFrame frame,
        W.Epochs epochs,
        W.CardSide side,
        long droppedFrames)
    {
        var visionEpochs = new V.FrameEpochs(
            epochs.SessionEpoch.ToString(CultureInfo.InvariantCulture),
            epochs.WorkerEpoch,
            epochs.PreviewEpoch,
            epochs.SideEpoch,
            side == W.CardSide.Back ? V.CardSide.Back : V.CardSide.Front);
        var identity = new V.FrameIdentity(
            frame.FrameId,
            ulong.TryParse(frame.BlockId, NumberStyles.None, CultureInfo.InvariantCulture, out var block)
                ? block
                : null,
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
        return (input, new V.DetectionContext(visionEpochs, W.MonotonicClock.NowTicks));
    }

    private static W.GeometryResult Map(
        V.GeometryResult detected,
        W.CameraFrame frame,
        W.Epochs epochs,
        W.CardSide side)
    {
        var evidence = detected.Metrics.Edges.Select(edge => new W.EdgeEvidence(
            edge.GradientSupport,
            edge.Continuity,
            edge.ResidualPixels,
            detected.Detector.Contains("line", StringComparison.OrdinalIgnoreCase))).ToArray();
        var lines = detected.FittedLines.Select(line => new W.LineD(line.A, line.B, line.C)).ToArray();
        var fullVisibility = !detected.Stale && !detected.Frozen &&
            detected.Reason != V.GeometryReasonCode.ClippedBoundary &&
            detected.Metrics.FullVisibility;
        var status = detected.Status switch
        {
            V.GeometryStatus.Ready => "ready",
            V.GeometryStatus.AdjustCard => "adjust_card",
            _ => "not_detected",
        };
        var orientation = detected.SensorOrientation;
        return new W.GeometryResult(
            status,
            [SnakeCase(detected.Reason.ToString())],
            detected.SourceCorners.Select(static point => new W.PointD(point.X, point.Y)).ToArray(),
            detected.NormalizedCorners.Select(static point => new W.PointD(point.X, point.Y)).ToArray(),
            lines,
            detected.SourceToNormalizedHomography,
            new W.PointD(detected.CenterSource.X, detected.CenterSource.Y),
            detected.ScaleFraction,
            detected.RotationDegrees,
            detected.Metrics.Confidence,
            new W.GeometryMetrics(
                evidence,
                detected.Metrics.AspectScore,
                detected.Metrics.Coverage,
                detected.Metrics.PerspectiveScore,
                detected.Metrics.ResidualScore,
                detected.Metrics.ConvexityScore,
                detected.Metrics.ClearanceScore,
                fullVisibility)
            {
                AspectRatio = detected.Metrics.AspectRatio,
                ClearanceFraction = detected.Metrics.ClearanceFraction,
                PerspectiveSkew = detected.Metrics.PerspectiveSkew,
                EdgeSupportScore = detected.Metrics.EdgeSupportScore,
                ContinuityScore = detected.Metrics.ContinuityScore,
                MeanResidualPixels = detected.Metrics.MeanResidualPixels,
            },
            frame.FrameId,
            frame.BlockId,
            epochs,
            side,
            detected.DetectEndMonotonicTicks,
            detected.ProcessingMs,
            detected.FrameAgeMs,
            detected.DroppedFrames,
            detected.Frozen,
            detected.Stale,
            detected.Hysteresis.MotionDeltaFraction,
            detected.Hysteresis.RemovalFenceSatisfied,
            new W.HysteresisEvidence(
                detected.Hysteresis.ConsecutiveAccepted,
                Math.Max(1, detected.Hysteresis.Required),
                detected.Hysteresis.CurrentFrameAccepted,
                detected.Hysteresis.EpochReset ? "epoch_reset" : string.Empty))
        {
            CalibrationId = detected.CalibrationId,
            CalibrationSha256 = detected.CalibrationDigest,
            Detector = detected.Detector,
            DetectorVersion = detected.DetectorVersion,
            SensorOrientation = orientation is null
                ? null
                : new W.SensorOrientationResult(
                    orientation.SensorToPortraitRotationDegrees,
                    orientation.MirrorHorizontal,
                    orientation.MirrorVertical,
                    orientation.SupportedMirrors.HasFlag(V.SensorMirrorSupport.Horizontal),
                    orientation.SupportedMirrors.HasFlag(V.SensorMirrorSupport.Vertical)),
            CurrentFrameAuthority = new W.CurrentFrameAuthorityResult(
                detected.CurrentFrameAuthority.NormalizationSafe,
                detected.CurrentFrameAuthority.CaptureReady,
                detected.CurrentFrameAuthority.RejectionCodes
                    .Select(static code => SnakeCase(code.ToString()))
                    .ToArray()),
            SourceWidth = detected.SourceWidth,
            SourceHeight = detected.SourceHeight,
            NormalizedWidth = detected.NormalizedWidth,
            NormalizedHeight = detected.NormalizedHeight,
        };
    }

    private static string SnakeCase(string value) =>
        string.Concat(value.Select((character, index) =>
            index > 0 && char.IsUpper(character)
                ? $"_{char.ToLowerInvariant(character)}"
                : char.ToLowerInvariant(character).ToString()));
}
