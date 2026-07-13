using OpenCvSharp;
using TenKings.AiGrader.Vision;

namespace TenKings.AiGrader.Vision.Tests;

public sealed class GeometryAuthorityTests
{
    [Fact]
    public void First_structurally_valid_current_frame_is_ready_without_live_hysteresis()
    {
        using var detector = TestFrames.Detector(readyFrames: 3);
        var generated = TestFrames.Generate(TestFrames.Spec());

        var forensic = TestFrames.DetectForensic(detector, generated);

        Assert.True(forensic.Status == GeometryStatus.Ready,
            $"status={forensic.Status}; reason={forensic.Reason}; confidence={forensic.Metrics.Confidence:F4}; edges={string.Join(';', forensic.Metrics.Edges.Select(edge => $"{edge.GradientSupport:F3}/{edge.Continuity:F3}/{edge.ResidualPixels:F2}"))}");
        Assert.Equal(GeometryReasonCode.None, forensic.Reason);
        Assert.True(forensic.CurrentFrameAuthority.NormalizationSafe);
        Assert.True(forensic.CurrentFrameAuthority.CaptureReady);
        Assert.Equal(1, forensic.Hysteresis.ConsecutiveAccepted);
        Assert.Equal(3, forensic.Hysteresis.Required);
    }

    [Fact]
    public void Live_preview_remains_hysteresis_gated_even_when_current_frame_is_safe()
    {
        using var detector = TestFrames.Detector(readyFrames: 3);

        var live = TestFrames.Detect(detector, TestFrames.Generate(TestFrames.Spec(), 1), temporal: true);

        Assert.Equal(GeometryStatus.AdjustCard, live.Status);
        Assert.Equal(GeometryReasonCode.WarmingUp, live.Reason);
        Assert.True(live.CurrentFrameAuthority.CaptureReady);
        Assert.Equal(1, live.Hysteresis.ConsecutiveAccepted);
    }

    [Fact]
    public void Externally_supplied_adjust_card_geometry_is_never_authoritative()
    {
        using var detector = TestFrames.Detector();
        var generated = TestFrames.Generate(TestFrames.Spec());
        var ready = TestFrames.DetectForensic(detector, generated);
        var adjust = ready with { Status = GeometryStatus.AdjustCard, Reason = GeometryReasonCode.WarmingUp };

        var authority = GeometryAuthorityEvaluator.EvaluateCurrentFrame(adjust, TestFrames.Expectation(generated), LooseOptions());

        Assert.False(authority.CaptureReady);
        Assert.Contains(GeometryAuthorityRejectionCode.RejectedStatus, authority.RejectionCodes);
        Assert.Contains(GeometryAuthorityRejectionCode.FailedReason, authority.RejectionCodes);
    }

    [Fact]
    public void Exact_frame_block_epoch_side_calibration_and_orientation_are_bound()
    {
        using var detector = TestFrames.Detector();
        var generated = TestFrames.Generate(TestFrames.Spec());
        var ready = TestFrames.DetectForensic(detector, generated);
        var expected = TestFrames.Expectation(generated);
        var cases = new[]
        {
            (expected with { FrameId = expected.FrameId + "-other" }, GeometryAuthorityRejectionCode.FrameIdentityMismatch),
            (expected with { BlockId = (expected.BlockId ?? 0) + 1 }, GeometryAuthorityRejectionCode.BlockIdentityMismatch),
            (expected with { Epochs = expected.Epochs with { SideEpoch = expected.Epochs.SideEpoch + 1 } }, GeometryAuthorityRejectionCode.EpochMismatch),
            (expected with { Side = expected.Side == CardSide.Front ? CardSide.Back : CardSide.Front }, GeometryAuthorityRejectionCode.SideMismatch),
            (expected with { CalibrationDigest = new string('0', 64) }, GeometryAuthorityRejectionCode.CalibrationMismatch),
            (expected with { Orientation = new SensorOrientation(90, false, false, SensorMirrorSupport.None) }, GeometryAuthorityRejectionCode.CalibrationMismatch),
        };

        foreach (var (mismatch, reason) in cases)
        {
            var authority = GeometryAuthorityEvaluator.EvaluateCurrentFrame(ready, mismatch, LooseOptions());
            Assert.False(authority.CaptureReady);
            Assert.Contains(reason, authority.RejectionCodes);
        }
    }

