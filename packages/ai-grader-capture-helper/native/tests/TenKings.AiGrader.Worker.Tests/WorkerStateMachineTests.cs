using System.Security.Cryptography;
using TenKings.AiGrader.Worker.Core;
using TenKings.AiGrader.Worker.Host;

namespace TenKings.AiGrader.Worker.Tests;

public sealed class WorkerStateMachineTests
{
    [Fact]
    public async Task PersistentCameraTraversesPreviewCaptureResumeWithOneOpen()
    {
        using var temporary = new TemporaryDirectory();
        var camera = new FakeCameraBackend(grabDelay: TimeSpan.FromMilliseconds(2));
        var lighting = new FakeLightingCoordinator();
        await using var worker = CreateWorker(camera, lighting, temporary.Path, new ReadyAnalyzer());
        await worker.InitializeAsync("session-1", 7, CancellationToken.None);
        await worker.StartPreviewAsync(1, 60, 85, CancellationToken.None);
        var preview = await worker.ReadLatestPreviewAsync(new CancellationTokenSource(TimeSpan.FromSeconds(3)).Token);
        Assert.Equal(preview.FrameId, preview.Geometry.FrameId);
        Assert.Equal(preview.BlockId, preview.Geometry.BlockId);
        Assert.Equal(preview.Epochs, preview.Geometry.Epochs);
        await worker.StopAndDrainAsync(CancellationToken.None);
        await worker.SetSideAsync(CardSide.Front, 1, CancellationToken.None);

        var result = await worker.ExecuteForensicSidePlanAsync(Plan(worker, "capture-1", ForensicCaptureProfile.FullForensic), CancellationToken.None);
        Assert.Equal(11, result.Artifacts.Count);
        Assert.Equal(ForensicRoles.Required, result.Artifacts.Select(static artifact => artifact.Role));
        Assert.All(result.Artifacts, artifact =>
        {
            Assert.Equal("image/png", artifact.MimeType);
            Assert.Equal(64, artifact.Sha256.Length);
            Assert.True(artifact.ByteSize > 0);
            Assert.DoesNotContain("\\", artifact.FileName);
            Assert.DoesNotContain("/", artifact.FileName);
        });
        Assert.Equal(11, lighting.AuthorizationCount);
        var allOn = result.Artifacts.Single(static artifact => artifact.Role == "all_on");
        Assert.Equal(allOn.FrameId, result.AuthoritativeAllOnGeometry.FrameId);
        Assert.Equal(allOn.Sha256, result.AuthoritativeTransform.SourceSha256);
        Assert.Equal("all_on", result.AuthoritativeTransform.SourceRole);
        Assert.Equal(9, result.AuthoritativeTransform.Homography.Count);
        Assert.Equal(ForensicRoles.Required.Skip(2), result.AuthoritativeTransform.ReusedByRoles);
        Assert.True(result.SafeOffCompleted);
        Assert.Equal(1, camera.OpenCount);

        await worker.ResumePreviewAsync(2, 60, 85, CancellationToken.None);
        _ = await worker.ReadLatestPreviewAsync(new CancellationTokenSource(TimeSpan.FromSeconds(3)).Token);
        Assert.Equal(1, camera.OpenCount);
        await worker.ShutdownAsync(CancellationToken.None);
        Assert.Equal(1, camera.CloseCount);
        Assert.Equal(WorkerState.Shutdown, worker.State);
    }

    [Fact]
    public async Task DefaultFakeCardSceneCompletesAuthoritativeCaptureWithRealDetector()
    {
        using var temporary = new TemporaryDirectory();
        var camera = new FakeCameraBackend();
        var lighting = new FakeLightingCoordinator();
        await using var worker = new NativeCameraWorker(
            camera,
            new VisionFrameAnalyzer(),
            new TestJpegEncoder(),
            lighting,
            new ForensicCaptureWriter(temporary.Path),
            "worker-real-detector",
            1,
            true);
        await worker.InitializeAsync("session-real-detector", 1, CancellationToken.None);
        await worker.SetSideAsync(CardSide.Front, 1, CancellationToken.None);
        await worker.StartPreviewAsync(1, 15, 85, CancellationToken.None);
        _ = await worker.ReadLatestPreviewAsync(new CancellationTokenSource(TimeSpan.FromSeconds(5)).Token);
        await worker.StopAndDrainAsync(CancellationToken.None);

        var result = await worker.ExecuteForensicSidePlanAsync(
            Plan(worker, "capture-real-detector", ForensicCaptureProfile.FullForensic),
            new CancellationTokenSource(TimeSpan.FromSeconds(15)).Token);

        Assert.Equal(11, result.Artifacts.Count);
        Assert.Equal("all_on", result.AuthoritativeTransform.SourceRole);
        Assert.Equal(result.Artifacts.Single(static artifact => artifact.Role == "all_on").FrameId, result.AuthoritativeAllOnGeometry.FrameId);
        Assert.Equal(9, result.AuthoritativeTransform.Homography.Count);
        Assert.True(result.AuthoritativeAllOnGeometry.Metrics.FullVisibility);
    }

