using TenKings.AiGrader.Vision;

namespace TenKings.AiGrader.Vision.Tests;

public sealed class GeometryTrackerTests
{
    [Fact]
    public void Ready_requires_current_evidence_and_consecutive_hysteresis()
    {
        var detector = TestFrames.Detector(readyFrames: 3);
        var spec = TestFrames.Spec();

        var first = TestFrames.Detect(detector, TestFrames.Generate(spec, 1), temporal: true);
        var second = TestFrames.Detect(detector, TestFrames.Generate(spec, 2), temporal: true);
        var third = TestFrames.Detect(detector, TestFrames.Generate(spec, 3), temporal: true);

        Assert.Equal(GeometryStatus.AdjustCard, first.Status);
        Assert.Equal(GeometryReasonCode.WarmingUp, first.Reason);
        Assert.Equal(2, second.Hysteresis.ConsecutiveAccepted);
        Assert.Equal(GeometryStatus.Ready, third.Status);
        Assert.True(third.Hysteresis.CurrentFrameAccepted);
        Assert.Equal(3, third.Hysteresis.ConsecutiveAccepted);
    }

    [Fact]
    public void Frozen_identity_immediately_clears_ready()
    {
        var detector = TestFrames.Detector(readyFrames: 2);
        var spec = TestFrames.Spec();
        var first = TestFrames.Generate(spec, 1);
        _ = TestFrames.Detect(detector, first, temporal: true);
        var ready = TestFrames.Detect(detector, TestFrames.Generate(spec, 2), temporal: true);
        Assert.Equal(GeometryStatus.Ready, ready.Status);

        var frozen = TestFrames.Detect(detector, TestFrames.Generate(spec, 2), temporal: true);

        Assert.Equal(GeometryStatus.NotDetected, frozen.Status);
        Assert.Equal(GeometryReasonCode.FrozenFrame, frozen.Reason);
        Assert.True(frozen.Frozen);
        Assert.False(frozen.Hysteresis.CurrentFrameAccepted);
        Assert.Empty(frozen.SourceCorners);
    }

    [Fact]
    public void Stale_frame_never_reuses_ready_geometry()
    {
        var detector = TestFrames.Detector(readyFrames: 1);
        var ready = TestFrames.Detect(detector, TestFrames.Generate(TestFrames.Spec(), 1), temporal: true);
        Assert.Equal(GeometryStatus.Ready, ready.Status);

        var stale = TestFrames.Detect(detector, TestFrames.Generate(TestFrames.Spec(), 2), temporal: true, ageMs: 500);

        Assert.Equal(GeometryStatus.NotDetected, stale.Status);
        Assert.Equal(GeometryReasonCode.StaleFrame, stale.Reason);
        Assert.True(stale.Stale);
        Assert.Empty(stale.SourceCorners);
    }

    [Fact]
    public void Wrong_epoch_is_rejected_before_processing()
    {
        var detector = TestFrames.Detector(readyFrames: 1);
        var generated = TestFrames.Generate(TestFrames.Spec());
        var wrong = generated.Frame.Epochs with { SideEpoch = generated.Frame.Epochs.SideEpoch + 1 };

        var result = TestFrames.Detect(detector, generated, temporal: true, expectedEpochs: wrong);

        Assert.Equal(GeometryStatus.NotDetected, result.Status);
        Assert.Equal(GeometryReasonCode.WrongEpoch, result.Reason);
        Assert.Empty(result.SourceCorners);
    }

    [Fact]
    public void Epoch_transition_resets_ready_and_display_smoothing()
    {
        var detector = TestFrames.Detector(readyFrames: 2);
        var firstEpoch = TestFrames.Spec(previewEpoch: 4, sideEpoch: 8);
        _ = TestFrames.Detect(detector, TestFrames.Generate(firstEpoch, 1), temporal: true);
        var ready = TestFrames.Detect(detector, TestFrames.Generate(firstEpoch, 2), temporal: true);
        Assert.Equal(GeometryStatus.Ready, ready.Status);
        var secondEpoch = TestFrames.Spec(id: "new-side", side: CardSide.Back, previewEpoch: 5, sideEpoch: 9);

        var transitioned = TestFrames.Detect(detector, TestFrames.Generate(secondEpoch, 1), temporal: true);

        Assert.Equal(GeometryStatus.AdjustCard, transitioned.Status);
        Assert.True(transitioned.Hysteresis.EpochReset);
        Assert.Equal(1, transitioned.Hysteresis.ConsecutiveAccepted);
    }

    [Fact]
    public void Inconsistent_motion_immediately_resets_evidence()
    {
        var detector = TestFrames.Detector(readyFrames: 2);
        var stable = TestFrames.Spec();
        _ = TestFrames.Detect(detector, TestFrames.Generate(stable, 1), temporal: true);
        var moved = TestFrames.Spec(id: "moved", translationX: 0.16);

        var result = TestFrames.Detect(detector, TestFrames.Generate(moved, 2), temporal: true);

        Assert.Equal(GeometryStatus.NotDetected, result.Status);
        Assert.Equal(GeometryReasonCode.InconsistentEvidence, result.Reason);
        Assert.True(result.Hysteresis.MotionDeltaFraction > 0.055);
    }

