using TenKings.AiGrader.Pylon.Host;
using TenKings.AiGrader.Worker.Core;

if (!PylonActivationGuard.TryAuthorize(args, out var permit, out var publicReason))
{
    Console.Error.WriteLine(publicReason);
    return 64;
}

try
{
#if PYLON_SDK
var outputArgument = args.SingleOrDefault(static argument => argument.StartsWith("--output-root=", StringComparison.Ordinal));
if (outputArgument is null)
{
    Console.Error.WriteLine("pylon_output_root_required");
    return 64;
}

var workerEpochArgument = args.SingleOrDefault(static argument => argument.StartsWith("--worker-epoch=", StringComparison.Ordinal));
var workerEpoch = workerEpochArgument is null
    ? 1
    : long.Parse(workerEpochArgument[(workerEpochArgument.IndexOf('=') + 1)..], System.Globalization.CultureInfo.InvariantCulture);
var outputRoot = outputArgument[(outputArgument.IndexOf('=') + 1)..];
await using var camera = new PylonCameraBackend(permit!);
var lighting = new ProtocolLightingCoordinator();
await using var worker = new NativeCameraWorker(
    camera,
    new PylonVisionFrameAnalyzer(),
    new PylonPreviewFrameEncoder(),
    lighting,
    new ForensicCaptureWriter(outputRoot),
    "pylon-worker-1",
    workerEpoch,
    nativeModeEnabled: true);
var server = new NativeCameraProtocolServer(
    worker,
    lighting,
    Console.OpenStandardInput(),
    Console.OpenStandardOutput(),
    Console.Error);
return await server.RunAsync(CancellationToken.None).ConfigureAwait(false);
#else
_ = permit;
return 64;
#endif
}
catch
{
    Console.Error.WriteLine("pylon_worker_startup_failed");
    return 64;
}
