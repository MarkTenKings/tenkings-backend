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
        string? frozenOf = null) => new(
            id, "test-pair", side, clipping > 0 ? "clipped" : expected ? "card" : "negative",
            expected, polarity, rotation, perspective, translationX, translationY, clipping,
            borderContrast, effects ?? Array.Empty<string>(), previewEpoch, sideEpoch, frozenOf, null, null);

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
                    BlockId = (generated.Frame.Identity.BlockId ?? 0) + sequence,
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

    public static NativeEdgeDetector Detector(DetectorMode mode = DetectorMode.Fused, int readyFrames = 3) => new(new DetectorOptions
    {
        Mode = mode,
        ReadyEvidenceFrames = readyFrames,
        MinConfidence = 0.46,
        ReadyConfidence = 0.52,
        MinEdgeSupport = 0.20,
    });
}
