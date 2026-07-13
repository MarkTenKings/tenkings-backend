namespace TenKings.AiGrader.Vision;

/// <summary>
/// Evaluates whether one exact current raw frame can supply the forensic normalization transform.
/// This deliberately does not read or require live-preview hysteresis.
/// </summary>
public static class GeometryAuthorityEvaluator
{
    private const double PointTolerancePixels = 1.0;

    public static CurrentFrameAuthority EvaluateCurrentFrame(
        GeometryResult geometry,
        GeometryAuthorityExpectation expectation,
        DetectorOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(geometry);
        ArgumentNullException.ThrowIfNull(expectation);
        options ??= new DetectorOptions();
        options.Validate();

        var normalizationFailures = new HashSet<GeometryAuthorityRejectionCode>();
        var evidenceFailures = new HashSet<GeometryAuthorityRejectionCode>();

        if (!string.Equals(geometry.Frame.FrameId, expectation.FrameId, StringComparison.Ordinal))
            normalizationFailures.Add(GeometryAuthorityRejectionCode.FrameIdentityMismatch);
        if (!geometry.Frame.BlockId.HasValue || !expectation.BlockId.HasValue ||
            geometry.Frame.BlockId != expectation.BlockId)
            normalizationFailures.Add(GeometryAuthorityRejectionCode.BlockIdentityMismatch);
        if (geometry.Epochs != expectation.Epochs)
            normalizationFailures.Add(GeometryAuthorityRejectionCode.EpochMismatch);
        if (geometry.Epochs.Side != expectation.Side || expectation.Epochs.Side != expectation.Side)
            normalizationFailures.Add(GeometryAuthorityRejectionCode.SideMismatch);

        if (!string.Equals(geometry.CalibrationId, expectation.CalibrationId, StringComparison.Ordinal) ||
            !string.Equals(geometry.CalibrationDigest, expectation.CalibrationDigest, StringComparison.Ordinal) ||
            geometry.SensorOrientation != expectation.Orientation)
        {
            normalizationFailures.Add(GeometryAuthorityRejectionCode.CalibrationMismatch);
        }

        if (geometry.CalibrationId.Equals("uncalibrated", StringComparison.OrdinalIgnoreCase) ||
            !IsCanonicalSha256(geometry.CalibrationDigest))
        {
            normalizationFailures.Add(GeometryAuthorityRejectionCode.Uncalibrated);
        }

        if (!IsValidOrientation(geometry.SensorOrientation) || !IsValidOrientation(expectation.Orientation))
            normalizationFailures.Add(GeometryAuthorityRejectionCode.InvalidOrientation);

        // Corner correspondence alone is insufficient when the detector has
        // undistorted the frame: a homography can agree at all four corners
        // while mapping interior raw pixels incorrectly under radial/tangential
        // distortion. Keep lens-assisted detection display-only until the
        // normalization contract carries that explicit non-linear transform.
        if (geometry.NonlinearLensCalibrationApplied)
            normalizationFailures.Add(GeometryAuthorityRejectionCode.UnsupportedLensTransform);

        var validSourceDimensions = SourceDimensionsAreBounded(geometry.SourceWidth, geometry.SourceHeight);
        if (!validSourceDimensions)
            normalizationFailures.Add(GeometryAuthorityRejectionCode.InvalidSourceDimensions);

        if (!CornersAreFiniteOrderedConvex(geometry.SourceCorners) ||
            !SourceCornersAreInsideFrame(geometry.SourceCorners, geometry.SourceWidth, geometry.SourceHeight) ||
            !CornersAreFiniteOrderedConvex(geometry.NormalizedCorners) ||
            !PhysicalLongEdgeMapsToHeight(geometry.SourceCorners))
        {
            normalizationFailures.Add(GeometryAuthorityRejectionCode.InvalidCorners);
        }

        if (!LinesAreFiniteCoherent(geometry.FittedLines, geometry.SourceCorners))
            normalizationFailures.Add(GeometryAuthorityRejectionCode.InvalidLines);

        if (geometry.NormalizedWidth != options.NormalizedWidth ||
            geometry.NormalizedHeight != options.NormalizedHeight ||
            options.NormalizedHeight <= options.NormalizedWidth ||
            !NormalizedCornersMatchContract(geometry.NormalizedCorners, options))
        {
            normalizationFailures.Add(GeometryAuthorityRejectionCode.InvalidNormalization);
        }

        if (!HomographyIsFiniteNonsingularAndCoherent(
                geometry.SourceToNormalizedHomography,
                geometry.SourceCorners,
                geometry.NormalizedCorners))
        {
            normalizationFailures.Add(GeometryAuthorityRejectionCode.InvalidHomography);
        }

        if (geometry.Status != GeometryStatus.Ready)
            evidenceFailures.Add(GeometryAuthorityRejectionCode.RejectedStatus);
        if (geometry.Reason != GeometryReasonCode.None)
            evidenceFailures.Add(GeometryAuthorityRejectionCode.FailedReason);
        if (geometry.Stale) evidenceFailures.Add(GeometryAuthorityRejectionCode.StaleFrame);
        if (geometry.Frozen) evidenceFailures.Add(GeometryAuthorityRejectionCode.FrozenFrame);

        var metrics = geometry.Metrics;
        if (!MetricsAreFinite(metrics)) evidenceFailures.Add(GeometryAuthorityRejectionCode.FailedReason);
        if (!metrics.FullVisibility) evidenceFailures.Add(GeometryAuthorityRejectionCode.UnsafeVisibility);
        if (metrics.ClearanceFraction < options.MinClearanceFraction)
            evidenceFailures.Add(GeometryAuthorityRejectionCode.UnsafeClearance);
        if (metrics.AspectRatio < options.MinAspectRatio || metrics.AspectRatio > options.MaxAspectRatio)
            evidenceFailures.Add(GeometryAuthorityRejectionCode.UnsafeAspect);
        if (metrics.Coverage < options.MinCoverage || metrics.Coverage > options.MaxCoverage)
            evidenceFailures.Add(GeometryAuthorityRejectionCode.UnsafeCoverage);
        if (metrics.PerspectiveSkew > options.MaxPerspectiveSkew)
            evidenceFailures.Add(GeometryAuthorityRejectionCode.ExcessPerspective);
        if (metrics.Confidence < options.ReadyConfidence)
            evidenceFailures.Add(GeometryAuthorityRejectionCode.LowConfidence);
        if (metrics.Edges.Count != 4 || metrics.Edges.Any(edge => edge.GradientSupport < options.MinEdgeSupport))
            evidenceFailures.Add(GeometryAuthorityRejectionCode.UnsupportedEdge);
        if (!geometry.ExternalBoundaryCorroborated)
            evidenceFailures.Add(GeometryAuthorityRejectionCode.UnsupportedEdge);
        if (metrics.Edges.Count != 4 || metrics.Edges.Any(edge => edge.Continuity < options.MinEdgeContinuity))
            evidenceFailures.Add(GeometryAuthorityRejectionCode.UnsafeContinuity);
        if (metrics.MeanResidualPixels > options.MaxMeanResidualPixels ||
            metrics.Edges.Count != 4 || metrics.Edges.Any(edge => edge.ResidualPixels > options.MaxMeanResidualPixels))
        {
            evidenceFailures.Add(GeometryAuthorityRejectionCode.ExcessResidual);
        }

        var allFailures = normalizationFailures.Concat(evidenceFailures)
            .Distinct()
            .OrderBy(static value => value)
            .ToArray();
        return new CurrentFrameAuthority(
            normalizationFailures.Count == 0,
            normalizationFailures.Count == 0 && evidenceFailures.Count == 0,
            ReadOnly.Wrap(allFailures));
    }

