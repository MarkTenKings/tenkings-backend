using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using TenKings.AiGrader.Vision;

namespace TenKings.AiGrader.Replay;

public sealed class ReplayEvaluator
{
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
            var options = new DetectorOptions { Mode = mode, ReadyEvidenceFrames = 2, MinConfidence = 0.48, ReadyConfidence = 0.55 };
            using var rawDetector = new NativeEdgeDetector(options);
            using var temporalDetector = new NativeEdgeDetector(options);
            foreach (var spec in manifest.Cases)
            {
                var generated = spec.PrivateFile is null
                    ? generator.Generate(spec, manifest.Seed)
                    : generator.LoadPrivate(spec, privateFixtureRoot!);
                using var cpuLoad = CpuLoadScope.Start(cpuLoadMilliseconds);
                var now = Stopwatch.GetTimestamp();
                var runtimeFrame = generated.Frame with
                {
                    Identity = generated.Frame.Identity with { ReceiveMonotonicTicks = now },
                };
                var context = new DetectionContext(runtimeFrame.Epochs, now, Stopwatch.Frequency);
                var raw = rawDetector.Detect(runtimeFrame, context, applyTemporalTracking: false);
                var temporal = temporalDetector.Detect(runtimeFrame, context, applyTemporalTracking: true);
                var selected = spec.FrozenOf is null ? raw : temporal;
                var expectedPositive = spec.ExpectedCard && spec.FrozenOf is null;
                var detected = selected.SourceCorners.Count == 4 && selected.Status != GeometryStatus.NotDetected;
                var correct = spec.Category.Equals("clipped", StringComparison.OrdinalIgnoreCase)
                    ? selected.Status != GeometryStatus.Ready && (selected.Status == GeometryStatus.NotDetected || selected.Reason is GeometryReasonCode.ClippedBoundary or GeometryReasonCode.UnsafeCoverage or GeometryReasonCode.UnsafeAspect)
                    : expectedPositive == detected;
                results.Add(new ReplayCaseResult(
                    spec.Id, spec.PairId, spec.Side, spec.Category, mode, spec.ExpectedCard, expectedPositive,
                    selected.Status, selected.Reason, detected, selected.Metrics.Confidence,
                    CornerError(selected.SourceCorners, generated.GroundTruthCorners),
                    selected.ProcessingMs, selected.Frozen, correct));
            }
        }

        var aggregates = Modes.Select(mode => Aggregate(mode, results.Where(result => result.Mode == mode).ToArray())).ToArray();
        return new ReplayReport(
            "tenkings.ai-grader.replay-report.v1",
            NativeEdgeDetector.DetectorVersion,
            manifest.CorpusKind,
            manifest.CorpusKind.Equals("synthetic", StringComparison.OrdinalIgnoreCase),
            "Synthetic/adversarial results are engineering regression evidence only; they are not production accuracy or Dell hardware performance claims.",
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

    public static string ToJson(ReplayReport report) => JsonSerializer.Serialize(report, JsonOptions);

    public static string ToMarkdown(ReplayReport report)
    {
        var output = new StringBuilder();
        output.AppendLine("# Native four-edge offline replay").AppendLine();
        output.AppendLine($"- Detector: `{report.DetectorVersion}`");
        output.AppendLine($"- Corpus: `{report.CorpusKind}`");
        output.AppendLine($"- Seed: `{report.Seed}`");
        output.AppendLine($"- Evaluations: `{report.TotalEvaluations}`").AppendLine();
        output.AppendLine($"> {report.AccuracyDisclaimer}").AppendLine();
        output.AppendLine("| Comparator | Recall | Precision | False detector positive | False Ready | P50 detect | P95 detect | Mean corner error |");
        output.AppendLine("|---|---:|---:|---:|---:|---:|---:|---:|");
        foreach (var aggregate in report.Aggregates)
        {
            output.AppendLine($"| {aggregate.Mode} | {aggregate.Recall:P1} | {aggregate.Precision:P1} | {aggregate.FalsePositive} | {aggregate.FalseReady} | {aggregate.P50ProcessingMs:F2} ms | {aggregate.P95ProcessingMs:F2} ms | {(aggregate.MeanCornerErrorPixels.HasValue ? $"{aggregate.MeanCornerErrorPixels:F2} px" : "n/a")} |");
        }

        output.AppendLine().AppendLine("## Missing real-corpus coverage").AppendLine();
        foreach (var category in report.MissingRealCorpusCategories) output.AppendLine($"- {category}");
        output.AppendLine().AppendLine("## Case results").AppendLine();
        output.AppendLine("| Case | Side | Category | Comparator | Card present | Expected detection | Status | Reason | Confidence | Safe outcome |");
        output.AppendLine("|---|---|---|---|---:|---:|---|---|---:|---:|");
        foreach (var result in report.Cases)
        {
            output.AppendLine($"| {result.CaseId} | {result.Side} | {result.Category} | {result.Mode} | {result.CardPresent} | {result.ExpectedDetection} | {result.Status} | {result.Reason} | {result.Confidence:F3} | {result.SafetyExpectationMet} |");
        }

        return output.ToString();
    }

    private static DetectorAggregate Aggregate(DetectorMode mode, IReadOnlyList<ReplayCaseResult> results)
    {
        var positive = results.Count(static result => result.ExpectedDetection);
        var negative = results.Count - positive;
        var truePositive = results.Count(static result => result.ExpectedDetection && result.Detected);
        var falseNegative = positive - truePositive;
        var trueNegative = results.Count(static result => !result.ExpectedDetection && !result.Detected);
        var falsePositive = negative - trueNegative;
        var falseReady = results.Count(static result => (!result.CardPresent || result.Category == "clipped" || result.Frozen) && result.Status == GeometryStatus.Ready);
        var durations = results.Select(static result => result.ProcessingMs).OrderBy(static value => value).ToArray();
        var errors = results.Where(static result => result.MeanCornerErrorPixels.HasValue)
            .Select(static result => result.MeanCornerErrorPixels!.Value).ToArray();
        return new DetectorAggregate(
            mode, results.Count, positive, negative, truePositive, falsePositive, trueNegative, falseNegative, falseReady,
            positive == 0 ? 0 : truePositive / (double)positive,
            truePositive + falsePositive == 0 ? 1 : truePositive / (double)(truePositive + falsePositive),
            Percentile(durations, 0.50), Percentile(durations, 0.95),
            errors.Length == 0 ? null : errors.Average());
    }

    private static double? CornerError(IReadOnlyList<PointD> detected, IReadOnlyList<PointD>? expected)
    {
        if (detected.Count != 4 || expected?.Count != 4) return null;
        var orderedExpected = Order(expected);
        var orderedDetected = Order(detected);
        return Enumerable.Range(0, 4).Average(index =>
        {
            var dx = orderedDetected[index].X - orderedExpected[index].X;
            var dy = orderedDetected[index].Y - orderedExpected[index].Y;
            return Math.Sqrt((dx * dx) + (dy * dy));
        });
    }

    private static PointD[] Order(IReadOnlyList<PointD> points)
    {
        var center = new PointD(points.Average(static point => point.X), points.Average(static point => point.Y));
        var ordered = points.OrderBy(point => Math.Atan2(point.Y - center.Y, point.X - center.X)).ToArray();
        var topLeft = ordered.MinBy(static point => point.X + point.Y)!;
        var index = Array.IndexOf(ordered, topLeft);
        return Enumerable.Range(0, 4).Select(offset => ordered[(index + offset) % 4]).ToArray();
    }

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
                spec.Effects.Any(static effect => !IsSafeIdentifier(effect)))
                throw new InvalidDataException("Replay case metadata is invalid.");
            if (spec.FrozenOf is not null && (!IsSafeIdentifier(spec.FrozenOf) || !ids.Contains(spec.FrozenOf)))
                throw new InvalidDataException("Frozen-frame reference is invalid.");
            if (spec.PrivateFile is not null &&
                (Path.IsPathRooted(spec.PrivateFile) || string.IsNullOrWhiteSpace(spec.PermittedSha256) ||
                 spec.PermittedSha256.Length != 64 || spec.PermittedSha256.Any(static character => !Uri.IsHexDigit(character))))
                throw new InvalidDataException("Private fixture metadata is invalid.");
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
