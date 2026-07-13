using System.Diagnostics;
using TenKings.AiGrader.Replay;
using TenKings.AiGrader.Vision;

namespace TenKings.AiGrader.Vision.Tests;

internal static class TestFrames
{
    public static ReplayCaseSpec Spec(
        string id = "card",
        CardSide side = CardSide.Front,
        bool expected = true,
        string polarity = "dark_on_light",
        double rotation = 0,
        double perspective = 0,
        double translationX = 0,
        double translationY = 0,
        double clipping = 0,
        double borderContrast = 130,
        string[]? effects = null,
        long previewEpoch = 1,
        long sideEpoch = 1,
        string? frozenOf = null,
        int sensorRotation = 0,
        bool mirrorHorizontal = false,
        bool mirrorVertical = false,
        string sequenceKind = "stable",
        int frameCount = 5,
        double motionStepX = 0,
        double motionStepY = 0,
        bool? expectedReady = null) => new(
            id, "test-pair", side, clipping > 0 ? "clipped" : expected ? "card" : "negative",
            expected, polarity, rotation, perspective, translationX, translationY, clipping,
            borderContrast, effects ?? Array.Empty<string>(), previewEpoch, sideEpoch, frozenOf, null, null,
            sensorRotation, mirrorHorizontal, mirrorVertical, sequenceKind, frameCount, motionStepX, motionStepY, expectedReady);

    public static GeneratedReplayFrame Generate(ReplayCaseSpec spec, int sequence = 0)
    {
        var generated = new SyntheticFrameGenerator().Generate(spec, 421337);
        return sequence == 0 ? generated : generated with
        {
            Frame = generated.Frame with
            {
                Identity = generated.Frame.Identity with
                {
                    FrameId = $"{generated.Frame.Identity.FrameId}-{sequence}",
                    BlockId = (generated.Frame.Identity.BlockId ?? 0) + (ulong)sequence,
                },
            },
        };
    }

    public static GeometryResult Detect(
        NativeEdgeDetector detector,
        GeneratedReplayFrame generated,
        bool temporal = false,
        FrameEpochs? expectedEpochs = null,
        double ageMs = 0)
    {
        var now = Stopwatch.GetTimestamp();
        var receive = now - (long)(Stopwatch.Frequency * ageMs / 1000d);
        var frame = generated.Frame with
        {
            Identity = generated.Frame.Identity with { ReceiveMonotonicTicks = Math.Max(0, receive) },
        };
        return detector.Detect(
            frame,
            new DetectionContext(expectedEpochs ?? frame.Epochs, now, Stopwatch.Frequency),
            temporal);
    }

    public static GeometryResult DetectForensic(
        NativeEdgeDetector detector,
        GeneratedReplayFrame generated,
        GeometryAuthorityExpectation? expectation = null)
    {
        var now = Stopwatch.GetTimestamp();
        var frame = generated.Frame with
        {
            Identity = generated.Frame.Identity with { ReceiveMonotonicTicks = now },
        };
        var rebound = generated with { Frame = frame };
        return detector.DetectForensicCurrentFrame(
            frame,
            new DetectionContext(frame.Epochs, now, Stopwatch.Frequency),
            expectation ?? Expectation(rebound));
    }

    public static NativeEdgeDetector Detector(DetectorMode mode = DetectorMode.Fused, int readyFrames = 3) => new(new DetectorOptions
    {
        Mode = mode,
        ReadyEvidenceFrames = readyFrames,
        MinConfidence = 0.46,
        ReadyConfidence = 0.52,
        MinEdgeSupport = 0.20,
        MinEdgeContinuity = 0.05,
        MaxMeanResidualPixels = 30,
    });

    public static GeometryAuthorityExpectation Expectation(GeneratedReplayFrame generated) => new(
        generated.Frame.Identity.FrameId,
        generated.Frame.Identity.BlockId,
        generated.Frame.Epochs,
        generated.Frame.Epochs.Side,
        generated.Frame.Calibration.CalibrationId,
        generated.Frame.Calibration.CalibrationDigest!,
        generated.Frame.Calibration.Orientation!);

    public static GeneratedReplayFrame WorkerFakeCardScene(long sequence = 1, int width = 640, int height = 896)
    {
        var pixels = new byte[checked(width * height)];
        var cardWidth = (int)Math.Round(width * 0.54);
        var cardHeight = (int)Math.Round(cardWidth * 1.4);
        if (cardHeight > height * 0.72)
        {
            cardHeight = (int)Math.Round(height * 0.64);
            cardWidth = (int)Math.Round(cardHeight / 1.4);
        }

        var left = (width - cardWidth) / 2;
        var top = (height - cardHeight) / 2;
        var right = left + cardWidth - 1;
        var bottom = top + cardHeight - 1;
        for (var y = 0; y < height; y++)
        for (var x = 0; x < width; x++)
        {
            var index = (y * width) + x;
            var background = 28 + ((x + (y * 3) + sequence) % 7);
            if (x >= left && x <= right && y >= top && y <= bottom)
            {
                var borderDistance = Math.Min(Math.Min(x - left, right - x), Math.Min(y - top, bottom - y));
                pixels[index] = borderDistance < 3 ? (byte)238 : (byte)(184 + ((x + y + sequence) % 12));
            }
            else pixels[index] = (byte)background;
        }

        var epochs = new FrameEpochs("worker-fake-session", 1, 1, 1, CardSide.Front);
        var identity = new FrameIdentity($"worker-fake-{sequence}", (ulong)Math.Max(0, sequence), (ulong)sequence * 1_000, DateTimeOffset.UnixEpoch, 0);
        var calibration = new VisionCalibration(
            "fake-calibration-v1",
            NormalizedRoi.SafeDefault,
            null,
            SyntheticFrameGenerator.SyntheticCalibrationDigest,
            SensorOrientation.Identity);
        var corners = new[]
        {
            new PointD(left, top), new PointD(right, top), new PointD(right, bottom), new PointD(left, bottom),
        };
        return new GeneratedReplayFrame(new Mono8Frame(pixels, width, height, width, identity, epochs, calibration, 0), corners);
    }
}