    public static GeometryResult CreateForensicSnapshot(
        GeometryResult currentFrame,
        GeometryAuthorityExpectation expectation,
        DetectorOptions? options = null)
    {
        var authority = EvaluateCurrentFrame(currentFrame, expectation, options);
        if (authority.CaptureReady)
        {
            return currentFrame with
            {
                CurrentFrameAuthority = authority,
            };
        }

        return currentFrame with
        {
            Status = currentFrame.Status == GeometryStatus.Ready ? GeometryStatus.AdjustCard : currentFrame.Status,
            Reason = currentFrame.Status == GeometryStatus.Ready && currentFrame.Reason == GeometryReasonCode.None
                ? GeometryReasonCode.InconsistentEvidence
                : currentFrame.Reason,
            CurrentFrameAuthority = authority,
        };
    }

    private static bool IsCanonicalSha256(string? value) =>
        value is { Length: 64 } && value.All(static character =>
            character is >= '0' and <= '9' or >= 'a' and <= 'f');

    private static bool SourceDimensionsAreBounded(int width, int height) =>
        width is >= 64 and <= Mono8Frame.MaxDimension &&
        height is >= 64 and <= Mono8Frame.MaxDimension &&
        (long)width * height <= Mono8Frame.MaxBufferBytes;

    private static bool SourceCornersAreInsideFrame(IReadOnlyList<PointD> corners, int width, int height) =>
        SourceDimensionsAreBounded(width, height) && corners.Count == 4 && corners.All(point =>
            double.IsFinite(point.X) && double.IsFinite(point.Y) &&
            point.X >= 0 && point.X <= width - 1 && point.Y >= 0 && point.Y <= height - 1);

