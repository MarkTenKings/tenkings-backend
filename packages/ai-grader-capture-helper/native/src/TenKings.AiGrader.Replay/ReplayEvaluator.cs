using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using TenKings.AiGrader.Vision;

namespace TenKings.AiGrader.Replay;

public sealed class ReplayEvaluator
{
    private const string ReportSchemaVersion = "tenkings.ai-grader.replay-report.v2";
    private const string AccuracyProjectionStart = "<!-- replay-accuracy-projection:start -->";
    private const string AccuracyProjectionEnd = "<!-- replay-accuracy-projection:end -->";
    public static JsonSerializerOptions JsonOptions { get; } = CreateJsonOptions();
    private static readonly DetectorMode[] Modes =
    {
        DetectorMode.PcaBaseline,
        DetectorMode.ContourQuad,
        DetectorMode.LineRecovery,
        DetectorMode.Fused,
    };

    public ReplayReport Evaluate(ReplayManifest manifest, string? privateFixtureRoot = null, int cpuLoadMilliseconds = 0)
    {
        ValidateManifest(manifest, privateFixtureRoot, cpuLoadMilliseconds);
        var generator = new SyntheticFrameGenerator();
        var results = new List<ReplayCaseResult>(manifest.Cases.Count * Modes.Length);
        foreach (var mode in Modes)
        {
            foreach (var spec in manifest.Cases)
                results.Add(EvaluateSequence(generator, manifest, spec, mode, privateFixtureRoot, cpuLoadMilliseconds));
        }

        var aggregates = Modes.Select(mode => Aggregate(mode, results.Where(result => result.Mode == mode).ToArray())).ToArray();
        var decisionDigest = ComputeDecisionDigest(manifest.Seed, manifest.CorpusKind, results, aggregates);
        return new ReplayReport(
            ReportSchemaVersion,
            NativeEdgeDetector.DetectorVersion,
            decisionDigest,
            manifest.CorpusKind,
            manifest.CorpusKind.Equals("synthetic", StringComparison.OrdinalIgnoreCase),
            "Synthetic/adversarial results are engineering regression evidence only; they are not production accuracy, approved thresholds, or Dell hardware performance claims.",
            manifest.Seed,
            manifest.MissingRealCorpusCategories.ToArray(),
            aggregates,
            results);
    }

    public static ReplayManifest LoadManifest(string manifestFile)
    {
        var bytes = File.ReadAllBytes(manifestFile);
        if (bytes.Length is 0 or > 2_000_000) throw new InvalidDataException("Replay manifest size is invalid.");
        return JsonSerializer.Deserialize<ReplayManifest>(bytes, JsonOptions)
            ?? throw new InvalidDataException("Replay manifest is empty.");
    }

    public static ReplayReport LoadReport(string reportFile)
    {
        var bytes = File.ReadAllBytes(reportFile);
        if (bytes.Length is 0 or > 10_000_000) throw new InvalidDataException("Replay report size is invalid.");
        return JsonSerializer.Deserialize<ReplayReport>(bytes, JsonOptions)
            ?? throw new InvalidDataException("Replay report is empty.");
    }

    public static string LoadMarkdown(string markdownFile)
    {
        var info = new FileInfo(markdownFile);
        if (!info.Exists || info.Length is <= 0 or > 10_000_000)
            throw new InvalidDataException("Replay Markdown report size is invalid.");
        return File.ReadAllText(info.FullName);
    }

    public static string ToJson(ReplayReport report) => JsonSerializer.Serialize(report, JsonOptions);

