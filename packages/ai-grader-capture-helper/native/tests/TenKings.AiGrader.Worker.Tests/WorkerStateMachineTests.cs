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
        await worker.InitializeAsync("session-1", 7, RigConfigurationDefaults.SafeFakeExpectation, CancellationToken.None);
        await worker.StartPreviewAsync(1, CancellationToken.None);
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

        await worker.ResumePreviewAsync(2, CancellationToken.None);
        _ = await worker.ReadLatestPreviewAsync(new CancellationTokenSource(TimeSpan.FromSeconds(3)).Token);
        Assert.Equal(1, camera.OpenCount);
        await worker.SafeIdleAsync(CancellationToken.None);
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
        await worker.InitializeAsync("session-real-detector", 1, RigConfigurationDefaults.SafeFakeExpectation, CancellationToken.None);
        await worker.SetSideAsync(CardSide.Front, 1, CancellationToken.None);
        await worker.StartPreviewAsync(1, CancellationToken.None);
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
        await worker.InitializeAsync("session-2", 1, RigConfigurationDefaults.SafeFakeExpectation, CancellationToken.None);
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
        await worker.InitializeAsync("session-loss", 1, RigConfigurationDefaults.SafeFakeExpectation, CancellationToken.None);
        await worker.StartPreviewAsync(1, CancellationToken.None);
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

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    [InlineData(9)]
    [InlineData(10)]
    [InlineData(11)]
    public async Task FailureAfterEveryStagedRoleSafeOffsLeavesNoFinalAndFreshRetrySucceeds(int failAfterRole)
    {
        using var temporary = new TemporaryDirectory();
        var sessionId = $"session-role-{failAfterRole}";
        var captureId = $"capture-role-{failAfterRole}";
        var failedLighting = new FakeLightingCoordinator();
        await using (var failedWorker = CreateWorker(new FakeCameraBackend(), failedLighting, temporary.Path, new ReadyAnalyzer()))
        {
            await PrepareForCaptureAsync(failedWorker, sessionId);
            failedWorker.ForensicRoleStagedTestHook = (count, _) => count == failAfterRole
                ? ValueTask.FromException(new IOException("injected_after_staged_role"))
                : ValueTask.CompletedTask;

            await Assert.ThrowsAsync<IOException>(() => failedWorker.ExecuteForensicSidePlanAsync(
                Plan(failedWorker, captureId, ForensicCaptureProfile.FullForensic), CancellationToken.None).AsTask());

            Assert.Equal(WorkerState.TerminalFault, failedWorker.State);
            Assert.True(failedLighting.SafeOffCount >= 1);
        }

        Assert.Empty(Directory.GetFiles(temporary.Path, "manifest.json", SearchOption.AllDirectories));

        var retryLighting = new FakeLightingCoordinator();
        await using var retryWorker = CreateWorker(new FakeCameraBackend(), retryLighting, temporary.Path, new ReadyAnalyzer());
        await PrepareForCaptureAsync(retryWorker, sessionId);
        var retry = await retryWorker.ExecuteForensicSidePlanAsync(
            Plan(retryWorker, captureId, ForensicCaptureProfile.FullForensic), CancellationToken.None);

        Assert.Equal(11, retry.Artifacts.Count);
        Assert.False(retry.Package.Idempotent);
        Assert.True(retry.SafeOffCompleted);
        Assert.Single(Directory.GetFiles(temporary.Path, "manifest.json", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task IncoherentAllOnGeometryTerminallyFailsTransformProvenance()
    {
        using var temporary = new TemporaryDirectory();
        var camera = new FakeCameraBackend();
        var lighting = new FakeLightingCoordinator();
        await using var worker = CreateWorker(camera, lighting, temporary.Path, new RecordingAnalyzer());
        await worker.InitializeAsync("session-no-geometry", 1, RigConfigurationDefaults.SafeFakeExpectation, CancellationToken.None);
        await worker.StartPreviewAsync(1, CancellationToken.None);
        await worker.StopAndDrainAsync(CancellationToken.None);
        await worker.SetSideAsync(CardSide.Front, 1, CancellationToken.None);

        var error = await Assert.ThrowsAsync<InvalidDataException>(() => worker.ExecuteForensicSidePlanAsync(
            Plan(worker, "capture-no-geometry", ForensicCaptureProfile.FullForensic), CancellationToken.None).AsTask());

        Assert.Contains("authoritative_all_on_geometry", error.Message, StringComparison.Ordinal);
        Assert.Equal(WorkerState.TerminalFault, worker.State);
        Assert.True(lighting.SafeOffCount >= 1);
    }

    [Theory]
    [InlineData("missing_block_id")]
    [InlineData("source_corner_outside_frame")]
    public async Task UnsafeExactFrameAuthorityTerminallySafeOffsBeforeEvidenceCommit(string variant)
    {
        using var temporary = new TemporaryDirectory();
        var lighting = new FakeLightingCoordinator();
        await using var worker = CreateWorker(
            new FakeCameraBackend(),
            lighting,
            temporary.Path,
            new UnsafeReadyAnalyzer(variant));
        await PrepareForCaptureAsync(worker, $"session-unsafe-{variant}");

        await Assert.ThrowsAsync<InvalidDataException>(() => worker.ExecuteForensicSidePlanAsync(
            Plan(worker, $"capture-unsafe-{variant}", ForensicCaptureProfile.FullForensic),
            CancellationToken.None).AsTask());

        Assert.Equal(WorkerState.TerminalFault, worker.State);
        Assert.True(lighting.SafeOffCount >= 1);
        Assert.Empty(Directory.GetFiles(temporary.Path, "manifest.json", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task PreviewCommandCancellationDoesNotCancelPersistentPreview()
    {
        using var temporary = new TemporaryDirectory();
        var camera = new FakeCameraBackend(grabDelay: TimeSpan.FromMilliseconds(4));
        await using var worker = CreateWorker(camera, new FakeLightingCoordinator(), temporary.Path);
        await worker.InitializeAsync("session-3", 1, RigConfigurationDefaults.SafeFakeExpectation, CancellationToken.None);
        using (var command = new CancellationTokenSource())
        {
            await worker.StartPreviewAsync(1, command.Token);
            command.Cancel();
        }

        _ = await worker.ReadLatestPreviewAsync(new CancellationTokenSource(TimeSpan.FromSeconds(3)).Token);
        Assert.Equal(WorkerState.Previewing, worker.State);
    }

    [Fact]
    public async Task FakePreviewHonorsDigestBoundRigCadence()
    {
        using var temporary = new TemporaryDirectory();
        await using var worker = CreateWorker(new FakeCameraBackend(), new FakeLightingCoordinator(), temporary.Path);
        await worker.InitializeAsync("session-cadence", 1, RigConfigurationDefaults.SafeFakeExpectation, CancellationToken.None);
        await worker.StartPreviewAsync(1, CancellationToken.None);
        var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        var first = await worker.ReadLatestPreviewAsync(timeout.Token);
        var second = await worker.ReadLatestPreviewAsync(timeout.Token);
        var receiveDeltaMs = (second.ReceiveMonotonicTicks - first.ReceiveMonotonicTicks) * 1000d / System.Diagnostics.Stopwatch.Frequency;
        var configuredIntervalMs = 1000d / RigConfigurationDefaults.SafeFakeConfiguration.Preview.FramesPerSecond;
        Assert.True(
            receiveDeltaMs >= configuredIntervalMs * 0.70,
            $"Expected digest-bound {configuredIntervalMs:F1}ms cadence; observed {receiveDeltaMs:F1}ms.");
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
        await worker.InitializeAsync("session-4", 1, RigConfigurationDefaults.SafeFakeExpectation, CancellationToken.None);
        await worker.SetSideAsync(CardSide.Back, 1, CancellationToken.None);
        await worker.StartPreviewAsync(1, CancellationToken.None);
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
        await worker.InitializeAsync("session-5", 1, RigConfigurationDefaults.SafeFakeExpectation, CancellationToken.None);
        await worker.SetSideAsync(CardSide.Front, 1, CancellationToken.None);
        await worker.StartPreviewAsync(1, CancellationToken.None);
        _ = await worker.ReadLatestPreviewAsync(new CancellationTokenSource(TimeSpan.FromSeconds(3)).Token);
        await worker.StopAndDrainAsync(CancellationToken.None);
        await worker.SetSideAsync(CardSide.Back, 2, CancellationToken.None);
        Assert.Contains("side_epoch_changed", analyzer.ResetReasons);
    }

    [Fact]
    public async Task SideEpochCannotChangeWhilePreviewFrameIsInFlight()
    {
        using var temporary = new TemporaryDirectory();
        var lighting = new FakeLightingCoordinator();
        await using var worker = CreateWorker(
            new FakeCameraBackend(grabDelay: TimeSpan.FromMilliseconds(40)),
            lighting,
            temporary.Path,
            new ReadyAnalyzer());
        await worker.InitializeAsync("session-side-fence", 1, RigConfigurationDefaults.SafeFakeExpectation, CancellationToken.None);
        await worker.SetSideAsync(CardSide.Front, 1, CancellationToken.None);
        await worker.StartPreviewAsync(1, CancellationToken.None);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            worker.SetSideAsync(CardSide.Back, 2, CancellationToken.None).AsTask());

        Assert.Equal(WorkerState.TerminalFault, worker.State);
        Assert.Equal(CardSide.Front, worker.Side);
        Assert.Equal(1, worker.Epochs.SideEpoch);
        Assert.True(lighting.SafeOffCount >= 1);
    }

    [Fact]
    public async Task FrozenPreviewRejectionPreservesLoadedAnalyzerAttestation()
    {
        using var temporary = new TemporaryDirectory();
        var frozen = FakeCameraBackend.CreateGradientFrame(1, 160, 224);
        var camera = new FakeCameraBackend(frameFactory: _ => frozen with
        {
            Mono8 = (byte[])frozen.Mono8.Clone(),
            MonotonicReceiveTicks = MonotonicClock.NowTicks,
            ReceiveTimestampUtc = DateTimeOffset.UtcNow,
        });
        await using var worker = CreateWorker(
            camera,
            new FakeLightingCoordinator(),
            temporary.Path,
            new NonFakeAttestedAnalyzer());
        await worker.InitializeAsync("session-frozen-attestation", 1, RigConfigurationDefaults.SafeFakeExpectation, CancellationToken.None);
        await worker.SetSideAsync(CardSide.Front, 1, CancellationToken.None);
        await worker.StartPreviewAsync(1, CancellationToken.None);
        _ = await worker.ReadLatestPreviewAsync(new CancellationTokenSource(TimeSpan.FromSeconds(3)).Token);

        PreviewFrameResult frozenPreview;
        do
        {
            frozenPreview = await worker.ReadLatestPreviewAsync(new CancellationTokenSource(TimeSpan.FromSeconds(3)).Token);
        }
        while (!frozenPreview.Frozen);

        Assert.Equal(NonFakeAttestedAnalyzer.CalibrationIdValue, frozenPreview.Geometry.CalibrationId);
        Assert.Equal(NonFakeAttestedAnalyzer.CalibrationDigestValue, frozenPreview.Geometry.CalibrationSha256);
        Assert.Equal(90, frozenPreview.Geometry.SensorOrientation?.SensorToPortraitRotationDegrees);
        Assert.False(frozenPreview.Geometry.CurrentFrameAuthority.CaptureReady);
        Assert.Empty(frozenPreview.Geometry.SourceCorners);
        Assert.Contains("frozen_frame", frozenPreview.Geometry.ReasonCodes);
    }

    [Fact]
    public async Task BackendAndQueueDropsAreCombinedWithoutLosingGeometryCoherence()
    {
        using var temporary = new TemporaryDirectory();
        var camera = new FakeCameraBackend(frameFactory: sequence =>
            FakeCameraBackend.CreateGradientFrame(sequence, 160, 224) with { SourceDroppedFrames = 7 });
        await using var worker = CreateWorker(camera, new FakeLightingCoordinator(), temporary.Path);
        await worker.InitializeAsync("session-source-drops", 1, RigConfigurationDefaults.SafeFakeExpectation, CancellationToken.None);
        await worker.SetSideAsync(CardSide.Front, 1, CancellationToken.None);
        await worker.StartPreviewAsync(1, CancellationToken.None);

        var preview = await worker.ReadLatestPreviewAsync(new CancellationTokenSource(TimeSpan.FromSeconds(3)).Token);

        Assert.True(preview.DroppedFrames >= 7);
        Assert.Equal(preview.DroppedFrames, preview.Geometry.DroppedFrames);
        Assert.True(worker.GetHealth().PreviewDrops >= 7);
    }

    [Fact]
    public async Task ConcurrentShutdownAbortsCaptureBeforeAtomicCommit()
    {
        using var temporary = new TemporaryDirectory();
        var lighting = new FakeLightingCoordinator();
        await using var worker = CreateWorker(new FakeCameraBackend(), lighting, temporary.Path, new ReadyAnalyzer());
        await PrepareForCaptureAsync(worker, "session-shutdown-fence");
        var staged = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        worker.ForensicRoleStagedTestHook = async (count, cancellationToken) =>
        {
            if (count != 1)
            {
                return;
            }

            staged.TrySetResult();
            await release.Task.WaitAsync(cancellationToken);
        };

        var captureTask = worker.ExecuteForensicSidePlanAsync(
            Plan(worker, "capture-shutdown-fence", ForensicCaptureProfile.FullForensic),
            CancellationToken.None).AsTask();
        await staged.Task.WaitAsync(TimeSpan.FromSeconds(3));
        var shutdownTask = worker.ShutdownAsync(CancellationToken.None).AsTask();
        release.TrySetResult();

        await Assert.ThrowsAnyAsync<Exception>(() => captureTask);
        await Assert.ThrowsAnyAsync<Exception>(() => shutdownTask);
        Assert.Equal(WorkerState.TerminalFault, worker.State);
        Assert.True(lighting.SafeOffCount >= 1);
        Assert.Empty(Directory.GetFiles(temporary.Path, "manifest.json", SearchOption.AllDirectories));
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
    public async Task LatestQueueClearRaceNeverSurfacesAnEmptySignal()
    {
        using var queue = new LatestFrameQueue<Box>();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        for (var index = 0; index < 500; index++)
        {
            var read = queue.ReadAsync(timeout.Token).AsTask();
            await Task.Run(() =>
            {
                queue.Publish(new Box((index * 2) + 1));
                queue.Clear();
                queue.Publish(new Box((index * 2) + 2));
            }, timeout.Token);

            var value = await read;
            Assert.InRange(value.Value, (index * 2) + 1, (index * 2) + 2);
            queue.Clear();
        }
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
    public async Task ForensicStagingIsLosslessHashedAndNeverExposedAsFinal(ForensicCaptureProfile profile, string mime, string headerHex)
    {
        using var temporary = new TemporaryDirectory();
        var writer = new ForensicCaptureWriter(temporary.Path);
        var frame = FakeCameraBackend.CreateGradientFrame(1, 64, 96);
        var plan = new ForensicSidePlan(
            "request-stage",
            "capture-stage",
            CardSide.Front,
            new Epochs(1, 1, 1, 1),
            profile,
            ForensicRoles.Required);
        await using var package = await writer.BeginPackageAsync("session-safe", plan, CancellationToken.None);
        var artifact = await package.StageRoleAsync("dark_control", frame, 1, CancellationToken.None);
        var path = Directory.GetFiles(temporary.Path, artifact.FileName, SearchOption.AllDirectories).Single();
        var bytes = await File.ReadAllBytesAsync(path);
        Assert.Equal(mime, artifact.MimeType);
        Assert.StartsWith(headerHex, Convert.ToHexString(bytes), StringComparison.Ordinal);
        Assert.Equal(Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), artifact.Sha256);
        Assert.Equal(bytes.LongLength, artifact.ByteSize);
        Assert.Equal(frame.ReceiveTimestampUtc, artifact.ReceiveTimestampUtc);
        Assert.Empty(Directory.GetFiles(temporary.Path, "*.tmp", SearchOption.AllDirectories));
        Assert.Empty(Directory.GetFiles(temporary.Path, "manifest.json", SearchOption.AllDirectories));
        await Assert.ThrowsAsync<InvalidDataException>(() => package.StageRoleAsync("dark_control", frame, 1, CancellationToken.None).AsTask());
    }

    private static NativeCameraWorker CreateWorker(FakeCameraBackend camera, FakeLightingCoordinator lighting, string output, IFrameAnalyzer? analyzer = null) => new(
        camera, analyzer ?? new RecordingAnalyzer(), new TestJpegEncoder(), lighting, new ForensicCaptureWriter(output), "worker-1", 1, true);

    private static async Task PrepareForCaptureAsync(NativeCameraWorker worker, string sessionId)
    {
        await worker.InitializeAsync(sessionId, 1, RigConfigurationDefaults.SafeFakeExpectation, CancellationToken.None);
        await worker.SetSideAsync(CardSide.Front, 1, CancellationToken.None);
        await worker.StartPreviewAsync(1, CancellationToken.None);
        await worker.StopAndDrainAsync(CancellationToken.None);
    }

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
        public virtual ValueTask<GeometryResult> AnalyzeForensicCurrentFrameAsync(
            CameraFrame frame,
            Epochs epochs,
            CardSide side,
            long droppedFrames,
            CancellationToken cancellationToken) =>
            AnalyzeAsync(frame, epochs, side, droppedFrames, cancellationToken);
        public void Reset(Epochs epochs, CardSide side, string reason) => ResetReasons.Add(reason);
    }

    private class ReadyAnalyzer : RecordingAnalyzer
    {
        public override ValueTask<GeometryResult> AnalyzeAsync(CameraFrame frame, Epochs epochs, CardSide side, long droppedFrames, CancellationToken cancellationToken)
        {
            var corners = new[] { new PointD(160, 160), new PointD(480, 160), new PointD(480, 608), new PointD(160, 608) };
            var normalized = new[] { new PointD(0, 0), new PointD(1199, 0), new PointD(1199, 1679), new PointD(0, 1679) };
            var scaleX = 1199d / 320;
            var scaleY = 1679d / 448;
            var attestation = RigConfigurationDefaults.SafeFakeAttestation;
            return ValueTask.FromResult(GeometryResult.NotDetected(frame, epochs, side, "none", droppedFrames) with
            {
                Status = "ready", ReasonCodes = ["none"], SourceCorners = corners, NormalizedCorners = normalized,
                FittedLines = [new LineD(0, 1, -160), new LineD(1, 0, -480), new LineD(0, 1, -608), new LineD(1, 0, -160)],
                SourceToNormalizedHomography = [scaleX, 0, -160 * scaleX, 0, scaleY, -160 * scaleY, 0, 0, 1],
                Confidence = 0.9,
                Metrics = new GeometryMetrics(
                    Enumerable.Range(0, 4).Select(_ => new EdgeEvidence(0.9, 0.9, 1, false)).ToArray(),
                    1,
                    0.25,
                    1,
                    1,
                    1,
                    1,
                    true)
                {
                    AspectRatio = 1.4,
                    ClearanceFraction = 0.17,
                    PerspectiveSkew = 0,
                    EdgeSupportScore = 0.9,
                    ContinuityScore = 0.9,
                    MeanResidualPixels = 1,
                },
                CalibrationId = attestation.CalibrationId,
                CalibrationSha256 = attestation.CalibrationSha256,
                SensorOrientation = new SensorOrientationResult(0, false, false, false, false),
                CurrentFrameAuthority = new CurrentFrameAuthorityResult(true, true, []),
                Hysteresis = new HysteresisEvidence(3, 3, true, string.Empty),
            });
        }
    }

    private sealed class NonFakeAttestedAnalyzer : ReadyAnalyzer
    {
        public const string CalibrationIdValue = "non-fake-preview-calibration";
        public const string CalibrationDigestValue = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

        public override async ValueTask<GeometryResult> AnalyzeAsync(
            CameraFrame frame,
            Epochs epochs,
            CardSide side,
            long droppedFrames,
            CancellationToken cancellationToken)
        {
            var geometry = await base.AnalyzeAsync(frame, epochs, side, droppedFrames, cancellationToken);
            return geometry with
            {
                CalibrationId = CalibrationIdValue,
                CalibrationSha256 = CalibrationDigestValue,
                SensorOrientation = new SensorOrientationResult(90, false, false, false, false),
            };
        }
    }

    private sealed class UnsafeReadyAnalyzer(string variant) : ReadyAnalyzer
    {
        public override async ValueTask<GeometryResult> AnalyzeAsync(
            CameraFrame frame,
            Epochs epochs,
            CardSide side,
            long droppedFrames,
            CancellationToken cancellationToken)
        {
            var ready = await base.AnalyzeAsync(frame, epochs, side, droppedFrames, cancellationToken);
            return variant switch
            {
                "missing_block_id" => ready with { BlockId = null },
                "source_corner_outside_frame" => ready with
                {
                    SourceCorners =
                    [
                        new PointD(-1, 160),
                        new PointD(480, 160),
                        new PointD(480, 608),
                        new PointD(-1, 608),
                    ],
                },
                _ => throw new ArgumentOutOfRangeException(nameof(variant)),
            };
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