    [Fact]
    public async Task InvalidTransitionFaultsAndSafeOffs()
    {
        using var temporary = new TemporaryDirectory();
        var camera = new FakeCameraBackend();
        var lighting = new FakeLightingCoordinator();
        await using var worker = CreateWorker(camera, lighting, temporary.Path);
        await worker.InitializeAsync("session-2", 1, CancellationToken.None);
        await Assert.ThrowsAsync<InvalidOperationException>(() => worker.StopAndDrainAsync(CancellationToken.None).AsTask());
        Assert.Equal(WorkerState.TerminalFault, worker.State);
        Assert.True(lighting.SafeOffCount >= 1);
        Assert.False(camera.IsOpen);
    }

    [Fact]
    public async Task CameraLossDuringCaptureIsTerminalAndSafeOffsWithoutFallback()
    {
        using var temporary = new TemporaryDirectory();
        var camera = new FakeCameraBackend();
        var lighting = new FakeLightingCoordinator();
        await using var worker = CreateWorker(camera, lighting, temporary.Path);
        await worker.InitializeAsync("session-loss", 1, CancellationToken.None);
        await worker.StartPreviewAsync(1, 30, 85, CancellationToken.None);
        await worker.StopAndDrainAsync(CancellationToken.None);
        await worker.SetSideAsync(CardSide.Front, 1, CancellationToken.None);
        camera.FailOnGrabNumber = camera.GrabCount + 1;

        await Assert.ThrowsAsync<IOException>(() => worker.ExecuteForensicSidePlanAsync(
            Plan(worker, "capture-loss", ForensicCaptureProfile.FullForensic), CancellationToken.None).AsTask());

        Assert.Equal(WorkerState.TerminalFault, worker.State);
        Assert.True(lighting.SafeOffCount >= 1);
        Assert.Equal(1, camera.OpenCount);
        Assert.False(camera.IsOpen);
    }

    [Fact]
    public async Task IncoherentAllOnGeometryTerminallyFailsTransformProvenance()
    {
        using var temporary = new TemporaryDirectory();
        var camera = new FakeCameraBackend();
        var lighting = new FakeLightingCoordinator();
        await using var worker = CreateWorker(camera, lighting, temporary.Path, new RecordingAnalyzer());
        await worker.InitializeAsync("session-no-geometry", 1, CancellationToken.None);
        await worker.StartPreviewAsync(1, 30, 85, CancellationToken.None);
        await worker.StopAndDrainAsync(CancellationToken.None);
        await worker.SetSideAsync(CardSide.Front, 1, CancellationToken.None);

        var error = await Assert.ThrowsAsync<InvalidDataException>(() => worker.ExecuteForensicSidePlanAsync(
            Plan(worker, "capture-no-geometry", ForensicCaptureProfile.FullForensic), CancellationToken.None).AsTask());

        Assert.Contains("authoritative_all_on_geometry", error.Message, StringComparison.Ordinal);
        Assert.Equal(WorkerState.TerminalFault, worker.State);
        Assert.True(lighting.SafeOffCount >= 1);
    }

    [Fact]
    public async Task PreviewCommandCancellationDoesNotCancelPersistentPreview()
    {
        using var temporary = new TemporaryDirectory();
        var camera = new FakeCameraBackend(grabDelay: TimeSpan.FromMilliseconds(4));
        await using var worker = CreateWorker(camera, new FakeLightingCoordinator(), temporary.Path);
        await worker.InitializeAsync("session-3", 1, CancellationToken.None);
        using (var command = new CancellationTokenSource())
        {
            await worker.StartPreviewAsync(1, 60, 85, command.Token);
            command.Cancel();
        }

        _ = await worker.ReadLatestPreviewAsync(new CancellationTokenSource(TimeSpan.FromSeconds(3)).Token);
        Assert.Equal(WorkerState.Previewing, worker.State);
    }