    public static string ToMarkdown(ReplayReport report)
    {
        var output = new StringBuilder();
        output.AppendLine("# Native four-edge offline replay").AppendLine();
        output.AppendLine($"- Detector: `{report.DetectorVersion}`");
        output.AppendLine($"- Corpus: `{report.CorpusKind}`");
        output.AppendLine($"- Seed: `{report.Seed}`");
        output.AppendLine($"- Deterministic decision digest: `{report.DecisionDigest}`");
        output.AppendLine($"- Sequence evaluations: `{report.TotalEvaluations}`").AppendLine();
        output.AppendLine($"> {report.AccuracyDisclaimer}").AppendLine();
        output.AppendLine("| Comparator | Detection recall | Detection precision | Ready recall | Ready precision | False detection | False Ready | P50 detect | P95 detect | Mean corner error |");
        output.AppendLine("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
        foreach (var aggregate in report.Aggregates)
        {
            output.AppendLine($"| {aggregate.Mode} | {aggregate.Recall:P1} | {aggregate.Precision:P1} | {aggregate.ReadyRecall:P1} | {aggregate.ReadyPrecision:P1} | {aggregate.FalseDetection} | {aggregate.FalseReady} | {aggregate.P50ProcessingMs:F2} ms | {aggregate.P95ProcessingMs:F2} ms | {(aggregate.MeanCornerErrorPixels.HasValue ? $"{aggregate.MeanCornerErrorPixels:F2} px" : "n/a")} |");
        }

        output.AppendLine().Append(ToDeterministicAccuracyMarkdown(report));

        output.AppendLine().AppendLine("## Missing real-corpus coverage").AppendLine();
        foreach (var category in report.MissingRealCorpusCategories) output.AppendLine($"- {category}");
        output.AppendLine().AppendLine("## Sequence results").AppendLine();
        output.AppendLine("| Case | Side | Category | Comparator | Frames | Expected detection | Detected | Expected Ready | Ready | Qualified | First Ready | Final reason | Motion reset | Epoch reset | Frozen reset | Old-epoch Ready | Safe outcome |");
        output.AppendLine("|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|");
        foreach (var result in report.Cases)
        {
            output.AppendLine($"| {result.CaseId} | {result.Side} | {result.Category} | {result.Mode} | {result.FramesEvaluated} | {result.ExpectedDetection} | {result.Detected} | {result.ExpectedReady} | {result.Ready} | {result.QualifiedFrames} | {(result.FirstReadyFrame?.ToString() ?? "n/a")} | {result.Reason} | {result.MotionResetObserved} | {result.EpochResetObserved} | {result.FrozenResetObserved} | {result.OldEpochReadyObserved} | {result.SafetyExpectationMet} |");
        }

        return output.ToString();
    }

    public static string ToDeterministicAccuracyMarkdown(ReplayReport report)
    {
        var output = new StringBuilder();
        output.AppendLine(AccuracyProjectionStart);
        output.AppendLine("## Deterministic accuracy projection").AppendLine();
        output.AppendLine($"- Decision digest: `{report.DecisionDigest}`");
        output.AppendLine("| Comparator | Cases | TP | FP | TN | FN | False Ready | Detection recall | Detection precision | Ready recall | Ready precision | Mean corner error |");
        output.AppendLine("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
        foreach (var aggregate in report.Aggregates)
        {
            output.AppendLine(FormattableString.Invariant(
                $"| {aggregate.Mode} | {aggregate.Cases} | {aggregate.TruePositive} | {aggregate.FalsePositive} | {aggregate.TrueNegative} | {aggregate.FalseNegative} | {aggregate.FalseReady} | {aggregate.Recall:F6} | {aggregate.Precision:F6} | {aggregate.ReadyRecall:F6} | {aggregate.ReadyPrecision:F6} | {(aggregate.MeanCornerErrorPixels.HasValue ? FormatDeterministic(aggregate.MeanCornerErrorPixels.Value) : "n/a")} |"));
        }
        output.AppendLine(AccuracyProjectionEnd);
        return output.ToString();
    }

    public static void VerifyProductionThresholdContract(ReplayReport generated, ReplayReport committed) =>
        VerifyProductionThresholdContract(generated, committed, ToMarkdown(committed));

    public static void VerifyProductionThresholdContract(
        ReplayReport generated,
        ReplayReport committed,
        string committedMarkdown)
    {
        var generatedProjectionDigest = ComputeDecisionDigest(
            generated.Seed, generated.CorpusKind, generated.Cases, generated.Aggregates);
        var committedProjectionDigest = ComputeDecisionDigest(
            committed.Seed, committed.CorpusKind, committed.Cases, committed.Aggregates);
        if (generated.SchemaVersion != ReportSchemaVersion || committed.SchemaVersion != ReportSchemaVersion ||
            generated.DetectorVersion != NativeEdgeDetector.DetectorVersion ||
            committed.DetectorVersion != NativeEdgeDetector.DetectorVersion ||
            !generated.SyntheticOnly || !committed.SyntheticOnly ||
            generated.DecisionDigest != generatedProjectionDigest ||
            committed.DecisionDigest != committedProjectionDigest ||
            generated.DecisionDigest != committed.DecisionDigest ||
            generated.Seed != committed.Seed ||
            generated.CorpusKind != committed.CorpusKind ||
            generated.Cases.Count != committed.Cases.Count)
        {
            throw new InvalidDataException("Committed replay decision/report contract drifted.");
        }

        var expectedMarkdownProjection = NormalizeNewlines(ToDeterministicAccuracyMarkdown(committed)).Trim();
        if (!NormalizeNewlines(committedMarkdown).Contains(expectedMarkdownProjection, StringComparison.Ordinal))
            throw new InvalidDataException("Committed replay Markdown accuracy projection drifted from JSON.");

        var fused = generated.Aggregates.Single(static aggregate => aggregate.Mode == DetectorMode.Fused);
        if (fused.FalseReady != 0 || fused.ReadyPrecision < 1 || fused.Recall < 0.70 || fused.ReadyRecall < 0.60 ||
            generated.Cases.Where(static result => result.Mode == DetectorMode.Fused).Any(static result =>
                result.OldEpochReadyObserved))
        {
            throw new InvalidDataException("Production-default synthetic replay safety contract failed.");
        }
    }

    private static ReplayCaseResult EvaluateSequence(
        SyntheticFrameGenerator generator,
        ReplayManifest manifest,
        ReplayCaseSpec spec,
        DetectorMode mode,
        string? privateFixtureRoot,
        int cpuLoadMilliseconds)
    {
        var options = new DetectorOptions { Mode = mode };
        using var rawDetector = new NativeEdgeDetector(options);
        using var temporalDetector = new NativeEdgeDetector(options);
        var frames = Math.Clamp(spec.FrameCount, options.ReadyEvidenceFrames, 20);
        var detectedFrames = 0;
        var qualifiedFrames = 0;
        var readyFrames = 0;
        int? firstReady = null;
        var errors = new List<double>();
        var durations = new List<double>();
        var motionReset = false;
        var epochReset = false;
        var frozenReset = false;
        var oldEpochReady = false;
        var removalFence = false;
        GeometryResult? final = null;
        double maximumConfidence = 0;

        for (var index = 0; index < frames; index++)
        {
            var generated = GenerateSequenceFrame(generator, manifest, spec, privateFixtureRoot, index, frames);
            using var cpuLoad = CpuLoadScope.Start(cpuLoadMilliseconds);
            var now = Stopwatch.GetTimestamp();
            var runtimeFrame = generated.Frame with
            {
                Identity = generated.Frame.Identity with { ReceiveMonotonicTicks = now },
            };
            var expectedEpochs = ExpectedEpochs(spec, runtimeFrame.Epochs);
            var context = new DetectionContext(expectedEpochs, now, Stopwatch.Frequency);
            var raw = rawDetector.Detect(runtimeFrame, context, applyTemporalTracking: false);
            var temporal = temporalDetector.Detect(runtimeFrame, context, applyTemporalTracking: true);
            final = temporal;
            durations.Add(raw.ProcessingMs);
            maximumConfidence = Math.Max(maximumConfidence, raw.Metrics.Confidence);
            var detected = raw.SourceCorners.Count == 4;
            if (detected) detectedFrames++;
            if (raw.CurrentFrameAuthority.CaptureReady) qualifiedFrames++;
            if (temporal.Status == GeometryStatus.Ready)
            {
                readyFrames++;
                firstReady ??= index + 1;
                if (spec.SequenceKind is "wrong_epoch" or "wrong_side" ||
                    temporal.Hysteresis.EpochReset && temporal.Hysteresis.ConsecutiveAccepted < temporal.Hysteresis.Required)
                    oldEpochReady = true;
            }

            motionReset |= temporal.Reason == GeometryReasonCode.InconsistentEvidence;
            epochReset |= temporal.Hysteresis.EpochReset;
            frozenReset |= temporal.Frozen || temporal.Reason == GeometryReasonCode.FrozenFrame;
            removalFence |= temporal.Hysteresis.RemovalFenceSatisfied;
            var error = CornerError(raw.SourceCorners, generated.GroundTruthCorners);
            if (error.HasValue) errors.Add(error.Value);
        }

        var expectedDetection = ExpectedDetection(spec);
        var expectedReady = ExpectedReady(spec);
        var detectedAny = detectedFrames > 0;
        var readyAny = readyFrames > 0;
        var correct = expectedReady ? readyAny && !oldEpochReady : !readyAny && !oldEpochReady;
        return new ReplayCaseResult(
            spec.Id,
            spec.PairId,
            spec.Side,
            spec.Category,
            mode,
            spec.ExpectedCard,
            expectedDetection,
            expectedReady,
            final?.Status ?? GeometryStatus.NotDetected,
            final?.Reason ?? GeometryReasonCode.EmptyFrame,
            detectedAny,
            readyAny,
            maximumConfidence,
            errors.Count == 0 ? null : errors.Average(),
            durations.Count == 0 ? 0 : durations.Average(),
            frozenReset,
            correct,
            frames,
            detectedFrames,
            qualifiedFrames,
            readyFrames,
            firstReady,
            motionReset,
            epochReset,
            frozenReset,
            oldEpochReady,
            removalFence);
    }

    private static GeneratedReplayFrame GenerateSequenceFrame(
        SyntheticFrameGenerator generator,
        ReplayManifest manifest,
        ReplayCaseSpec spec,
        string? privateFixtureRoot,
        int index,
        int frameCount)
    {
        var frameSpec = spec;
        switch (spec.SequenceKind)
        {
            case "slow_drift":
                frameSpec = spec with
                {
                    TranslationX = spec.TranslationX + (spec.MotionStepX * index),
                    TranslationY = spec.TranslationY + (spec.MotionStepY * index),
                };
                break;
            case "sudden_motion" when index >= frameCount / 2:
                frameSpec = spec with
                {
                    TranslationX = spec.TranslationX + (Math.Abs(spec.MotionStepX) > 0 ? spec.MotionStepX : 0.16),
                    TranslationY = spec.TranslationY + spec.MotionStepY,
                };
                break;
            case "epoch_transition" when index >= frameCount / 2:
                frameSpec = spec with { PreviewEpoch = spec.PreviewEpoch + 1, SideEpoch = spec.SideEpoch + 1 };
                break;
            case "removal_replacement" when index is 2 or 3:
                frameSpec = spec with
                {
                    Id = spec.Id + "-removed",
                    ExpectedCard = false,
                    Effects = new[] { "no_card" },
                };
                break;
            case "removal_replacement" when index >= 4:
                frameSpec = spec with { Id = spec.Id + "-replacement" };
                break;
        }

        var generated = frameSpec.PrivateFile is null
            ? generator.Generate(frameSpec, manifest.Seed)
            : generator.LoadPrivate(frameSpec, privateFixtureRoot!);
        if (spec.SequenceKind == "frozen" || spec.FrozenOf is not null) return generated;
        return generated with
        {
            Frame = generated.Frame with
            {
                Identity = generated.Frame.Identity with
                {
                    FrameId = $"{generated.Frame.Identity.FrameId}-seq-{index + 1}",
                    BlockId = (generated.Frame.Identity.BlockId ?? 0) + (ulong)(index + 1),
                },
            },
        };
    }

    private static FrameEpochs ExpectedEpochs(ReplayCaseSpec spec, FrameEpochs actual) => spec.SequenceKind switch
    {
        "wrong_epoch" => actual with { SideEpoch = actual.SideEpoch + 1 },
        "wrong_side" => actual with { Side = actual.Side == CardSide.Front ? CardSide.Back : CardSide.Front },
        _ => actual,
    };

    private static bool ExpectedDetection(ReplayCaseSpec spec) =>
        spec.ExpectedCard && !spec.Effects.Contains("no_card", StringComparer.OrdinalIgnoreCase) &&
        !spec.Effects.Contains("no_gradient", StringComparer.OrdinalIgnoreCase) &&
        spec.SequenceKind is not ("wrong_epoch" or "wrong_side");

    private static bool ExpectedReady(ReplayCaseSpec spec) => spec.ExpectedReady ??
        (ExpectedDetection(spec) && spec.Category != "clipped" && spec.Clipping <= 0 &&
         spec.SequenceKind is not ("sudden_motion" or "epoch_transition"));

    private static DetectorAggregate Aggregate(DetectorMode mode, IReadOnlyList<ReplayCaseResult> results)
    {
        var positive = results.Count(static result => result.ExpectedDetection);
        var negative = results.Count - positive;
        var truePositive = results.Count(static result => result.ExpectedDetection && result.Detected);
        var falseNegative = positive - truePositive;
        var trueNegative = results.Count(static result => !result.ExpectedDetection && !result.Detected);
        var falsePositive = negative - trueNegative;
        var expectedReady = results.Count(static result => result.ExpectedReady);
        var trueReady = results.Count(static result => result.ExpectedReady && result.Ready && !result.OldEpochReadyObserved);
        var falseReady = results.Count(static result => !result.ExpectedReady && result.Ready || result.OldEpochReadyObserved);
        var durations = results.Select(static result => result.ProcessingMs).OrderBy(static value => value).ToArray();
        var errors = results.Where(static result => result.MeanCornerErrorPixels.HasValue)
            .Select(static result => result.MeanCornerErrorPixels!.Value).ToArray();
        return new DetectorAggregate(
            mode,
            results.Count,
            positive,
            negative,
            truePositive,
            falsePositive,
            trueNegative,
            falseNegative,
            falsePositive,
            falseReady,
            positive == 0 ? 0 : truePositive / (double)positive,
            truePositive + falsePositive == 0 ? 1 : truePositive / (double)(truePositive + falsePositive),
            expectedReady == 0 ? 0 : trueReady / (double)expectedReady,
            trueReady + falseReady == 0 ? 1 : trueReady / (double)(trueReady + falseReady),
            Percentile(durations, 0.50),
            Percentile(durations, 0.95),
            errors.Length == 0 ? null : errors.Average());
    }

    private static double? CornerError(IReadOnlyList<PointD> detected, IReadOnlyList<PointD>? expected)
    {
        if (detected.Count != 4 || expected?.Count != 4) return null;
        return BestCyclicCornerError(detected, expected);
    }

    private static double BestCyclicCornerError(IReadOnlyList<PointD> detected, IReadOnlyList<PointD> expected)
    {
        var best = double.PositiveInfinity;
        for (var reverse = 0; reverse < 2; reverse++)
        for (var offset = 0; offset < 4; offset++)
        {
            var error = Enumerable.Range(0, 4).Average(index =>
            {
                var expectedIndex = reverse == 0 ? (index + offset) % 4 : (offset - index + 8) % 4;
                var dx = detected[index].X - expected[expectedIndex].X;
                var dy = detected[index].Y - expected[expectedIndex].Y;
                return Math.Sqrt((dx * dx) + (dy * dy));
            });
            best = Math.Min(best, error);
        }

        return best;
    }

    private static string ComputeDecisionDigest(
        int seed,
        string corpusKind,
        IReadOnlyList<ReplayCaseResult> results,
        IReadOnlyList<DetectorAggregate> aggregates)
    {
        var stable = new
        {
            SchemaVersion = ReportSchemaVersion,
            Seed = seed,
            CorpusKind = corpusKind,
            DetectorVersion = NativeEdgeDetector.DetectorVersion,
            Cases = results.Select(static result => new
            {
                result.CaseId,
                result.PairId,
                result.Side,
                result.Category,
                result.Mode,
                result.CardPresent,
                result.ExpectedDetection,
                result.ExpectedReady,
                result.Status,
                result.Reason,
                result.Detected,
                result.Ready,
                Confidence = RoundDeterministic(result.Confidence),
                MeanCornerErrorPixels = RoundDeterministic(result.MeanCornerErrorPixels),
                result.Frozen,
                result.SafetyExpectationMet,
                result.FramesEvaluated,
                result.DetectedFrames,
                result.QualifiedFrames,
                result.ReadyFrames,
                result.FirstReadyFrame,
                result.MotionResetObserved,
                result.EpochResetObserved,
                result.FrozenResetObserved,
                result.OldEpochReadyObserved,
                result.RemovalFenceObserved,
            }).ToArray(),
            Aggregates = aggregates.Select(static aggregate => new
            {
                aggregate.Mode,
                aggregate.Cases,
                aggregate.ExpectedCards,
                aggregate.Negatives,
                aggregate.TruePositive,
                aggregate.FalsePositive,
                aggregate.TrueNegative,
                aggregate.FalseNegative,
                aggregate.FalseDetection,
                aggregate.FalseReady,
                Recall = RoundDeterministic(aggregate.Recall),
                Precision = RoundDeterministic(aggregate.Precision),
                ReadyRecall = RoundDeterministic(aggregate.ReadyRecall),
                ReadyPrecision = RoundDeterministic(aggregate.ReadyPrecision),
                MeanCornerErrorPixels = RoundDeterministic(aggregate.MeanCornerErrorPixels),
            }).ToArray(),
        };
        return Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(stable, JsonOptions))).ToLowerInvariant();
    }