    [Fact]
    public void Every_unsafe_evidence_or_transform_condition_is_rejected()
    {
        using var detector = TestFrames.Detector();
        var generated = TestFrames.Generate(TestFrames.Spec());
        var ready = TestFrames.DetectForensic(detector, generated);
        var expected = TestFrames.Expectation(generated);
        var firstEdge = ready.Metrics.Edges[0];
        var cases = new (GeometryResult Geometry, GeometryAuthorityRejectionCode Reason)[]
        {
            (ready with { Status = GeometryStatus.NotDetected }, GeometryAuthorityRejectionCode.RejectedStatus),
            (ready with { Reason = GeometryReasonCode.LowConfidence }, GeometryAuthorityRejectionCode.FailedReason),
            (ready with { Stale = true }, GeometryAuthorityRejectionCode.StaleFrame),
            (ready with { Frozen = true }, GeometryAuthorityRejectionCode.FrozenFrame),
            (ready with { SourceWidth = 0 }, GeometryAuthorityRejectionCode.InvalidSourceDimensions),
            (ready with { SourceHeight = Mono8Frame.MaxDimension + 1 }, GeometryAuthorityRejectionCode.InvalidSourceDimensions),
            (ready with { SourceCorners = ready.SourceCorners.Select((point, index) => index == 0 ? new PointD(-0.01, point.Y) : point).ToArray() }, GeometryAuthorityRejectionCode.InvalidCorners),
            (ready with { SourceCorners = ready.SourceCorners.Select((point, index) => index == 1 ? new PointD(ready.SourceWidth, point.Y) : point).ToArray() }, GeometryAuthorityRejectionCode.InvalidCorners),
            (ready with { SourceCorners = ready.SourceCorners.Select((point, index) => index == 0 ? new PointD(double.NaN, point.Y) : point).ToArray() }, GeometryAuthorityRejectionCode.InvalidCorners),
            (ready with { FittedLines = ready.FittedLines.Select((line, index) => index == 0 ? line with { A = double.PositiveInfinity } : line).ToArray() }, GeometryAuthorityRejectionCode.InvalidLines),
            (ready with { SourceToNormalizedHomography = new double[9] }, GeometryAuthorityRejectionCode.InvalidHomography),
            (ready with { NormalizedWidth = 1680, NormalizedHeight = 1200 }, GeometryAuthorityRejectionCode.InvalidNormalization),
            (ready with { Metrics = ready.Metrics with { FullVisibility = false } }, GeometryAuthorityRejectionCode.UnsafeVisibility),
            (ready with { Metrics = ready.Metrics with { ClearanceFraction = 0 } }, GeometryAuthorityRejectionCode.UnsafeClearance),
            (ready with { Metrics = ready.Metrics with { AspectRatio = 4 } }, GeometryAuthorityRejectionCode.UnsafeAspect),
            (ready with { Metrics = ready.Metrics with { Coverage = 0.99 } }, GeometryAuthorityRejectionCode.UnsafeCoverage),
            (ready with { Metrics = ready.Metrics with { PerspectiveSkew = 0.9 } }, GeometryAuthorityRejectionCode.ExcessPerspective),
            (ready with { Metrics = ready.Metrics with { Confidence = 0.01 } }, GeometryAuthorityRejectionCode.LowConfidence),
            (ready with { Metrics = ready.Metrics with { Edges = ReplaceFirst(ready.Metrics.Edges, firstEdge with { GradientSupport = 0 }) } }, GeometryAuthorityRejectionCode.UnsupportedEdge),
            (ready with { Metrics = ready.Metrics with { Edges = ReplaceFirst(ready.Metrics.Edges, firstEdge with { Continuity = 0 }) } }, GeometryAuthorityRejectionCode.UnsafeContinuity),
            (ready with { Metrics = ready.Metrics with { MeanResidualPixels = 100 } }, GeometryAuthorityRejectionCode.ExcessResidual),
            (ready with { CalibrationDigest = null }, GeometryAuthorityRejectionCode.Uncalibrated),
            (ready with { SensorOrientation = null }, GeometryAuthorityRejectionCode.InvalidOrientation),
        };

        foreach (var (unsafeGeometry, reason) in cases)
        {
            var authority = GeometryAuthorityEvaluator.EvaluateCurrentFrame(unsafeGeometry, expected, LooseOptions());
            Assert.False(authority.CaptureReady);
            Assert.Contains(reason, authority.RejectionCodes);
        }
    }

