using TenKings.AiGrader.Vision;

namespace TenKings.AiGrader.Vision.Tests;

public sealed class NativeEdgeDetectorTests
{
    [Theory]
    [InlineData(DetectorMode.PcaBaseline)]
    [InlineData(DetectorMode.ContourQuad)]
    [InlineData(DetectorMode.LineRecovery)]
    [InlineData(DetectorMode.Fused)]
    public void Comparators_detect_bounded_card_with_real_edge_support(DetectorMode mode)
    {
        var result = TestFrames.Detect(TestFrames.Detector(mode), TestFrames.Generate(TestFrames.Spec()), temporal: false);

        Assert.Equal(4, result.SourceCorners.Count);
        Assert.Equal(4, result.FittedLines.Count);
        Assert.Equal(9, result.SourceToNormalizedHomography.Count);
        Assert.True(result.Metrics.EdgeSupportScore >= 0.2, $"support={result.Metrics.EdgeSupportScore}");
        Assert.Equal(NativeEdgeDetector.DetectorVersion, result.DetectorVersion);
    }

    [Theory]
    [InlineData("dark_on_light")]
    [InlineData("light_on_dark")]
    public void Dual_polarity_detects_dark_and_light_cards(string polarity)
    {
        var result = TestFrames.Detect(
            TestFrames.Detector(DetectorMode.Fused),
            TestFrames.Generate(TestFrames.Spec(polarity: polarity)),
            temporal: false);

        Assert.Equal(4, result.SourceCorners.Count);
        Assert.True(result.Metrics.Confidence > 0.45);
    }

    [Theory]
    [InlineData(-35)]
    [InlineData(-18)]
    [InlineData(0)]
    [InlineData(18)]
    [InlineData(35)]
    public void Rotation_envelope_preserves_four_edge_geometry(double rotation)
    {
        var result = TestFrames.Detect(
            TestFrames.Detector(),
            TestFrames.Generate(TestFrames.Spec(rotation: rotation)),
            temporal: false);

        Assert.Equal(4, result.SourceCorners.Count);
        Assert.InRange(Math.Abs(result.RotationDegrees), Math.Max(0, Math.Abs(rotation) - 7), Math.Abs(rotation) + 7);
    }

    [Fact]
    public void Perspective_and_translation_produce_projective_transform()
    {
        var result = TestFrames.Detect(
            TestFrames.Detector(),
            TestFrames.Generate(TestFrames.Spec(rotation: 11, perspective: 0.16, translationX: 0.08, translationY: -0.06)),
            temporal: false);

        Assert.Equal(4, result.SourceCorners.Count);
        for (var index = 0; index < 4; index++)
        {
            var projected = Project(result.SourceToNormalizedHomography, result.SourceCorners[index]);
            Assert.InRange(Math.Abs(projected.X - result.NormalizedCorners[index].X), 0, 0.25);
            Assert.InRange(Math.Abs(projected.Y - result.NormalizedCorners[index].Y), 0, 0.25);
        }
    }

    [Fact]
    public void Incomplete_boundaries_are_recovered_from_fitted_lines()
    {
        var result = TestFrames.Detect(
            TestFrames.Detector(DetectorMode.LineRecovery),
            TestFrames.Generate(TestFrames.Spec(effects: new[] { "gap_edges" })),
            temporal: false);

        Assert.Equal("line_recovery", result.Detector);
        Assert.Equal(4, result.SourceCorners.Count);
        Assert.All(result.Metrics.Edges, edge => Assert.True(edge.GradientSupport > 0.18));
    }

    [Fact]
    public void Uniform_no_gradient_frame_never_fabricates_edges()
    {
        var result = TestFrames.Detect(
            TestFrames.Detector(),
            TestFrames.Generate(TestFrames.Spec(polarity: "neutral", borderContrast: 0, effects: new[] { "no_gradient" })),
            temporal: false);

        Assert.Equal(GeometryStatus.NotDetected, result.Status);
        Assert.Contains(result.Reason, new[] { GeometryReasonCode.NoBoundary, GeometryReasonCode.NoGradientSupport });
        Assert.Empty(result.SourceCorners);
    }

    [Fact]
    public void Clipped_card_is_never_ready()
    {
        var detector = TestFrames.Detector(readyFrames: 1);
        var result = TestFrames.Detect(detector, TestFrames.Generate(TestFrames.Spec(clipping: 0.10)), temporal: true);

        Assert.NotEqual(GeometryStatus.Ready, result.Status);
        Assert.Contains(result.Reason, new[] { GeometryReasonCode.ClippedBoundary, GeometryReasonCode.UnsafeCoverage, GeometryReasonCode.UnsafeAspect, GeometryReasonCode.NoBoundary });
    }

    [Theory]
    [InlineData("no_card")]
    [InlineData("hands")]
    [InlineData("ruler")]
    [InlineData("wrong_object")]
    public void Approved_negative_categories_never_become_ready(string effect)
    {
        var detector = TestFrames.Detector(readyFrames: 1);
        for (var sequence = 1; sequence <= 3; sequence++)
        {
            var result = TestFrames.Detect(
                detector,
                TestFrames.Generate(TestFrames.Spec(expected: false, effects: new[] { effect }), sequence),
                temporal: true);
            Assert.NotEqual(GeometryStatus.Ready, result.Status);
        }
    }

    [Fact]
    public void Identity_undistortion_calibration_is_supported()
    {
        var generated = TestFrames.Generate(TestFrames.Spec());
        var lens = new LensCalibration(
            new[] { 500d, 0, 320, 0, 500, 240, 0, 0, 1 },
            new[] { 0d, 0, 0, 0, 0 });
        generated = generated with
        {
            Frame = generated.Frame with
            {
                Calibration = new VisionCalibration("identity-lens", NormalizedRoi.SafeDefault, lens),
            },
        };

        var result = TestFrames.Detect(TestFrames.Detector(), generated, temporal: false);

        Assert.Equal("identity-lens", result.CalibrationId);
        Assert.Equal(4, result.SourceCorners.Count);
    }

    [Fact]
    public void Padded_stride_is_read_as_mono8_without_row_bleed()
    {
        var generated = TestFrames.Generate(TestFrames.Spec());
        var padded = new byte[(generated.Frame.Width + 13) * generated.Frame.Height];
        for (var row = 0; row < generated.Frame.Height; row++)
            generated.Frame.Buffer.Span.Slice(row * generated.Frame.Width, generated.Frame.Width)
                .CopyTo(padded.AsSpan(row * (generated.Frame.Width + 13), generated.Frame.Width));
        generated = generated with { Frame = generated.Frame with { Buffer = padded, Stride = generated.Frame.Width + 13 } };

        var result = TestFrames.Detect(TestFrames.Detector(), generated, temporal: false);

        Assert.Equal(4, result.SourceCorners.Count);
    }

    private static PointD Project(IReadOnlyList<double> matrix, PointD point)
    {
        var scale = (matrix[6] * point.X) + (matrix[7] * point.Y) + matrix[8];
        return new PointD(
            ((matrix[0] * point.X) + (matrix[1] * point.Y) + matrix[2]) / scale,
            ((matrix[3] * point.X) + (matrix[4] * point.Y) + matrix[5]) / scale);
    }
}
