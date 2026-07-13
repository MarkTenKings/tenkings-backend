using System.Reflection;
using OpenCvSharp;
using TenKings.AiGrader.Vision;

namespace TenKings.AiGrader.Vision.Tests;

public sealed class VisionContractTests
{
    [Fact]
    public void Mono8_contract_rejects_short_stride_and_buffer()
    {
        var generated = TestFrames.Generate(TestFrames.Spec());

        Assert.Throws<ArgumentException>(() => (generated.Frame with { Stride = generated.Frame.Width - 1 }).Validate());
        Assert.Throws<ArgumentException>(() => (generated.Frame with { Buffer = new byte[10] }).Validate());
    }

    [Fact]
    public void Epoch_and_frame_identifiers_reject_paths_and_controls()
    {
        var generated = TestFrames.Generate(TestFrames.Spec());

        Assert.Throws<ArgumentException>(() => (generated.Frame with
        {
            Identity = generated.Frame.Identity with { FrameId = "private/path" },
        }).Validate());
        Assert.Throws<ArgumentException>(() => (generated.Frame with
        {
            Epochs = generated.Frame.Epochs with { SessionEpoch = "bad\nepoch" },
        }).Validate());
    }

    [Fact]
    public void Roi_and_lens_calibration_are_strictly_bounded()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new NormalizedRoi(0.9, 0, 0.2, 1).Validate());
        Assert.Throws<ArgumentException>(() => new LensCalibration(new[] { 1d, 2d }, new[] { 0d, 0, 0, 0 }).Validate());
        new LensCalibration(new[] { 1d, 0, 0, 0, 1, 0, 0, 0, 1 }, new[] { 0d, 0, 0, 0 }).Validate();
    }

    [Fact]
    public void Result_is_path_free_and_has_future_rapid_inputs()
    {
        var properties = typeof(GeometryResult).GetProperties(BindingFlags.Instance | BindingFlags.Public)
            .Select(static property => property.Name).ToHashSet(StringComparer.Ordinal);

        Assert.DoesNotContain(properties, static name => name.Contains("Path", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(nameof(GeometryResult.Frame), properties);
        Assert.Contains(nameof(GeometryResult.CenterSource), properties);
        Assert.Contains(nameof(GeometryResult.ScaleFraction), properties);
        Assert.Contains(nameof(GeometryResult.RotationDegrees), properties);
        Assert.Contains(nameof(GeometryResult.Frozen), properties);
        Assert.Contains(nameof(GeometryResult.Hysteresis), properties);
    }

    [Fact]
    public void Fitted_lines_have_protocol_edge_names_and_normalized_equations()
    {
        var result = TestFrames.Detect(TestFrames.Detector(), TestFrames.Generate(TestFrames.Spec()), temporal: false);

        Assert.Equal(new[] { CardEdge.Top, CardEdge.Right, CardEdge.Bottom, CardEdge.Left }, result.FittedLines.Select(static line => line.Edge));
        Assert.All(result.FittedLines, line =>
        {
            Assert.InRange(Math.Sqrt((line.A * line.A) + (line.B * line.B)), 0.999, 1.001);
            Assert.InRange(Math.Abs((line.A * line.Start.X) + (line.B * line.Start.Y) + line.C), 0, 0.001);
        });
        Assert.Equal(1200, result.NormalizedWidth);
        Assert.Equal(1680, result.NormalizedHeight);
    }

    [Fact]
    public void Hardware_independent_assemblies_cannot_reference_pylon()
    {
        var references = new[] { typeof(NativeEdgeDetector).Assembly, typeof(TenKings.AiGrader.Replay.ReplayEvaluator).Assembly }
            .SelectMany(static assembly => assembly.GetReferencedAssemblies())
            .Select(static name => name.Name ?? string.Empty)
            .ToArray();

        Assert.DoesNotContain(references, static name => name.Contains("Basler", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(references, static name => name.Contains("Pylon", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Serialized_detector_reuses_preallocated_mono8_workspace()
    {
        using var detector = TestFrames.Detector();
        _ = TestFrames.Detect(detector, TestFrames.Generate(TestFrames.Spec(), 1), temporal: false);
        var field = typeof(NativeEdgeDetector).GetField("_workspace", BindingFlags.Instance | BindingFlags.NonPublic)!;
        var workspace = field.GetValue(detector)!;
        var source = (Mat)workspace.GetType().GetProperty("Source")!.GetValue(workspace)!;
        var firstPointer = source.Data;

        _ = TestFrames.Detect(detector, TestFrames.Generate(TestFrames.Spec(), 2), temporal: false);

        Assert.NotEqual(IntPtr.Zero, firstPointer);
        Assert.Equal(firstPointer, source.Data);
    }

    [Fact]
    public void Disposed_detector_rejects_new_frames()
    {
        var detector = TestFrames.Detector();
        detector.Dispose();

        Assert.Throws<ObjectDisposedException>(() =>
            TestFrames.Detect(detector, TestFrames.Generate(TestFrames.Spec()), temporal: false));
    }
}