    private static bool IsValidOrientation(SensorOrientation? orientation)
    {
        if (orientation is null) return false;
        try
        {
            orientation.Validate();
            return true;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    private static bool CornersAreFiniteOrderedConvex(IReadOnlyList<PointD> corners)
    {
        if (corners.Count != 4 || corners.Any(static point => !double.IsFinite(point.X) || !double.IsFinite(point.Y)))
            return false;
        double sign = 0;
        for (var index = 0; index < 4; index++)
        {
            var first = corners[index];
            var second = corners[(index + 1) % 4];
            var third = corners[(index + 2) % 4];
            if (Distance(first, second) <= 1) return false;
            var cross = ((second.X - first.X) * (third.Y - second.Y)) -
                ((second.Y - first.Y) * (third.X - second.X));
            if (!double.IsFinite(cross) || Math.Abs(cross) <= 1e-6) return false;
            sign = sign == 0 ? Math.Sign(cross) : sign;
            if (Math.Sign(cross) != Math.Sign(sign)) return false;
        }

        return Math.Abs(PolygonArea(corners)) > 1;
    }

    private static bool PhysicalLongEdgeMapsToHeight(IReadOnlyList<PointD> corners)
    {
        if (corners.Count != 4) return false;
        var mappedToWidth = (Distance(corners[0], corners[1]) + Distance(corners[2], corners[3])) / 2;
        var mappedToHeight = (Distance(corners[1], corners[2]) + Distance(corners[3], corners[0])) / 2;
        return double.IsFinite(mappedToWidth) && double.IsFinite(mappedToHeight) && mappedToHeight > mappedToWidth;
    }

    private static bool LinesAreFiniteCoherent(IReadOnlyList<FittedLine> lines, IReadOnlyList<PointD> corners)
    {
        if (lines.Count != 4 || corners.Count != 4) return false;
        for (var index = 0; index < 4; index++)
        {
            var line = lines[index];
            var values = new[]
            {
                line.Start.X, line.Start.Y, line.End.X, line.End.Y, line.A, line.B, line.C,
                line.ResidualPixels, line.GradientSupport, line.Continuity,
            };
            if (line.Edge != (CardEdge)index || values.Any(static value => !double.IsFinite(value)) ||
                line.ResidualPixels < 0 || line.GradientSupport is < 0 or > 1 || line.Continuity is < 0 or > 1)
                return false;
            var norm = Math.Sqrt((line.A * line.A) + (line.B * line.B));
            if (norm is < 0.999 or > 1.001 ||
                Distance(line.Start, corners[index]) > PointTolerancePixels ||
                Distance(line.End, corners[(index + 1) % 4]) > PointTolerancePixels ||
                Math.Abs((line.A * line.Start.X) + (line.B * line.Start.Y) + line.C) > PointTolerancePixels ||
                Math.Abs((line.A * line.End.X) + (line.B * line.End.Y) + line.C) > PointTolerancePixels)
                return false;
        }

        return true;
    }

    private static bool NormalizedCornersMatchContract(IReadOnlyList<PointD> corners, DetectorOptions options)
    {
        if (corners.Count != 4) return false;
        var expected = new[]
        {
            new PointD(0, 0),
            new PointD(options.NormalizedWidth - 1, 0),
            new PointD(options.NormalizedWidth - 1, options.NormalizedHeight - 1),
            new PointD(0, options.NormalizedHeight - 1),
        };
        return corners.Select((point, index) => Distance(point, expected[index])).All(static distance => distance <= 1e-6);
    }

    private static bool HomographyIsFiniteNonsingularAndCoherent(
        IReadOnlyList<double> matrix,
        IReadOnlyList<PointD> source,
        IReadOnlyList<PointD> destination)
    {
        if (matrix.Count != 9 || matrix.Any(static value => !double.IsFinite(value)) ||
            source.Count != 4 || destination.Count != 4)
            return false;
        var determinant =
            (matrix[0] * ((matrix[4] * matrix[8]) - (matrix[5] * matrix[7]))) -
            (matrix[1] * ((matrix[3] * matrix[8]) - (matrix[5] * matrix[6]))) +
            (matrix[2] * ((matrix[3] * matrix[7]) - (matrix[4] * matrix[6])));
        if (!double.IsFinite(determinant) || Math.Abs(determinant) <= 1e-12) return false;
        for (var index = 0; index < 4; index++)
        {
            var denominator = (matrix[6] * source[index].X) + (matrix[7] * source[index].Y) + matrix[8];
            if (!double.IsFinite(denominator) || Math.Abs(denominator) <= 1e-12) return false;
            var projected = new PointD(
                ((matrix[0] * source[index].X) + (matrix[1] * source[index].Y) + matrix[2]) / denominator,
                ((matrix[3] * source[index].X) + (matrix[4] * source[index].Y) + matrix[5]) / denominator);
            if (!double.IsFinite(projected.X) || !double.IsFinite(projected.Y) ||
                Distance(projected, destination[index]) > PointTolerancePixels)
                return false;
        }

        return true;
    }

    private static bool MetricsAreFinite(GeometryMetrics metrics)
    {
        var values = new[]
        {
            metrics.Confidence, metrics.AspectRatio, metrics.AspectScore, metrics.Coverage,
            metrics.CoverageScore, metrics.ClearanceFraction, metrics.ClearanceScore,
            metrics.PerspectiveSkew, metrics.PerspectiveScore, metrics.ConvexityScore,
            metrics.ResidualScore, metrics.MeanResidualPixels, metrics.EdgeSupportScore,
            metrics.ContinuityScore,
        };
        return values.All(static value => double.IsFinite(value)) &&
            metrics.Edges.All(static edge =>
                double.IsFinite(edge.LengthPixels) && double.IsFinite(edge.GradientSupport) &&
                double.IsFinite(edge.Continuity) && double.IsFinite(edge.ResidualFraction) &&
                double.IsFinite(edge.ResidualPixels) && double.IsFinite(edge.Score));
    }

    private static double PolygonArea(IReadOnlyList<PointD> points)
    {
        double area = 0;
        for (var index = 0; index < points.Count; index++)
        {
            var next = (index + 1) % points.Count;
            area += (points[index].X * points[next].Y) - (points[next].X * points[index].Y);
        }

        return area / 2;
    }

    private static double Distance(PointD first, PointD second) =>
        Math.Sqrt(Math.Pow(first.X - second.X, 2) + Math.Pow(first.Y - second.Y, 2));
}