    [Fact]
    public void Missing_block_id_on_both_result_and_expectation_is_rejected()
    {
        using var detector = TestFrames.Detector();
        var generated = TestFrames.Generate(TestFrames.Spec());
        var ready = TestFrames.DetectForensic(detector, generated);
        var withoutBlock = ready with { Frame = ready.Frame with { BlockId = null } };

        var authority = GeometryAuthorityEvaluator.EvaluateCurrentFrame(
            withoutBlock,
            TestFrames.Expectation(generated) with { BlockId = null },
            LooseOptions());

        Assert.False(authority.NormalizationSafe);
        Assert.False(authority.CaptureReady);
        Assert.Contains(GeometryAuthorityRejectionCode.BlockIdentityMismatch, authority.RejectionCodes);
    }

    [Theory]
    [InlineData("9223372036854775808")]
    [InlineData("18446744073709551615")]
    public void Unsigned_64_bit_block_identity_is_preserved_losslessly(string decimalBlockId)
    {
        using var detector = TestFrames.Detector();
        var generated = TestFrames.Generate(TestFrames.Spec());
        var ready = TestFrames.DetectForensic(detector, generated);
        var blockId = ulong.Parse(decimalBlockId, System.Globalization.CultureInfo.InvariantCulture);
        var rebound = ready with { Frame = ready.Frame with { BlockId = blockId } };

        var authority = GeometryAuthorityEvaluator.EvaluateCurrentFrame(
            rebound,
            TestFrames.Expectation(generated) with { BlockId = blockId },
            LooseOptions());

        Assert.True(authority.NormalizationSafe);
        Assert.True(authority.CaptureReady);
    }

    [Fact]
    public void Uncalibrated_frame_can_detect_for_display_but_never_become_forensic_ready()
    {
        using var detector = TestFrames.Detector();
        var generated = TestFrames.Generate(TestFrames.Spec());
        generated = generated with { Frame = generated.Frame with { Calibration = VisionCalibration.Uncalibrated } };
        var expectation = new GeometryAuthorityExpectation(
            generated.Frame.Identity.FrameId,
            generated.Frame.Identity.BlockId,
            generated.Frame.Epochs,
            generated.Frame.Epochs.Side,
            "uncalibrated",
            string.Empty,
            SensorOrientation.Identity);

        var forensic = TestFrames.DetectForensic(detector, generated, expectation);

        Assert.NotEqual(GeometryStatus.Ready, forensic.Status);
        Assert.False(forensic.CurrentFrameAuthority.CaptureReady);
        Assert.Contains(GeometryAuthorityRejectionCode.Uncalibrated, forensic.CurrentFrameAuthority.RejectionCodes);
    }