    private static double RoundDeterministic(double value) =>
        Math.Round(value, 6, MidpointRounding.AwayFromZero);

    private static double? RoundDeterministic(double? value) =>
        value.HasValue ? RoundDeterministic(value.Value) : null;

    private static string FormatDeterministic(double value) =>
        RoundDeterministic(value).ToString("F6", CultureInfo.InvariantCulture);

    private static string NormalizeNewlines(string value) =>
        value.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');

    private static double Percentile(IReadOnlyList<double> values, double percentile)
    {
        if (values.Count == 0) return 0;
        var index = (values.Count - 1) * percentile;
        var lower = (int)Math.Floor(index);
        var upper = (int)Math.Ceiling(index);
        if (lower == upper) return values[lower];
        return values[lower] + ((values[upper] - values[lower]) * (index - lower));
    }

    private static void ValidateManifest(ReplayManifest manifest, string? privateRoot, int cpuLoadMilliseconds)
    {
        if (manifest.SchemaVersion != "tenkings.ai-grader.replay-manifest.v1" ||
            manifest.CorpusKind is not ("synthetic" or "private" or "mixed") ||
            manifest.Cases.Count is 0 or > 10_000 || cpuLoadMilliseconds is < 0 or > 5_000)
            throw new InvalidDataException("Replay manifest or CPU load bound is invalid.");
        if (manifest.Cases.Select(static spec => spec.Id).Distinct(StringComparer.Ordinal).Count() != manifest.Cases.Count)
            throw new InvalidDataException("Replay case IDs must be unique.");
        var ids = manifest.Cases.Select(static spec => spec.Id).ToHashSet(StringComparer.Ordinal);
        var sequenceKinds = new HashSet<string>(StringComparer.Ordinal)
        {
            "stable", "slow_drift", "sudden_motion", "epoch_transition", "wrong_epoch",
            "wrong_side", "removal_replacement", "frozen",
        };
        foreach (var spec in manifest.Cases)
        {
            if (!IsSafeIdentifier(spec.Id) || !IsSafeIdentifier(spec.PairId) || !IsSafeIdentifier(spec.Category) ||
                spec.Polarity is not ("dark_on_light" or "light_on_dark" or "neutral") ||
                !double.IsFinite(spec.RotationDegrees) || Math.Abs(spec.RotationDegrees) > 35 ||
                !double.IsFinite(spec.Perspective) || Math.Abs(spec.Perspective) > 0.3 ||
                !double.IsFinite(spec.TranslationX) || Math.Abs(spec.TranslationX) > 1 ||
                !double.IsFinite(spec.TranslationY) || Math.Abs(spec.TranslationY) > 1 ||
                !double.IsFinite(spec.Clipping) || spec.Clipping is < 0 or > 1 ||
                !double.IsFinite(spec.BorderContrast) || spec.BorderContrast is < 0 or > 255 ||
                spec.PreviewEpoch < 0 || spec.SideEpoch < 0 || spec.Effects.Count > 20 ||
                spec.Effects.Any(static effect => !IsSafeIdentifier(effect)) ||
                spec.SensorRotationDegrees is not (0 or 90 or 180 or 270) ||
                !sequenceKinds.Contains(spec.SequenceKind) || spec.FrameCount is < 3 or > 20 ||
                !double.IsFinite(spec.MotionStepX) || Math.Abs(spec.MotionStepX) > 0.5 ||
                !double.IsFinite(spec.MotionStepY) || Math.Abs(spec.MotionStepY) > 0.5)
                throw new InvalidDataException("Replay case metadata is invalid.");
            if (spec.FrozenOf is not null && (!IsSafeIdentifier(spec.FrozenOf) || !ids.Contains(spec.FrozenOf)))
                throw new InvalidDataException("Frozen-frame reference is invalid.");
            if (spec.PrivateFile is not null &&
                (Path.IsPathRooted(spec.PrivateFile) || string.IsNullOrWhiteSpace(spec.PermittedSha256) ||
                 spec.PermittedSha256.Length != 64 || spec.PermittedSha256.Any(static character => !Uri.IsHexDigit(character))))
                throw new InvalidDataException("Private fixture metadata is invalid.");
            if (spec.PrivateFile is not null && spec.ExpectedCard && spec.GroundTruthCorners?.Count != 4)
                throw new InvalidDataException("Expected-card private fixtures require four raw-source ground-truth corners.");
            if (spec.GroundTruthCorners is not null &&
                (spec.GroundTruthCorners.Count != 4 || spec.GroundTruthCorners.Any(static point =>
                    !double.IsFinite(point.X) || !double.IsFinite(point.Y) || point.X < 0 || point.Y < 0)))
                throw new InvalidDataException("Replay ground-truth corners are invalid.");
        }

        if (manifest.MissingRealCorpusCategories.Count > 100 || manifest.MissingRealCorpusCategories.Any(static category =>
                string.IsNullOrWhiteSpace(category) || category.Length > 160 || category.Any(char.IsControl) ||
                category.Contains('\\') || category.StartsWith('/') || category.Contains(":/", StringComparison.Ordinal)))
            throw new InvalidDataException("Missing-corpus descriptions are invalid.");
        if (manifest.Cases.Any(static spec => spec.PrivateFile is not null) && string.IsNullOrWhiteSpace(privateRoot))
            throw new InvalidDataException("A private fixture root is required by this manifest.");
    }

