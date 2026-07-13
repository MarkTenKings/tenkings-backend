using System.Diagnostics;
using System.Security.Cryptography;
using OpenCvSharp;
using TenKings.AiGrader.Replay;
using TenKings.AiGrader.Vision;

namespace TenKings.AiGrader.Vision.Tests;

public sealed class ReplayEvaluatorTests
{
    private static string ManifestPath => Path.Combine(AppContext.BaseDirectory, "fixtures", "synthetic-manifest.json");
    private static readonly Lazy<ReplayReport> SharedReport = new(
        () => new ReplayEvaluator().Evaluate(ReplayEvaluator.LoadManifest(ManifestPath)),
        LazyThreadSafetyMode.ExecutionAndPublication);

    [Fact]
    public void Manifest_covers_required_adversarial_categories_and_pairs()
    {
        var manifest = ReplayEvaluator.LoadManifest(ManifestPath);
        var categories = manifest.Cases.Select(static spec => spec.Category).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var effects = manifest.Cases.SelectMany(static spec => spec.Effects).ToHashSet(StringComparer.OrdinalIgnoreCase);

        Assert.Contains("black_plate", categories);
        Assert.Contains("white_plate", categories);
        Assert.Contains("neutral_plate", categories);
        Assert.Contains("same_tone_border", categories);
        Assert.Contains("worn_corners", categories);
        Assert.Contains("clipped", categories);
        Assert.Contains("hands", effects);
        Assert.Contains("ruler", effects);
        Assert.Contains("wrong_object", effects);
        Assert.Contains("internal_rectangle", effects);
        Assert.Contains(manifest.Cases, static spec => spec.RotationDegrees == -35);
        Assert.Contains(manifest.Cases, static spec => spec.RotationDegrees == 35);
        Assert.Contains(manifest.Cases.GroupBy(static spec => spec.PairId), static pair => pair.Any(spec => spec.Side == CardSide.Front) && pair.Any(spec => spec.Side == CardSide.Back));
        Assert.Contains(manifest.Cases, static spec => spec.FrozenOf is not null);
        Assert.True(manifest.Cases.Select(static spec => spec.PreviewEpoch).Distinct().Count() > 2);
    }

    [Fact]
    public void Replay_compares_all_four_detectors_and_reports_false_ready_separately()
    {
        var report = SharedReport.Value;

        Assert.Equal(4, report.Aggregates.Count);
        Assert.Equal(Enum.GetValues<DetectorMode>(), report.Aggregates.Select(static aggregate => aggregate.Mode));
        Assert.All(report.Aggregates, static aggregate => Assert.Equal(0, aggregate.FalseReady));
        Assert.Equal(report.Aggregates.Sum(static aggregate => aggregate.Cases), report.Cases.Count);
        Assert.True(report.SyntheticOnly);
        Assert.NotEmpty(report.MissingRealCorpusCategories);
    }

    [Fact]
    public void Clipped_cases_require_adjust_card_evidence_not_any_detection()
    {
        var report = SharedReport.Value;
        var clipped = report.Cases.Where(static result => result.Category == "clipped").ToArray();

        Assert.NotEmpty(clipped);
        Assert.All(clipped, static result => Assert.NotEqual(GeometryStatus.Ready, result.Status));
        Assert.All(clipped.Where(static result => result.Mode == DetectorMode.Fused), static result =>
        {
            Assert.Contains(result.Status, new[] { GeometryStatus.AdjustCard, GeometryStatus.NotDetected });
            Assert.Contains(result.Reason, new[] { GeometryReasonCode.ClippedBoundary, GeometryReasonCode.UnsafeCoverage, GeometryReasonCode.UnsafeAspect, GeometryReasonCode.UnsupportedEdge, GeometryReasonCode.NoBoundary });
            Assert.True(result.SafetyExpectationMet);
        });
    }

    [Fact]
    public void Replay_is_deterministic_for_decisions_and_geometry_error()
    {
        var manifest = ReplayEvaluator.LoadManifest(ManifestPath);
        var first = new ReplayEvaluator().Evaluate(manifest);
        var second = new ReplayEvaluator().Evaluate(manifest);
        var firstStable = first.Cases.Select(static result => (result.CaseId, result.Mode, result.Status, result.Reason, result.ExpectedDetection, result.SafetyExpectationMet, Error: Math.Round(result.MeanCornerErrorPixels ?? -1, 6))).ToArray();
        var secondStable = second.Cases.Select(static result => (result.CaseId, result.Mode, result.Status, result.Reason, result.ExpectedDetection, result.SafetyExpectationMet, Error: Math.Round(result.MeanCornerErrorPixels ?? -1, 6))).ToArray();

        Assert.Equal(firstStable, secondStable);
    }

