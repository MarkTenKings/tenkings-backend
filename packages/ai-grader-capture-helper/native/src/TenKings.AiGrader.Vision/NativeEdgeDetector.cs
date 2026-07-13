using System.Diagnostics;
using OpenCvSharp;

namespace TenKings.AiGrader.Vision;

public sealed class NativeEdgeDetector : IDisposable
{
    public const string DetectorVersion = "native_four_edge_v1";
    private readonly DetectorOptions _options;
    private readonly GeometryTracker _tracker;
    private readonly VisionWorkspace _workspace = new();
    private readonly object _gate = new();
    private bool _disposed;

    public NativeEdgeDetector(DetectorOptions? options = null)
    {
        _options = options ?? new DetectorOptions();
        _options.Validate();
        _tracker = new GeometryTracker(_options);
    }

    public GeometryResult Detect(Mono8Frame frame, DetectionContext context, bool applyTemporalTracking = true)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            frame.Validate();
            context.ExpectedEpochs.Validate();
            var ageMs = Math.Max(0, (context.DetectStartMonotonicTicks - frame.Identity.ReceiveMonotonicTicks) * 1000d / context.EffectiveFrequency);
            if (frame.Epochs != context.ExpectedEpochs)
            {
                _tracker.Reset();
                return GeometryResult.Rejected(frame, context, GeometryReasonCode.WrongEpoch, frameAgeMs: ageMs, detector: DetectorName(_options.Mode));
            }

            if (ageMs > _options.MaxFrameAgeMs)
            {
                _tracker.Reset();
                return GeometryResult.Rejected(frame, context, GeometryReasonCode.StaleFrame, stale: true, frameAgeMs: ageMs, detector: DetectorName(_options.Mode));
            }

            GeometryResult current;
            try
            {
                current = DetectCurrent(frame, context, ageMs);
            }
            catch (OpenCVException)
            {
                _tracker.Reset();
                return GeometryResult.Rejected(frame, context, GeometryReasonCode.InvalidFrame, frameAgeMs: ageMs, detector: DetectorName(_options.Mode));
            }

            return applyTemporalTracking ? _tracker.Update(current) : current;
        }
    }

    public void ResetTemporalState()
    {
        lock (_gate)
        {
            _tracker.Reset();
        }
    }

    private GeometryResult DetectCurrent(Mono8Frame frame, DetectionContext context, double frameAgeMs)
    {
        using var images = VisionPipeline.Preprocess(frame, _options, _workspace);
        var candidates = VisionPipeline.FindCandidates(images, _options);
        if (candidates.Count == 0)
        {
            return GeometryResult.Rejected(frame, context, GeometryReasonCode.NoBoundary, frameAgeMs: frameAgeMs, detector: DetectorName(_options.Mode));
        }

        var evaluated = candidates
            .Select(candidate => VisionPipeline.Evaluate(candidate, images, _options))
            .Where(static value => value is not null)
            .Cast<EvaluatedCandidate>()
            .OrderByDescending(static value => value.Metrics.Confidence)
            .ToArray();
        if (evaluated.Length == 0)
        {
            return GeometryResult.Rejected(frame, context, GeometryReasonCode.NoGradientSupport, frameAgeMs: frameAgeMs, detector: DetectorName(_options.Mode));
        }

        var selected = evaluated[0];
        var refined = VisionMath.RefineCorners(selected.Corners, images.GradientX, images.GradientY, 3);
        var source = refined.Select(point => new PointD(
            images.SourceRoi.X + (point.X / images.AnalysisScale),
            images.SourceRoi.Y + (point.Y / images.AnalysisScale))).ToArray();
        var normalized = new[]
        {
            new PointD(0, 0),
            new PointD(_options.NormalizedWidth - 1, 0),
            new PointD(_options.NormalizedWidth - 1, _options.NormalizedHeight - 1),
            new PointD(0, _options.NormalizedHeight - 1),
        };
        var homography = VisionMath.ComputeHomography(source, normalized);
        var lines = Enumerable.Range(0, 4).Select(index =>
        {
            var edge = selected.Metrics.Edges[index];
            var start = source[index];
            var finish = source[(index + 1) % 4];
            var a = start.Y - finish.Y;
            var b = finish.X - start.X;
            var length = Math.Max(1e-9, Math.Sqrt((a * a) + (b * b)));
            return new FittedLine(
                (CardEdge)index, start, finish, a / length, b / length,
                ((start.X * finish.Y) - (finish.X * start.Y)) / length,
                edge.ResidualPixels / images.AnalysisScale, edge.GradientSupport, edge.Continuity);
        }).ToArray();
        var center = new PointD(source.Average(static point => point.X), source.Average(static point => point.Y));
        var scale = Math.Sqrt(Math.Abs(VisionMath.PolygonArea(source)) / (frame.Width * (double)frame.Height));
        var rotation = VisionMath.NormalizeRotation(Math.Atan2(source[1].Y - source[0].Y, source[1].X - source[0].X) * 180 / Math.PI);
        var reason = Classify(selected.Metrics);
        var accepted = reason == GeometryReasonCode.None;
        var end = Stopwatch.GetTimestamp();
        return new GeometryResult(
            accepted ? GeometryStatus.AdjustCard : reason is GeometryReasonCode.NoGradientSupport or GeometryReasonCode.LowConfidence ? GeometryStatus.NotDetected : GeometryStatus.AdjustCard,
            accepted ? GeometryReasonCode.WarmingUp : reason,
            selected.Source,
            DetectorVersion,
            frame.Identity,
            frame.Epochs,
            frame.Calibration.CalibrationId,
            frame.Width,
            frame.Height,
            _options.NormalizedWidth,
            _options.NormalizedHeight,
            ReadOnly.Wrap(source),
            ReadOnly.Wrap(source),
            ReadOnly.Wrap(normalized),
            ReadOnly.Wrap(lines),
            ReadOnly.Wrap(homography),
            center,
            scale,
            rotation,
            selected.Metrics,
            context.DetectStartMonotonicTicks,
            end,
            Math.Max(0, (end - context.DetectStartMonotonicTicks) * 1000d / context.EffectiveFrequency),
            frameAgeMs,
            frame.DroppedFrames,
            false,
            false,
            new HysteresisEvidence(accepted ? 1 : 0, _options.ReadyEvidenceFrames, accepted, false, 0, false));
    }

    private GeometryReasonCode Classify(GeometryMetrics metrics)
    {
        if (metrics.ClearanceFraction < _options.MinClearanceFraction) return GeometryReasonCode.ClippedBoundary;
        if (metrics.Coverage < _options.MinCoverage || metrics.Coverage > _options.MaxCoverage) return GeometryReasonCode.UnsafeCoverage;
        if (metrics.EdgeSupportScore < _options.MinEdgeSupport) return GeometryReasonCode.NoGradientSupport;
        if (metrics.AspectRatio < _options.MinAspectRatio || metrics.AspectRatio > _options.MaxAspectRatio) return GeometryReasonCode.UnsafeAspect;
        if (metrics.PerspectiveSkew > _options.MaxPerspectiveSkew) return GeometryReasonCode.ExcessPerspective;
        return metrics.Confidence < _options.MinConfidence ? GeometryReasonCode.LowConfidence : GeometryReasonCode.None;
    }

    private static string DetectorName(DetectorMode mode) => mode switch
    {
        DetectorMode.PcaBaseline => "pca_baseline",
        DetectorMode.ContourQuad => "contour_quad",
        DetectorMode.LineRecovery => "line_recovery",
        _ => "fused_four_edge",
    };

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _workspace.Dispose();
            _disposed = true;
        }
    }
}