    private static bool IsSafeIdentifier(string? value) =>
        !string.IsNullOrWhiteSpace(value) && value.Length <= 96 &&
        value.All(static character => char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or ':' or '-');

    private static JsonSerializerOptions CreateJsonOptions()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true,
            WriteIndented = true,
        };
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }

    private sealed class CpuLoadScope : IDisposable
    {
        private readonly CancellationTokenSource? _cancellation;
        private readonly Task? _task;

        private CpuLoadScope(int milliseconds)
        {
            if (milliseconds <= 0) return;
            _cancellation = new CancellationTokenSource();
            using var started = new ManualResetEventSlim();
            var token = _cancellation.Token;
            _task = Task.Factory.StartNew(() =>
            {
                var until = Stopwatch.GetTimestamp() + (long)(Stopwatch.Frequency * (milliseconds / 1_000d));
                started.Set();
                while (!token.IsCancellationRequested && Stopwatch.GetTimestamp() < until) Thread.SpinWait(512);
            }, token, TaskCreationOptions.LongRunning, TaskScheduler.Default);
            started.Wait(TimeSpan.FromSeconds(1));
        }

        public static CpuLoadScope Start(int milliseconds) => new(milliseconds);

        public void Dispose()
        {
            if (_cancellation is null || _task is null) return;
            _cancellation.Cancel();
            try { _task.GetAwaiter().GetResult(); }
            catch (OperationCanceledException) { }
            _cancellation.Dispose();
        }
    }
}
