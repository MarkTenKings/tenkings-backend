using System.Diagnostics;
using OpenCvSharp;

namespace TenKings.AiGrader.Vision;

public sealed class NativeEdgeDetector : IDisposable
{
    public const string DetectorVersion = "native_four_edge_v2";
    private readonly DetectorOptions _options;
    private readonly GeometryTracker _tracker;
    private readonly VisionWorkspace _workspace = new();
    private readonly object _gate = new();
    private FrameEpochs? _lastObservedEpochs;
    private string? _lastObservedFrameId;
    private ulong? _lastObservedBlockId;
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
                ClearObservedIdentity();
                return AttachCurrentFrameAuthority(
                    GeometryResult.Rejected(frame, context, GeometryReasonCode.WrongEpoch, frameAgeMs: ageMs, detector: DetectorName(_options.Mode)),
                    frame,
                    context.ExpectedEpochs);
            }

            if (ObserveRepeatedIdentity(frame))
            {
                var frozen = AttachCurrentFrameAuthority(
                    GeometryResult.Rejected(
                        frame,
                        context,
                        GeometryReasonCode.FrozenFrame,
                        frozen: true,
                        frameAgeMs: ageMs,
                        detector: DetectorName(_options.Mode)),
                    frame,
                    context.ExpectedEpochs);
                return applyTemporalTracking ? _tracker.Update(frozen) : frozen;
            }

            if (ageMs > _options.MaxFrameAgeMs)
            {
                _tracker.Reset();
                return AttachCurrentFrameAuthority(
                    GeometryResult.Rejected(frame, context, GeometryReasonCode.StaleFrame, stale: true, frameAgeMs: ageMs, detector: DetectorName(_options.Mode)),
                    frame,
                    context.ExpectedEpochs);
            }

            GeometryResult current;
            try
            {
                current = AttachCurrentFrameAuthority(DetectCurrent(frame, context, ageMs), frame, context.ExpectedEpochs);
            }
            catch (OpenCVException)
            {
                _tracker.Reset();
                return AttachCurrentFrameAuthority(
                    GeometryResult.Rejected(frame, context, GeometryReasonCode.InvalidFrame, frameAgeMs: ageMs, detector: DetectorName(_options.Mode)),
                    frame,
                    context.ExpectedEpochs);
            }

            return applyTemporalTracking ? _tracker.Update(current) : current;
        }
    }

    public GeometryResult DetectForensicCurrentFrame(
        Mono8Frame frame,
        DetectionContext context,
        GeometryAuthorityExpectation expectation)
    {
        var current = Detect(frame, context, applyTemporalTracking: false);
        return GeometryAuthorityEvaluator.CreateForensicSnapshot(current, expectation, _options);
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
        var portrait = refined.Select(point => new PointD(
            images.SourceRoi.X + (point.X / images.AnalysisScale),
            images.SourceRoi.Y + (point.Y / images.AnalysisScale))).ToArray();
        var source = portrait.Select(point => SensorCoordinateTransform.CorrectedSensorToRaw(
            SensorCoordinateTransform.PortraitToRawSensor(
                point,
                images.SensorWidth,
                images.SensorHeight,
                images.Orientation),
            frame.Calibration.Lens)).ToArray();
        var normalized = new[]
        {
            new PointD(0, 0),
            new PointD(_options.NormalizedWidth - 1, 0),
            new PointD(_options.NormalizedWidth - 1, _options.NormalizedHeight - 1),
            new PointD(0, _options.NormalizedHeight - 1),
        };
        var homography = VisionMath.ComputeHomography(source, normalized);
        var sourceMetrics = ScaleMetricsToSource(selected.Metrics, images.AnalysisScale);
        var lines = Enumerable.Range(0, 4).Select(index =>
        {
            var edge = sourceMetrics.Edges[index];
            var start = source[index];
            var finish = source[(index + 1) % 4];
            var a = start.Y - finish.Y;
            var b = finish.X - start.X;
            var length = Math.Max(1e-9, Math.Sqrt((a * a) + (b * b)));
            return new FittedLine(
                (CardEdge)index, start, finish, a / length, b / length,
                ((start.X * finish.Y) - (finish.X * start.Y)) / length,
                edge.ResidualPixels, edge.GradientSupport, edge.Continuity);
        }).ToArray();
        var center = new PointD(source.Average(static point => point.X), source.Average(static point => point.Y));
        var scale = Math.Sqrt(Math.Abs(VisionMath.PolygonArea(source)) / (frame.Width * (double)frame.Height));
        var rotation = VisionMath.NormalizeRotation(Math.Atan2(portrait[1].Y - portrait[0].Y, portrait[1].X - portrait[0].X) * 180 / Math.PI);
        var reason = Classify(sourceMetrics, selected.ExternalBoundaryCorroborated);
        var accepted = reason == GeometryReasonCode.None;
        var end = Stopwatch.GetTimestamp();
        return new GeometryResult(
            accepted ? GeometryStatus.Ready : reason is GeometryReasonCode.NoGradientSupport or GeometryReasonCode.LowConfidence ? GeometryStatus.NotDetected : GeometryStatus.AdjustCard,
            accepted ? GeometryReasonCode.None : reason,
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
            ReadOnly.Wrap(portrait),
            ReadOnly.Wrap(normalized),
            ReadOnly.Wrap(lines),
            ReadOnly.Wrap(homography),
            center,
            scale,
            rotation,
            sourceMetrics,
            context.DetectStartMonotonicTicks,
            end,
            Math.Max(0, (end - context.DetectStartMonotonicTicks) * 1000d / context.EffectiveFrequency),
            frameAgeMs,
            frame.DroppedFrames,
            false,
            false,
            new HysteresisEvidence(accepted ? 1 : 0, _options.ReadyEvidenceFrames, accepted, false, 0, false))
        {
            CalibrationDigest = frame.Calibration.CalibrationDigest,
            SensorOrientation = frame.Calibration.Orientation,
            NonlinearLensCalibrationApplied = frame.Calibration.Lens is not null,
            ExternalBoundaryCorroborated = selected.ExternalBoundaryCorroborated,
        };
    }

    private GeometryReasonCode Classify(GeometryMetrics metrics, bool externalBoundaryCorroborated)
    {
        if (metrics.ClearanceFraction < _options.MinClearanceFraction) return GeometryReasonCode.ClippedBoundary;
        if (metrics.Coverage < _options.MinCoverage || metrics.Coverage > _options.MaxCoverage) return GeometryReasonCode.UnsafeCoverage;
        if (!externalBoundaryCorroborated) return GeometryReasonCode.UnsupportedEdge;
        if (metrics.Edges.Count != 4 || metrics.Edges.Any(edge => edge.GradientSupport < _options.MinEdgeSupport)) return GeometryReasonCode.UnsupportedEdge;
        if (metrics.Edges.Any(edge => edge.Continuity < _options.MinEdgeContinuity)) return GeometryReasonCode.UnsafeContinuity;
        if (metrics.MeanResidualPixels > _options.MaxMeanResidualPixels || metrics.Edges.Any(edge => edge.ResidualPixels > _options.MaxMeanResidualPixels)) return GeometryReasonCode.ExcessResidual;
        if (metrics.AspectRatio < _options.MinAspectRatio || metrics.AspectRatio > _options.MaxAspectRatio) return GeometryReasonCode.UnsafeAspect;
        if (metrics.PerspectiveSkew > _options.MaxPerspectiveSkew) return GeometryReasonCode.ExcessPerspective;
        return metrics.Confidence < _options.MinConfidence ? GeometryReasonCode.LowConfidence : GeometryReasonCode.None;
    }

    private GeometryResult AttachCurrentFrameAuthority(GeometryResult result, Mono8Frame frame, FrameEpochs expectedEpochs)
    {
        var orientation = frame.Calibration.Orientation ?? SensorOrientation.Identity;
        var expectation = new GeometryAuthorityExpectation(
            frame.Identity.FrameId,
            frame.Identity.BlockId,
            expectedEpochs,
            expectedEpochs.Side,
            frame.Calibration.CalibrationId,
            frame.Calibration.CalibrationDigest ?? string.Empty,
            orientation);
        var attested = result with
        {
            CalibrationDigest = frame.Calibration.CalibrationDigest,
            SensorOrientation = frame.Calibration.Orientation,
            NonlinearLensCalibrationApplied = frame.Calibration.Lens is not null,
        };
        return attested with
        {
            CurrentFrameAuthority = GeometryAuthorityEvaluator.EvaluateCurrentFrame(attested, expectation, _options),
        };
    }

    private static GeometryMetrics ScaleMetricsToSource(GeometryMetrics metrics, double analysisScale)
    {
        var inverseScale = 1 / Math.Max(analysisScale, 1e-9);
        var edges = metrics.Edges.Select(edge => edge with
        {
            LengthPixels = edge.LengthPixels * inverseScale,
            ResidualPixels = edge.ResidualPixels * inverseScale,
        }).ToArray();
        return metrics with
        {
            MeanResidualPixels = metrics.MeanResidualPixels * inverseScale,
            Edges = ReadOnly.Wrap(edges),
        };
    }

    private bool ObserveRepeatedIdentity(Mono8Frame frame)
    {
        var sameEpoch = _lastObservedEpochs == frame.Epochs;
        var repeated = sameEpoch &&
            (string.Equals(_lastObservedFrameId, frame.Identity.FrameId, StringComparison.Ordinal) ||
             (_lastObservedBlockId.HasValue && frame.Identity.BlockId.HasValue &&
              _lastObservedBlockId == frame.Identity.BlockId));
        _lastObservedEpochs = frame.Epochs;
        _lastObservedFrameId = frame.Identity.FrameId;
        _lastObservedBlockId = frame.Identity.BlockId;
        return repeated;
    }

    private void ClearObservedIdentity()
    {
        _lastObservedEpochs = null;
        _lastObservedFrameId = null;
        _lastObservedBlockId = null;
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