    [Fact]
    public void Nonlinear_lens_corners_cannot_make_the_interior_projective_or_authoritative()
    {
        using var detector = TestFrames.Detector();
        var generated = TestFrames.Generate(TestFrames.Spec());
        var ready = TestFrames.DetectForensic(detector, generated);
        var lens = new LensCalibration(
            [500, 0, 320, 0, 500, 240, 0, 0, 1],
            [0.8, -0.15, 0.001, -0.001, 0.02]);
        lens.Validate();

        var correctedCorners = new[]
        {
            new PointD(220, 80),
            new PointD(420, 80),
            new PointD(420, 360),
            new PointD(220, 360),
        };
        var rawCorners = correctedCorners.Select(point => Distort(point, lens)).ToArray();
        var normalizedCorners = new[]
        {
            new PointD(0, 0),
            new PointD(1199, 0),
            new PointD(1199, 1679),
            new PointD(0, 1679),
        };
        var homography = ComputeHomography(rawCorners, normalizedCorners);

        // All four distorted corners are exactly fit by a homography, but an
        // interior point still diverges because radial/tangential correction is
        // non-linear.
        var correctedInterior = new PointD(250, 300);
        var rawInterior = Distort(correctedInterior, lens);
        var projectedInterior = Project(homography, rawInterior);
        var expectedInterior = new PointD(
            ((correctedInterior.X - 220) / (420 - 220)) * 1199,
            ((correctedInterior.Y - 80) / (360 - 80)) * 1679);
        Assert.True(Distance(projectedInterior, expectedInterior) > 0.1,
            $"Non-linear lens model unexpectedly behaved projectively: error={Distance(projectedInterior, expectedInterior):F6}px.");

        var structurallyProjective = ready with
        {
            SourceCorners = rawCorners,
            NormalizedCorners = normalizedCorners,
            FittedLines = Lines(rawCorners, ready.Metrics.Edges),
            SourceToNormalizedHomography = homography,
            CenterSource = new PointD(rawCorners.Average(static point => point.X), rawCorners.Average(static point => point.Y)),
            NonlinearLensCalibrationApplied = false,
        };
        var expectation = TestFrames.Expectation(generated);
        var projectiveAuthority = GeometryAuthorityEvaluator.EvaluateCurrentFrame(
            structurallyProjective,
            expectation,
            LooseOptions());
        Assert.True(projectiveAuthority.NormalizationSafe,
            string.Join(',', projectiveAuthority.RejectionCodes));

        var lensAssisted = structurallyProjective with { NonlinearLensCalibrationApplied = true };
        var authority = GeometryAuthorityEvaluator.EvaluateCurrentFrame(lensAssisted, expectation, LooseOptions());
        Assert.False(authority.NormalizationSafe);
        Assert.False(authority.CaptureReady);
        Assert.Contains(GeometryAuthorityRejectionCode.UnsupportedLensTransform, authority.RejectionCodes);

        // The real detector must carry the typed lens flag into its authority
        // result even when it can still produce useful display geometry.
        using var lensDetector = TestFrames.Detector();
        var lensGenerated = generated with
        {
            Frame = generated.Frame with
            {
                Calibration = generated.Frame.Calibration with { Lens = lens },
                Identity = generated.Frame.Identity with
                {
                    FrameId = generated.Frame.Identity.FrameId + "-lens",
                    BlockId = (generated.Frame.Identity.BlockId ?? 0) + 1,
                },
            },
        };
        var forensic = TestFrames.DetectForensic(lensDetector, lensGenerated);
        Assert.True(forensic.NonlinearLensCalibrationApplied);
        Assert.False(forensic.CurrentFrameAuthority.CaptureReady);
        Assert.Contains(
            GeometryAuthorityRejectionCode.UnsupportedLensTransform,
            forensic.CurrentFrameAuthority.RejectionCodes);
    }

    [Fact]
    public void Worker_fake_card_scene_meets_production_current_frame_authority()
    {
        using var detector = new NativeEdgeDetector();
        var forensic = TestFrames.DetectForensic(detector, TestFrames.WorkerFakeCardScene());

        Assert.True(forensic.CurrentFrameAuthority.CaptureReady,
            $"status={forensic.Status}; reason={forensic.Reason}; authority={string.Join(',', forensic.CurrentFrameAuthority.RejectionCodes)}; confidence={forensic.Metrics.Confidence:F4}; aspect={forensic.Metrics.AspectRatio:F4}; coverage={forensic.Metrics.Coverage:F4}; clearance={forensic.Metrics.ClearanceFraction:F4}; perspective={forensic.Metrics.PerspectiveSkew:F4}; edges={string.Join(';', forensic.Metrics.Edges.Select(edge => $"{edge.GradientSupport:F3}/{edge.Continuity:F3}/{edge.ResidualPixels:F2}"))}");
        Assert.Equal(GeometryStatus.Ready, forensic.Status);
    }

    [Fact]
    public void Repeated_current_frame_identity_is_frozen_and_never_authoritative_even_after_temporal_reset()
    {
        using var detector = TestFrames.Detector();
        var generated = TestFrames.Generate(TestFrames.Spec());
        var first = TestFrames.DetectForensic(detector, generated);
        detector.ResetTemporalState();

        var repeated = TestFrames.DetectForensic(detector, generated);

        Assert.Equal(GeometryStatus.NotDetected, repeated.Status);
        Assert.Equal(GeometryReasonCode.FrozenFrame, repeated.Reason);
        Assert.True(repeated.Frozen);
        Assert.False(repeated.CurrentFrameAuthority.CaptureReady);
        Assert.Contains(GeometryAuthorityRejectionCode.FrozenFrame, repeated.CurrentFrameAuthority.RejectionCodes);
        Assert.Equal(GeometryStatus.Ready, first.Status);
    }