    [Fact]
    public void Replay_contract_binds_accuracy_json_and_markdown_but_excludes_timing()
    {
        var report = SharedReport.Value;
        var markdown = ReplayEvaluator.ToMarkdown(report);
        var changedAggregate = report.Aggregates.Select((aggregate, index) =>
            index == 0 ? aggregate with { Recall = aggregate.Recall + 0.001 } : aggregate).ToArray();
        Assert.Throws<InvalidDataException>(() => ReplayEvaluator.VerifyProductionThresholdContract(
            report,
            report with { Aggregates = changedAggregate },
            markdown));

        var changedCases = report.Cases.Select((result, index) =>
            index == 0 ? result with { Confidence = result.Confidence + 0.001 } : result).ToArray();
        Assert.Throws<InvalidDataException>(() => ReplayEvaluator.VerifyProductionThresholdContract(
            report,
            report with { Cases = changedCases },
            markdown));

        var changedMarkdown = markdown.Replace(
            "<!-- replay-accuracy-projection:end -->",
            "| stale | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |\n<!-- replay-accuracy-projection:end -->",
            StringComparison.Ordinal);
        Assert.Throws<InvalidDataException>(() => ReplayEvaluator.VerifyProductionThresholdContract(
            report,
            report,
            changedMarkdown));

        var timingOnly = report with
        {
            Aggregates = report.Aggregates.Select(static aggregate => aggregate with
            {
                P50ProcessingMs = aggregate.P50ProcessingMs + 100,
                P95ProcessingMs = aggregate.P95ProcessingMs + 100,
            }).ToArray(),
            Cases = report.Cases.Select(static result => result with
            {
                ProcessingMs = result.ProcessingMs + 100,
            }).ToArray(),
        };
        ReplayEvaluator.VerifyProductionThresholdContract(report, timingOnly, markdown);
    }

    [Fact]
    public void Cpu_load_simulation_runs_concurrently_and_remains_bounded()
    {
        var original = ReplayEvaluator.LoadManifest(ManifestPath);
        var manifest = original with { Cases = original.Cases.Take(2).ToArray() };
        var stopwatch = Stopwatch.StartNew();

        var report = new ReplayEvaluator().Evaluate(manifest, cpuLoadMilliseconds: 20);

        stopwatch.Stop();
        Assert.Equal(8, report.TotalEvaluations);
        Assert.InRange(stopwatch.ElapsedMilliseconds, 20, 30_000);
        Assert.All(report.Cases, static result => Assert.InRange(result.ProcessingMs, 0, 30_000));
    }

