namespace TenKings.AiGrader.Vision;

internal sealed class GeometryTracker
{
    private readonly DetectorOptions _options;
    private FrameEpochs? _epochs;
    private string? _frameId;
    private long? _blockId;
    private PointD[]? _displayCorners;
    private PointD[]? _lastSourceCorners;
    private int _acceptedFrames;
    private int _absenceFrames;
    private bool _removalObserved;

    public GeometryTracker(DetectorOptions options) => _options = options;

    public GeometryResult Update(GeometryResult current)
    {
        var epochReset = _epochs is not null && _epochs != current.Epochs;
        if (_epochs != current.Epochs)
        {
            ClearEvidence();
            _epochs = current.Epochs;
        }

        var repeated = _frameId == current.Frame.FrameId ||
            (_blockId.HasValue && current.Frame.BlockId.HasValue && _blockId == current.Frame.BlockId);
        _frameId = current.Frame.FrameId;
        _blockId = current.Frame.BlockId;
        if (repeated)
        {
            ClearEvidence(keepIdentity: true);
            return Reject(current, GeometryReasonCode.FrozenFrame, frozen: true, epochReset: epochReset);
        }

        if (current.Stale || current.Frozen || current.Status == GeometryStatus.NotDetected ||
            current.Reason is not (GeometryReasonCode.WarmingUp or GeometryReasonCode.None))
        {
            _absenceFrames = current.Status == GeometryStatus.NotDetected && current.Reason == GeometryReasonCode.NoBoundary
                ? _absenceFrames + 1
                : 0;
            _removalObserved |= _absenceFrames >= 2;
            ClearEvidence(keepIdentity: true, keepRemoval: true);
            return current with
            {
                Hysteresis = new HysteresisEvidence(0, _options.ReadyEvidenceFrames, false, epochReset, 0, _removalObserved),
            };
        }

        var source = current.SourceCorners.ToArray();
        var motion = MotionDelta(_lastSourceCorners, source);
        if (_lastSourceCorners is not null && motion > _options.MaxReadyMotionFraction)
        {
            ClearEvidence(keepIdentity: true, keepRemoval: true);
            _lastSourceCorners = source;
            return Reject(current, GeometryReasonCode.InconsistentEvidence, epochReset: epochReset, motion: motion);
        }

        _acceptedFrames++;
        _absenceFrames = 0;
        _lastSourceCorners = source;
        _displayCorners = Smooth(_displayCorners, source, _options.DisplaySmoothingAlpha);
        var ready = current.Metrics.Confidence >= _options.ReadyConfidence && _acceptedFrames >= _options.ReadyEvidenceFrames;
        if (current.Metrics.Confidence < _options.ReadyConfidence)
        {
            ClearEvidence(keepIdentity: true, keepRemoval: true);
            return Reject(current, GeometryReasonCode.LowConfidence, epochReset: epochReset, motion: motion);
        }

        return current with
        {
            Status = ready ? GeometryStatus.Ready : GeometryStatus.AdjustCard,
            Reason = ready ? GeometryReasonCode.None : GeometryReasonCode.WarmingUp,
            DisplayCorners = ReadOnly.Wrap(_displayCorners),
            Hysteresis = new HysteresisEvidence(_acceptedFrames, _options.ReadyEvidenceFrames, true, epochReset, motion, _removalObserved),
        };
    }

    public void Reset()
    {
        _epochs = null;
        _frameId = null;
        _blockId = null;
        _removalObserved = false;
        _absenceFrames = 0;
        ClearEvidence();
    }

    private GeometryResult Reject(
        GeometryResult current,
        GeometryReasonCode reason,
        bool frozen = false,
        bool epochReset = false,
        double motion = 0) => current with
    {
        Status = GeometryStatus.NotDetected,
        Reason = reason,
        SourceCorners = Array.Empty<PointD>(),
        DisplayCorners = Array.Empty<PointD>(),
        NormalizedCorners = Array.Empty<PointD>(),
        FittedLines = Array.Empty<FittedLine>(),
        SourceToNormalizedHomography = Array.Empty<double>(),
        Metrics = GeometryResult.EmptyMetrics,
        Frozen = frozen,
        Hysteresis = new HysteresisEvidence(0, _options.ReadyEvidenceFrames, false, epochReset, motion, _removalObserved),
    };

    private void ClearEvidence(bool keepIdentity = false, bool keepRemoval = false)
    {
        _displayCorners = null;
        _lastSourceCorners = null;
        _acceptedFrames = 0;
        if (!keepIdentity)
        {
            _frameId = null;
            _blockId = null;
        }

        if (!keepRemoval) _removalObserved = false;
    }

    private static PointD[] Smooth(IReadOnlyList<PointD>? previous, IReadOnlyList<PointD> current, double alpha)
    {
        if (previous is null || previous.Count != current.Count) return current.ToArray();
        return current.Select((point, index) => PointD.Lerp(previous[index], point, alpha)).ToArray();
    }

    private static double MotionDelta(IReadOnlyList<PointD>? previous, IReadOnlyList<PointD> current)
    {
        if (previous is null || previous.Count != 4 || current.Count != 4) return 0;
        var mean = current.Select((point, index) =>
        {
            var dx = point.X - previous[index].X;
            var dy = point.Y - previous[index].Y;
            return Math.Sqrt((dx * dx) + (dy * dy));
        }).Average();
        var diagonal = Math.Sqrt(
            Math.Pow(current[2].X - current[0].X, 2) +
            Math.Pow(current[2].Y - current[0].Y, 2));
        return diagonal <= 1 ? 1 : mean / diagonal;
    }
}
