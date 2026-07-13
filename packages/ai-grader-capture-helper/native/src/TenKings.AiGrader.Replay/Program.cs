namespace TenKings.AiGrader.Replay;

internal static class Program
{
    private static int Main(string[] args)
    {
        try
        {
            var options = CliOptions.Parse(args);
            var manifest = ReplayEvaluator.LoadManifest(options.Manifest);
            var report = new ReplayEvaluator().Evaluate(manifest, options.PrivateFixtures, options.CpuLoadMilliseconds);
            foreach (var aggregate in report.Aggregates)
                Console.WriteLine($"{aggregate.Mode}: detectionRecall={aggregate.Recall:F4}; detectionPrecision={aggregate.Precision:F4}; readyRecall={aggregate.ReadyRecall:F4}; readyPrecision={aggregate.ReadyPrecision:F4}; falseDetection={aggregate.FalseDetection}; falseReady={aggregate.FalseReady}; p95Ms={aggregate.P95ProcessingMs:F3}.");
            foreach (var unsafeCase in report.Cases.Where(static result => !result.SafetyExpectationMet))
                Console.WriteLine($"Unsafe expectation: case={unsafeCase.CaseId}; mode={unsafeCase.Mode}; ready={unsafeCase.Ready}; reason={unsafeCase.Reason}; oldEpochReady={unsafeCase.OldEpochReadyObserved}.");
            if (options.JsonReport is not null) WriteReport(options.JsonReport, ReplayEvaluator.ToJson(report));
            if (options.MarkdownReport is not null) WriteReport(options.MarkdownReport, ReplayEvaluator.ToMarkdown(report));
            if (options.VerifyBaseline is not null)
                ReplayEvaluator.VerifyProductionThresholdContract(
                    report,
                    ReplayEvaluator.LoadReport(options.VerifyBaseline),
                    ReplayEvaluator.LoadMarkdown(Path.ChangeExtension(options.VerifyBaseline, ".md")));
            Console.WriteLine($"Replay complete: {report.TotalEvaluations} bounded sequence evaluations; syntheticOnly={report.SyntheticOnly}; decisions={report.DecisionDigest}.");
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"Replay failed safely: {exception.GetType().Name}.");
            return 2;
        }
    }

    private static void WriteReport(string destination, string contents)
    {
        var full = Path.GetFullPath(destination);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        var temporary = full + ".tmp";
        File.WriteAllText(temporary, contents);
        File.Move(temporary, full, overwrite: true);
    }

    private sealed record CliOptions(
        string Manifest,
        string? PrivateFixtures,
        string? JsonReport,
        string? MarkdownReport,
        string? VerifyBaseline,
        int CpuLoadMilliseconds)
    {
        public static CliOptions Parse(IReadOnlyList<string> args)
        {
            string? manifest = null, privateFixtures = null, json = null, markdown = null, verifyBaseline = null;
            var cpuLoad = 0;
            for (var index = 0; index < args.Count; index++)
            {
                var name = args[index];
                if (name is "--help" or "-h") throw new ArgumentException("Usage requested.");
                if (index + 1 >= args.Count) throw new ArgumentException("CLI option value is missing.");
                var value = args[++index];
                switch (name)
                {
                    case "--manifest": manifest = value; break;
                    case "--private-fixtures": privateFixtures = value; break;
                    case "--json": json = value; break;
                    case "--markdown": markdown = value; break;
                    case "--verify-baseline": verifyBaseline = value; break;
                    case "--cpu-load-ms" when int.TryParse(value, out var parsed): cpuLoad = parsed; break;
                    default: throw new ArgumentException("CLI option is invalid.");
                }
            }

            if (string.IsNullOrWhiteSpace(manifest)) throw new ArgumentException("--manifest is required.");
            if (json is null && markdown is null && verifyBaseline is null)
                throw new ArgumentException("At least one report output or --verify-baseline is required.");
            return new CliOptions(manifest, privateFixtures, json, markdown, verifyBaseline, cpuLoad);
        }
    }
}