    [Fact]
    public void Display_smoothing_does_not_replace_exact_source_corners()
    {
        var detector = TestFrames.Detector(readyFrames: 2);
        _ = TestFrames.Detect(detector, TestFrames.Generate(TestFrames.Spec(), 1), temporal: true);
        var shifted = TestFrames.Spec(id: "slight-shift", translationX: 0.015);

        var result = TestFrames.Detect(detector, TestFrames.Generate(shifted, 2), temporal: true);

        Assert.Equal(4, result.SourceCorners.Count);
        Assert.Equal(4, result.DisplayCorners.Count);
        Assert.Contains(Enumerable.Range(0, 4), index =>
            Math.Abs(result.SourceCorners[index].X - result.DisplayCorners[index].X) > 0.01);
    }

    [Fact]
    public void Removal_fence_signal_is_carried_after_not_detected_frame()
    {
        var detector = TestFrames.Detector(readyFrames: 2);
        _ = TestFrames.Detect(
            detector,
            TestFrames.Generate(TestFrames.Spec(expected: false, effects: new[] { "no_card" }), 1),
            temporal: true);
        _ = TestFrames.Detect(
            detector,
            TestFrames.Generate(TestFrames.Spec(expected: false, effects: new[] { "no_card" }), 2),
            temporal: true);

        var replacement = TestFrames.Detect(detector, TestFrames.Generate(TestFrames.Spec(id: "replacement"), 3), temporal: true);

        Assert.True(replacement.Hysteresis.RemovalFenceSatisfied);
        Assert.Equal(GeometryStatus.AdjustCard, replacement.Status);
    }

    [Fact]
    public void Uncalibrated_display_geometry_never_accumulates_ready_evidence_across_four_frames()
    {
        using var detector = TestFrames.Detector(readyFrames: 3);
        var results = Enumerable.Range(1, 4).Select(index =>
        {
            var generated = TestFrames.Generate(TestFrames.Spec(), index);
            return TestFrames.Detect(
                detector,
                generated with { Frame = generated.Frame with { Calibration = VisionCalibration.Uncalibrated } },
                temporal: true);
        }).ToArray();

        Assert.All(results, result =>
        {
            Assert.Equal(GeometryStatus.AdjustCard, result.Status);
            Assert.Equal(GeometryReasonCode.Uncalibrated, result.Reason);
            Assert.False(result.CurrentFrameAuthority.CaptureReady);
            Assert.False(result.Hysteresis.CurrentFrameAccepted);
            Assert.Equal(0, result.Hysteresis.ConsecutiveAccepted);
            Assert.Equal(4, result.SourceCorners.Count);
            Assert.Equal(4, result.DisplayCorners.Count);
        });
    }

    [Fact]
    public void Missing_sensor_orientation_never_accumulates_ready_evidence_across_four_frames()
    {
        using var detector = TestFrames.Detector(readyFrames: 3);
        var results = Enumerable.Range(1, 4).Select(index =>
        {
            var generated = TestFrames.Generate(TestFrames.Spec(), index);
            var calibration = generated.Frame.Calibration with { Orientation = null };
            return TestFrames.Detect(
                detector,
                generated with { Frame = generated.Frame with { Calibration = calibration } },
                temporal: true);
        }).ToArray();

        Assert.All(results, result =>
        {
            Assert.Equal(GeometryStatus.AdjustCard, result.Status);
            Assert.Equal(GeometryReasonCode.InvalidOrientation, result.Reason);
            Assert.False(result.CurrentFrameAuthority.CaptureReady);
            Assert.False(result.Hysteresis.CurrentFrameAccepted);
            Assert.Equal(0, result.Hysteresis.ConsecutiveAccepted);
            Assert.Equal(4, result.SourceCorners.Count);
        });
    }

    [Fact]
    public void Unsafe_current_frame_clears_prior_hysteresis_before_calibrated_recovery()
    {
        using var detector = TestFrames.Detector(readyFrames: 3);
        _ = TestFrames.Detect(detector, TestFrames.Generate(TestFrames.Spec(), 1), temporal: true);
        var second = TestFrames.Detect(detector, TestFrames.Generate(TestFrames.Spec(), 2), temporal: true);
        Assert.Equal(2, second.Hysteresis.ConsecutiveAccepted);

        var unsafeFrame = TestFrames.Generate(TestFrames.Spec(), 3);
        var rejected = TestFrames.Detect(
            detector,
            unsafeFrame with { Frame = unsafeFrame.Frame with { Calibration = VisionCalibration.Uncalibrated } },
            temporal: true);
        Assert.Equal(0, rejected.Hysteresis.ConsecutiveAccepted);

        var recovery = Enumerable.Range(4, 3)
            .Select(index => TestFrames.Detect(detector, TestFrames.Generate(TestFrames.Spec(), index), temporal: true))
            .ToArray();
        Assert.Equal(GeometryStatus.AdjustCard, recovery[0].Status);
        Assert.Equal(1, recovery[0].Hysteresis.ConsecutiveAccepted);
        Assert.Equal(GeometryStatus.AdjustCard, recovery[1].Status);
        Assert.Equal(2, recovery[1].Hysteresis.ConsecutiveAccepted);
        Assert.Equal(GeometryStatus.Ready, recovery[2].Status);
    }
}
