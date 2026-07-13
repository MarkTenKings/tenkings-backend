using System.Diagnostics;
using System.Security.Cryptography;
using OpenCvSharp;
using TenKings.AiGrader.Replay;
using TenKings.AiGrader.Vision;

namespace TenKings.AiGrader.Vision.Tests;

public sealed class ReplayEvaluatorTests
{
    private static string ManifestPath => Path.Combine(AppContext.BaseDirectory, "fixtures", "synthetic-manifest.json");

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
        Assert.Contains(manifest.Cases, static spec => spec.RotationDegrees == -35);
        Assert.Contains(manifest.Cases, static spec => spec.RotationDegrees == 35);
        Assert.Contains(manifest.Cases.GroupBy(static spec => spec.PairId), static pair => pair.Any(spec => spec.Side == CardSide.Front) && pair.Any(spec => spec.Side == CardSide.Back));
        Assert.Contains(manifest.Cases, static spec => spec.FrozenOf is not null);
        Assert.True(manifest.Cases.Select(static spec => spec.PreviewEpoch).Distinct().Count() > 2);
    }

    [Fact]
    public void Replay_compares_all_four_detectors_and_reports_false_ready_separately()
    {
        var report = new ReplayEvaluator().Evaluate(ReplayEvaluator.LoadManifest(ManifestPath));

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
        var report = new ReplayEvaluator().Evaluate(ReplayEvaluator.LoadManifest(ManifestPath));
        var clipped = report.Cases.Where(static result => result.Category == "clipped").ToArray();

        Assert.NotEmpty(clipped);
        Assert.All(clipped, static result => Assert.NotEqual(GeometryStatus.Ready, result.Status));
        Assert.All(clipped.Where(static result => result.Mode == DetectorMode.Fused), static result =>
        {
            Assert.Equal(GeometryStatus.AdjustCard, result.Status);
            Assert.Contains(result.Reason, new[] { GeometryReasonCode.ClippedBoundary, GeometryReasonCode.UnsafeCoverage });
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
        var report = new ReplayEvaluator().Evaluate(ReplayEvaluator.LoadManifest(ManifestPath));
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
}
