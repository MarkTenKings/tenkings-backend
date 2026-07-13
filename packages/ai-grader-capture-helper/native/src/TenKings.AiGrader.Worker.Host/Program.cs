using TenKings.AiGrader.Worker.Core;
using TenKings.AiGrader.Worker.Host;

try
{
    return await WorkerProgram.RunAsync(args).ConfigureAwait(false);
}
catch
{
    Console.Error.WriteLine("native_worker_startup_failed");
    return 64;
}

internal static class WorkerProgram
{
    public static async Task<int> RunAsync(string[] args)
    {
        var options = WorkerOptions.Parse(args);
        await using var camera = CreateBackend(options);
        var lighting = new ProtocolLightingCoordinator();
        await using var worker = new NativeCameraWorker(
            camera,
            new VisionFrameAnalyzer(RigConfigurationDefaults.SafeFakeConfiguration),
            new OpenCvPreviewFrameEncoder(camera.RuntimePolicy.Preview.JpegQuality),
            lighting,
            new ForensicCaptureWriter(options.OutputRoot),
            options.WorkerId,
            options.WorkerEpoch,
            options.NativeModeEnabled);
        var server = new NativeCameraProtocolServer(
            worker,
            lighting,
            Console.OpenStandardInput(),
            Console.OpenStandardOutput(),
            Console.Error);
        return await server.RunAsync(CancellationToken.None).ConfigureAwait(false);
    }

    private static ICameraBackend CreateBackend(WorkerOptions options) => options.Backend switch
    {
        "fake" => new FakeCameraBackend(),
        "replay" => new ReplayCameraBackend(ReplayManifestLoader.Load(options.ReplayManifest!)),
        _ => throw new InvalidOperationException("Worker host supports only fake/replay. Use the separately guarded Pylon host for hardware."),
    };
}

internal sealed record WorkerOptions(
    string Backend,
    string? ReplayManifest,
    string OutputRoot,
    string WorkerId,
    long WorkerEpoch,
    bool NativeModeEnabled)
{
    public static WorkerOptions Parse(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        var enableNative = false;
        foreach (var argument in args)
        {
            if (argument == "--enable-native")
            {
                enableNative = true;
                continue;
            }

            if (!argument.StartsWith("--", StringComparison.Ordinal) || !argument.Contains('=', StringComparison.Ordinal))
            {
                throw new ArgumentException("Invalid worker argument.");
            }

            var separator = argument.IndexOf('=');
            var key = argument[2..separator];
            var value = argument[(separator + 1)..];
            if (!values.TryAdd(key, value))
            {
                throw new ArgumentException("Duplicate worker argument.");
            }
        }

        var backend = values.GetValueOrDefault("backend", "disabled");
        var allowedKeys = new HashSet<string>(StringComparer.Ordinal)
        {
            "backend",
            "replay-manifest",
            "output-root",
            "worker-id",
            "worker-epoch",
        };
        if (values.Keys.Any(key => !allowedKeys.Contains(key)))
        {
            throw new ArgumentException("Worker argument is not in the fixed host policy.");
        }
        if (backend is not ("fake" or "replay"))
        {
            throw new ArgumentException("Explicit --backend=fake or --backend=replay is required.");
        }

        var replayManifest = values.GetValueOrDefault("replay-manifest");
        if (backend == "replay" && string.IsNullOrWhiteSpace(replayManifest))
        {
            throw new ArgumentException("Replay mode requires --replay-manifest.");
        }

        var outputRoot = values.GetValueOrDefault("output-root");
        if (string.IsNullOrWhiteSpace(outputRoot))
        {
            throw new ArgumentException("Explicit --output-root is required.");
        }

        var workerId = values.GetValueOrDefault("worker-id", "native-worker-1");
        var workerEpoch = long.Parse(values.GetValueOrDefault("worker-epoch", "1"), System.Globalization.CultureInfo.InvariantCulture);
        return new WorkerOptions(backend, replayManifest, outputRoot, workerId, workerEpoch, enableNative);
    }
}
