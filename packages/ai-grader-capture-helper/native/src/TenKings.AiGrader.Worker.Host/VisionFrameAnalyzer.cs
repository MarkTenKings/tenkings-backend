using System.Globalization;
using V = TenKings.AiGrader.Vision;
using W = TenKings.AiGrader.Worker.Core;

namespace TenKings.AiGrader.Worker.Host;

internal sealed class VisionFrameAnalyzer : W.IFrameAnalyzer
{
    private readonly V.NativeEdgeDetector _detector = new();

    public ValueTask<W.GeometryResult> AnalyzeAsync(
        W.CameraFrame frame,
        W.Epochs epochs,
        W.CardSide side,
        long droppedFrames,
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
            ParseBlockId(frame.BlockId, frame.Sequence),
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
            V.VisionCalibration.Uncalibrated,
            droppedFrames);
        var detected = _detector.Detect(input, new V.DetectionContext(visionEpochs, W.MonotonicClock.NowTicks));
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
                result.Hysteresis.EpochReset ? "epoch_reset" : string.Empty));
    }

    private static long ParseBlockId(string? value, long fallback) =>
        long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) && parsed >= 0 ? parsed : Math.Max(0, fallback);

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
}