    private static IReadOnlyList<EdgeEvidence> ReplaceFirst(IReadOnlyList<EdgeEvidence> source, EdgeEvidence replacement) =>
        source.Select((edge, index) => index == 0 ? replacement : edge).ToArray();

    private static IReadOnlyList<FittedLine> Lines(
        IReadOnlyList<PointD> corners,
        IReadOnlyList<EdgeEvidence> evidence) =>
        Enumerable.Range(0, 4).Select(index =>
        {
            var start = corners[index];
            var end = corners[(index + 1) % 4];
            var a = start.Y - end.Y;
            var b = end.X - start.X;
            var length = Math.Sqrt((a * a) + (b * b));
            return new FittedLine(
                (CardEdge)index,
                start,
                end,
                a / length,
                b / length,
                ((start.X * end.Y) - (end.X * start.Y)) / length,
                evidence[index].ResidualPixels,
                evidence[index].GradientSupport,
                evidence[index].Continuity);
        }).ToArray();

    private static IReadOnlyList<double> ComputeHomography(
        IReadOnlyList<PointD> source,
        IReadOnlyList<PointD> destination)
    {
        using var matrix = Cv2.GetPerspectiveTransform(
            source.Select(static point => new Point2f((float)point.X, (float)point.Y)).ToArray(),
            destination.Select(static point => new Point2f((float)point.X, (float)point.Y)).ToArray());
        return Enumerable.Range(0, 9)
            .Select(index => matrix.At<double>(index / 3, index % 3))
            .ToArray();
    }

    private static PointD Distort(PointD corrected, LensCalibration lens)
    {
        var matrix = lens.CameraMatrix;
        var coefficients = lens.DistortionCoefficients;
        double Coefficient(int index) => index < coefficients.Count ? coefficients[index] : 0;
        var y = (corrected.Y - matrix[5]) / matrix[4];
        var x = (corrected.X - matrix[2] - (matrix[1] * y)) / matrix[0];
        var r2 = (x * x) + (y * y);
        var r4 = r2 * r2;
        var r6 = r4 * r2;
        var radial = (1 + (Coefficient(0) * r2) + (Coefficient(1) * r4) + (Coefficient(4) * r6)) /
            (1 + (Coefficient(5) * r2) + (Coefficient(6) * r4) + (Coefficient(7) * r6));
        var distortedX = (x * radial) + (2 * Coefficient(2) * x * y) +
            (Coefficient(3) * (r2 + (2 * x * x))) + (Coefficient(8) * r2) + (Coefficient(9) * r4);
        var distortedY = (y * radial) + (Coefficient(2) * (r2 + (2 * y * y))) +
            (2 * Coefficient(3) * x * y) + (Coefficient(10) * r2) + (Coefficient(11) * r4);
        return new PointD(
            (matrix[0] * distortedX) + (matrix[1] * distortedY) + matrix[2],
            (matrix[4] * distortedY) + matrix[5]);
    }

    private static PointD Project(IReadOnlyList<double> matrix, PointD point)
    {
        var denominator = (matrix[6] * point.X) + (matrix[7] * point.Y) + matrix[8];
        return new PointD(
            ((matrix[0] * point.X) + (matrix[1] * point.Y) + matrix[2]) / denominator,
            ((matrix[3] * point.X) + (matrix[4] * point.Y) + matrix[5]) / denominator);
    }

    private static double Distance(PointD first, PointD second) =>
        Math.Sqrt(Math.Pow(first.X - second.X, 2) + Math.Pow(first.Y - second.Y, 2));

    private static DetectorOptions LooseOptions() => new()
    {
        ReadyConfidence = 0.52,
        MinConfidence = 0.46,
        MinEdgeSupport = 0.20,
        MinEdgeContinuity = 0.05,
        MaxMeanResidualPixels = 30,
    };
}
