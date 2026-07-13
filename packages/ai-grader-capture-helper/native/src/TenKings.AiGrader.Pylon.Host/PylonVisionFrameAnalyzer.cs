using System.Globalization;
using V = TenKings.AiGrader.Vision;
using W = TenKings.AiGrader.Worker.Core;

namespace TenKings.AiGrader.Pylon.Host;

internal sealed class PylonVisionFrameAnalyzer : W.IFrameAnalyzer
{
    private readonly V.NativeEdgeDetector _detector = new();

    public ValueTask<W.GeometryResult> AnalyzeAsync(W.CameraFrame frame, W.Epochs epochs, W.CardSide side, long droppedFrames, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var visionEpochs = new V.FrameEpochs(
            epochs.SessionEpoch.ToString(CultureInfo.InvariantCulture), epochs.WorkerEpoch, epochs.PreviewEpoch, epochs.SideEpoch,
            side == W.CardSide.Back ? V.CardSide.Back : V.CardSide.Front);
        var identity = new V.FrameIdentity(
            frame.FrameId,
            long.TryParse(frame.BlockId, NumberStyles.None, CultureInfo.InvariantCulture, out var block) ? block : frame.Sequence,
            frame.HardwareTimestampTicks is >= 0 ? (ulong)frame.HardwareTimestampTicks.Value : null,
            frame.ReceiveTimestampUtc,
            frame.MonotonicReceiveTicks);
        var detected = _detector.Detect(
            new V.Mono8Frame(frame.Mono8, frame.Width, frame.Height, frame.Stride, identity, visionEpochs, V.VisionCalibration.Uncalibrated, droppedFrames),
            new V.DetectionContext(visionEpochs, W.MonotonicClock.NowTicks));
        var evidence = detected.Metrics.Edges.Select(edge => new W.EdgeEvidence(edge.GradientSupport, edge.Continuity, edge.ResidualPixels, detected.Detector.Contains("line", StringComparison.OrdinalIgnoreCase))).ToArray();
        var lines = detected.FittedLines.Select(line => new W.LineD(line.A, line.B, line.C)).ToArray();
        var status = detected.Status switch { V.GeometryStatus.Ready => "ready", V.GeometryStatus.AdjustCard => "adjust_card", _ => "not_detected" };
        var reasonName = detected.Reason.ToString();
        var reason = string.Concat(reasonName.Select((character, index) => index > 0 && char.IsUpper(character) ? $"_{char.ToLowerInvariant(character)}" : char.ToLowerInvariant(character).ToString()));
        var fullVisibility = !detected.Stale && !detected.Frozen && detected.Reason != V.GeometryReasonCode.ClippedBoundary && detected.Metrics.FullVisibility;
        return ValueTask.FromResult(new W.GeometryResult(
            status, [reason], detected.SourceCorners.Select(static point => new W.PointD(point.X, point.Y)).ToArray(),
            detected.NormalizedCorners.Select(static point => new W.PointD(point.X, point.Y)).ToArray(), lines,
            detected.SourceToNormalizedHomography,
            new W.PointD(detected.CenterSource.X, detected.CenterSource.Y), detected.ScaleFraction, detected.RotationDegrees,
            detected.Metrics.Confidence,
            new W.GeometryMetrics(evidence, detected.Metrics.AspectScore, detected.Metrics.Coverage, detected.Metrics.PerspectiveScore,
                detected.Metrics.ResidualScore, detected.Metrics.ConvexityScore, detected.Metrics.ClearanceScore, fullVisibility),
            frame.FrameId, frame.BlockId, epochs, side, detected.DetectEndMonotonicTicks, detected.ProcessingMs, detected.FrameAgeMs,
            detected.DroppedFrames, detected.Frozen, detected.Stale, detected.Hysteresis.MotionDeltaFraction,
            detected.Hysteresis.RemovalFenceSatisfied,
            new W.HysteresisEvidence(detected.Hysteresis.ConsecutiveAccepted, Math.Max(1, detected.Hysteresis.Required),
                detected.Hysteresis.CurrentFrameAccepted, detected.Hysteresis.EpochReset ? "epoch_reset" : string.Empty)));
    }

    public void Reset(W.Epochs epochs, W.CardSide side, string reason) => _detector.ResetTemporalState();
}
