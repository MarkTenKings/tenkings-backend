using TenKings.AiGrader.Vision;

namespace TenKings.AiGrader.Vision.Tests;

public sealed class SensorOrientationTests
{
    public static TheoryData<int, bool, bool> Orientations => new()
    {
        { 0, false, false },
        { 90, false, false },
        { 180, false, false },
        { 270, false, false },
        { 0, true, false },
        { 90, false, true },
        { 180, true, true },
        { 270, true, false },
    };

    [Theory]
    [MemberData(nameof(Orientations))]
    public void Sensor_portrait_transform_round_trips_all_rotations_and_supported_mirrors(int rotation, bool mirrorHorizontal, bool mirrorVertical)
    {
        var support = (mirrorHorizontal ? SensorMirrorSupport.Horizontal : SensorMirrorSupport.None) |
            (mirrorVertical ? SensorMirrorSupport.Vertical : SensorMirrorSupport.None);
        var orientation = new SensorOrientation(rotation, mirrorHorizontal, mirrorVertical, support);
        var points = new[] { new PointD(0, 0), new PointD(37.25, 88.75), new PointD(639, 479) };

        foreach (var point in points)
        {
            var portrait = SensorCoordinateTransform.RawSensorToPortrait(point, 640, 480, orientation);
            var roundTrip = SensorCoordinateTransform.PortraitToRawSensor(portrait, 640, 480, orientation);
            Assert.InRange(Math.Abs(roundTrip.X - point.X), 0, 1e-9);
            Assert.InRange(Math.Abs(roundTrip.Y - point.Y), 0, 1e-9);
        }

        var size = SensorCoordinateTransform.PortraitSize(2448, 2048, orientation);
        if (rotation is 90 or 270) Assert.Equal((2048, 2448), size);
        else Assert.Equal((2448, 2048), size);
    }

    [Theory]
    [MemberData(nameof(Orientations))]
    public void Detection_preserves_raw_source_corners_and_maps_physical_long_edge_to_1680(int rotation, bool mirrorHorizontal, bool mirrorVertical)
    {
        using var detector = TestFrames.Detector();
        var generated = TestFrames.Generate(TestFrames.Spec(
            rotation: 17,
            perspective: 0.12,
            sensorRotation: rotation,
            mirrorHorizontal: mirrorHorizontal,
            mirrorVertical: mirrorVertical));

        var result = TestFrames.DetectForensic(detector, generated);

        Assert.True(result.Status == GeometryStatus.Ready,
            $"rotation={rotation}; mirrors={mirrorHorizontal}/{mirrorVertical}; status={result.Status}; reason={result.Reason}; authority={string.Join(',', result.CurrentFrameAuthority.RejectionCodes)}");
        Assert.True(result.CurrentFrameAuthority.CaptureReady);
        var widthEdges = (Distance(result.SourceCorners[0], result.SourceCorners[1]) + Distance(result.SourceCorners[2], result.SourceCorners[3])) / 2;
        var heightEdges = (Distance(result.SourceCorners[1], result.SourceCorners[2]) + Distance(result.SourceCorners[3], result.SourceCorners[0])) / 2;
        Assert.True(heightEdges > widthEdges);
        for (var index = 0; index < 4; index++)
        {
            var projected = Project(result.SourceToNormalizedHomography, result.SourceCorners[index]);
            Assert.InRange(Distance(projected, result.NormalizedCorners[index]), 0, 1);
        }

        Assert.All(result.SourceCorners, point =>
        {
            Assert.InRange(point.X, -1, generated.Frame.Width);
            Assert.InRange(point.Y, -1, generated.Frame.Height);
        });
    }

    [Fact]
    public void Realistic_Dell_mount_is_explicit_90_clockwise_without_mirror()
    {
        var orientation = new SensorOrientation(90, false, false, SensorMirrorSupport.None);
        orientation.Validate();

        Assert.Equal((2048, 2448), SensorCoordinateTransform.PortraitSize(2448, 2048, orientation));
    }

    [Fact]
    public void Bounded_distortion_roi_and_orientation_preserve_corner_round_trip_but_are_non_authoritative()
    {
        using var detector = TestFrames.Detector();
        var generated = TestFrames.Generate(TestFrames.Spec(rotation: 9, perspective: 0.06));
        var orientation = new SensorOrientation(180, true, false, SensorMirrorSupport.Horizontal);
        var lens = new LensCalibration(
            new[] { 700d, 0, 319.5, 0, 710, 239.5, 0, 0, 1 },
            new[] { -0.015, 0.002, 0.0002, -0.0001, 0d });
        var calibration = new VisionCalibration(
            "distorted-offline-calibration-v1",
            new NormalizedRoi(0.025, 0.025, 0.95, 0.95),
            lens,
            TenKings.AiGrader.Replay.SyntheticFrameGenerator.SyntheticCalibrationDigest,
            orientation);
        generated = generated with { Frame = generated.Frame with { Calibration = calibration } };

        var result = TestFrames.DetectForensic(detector, generated);

        Assert.Equal(GeometryStatus.AdjustCard, result.Status);
        Assert.True(result.NonlinearLensCalibrationApplied);
        Assert.False(result.CurrentFrameAuthority.NormalizationSafe);
        Assert.False(result.CurrentFrameAuthority.CaptureReady);
        Assert.Contains(
            GeometryAuthorityRejectionCode.UnsupportedLensTransform,
            result.CurrentFrameAuthority.RejectionCodes);
        Assert.All(result.SourceCorners, point =>
        {
            Assert.InRange(point.X, 0, generated.Frame.Width - 1);
            Assert.InRange(point.Y, 0, generated.Frame.Height - 1);
        });
        for (var index = 0; index < 4; index++)
        {
            var projected = Project(result.SourceToNormalizedHomography, result.SourceCorners[index]);
            Assert.InRange(Distance(projected, result.NormalizedCorners[index]), 0, 1);
        }
    }

    [Fact]
    public void Unsupported_or_contradictory_orientation_is_rejected()
    {
        Assert.Throws<ArgumentException>(() => new SensorOrientation(45, false, false, SensorMirrorSupport.None).Validate());
        Assert.Throws<ArgumentException>(() => new SensorOrientation(90, true, false, SensorMirrorSupport.None).Validate());
        Assert.Throws<ArgumentException>(() => new SensorOrientation(90, false, true, SensorMirrorSupport.Horizontal).Validate());
    }

    private static PointD Project(IReadOnlyList<double> matrix, PointD point)
    {
        var scale = (matrix[6] * point.X) + (matrix[7] * point.Y) + matrix[8];
        return new PointD(
            ((matrix[0] * point.X) + (matrix[1] * point.Y) + matrix[2]) / scale,
            ((matrix[3] * point.X) + (matrix[4] * point.Y) + matrix[5]) / scale);
    }

    private static double Distance(PointD first, PointD second) =>
        Math.Sqrt(Math.Pow(first.X - second.X, 2) + Math.Pow(first.Y - second.Y, 2));
}