    [Fact]
    public async Task FakePreviewHonorsRequestedMaximumCadence()
    {
        using var temporary = new TemporaryDirectory();
        await using var worker = CreateWorker(new FakeCameraBackend(), new FakeLightingCoordinator(), temporary.Path);
        await worker.InitializeAsync("session-cadence", 1, CancellationToken.None);
        await worker.StartPreviewAsync(1, 5, 85, CancellationToken.None);
        var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        var first = await worker.ReadLatestPreviewAsync(timeout.Token);
        var second = await worker.ReadLatestPreviewAsync(timeout.Token);
        var receiveDeltaMs = (second.ReceiveMonotonicTicks - first.ReceiveMonotonicTicks) * 1000d / System.Diagnostics.Stopwatch.Frequency;
        Assert.True(receiveDeltaMs >= 140, $"Expected <=5fps cadence; observed {receiveDeltaMs:F1}ms.");
    }

    [Fact]
    public async Task FrozenFrameImmediatelyLosesReady()
    {
        using var temporary = new TemporaryDirectory();
        var frozen = FakeCameraBackend.CreateGradientFrame(1, 160, 224);
        var camera = new FakeCameraBackend(frameFactory: _ => frozen with
        {
            Mono8 = (byte[])frozen.Mono8.Clone(),
            MonotonicReceiveTicks = MonotonicClock.NowTicks,
            ReceiveTimestampUtc = DateTimeOffset.UtcNow,
        });
        await using var worker = CreateWorker(camera, new FakeLightingCoordinator(), temporary.Path, new ReadyAnalyzer());
        await worker.InitializeAsync("session-4", 1, CancellationToken.None);
        await worker.SetSideAsync(CardSide.Back, 1, CancellationToken.None);
        await worker.StartPreviewAsync(1, 60, 85, CancellationToken.None);
        var first = await worker.ReadLatestPreviewAsync(new CancellationTokenSource(TimeSpan.FromSeconds(3)).Token);
        Assert.Equal("ready", first.Geometry.Status);

        PreviewFrameResult second;
        do
        {
            second = await worker.ReadLatestPreviewAsync(new CancellationTokenSource(TimeSpan.FromSeconds(3)).Token);
        }
        while (!second.Frozen);
        Assert.Equal("not_detected", second.Geometry.Status);
        Assert.Contains("frozen_frame", second.Geometry.ReasonCodes);
        Assert.True(second.Geometry.Stale);
    }

    [Fact]
    public async Task EpochAdvanceResetsAnalyzer()
    {
        using var temporary = new TemporaryDirectory();
        var analyzer = new RecordingAnalyzer();
        await using var worker = CreateWorker(new FakeCameraBackend(), new FakeLightingCoordinator(), temporary.Path, analyzer);
        await worker.InitializeAsync("session-5", 1, CancellationToken.None);
        await worker.SetSideAsync(CardSide.Front, 1, CancellationToken.None);
        await worker.StartPreviewAsync(1, 60, 85, CancellationToken.None);
        _ = await worker.ReadLatestPreviewAsync(new CancellationTokenSource(TimeSpan.FromSeconds(3)).Token);
        await worker.StopAndDrainAsync(CancellationToken.None);
        await worker.SetSideAsync(CardSide.Back, 2, CancellationToken.None);
        Assert.Contains("side_epoch_changed", analyzer.ResetReasons);
    }

    [Fact]
    public async Task LatestQueueDropsUnreadFramesAndReturnsNewest()
    {
        using var queue = new LatestFrameQueue<Box>();
        queue.Publish(new Box(1));
        queue.Publish(new Box(2));
        queue.Publish(new Box(3));
        Assert.Equal(2, queue.Dropped);
        Assert.Equal(3, (await queue.ReadAsync(CancellationToken.None)).Value);
    }

    [Fact]
    public void MissingDuplicateAndOutOfOrderRolesAreRejected()
    {
        var epochs = new Epochs(1, 1, 1, 1);
        Assert.Throws<InvalidDataException>(() => ForensicPlanValidator.Validate(
            new ForensicSidePlan("request-1", "capture-1", CardSide.Front, epochs, ForensicCaptureProfile.FullForensic, ForensicRoles.Required.Take(10).ToArray())));
        var duplicate = ForensicRoles.Required.ToArray();
        duplicate[10] = duplicate[9];
        Assert.Throws<InvalidDataException>(() => ForensicPlanValidator.Validate(
            new ForensicSidePlan("request-1", "capture-1", CardSide.Front, epochs, ForensicCaptureProfile.FullForensic, duplicate)));
        Assert.Throws<InvalidDataException>(() => ForensicPlanValidator.Validate(
            new ForensicSidePlan("request-1", "capture-1", CardSide.Front, epochs, ForensicCaptureProfile.FullForensic, ForensicRoles.Required.Reverse().ToArray())));
    }