    [Fact]
    public void Machine_and_human_reports_are_redacted_and_honest()
    {
        var report = SharedReport.Value;
        var json = ReplayEvaluator.ToJson(report);
        var markdown = ReplayEvaluator.ToMarkdown(report);
        var drivePrefix = string.Concat("C", Path.VolumeSeparatorChar, Path.DirectorySeparatorChar);

        Assert.DoesNotContain(drivePrefix, json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("privateFile", json, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("not production accuracy", markdown, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Missing real-corpus coverage", markdown);
        Assert.Contains("False Ready", markdown);
    }

    [Fact]
    public void Production_default_sequences_exercise_hysteresis_motion_epochs_freeze_and_removal()
    {
        var fused = SharedReport.Value.Cases.Where(static result => result.Mode == DetectorMode.Fused)
            .ToDictionary(static result => result.CaseId, StringComparer.Ordinal);

        Assert.True(fused["slow-drift"].Ready);
        Assert.True(fused["slow-drift"].FirstReadyFrame >= 3);
        Assert.True(fused["sudden-motion"].MotionResetObserved);
        Assert.True(fused["epoch-transition"].EpochResetObserved);
        Assert.False(fused["epoch-transition"].OldEpochReadyObserved);
        Assert.False(fused["wrong-epoch"].Ready);
        Assert.False(fused["wrong-side"].Ready);
        Assert.True(fused["frozen-repeat"].FrozenResetObserved);
        Assert.False(fused["frozen-repeat"].Ready);
        Assert.True(fused["removal-replacement"].RemovalFenceObserved);
        Assert.False(fused["same-tone-front"].Ready);
        Assert.False(fused["same-tone-back"].Ready);
        Assert.Equal(0, fused["same-tone-front"].DetectedFrames);
        Assert.Equal(0, fused["same-tone-back"].DetectedFrames);
        Assert.All(fused.Values.Where(static result => !result.CardPresent), static result => Assert.False(result.Ready));
    }

    [Fact]
    public void Correct_aspect_internal_rectangle_never_establishes_line_or_fused_ready()
    {
        var outcomes = SharedReport.Value.Cases.Where(static result =>
            result.CaseId == "internal-rectangle" &&
            result.Mode is DetectorMode.LineRecovery or DetectorMode.Fused).ToArray();

        Assert.Equal(2, outcomes.Length);
        Assert.All(outcomes, static result =>
        {
            Assert.False(result.Ready);
            Assert.Equal(0, result.ReadyFrames);
            Assert.Equal(0, result.QualifiedFrames);
            Assert.Equal(GeometryReasonCode.UnsupportedEdge, result.Reason);
            Assert.True(result.SafetyExpectationMet);
        });
    }

    [Fact]
    public void Private_fixture_is_root_bounded_hash_permitted_and_path_free()
    {
        var root = Path.Combine(Path.GetTempPath(), $"tk-replay-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            using var image = new Mat(128, 96, MatType.CV_8UC1, Scalar.All(128));
            Assert.True(Cv2.ImEncode(".png", image, out var encoded));
            var file = Path.Combine(root, "safe.png");
            File.WriteAllBytes(file, encoded);
            var sha256 = Convert.ToHexString(SHA256.HashData(encoded)).ToLowerInvariant();
            var spec = TestFrames.Spec(id: "private-safe", expected: false) with
            {
                PrivateFile = "safe.png",
                PermittedSha256 = sha256,
            };
            var manifest = new ReplayManifest(
                "tenkings.ai-grader.replay-manifest.v1", 7, "private", new[] { spec }, new[] { "real-corpus coverage remains incomplete" });

            var report = new ReplayEvaluator().Evaluate(manifest, root);

            Assert.Equal(4, report.TotalEvaluations);
            Assert.DoesNotContain(root, ReplayEvaluator.ToJson(report), StringComparison.OrdinalIgnoreCase);
            Assert.Throws<InvalidDataException>(() => new ReplayEvaluator().Evaluate(
                manifest with { Cases = new[] { spec with { PermittedSha256 = new string('0', 64) } } }, root));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Expected_private_fixture_requires_bounded_raw_truth_and_uses_declared_offline_orientation()
    {
        var root = Path.Combine(Path.GetTempPath(), $"tk-replay-card-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            using var image = new Mat(240, 320, MatType.CV_8UC1, Scalar.All(28));
            var rawTruth = new[]
            {
                new PointD(76, 60), new PointD(243, 60),
                new PointD(243, 179), new PointD(76, 179),
            };
            var polygon = rawTruth.Select(static point => new Point((int)point.X, (int)point.Y)).ToArray();
            Cv2.FillConvexPoly(image, polygon, Scalar.All(205), LineTypes.AntiAlias);
            Cv2.Polylines(image, new[] { polygon }, true, Scalar.All(245), 4, LineTypes.AntiAlias);
            Assert.True(Cv2.ImEncode(".png", image, out var encoded));
            File.WriteAllBytes(Path.Combine(root, "card.png"), encoded);
            var sha256 = Convert.ToHexString(SHA256.HashData(encoded)).ToLowerInvariant();
            var spec = TestFrames.Spec(id: "private-card", expected: true, expectedReady: false) with
            {
                PrivateFile = "card.png",
                PermittedSha256 = sha256,
                SensorRotationDegrees = 90,
                MirrorHorizontal = true,
                GroundTruthCorners = rawTruth,
            };
            var manifest = new ReplayManifest(
                "tenkings.ai-grader.replay-manifest.v1", 11, "private", new[] { spec },
                new[] { "real-corpus coverage remains incomplete" });

            var loaded = new SyntheticFrameGenerator().LoadPrivate(spec, root);
            Assert.Equal(SyntheticFrameGenerator.OfflineReplayCalibrationId, loaded.Frame.Calibration.CalibrationId);
            Assert.Equal(SyntheticFrameGenerator.OfflineReplayCalibrationDigest, loaded.Frame.Calibration.CalibrationDigest);
            Assert.Equal(new SensorOrientation(90, true, false, SensorMirrorSupport.Horizontal), loaded.Frame.Calibration.Orientation);
            Assert.Equal(rawTruth, loaded.GroundTruthCorners);

            var report = new ReplayEvaluator().Evaluate(manifest, root);
            Assert.Equal(4, report.TotalEvaluations);
            Assert.DoesNotContain(root, ReplayEvaluator.ToJson(report), StringComparison.OrdinalIgnoreCase);

            Assert.Throws<InvalidDataException>(() => new ReplayEvaluator().Evaluate(
                manifest with { Cases = new[] { spec with { GroundTruthCorners = null } } }, root));
            Assert.Throws<InvalidDataException>(() => new ReplayEvaluator().Evaluate(
                manifest with
                {
                    Cases = new[]
                    {
                        spec with
                        {
                            GroundTruthCorners = rawTruth.Select((point, index) =>
                                index == 0 ? new PointD(320, point.Y) : point).ToArray(),
                        },
                    },
                },
                root));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