    [Theory]
    [InlineData(ForensicCaptureProfile.FullForensic, "image/png", "89504E470D0A1A0A")]
    [InlineData(ForensicCaptureProfile.ProductionFast, "image/tiff", "49492A00")]
    public async Task ForensicWritesAreLosslessHashedAtomicAndNoOverwrite(ForensicCaptureProfile profile, string mime, string headerHex)
    {
        using var temporary = new TemporaryDirectory();
        var writer = new ForensicCaptureWriter(temporary.Path);
        var frame = FakeCameraBackend.CreateGradientFrame(1, 64, 96);
        var artifact = await writer.WriteAsync("session-safe", CardSide.Front, "dark_control", profile, frame, 1, CancellationToken.None);
        var path = Directory.GetFiles(temporary.Path, artifact.FileName, SearchOption.AllDirectories).Single();
        var bytes = await File.ReadAllBytesAsync(path);
        Assert.Equal(mime, artifact.MimeType);
        Assert.StartsWith(headerHex, Convert.ToHexString(bytes), StringComparison.Ordinal);
        Assert.Equal(Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), artifact.Sha256);
        Assert.Equal(bytes.LongLength, artifact.ByteSize);
        Assert.Equal(frame.ReceiveTimestampUtc, artifact.ReceiveTimestampUtc);
        Assert.Empty(Directory.GetFiles(temporary.Path, "*.tmp", SearchOption.AllDirectories));
        await Assert.ThrowsAsync<IOException>(() => writer.WriteAsync("session-safe", CardSide.Front, "dark_control", profile, frame, 1, CancellationToken.None).AsTask());
    }

    private static NativeCameraWorker CreateWorker(FakeCameraBackend camera, FakeLightingCoordinator lighting, string output, IFrameAnalyzer? analyzer = null) => new(
        camera, analyzer ?? new RecordingAnalyzer(), new TestJpegEncoder(), lighting, new ForensicCaptureWriter(output), "worker-1", 1, true);

    private static ForensicSidePlan Plan(NativeCameraWorker worker, string captureId, ForensicCaptureProfile profile) =>
        new("request-1", captureId, worker.Side, worker.Epochs, profile, ForensicRoles.Required);

    private sealed record Box(int Value);

    private sealed class TestJpegEncoder : IPreviewFrameEncoder
    {
        public int JpegQuality => 85;
        public ValueTask<PreviewJpeg> EncodeJpegAsync(CameraFrame frame, CancellationToken cancellationToken) =>
            ValueTask.FromResult(new PreviewJpeg([0xff, 0xd8, (byte)frame.Sequence, 0xff, 0xd9], frame.Width, frame.Height));
    }

    private class RecordingAnalyzer : IFrameAnalyzer
    {
        public List<string> ResetReasons { get; } = [];
        public virtual ValueTask<GeometryResult> AnalyzeAsync(CameraFrame frame, Epochs epochs, CardSide side, long droppedFrames, CancellationToken cancellationToken) =>
            ValueTask.FromResult(GeometryResult.NotDetected(frame, epochs, side, "no_gradient_supported_edges", droppedFrames));
        public void Reset(Epochs epochs, CardSide side, string reason) => ResetReasons.Add(reason);
    }

    private sealed class ReadyAnalyzer : RecordingAnalyzer
    {
        public override ValueTask<GeometryResult> AnalyzeAsync(CameraFrame frame, Epochs epochs, CardSide side, long droppedFrames, CancellationToken cancellationToken)
        {
            var corners = new[] { new PointD(20, 20), new PointD(140, 20), new PointD(140, 204), new PointD(20, 204) };
            return ValueTask.FromResult(GeometryResult.NotDetected(frame, epochs, side, "none", droppedFrames) with
            {
                Status = "ready", ReasonCodes = ["none"], SourceCorners = corners, NormalizedCorners = corners,
                FittedLines = [new LineD(0, 1, -20), new LineD(1, 0, -140), new LineD(0, 1, -204), new LineD(1, 0, -20)],
                SourceToNormalizedHomography = [1, 0, 0, 0, 1, 0, 0, 0, 1],
                Confidence = 0.9, Metrics = new GeometryMetrics([], 1, 0.6, 1, 1, 1, 1, true),
                Hysteresis = new HysteresisEvidence(3, 3, true, string.Empty),
            });
        }
    }
}

internal sealed class TemporaryDirectory : IDisposable
{
    public TemporaryDirectory()
    {
        Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"tenkings-native-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path);
    }

    public string Path { get; }
    public void Dispose()
    {
        if (Directory.Exists(Path)) Directory.Delete(Path, recursive: true);
    }
}
