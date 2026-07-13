using System.Text;
using System.Text.Json;
using System.Security.Cryptography;
using TenKings.AiGrader.Worker.Core;

namespace TenKings.AiGrader.Worker.Tests;

public sealed class AtomicPackageAndProtocolLifetimeTests
{
    [Theory]
    [InlineData("missing_digest")]
    [InlineData("uppercase_digest")]
    [InlineData("extra_hardware_setting")]
    public async Task InitializeRejectsUntrustedConfigurationPayloadBeforeCameraOpen(string variant)
    {
        using var temporary = new TemporaryDirectory();
        var camera = new FakeCameraBackend();
        var lighting = new FakeLightingCoordinator();
        await using var worker = CreateWorker(camera, lighting, temporary.Path);
        var attestation = camera.LoadedRigConfiguration;
        object payload = variant switch
        {
            "missing_digest" => new { configurationId = attestation.ConfigurationId },
            "uppercase_digest" => new
            {
                configurationId = attestation.ConfigurationId,
                configurationSha256 = attestation.CanonicalSha256.ToUpperInvariant(),
            },
            "extra_hardware_setting" => new
            {
                configurationId = attestation.ConfigurationId,
                configurationSha256 = attestation.CanonicalSha256,
                exposureMicroseconds = 10_000,
            },
            _ => throw new ArgumentOutOfRangeException(nameof(variant)),
        };
        var command = Command("initialize", "request-1", 1, payload) + "\n";
        await using var input = new MemoryStream(Encoding.UTF8.GetBytes(command));
        await using var output = new MemoryStream();
        var server = new NativeCameraProtocolServer(worker, new ProtocolLightingCoordinator(), input, output, TextWriter.Null);

        Assert.Equal(2, await server.RunAsync(CancellationToken.None));
        Assert.Equal(0, camera.OpenCount);
        Assert.Equal(WorkerState.TerminalFault, worker.State);
        Assert.Equal(0, server.ActiveCommandCountForTest);
    }

    [Fact]
    public async Task HighCommandCountKeepsActiveAndDuplicateBookkeepingBounded()
    {
        using var temporary = new TemporaryDirectory();
        var camera = new FakeCameraBackend();
        var lighting = new FakeLightingCoordinator();
        await using var worker = CreateWorker(camera, lighting, temporary.Path);
        var attestation = camera.LoadedRigConfiguration;
        const int healthCount = 600;
        var commands = new List<string>(healthCount + 1)
        {
            Command("initialize", "request-0", 1, new
            {
                configurationId = attestation.ConfigurationId,
                configurationSha256 = attestation.CanonicalSha256,
            }),
        };
        for (var index = 1; index <= healthCount; index++)
        {
            commands.Add(Command("health", $"request-{index}", index + 1, new { }));
        }

        await using var input = new MemoryStream(Encoding.UTF8.GetBytes(string.Join('\n', commands) + "\n"));
        await using var output = new MemoryStream();
        var server = new NativeCameraProtocolServer(worker, new ProtocolLightingCoordinator(), input, output, TextWriter.Null);

        Assert.Equal(0, await server.RunAsync(CancellationToken.None));
        Assert.Equal(healthCount + 1, Encoding.UTF8.GetString(output.ToArray()).Split('\n', StringSplitOptions.RemoveEmptyEntries).Length);
        Assert.Equal(0, server.ActiveCommandCountForTest);
        Assert.Equal(NativeCameraProtocolServer.MaximumRememberedRequests, server.RememberedRequestCountForTest);
        Assert.Equal(1, camera.OpenCount);
    }

    [Fact]
    public async Task InFlightSetIsSynchronizedBoundedAndRemovesCompletedTasks()
    {
        using var temporary = new TemporaryDirectory();
        await using var worker = CreateWorker(new FakeCameraBackend(), new FakeLightingCoordinator(), temporary.Path);
        await using var input = new MemoryStream();
        await using var output = new MemoryStream();
        var server = new NativeCameraProtocolServer(worker, new ProtocolLightingCoordinator(), input, output, TextWriter.Null);
        var gates = Enumerable.Range(0, NativeCameraProtocolServer.MaximumInFlightCommands)
            .Select(_ => new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously))
            .ToArray();
        foreach (var gate in gates)
        {
            server.TrackCommandForTest(gate.Task);
        }

        Assert.Equal(NativeCameraProtocolServer.MaximumInFlightCommands, server.ActiveCommandCountForTest);
        Assert.Throws<InvalidOperationException>(() => server.TrackCommandForTest(Task.CompletedTask));
        foreach (var gate in gates)
        {
            gate.SetResult();
        }

        await Task.WhenAll(gates.Select(gate => gate.Task));
        Assert.True(SpinWait.SpinUntil(() => server.ActiveCommandCountForTest == 0, TimeSpan.FromSeconds(2)));

        server.TrackCommandForTest(Task.FromException(new InvalidOperationException("injected_observed_failure")));
        Assert.True(SpinWait.SpinUntil(() => server.ActiveCommandCountForTest == 0, TimeSpan.FromSeconds(2)));
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
    public async Task AbortAfterEachRoleLeavesNoFinalPackageAndNoOwnedStaging(int completedRoles)
    {
        using var temporary = new TemporaryDirectory();
        var writer = new ForensicCaptureWriter(temporary.Path);
        var plan = Plan("capture-abort", "request-abort");
        var package = await writer.BeginPackageAsync("session-safe", plan, CancellationToken.None);
        for (var index = 0; index < completedRoles; index++)
        {
            await package.StageRoleAsync(
                ForensicRoles.Required[index],
                FakeCameraBackend.CreateGradientFrame(index + 1, 64, 96),
                1,
                CancellationToken.None);
        }

        Assert.False(package.FinalPackageExistsForTest);
        await package.AbortAsync();
        Assert.False(package.FinalPackageExistsForTest);
        Assert.False(package.StagingDirectoryExistsForTest);
        Assert.Empty(Directory.GetFiles(temporary.Path, "manifest.json", SearchOption.AllDirectories));
        Assert.Empty(Directory.GetDirectories(temporary.Path, ".tk-native-stage-v1-*", SearchOption.AllDirectories));

        var retry = await StageCompleteAsync(writer, plan, Frames());
        await using (retry.Package)
        {
            var committed = await retry.Package.CommitAsync(
                ForensicPackageBinding.FromAttestation(RigConfigurationDefaults.SafeFakeAttestation),
                retry.Geometry,
                retry.Transform,
                CancellationToken.None);
            Assert.False(committed.Idempotent);
        }

        Assert.Single(Directory.GetFiles(temporary.Path, "manifest.json", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task CompletePackagePromotesOnceVerifiesManifestAndReturnsPathFreeDigests()
    {
        using var temporary = new TemporaryDirectory();
        var writer = new ForensicCaptureWriter(temporary.Path);
        var plan = Plan("capture-complete", "request-complete");
        var frames = Frames();
        var staged = await StageCompleteAsync(writer, plan, frames);
        await using var package = staged.Package;
        var result = await package.CommitAsync(
            ForensicPackageBinding.FromAttestation(RigConfigurationDefaults.SafeFakeAttestation),
            staged.Geometry,
            staged.Transform,
            CancellationToken.None);

        Assert.False(result.Idempotent);
        Assert.True(package.FinalPackageExistsForTest);
        Assert.False(package.StagingDirectoryExistsForTest);
        Assert.Equal(64, result.PackageSha256.Length);
        Assert.Equal(64, result.ManifestSha256.Length);
        Assert.Equal(package.CapturePlanSha256, result.CapturePlanSha256);
        Assert.DoesNotContain(temporary.Path, JsonSerializer.Serialize(result), StringComparison.OrdinalIgnoreCase);
        var manifestPath = Directory.GetFiles(temporary.Path, "manifest.json", SearchOption.AllDirectories).Single();
        var finalPackagePath = Path.GetDirectoryName(manifestPath)!;
        Assert.False(File.Exists(Path.Combine(finalPackagePath, ".tenkings-owner.json")));
        Assert.False(File.Exists(Path.Combine(finalPackagePath, ".tenkings-lease.lock")));
        Assert.Equal(
            ForensicRoles.Required.Count + 1,
            Directory.EnumerateFileSystemEntries(finalPackagePath, "*", SearchOption.TopDirectoryOnly).Count());
        var manifestBytes = await File.ReadAllBytesAsync(manifestPath);
        Assert.Equal(result.ManifestSha256, Convert.ToHexString(SHA256.HashData(manifestBytes)).ToLowerInvariant());
        using var manifest = JsonDocument.Parse(manifestBytes);
        Assert.Equal(result.PackageSha256, manifest.RootElement.GetProperty("packageSha256").GetString());
        var payload = manifest.RootElement.GetProperty("payload");
        Assert.Equal(package.CapturePlanSha256, payload.GetProperty("capturePlanSha256").GetString());
        Assert.Equal(ForensicRoles.Required.Count, payload.GetProperty("artifacts").GetArrayLength());
        Assert.Equal(1200, payload.GetProperty("normalized").GetProperty("width").GetInt32());
        Assert.Equal(1680, payload.GetProperty("normalized").GetProperty("height").GetInt32());
        Assert.Equal("all_on", payload.GetProperty("authority").GetProperty("sourceRole").GetString());

        foreach (var artifact in result.Artifacts)
        {
            var path = Path.Combine(Path.GetDirectoryName(manifestPath)!, artifact.FileName);
            var bytes = await File.ReadAllBytesAsync(path);
            Assert.Equal(artifact.ByteSize, bytes.LongLength);
            Assert.Equal(artifact.Sha256, Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
            var decoded = LosslessMono8Decoder.Decode(bytes);
            Assert.Equal(artifact.MimeType, decoded.MimeType);
            Assert.Equal(artifact.Width, decoded.Width);
            Assert.Equal(artifact.Height, decoded.Height);
        }
    }

    [Theory]
    [InlineData("cancel")]
    [InlineData("throw")]
    public async Task FailureAtLastPrecommitBoundaryNeverExposesFinalPackage(string variant)
    {
        using var temporary = new TemporaryDirectory();
        var writer = new ForensicCaptureWriter(temporary.Path);
        var plan = Plan($"capture-precommit-{variant}", $"request-precommit-{variant}");
        var staged = await StageCompleteAsync(writer, plan, Frames());
        await using var package = staged.Package;
        using var cancellation = new CancellationTokenSource();
        var boundaryReached = false;
        package.AtomicRenameReadyTestHook = _ =>
        {
            boundaryReached = true;
            if (variant == "cancel")
            {
                cancellation.Cancel();
                return ValueTask.CompletedTask;
            }

            return ValueTask.FromException(new IOException("injected_last_precommit_failure"));
        };

        if (variant == "cancel")
        {
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => package.CommitAsync(
                ForensicPackageBinding.FromAttestation(RigConfigurationDefaults.SafeFakeAttestation),
                staged.Geometry,
                staged.Transform,
                cancellation.Token).AsTask());
        }
        else
        {
            await Assert.ThrowsAsync<IOException>(() => package.CommitAsync(
                ForensicPackageBinding.FromAttestation(RigConfigurationDefaults.SafeFakeAttestation),
                staged.Geometry,
                staged.Transform,
                cancellation.Token).AsTask());
        }

        Assert.True(boundaryReached);
        Assert.False(package.FinalPackageExistsForTest);
        await package.AbortAsync();
        Assert.False(package.FinalPackageExistsForTest);
        Assert.False(package.StagingDirectoryExistsForTest);
    }

    [Fact]
    public async Task FinalPackageRejectsReintroducedUnboundStagingMetadata()
    {
        using var temporary = new TemporaryDirectory();
        var writer = new ForensicCaptureWriter(temporary.Path);
        var plan = Plan("capture-owner-mutation", "request-owner-mutation");
        var frames = Frames();
        var first = await StageCompleteAsync(writer, plan, frames);
        await using (first.Package)
        {
            await first.Package.CommitAsync(
                ForensicPackageBinding.FromAttestation(RigConfigurationDefaults.SafeFakeAttestation),
                first.Geometry,
                first.Transform,
                CancellationToken.None);
        }

        var manifestPath = Directory.GetFiles(temporary.Path, "manifest.json", SearchOption.AllDirectories).Single();
        var finalPackagePath = Path.GetDirectoryName(manifestPath)!;
        var ownerPath = Path.Combine(finalPackagePath, ".tenkings-owner.json");
        Assert.False(File.Exists(ownerPath));
        await File.WriteAllTextAsync(ownerPath, "{}");

        var mutatedRetry = await StageCompleteAsync(writer, plan, frames);
        await using (mutatedRetry.Package)
        {
            await Assert.ThrowsAsync<InvalidDataException>(() => mutatedRetry.Package.CommitAsync(
                ForensicPackageBinding.FromAttestation(RigConfigurationDefaults.SafeFakeAttestation),
                mutatedRetry.Geometry,
                mutatedRetry.Transform,
                CancellationToken.None).AsTask());
        }

        File.Delete(ownerPath);
        var cleanRetry = await StageCompleteAsync(writer, plan, frames);
        await using (cleanRetry.Package)
        {
            var idempotent = await cleanRetry.Package.CommitAsync(
                ForensicPackageBinding.FromAttestation(RigConfigurationDefaults.SafeFakeAttestation),
                cleanRetry.Geometry,
                cleanRetry.Transform,
                CancellationToken.None);
            Assert.True(idempotent.Idempotent);
        }
    }

    [Theory]
    [InlineData("missing_block_id")]
    [InlineData("source_corner_outside_frame")]
    public async Task PackageRejectsMissingExactBlockIdentityAndOutOfFrameAuthority(string variant)
    {
        using var temporary = new TemporaryDirectory();
        var writer = new ForensicCaptureWriter(temporary.Path);
        var plan = Plan($"capture-{variant}", $"request-{variant}");
        var frames = Frames();
        if (variant == "missing_block_id")
        {
            frames[6] = frames[6] with { BlockId = null };
        }

        var staged = await StageCompleteAsync(writer, plan, frames);
        await using var package = staged.Package;
        var geometry = variant == "source_corner_outside_frame"
            ? staged.Geometry with
            {
                SourceCorners =
                [
                    new PointD(-1, 8),
                    new PointD(56, 8),
                    new PointD(56, 88),
                    new PointD(-1, 88),
                ],
            }
            : staged.Geometry;

        await Assert.ThrowsAsync<InvalidDataException>(() => package.CommitAsync(
            ForensicPackageBinding.FromAttestation(RigConfigurationDefaults.SafeFakeAttestation),
            geometry,
            staged.Transform,
            CancellationToken.None).AsTask());

        Assert.False(package.FinalPackageExistsForTest);
        Assert.Empty(Directory.GetFiles(temporary.Path, "manifest.json", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task ExactCompleteDigestIsIdempotentAndDifferentDigestIsImmutableConflict()
    {
        using var temporary = new TemporaryDirectory();
        var writer = new ForensicCaptureWriter(temporary.Path);
        var plan = Plan("capture-idempotent", "request-idempotent");
        var frames = Frames();
        var first = await StageCompleteAsync(writer, plan, frames);
        await using (first.Package)
        {
            var committed = await first.Package.CommitAsync(
                ForensicPackageBinding.FromAttestation(RigConfigurationDefaults.SafeFakeAttestation),
                first.Geometry,
                first.Transform,
                CancellationToken.None);
            Assert.False(committed.Idempotent);
        }

        var manifestPath = Directory.GetFiles(temporary.Path, "manifest.json", SearchOption.AllDirectories).Single();
        var originalManifestSha256 = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(manifestPath))).ToLowerInvariant();
        var duplicate = await StageCompleteAsync(writer, plan, frames);
        await using (duplicate.Package)
        {
            var committed = await duplicate.Package.CommitAsync(
                ForensicPackageBinding.FromAttestation(RigConfigurationDefaults.SafeFakeAttestation),
                duplicate.Geometry,
                duplicate.Transform,
                CancellationToken.None);
            Assert.True(committed.Idempotent);
        }

        var changedFrames = frames.ToArray();
        var changedPixels = changedFrames[0].Mono8.ToArray();
        changedPixels[0] ^= 0xff;
        changedFrames[0] = changedFrames[0] with { Mono8 = changedPixels };
        var conflict = await StageCompleteAsync(writer, plan, changedFrames);
        await using (conflict.Package)
        {
            await Assert.ThrowsAsync<IOException>(() => conflict.Package.CommitAsync(
                ForensicPackageBinding.FromAttestation(RigConfigurationDefaults.SafeFakeAttestation),
                conflict.Geometry,
                conflict.Transform,
                CancellationToken.None).AsTask());
        }

        Assert.Equal(originalManifestSha256, Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(manifestPath))).ToLowerInvariant());
        Assert.Single(Directory.GetFiles(temporary.Path, "manifest.json", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task RetryPreservesLiveTransactionAndReconcilesOnlyUnlockedOwnedOrphans()
    {
        using var temporary = new TemporaryDirectory();
        var writer = new ForensicCaptureWriter(temporary.Path);
        var plan = Plan("capture-orphan", "request-orphan");
        var orphan = await writer.BeginPackageAsync("session-safe", plan, CancellationToken.None);
        await orphan.StageRoleAsync(ForensicRoles.Required[0], Frames()[0], 1, CancellationToken.None);
        Assert.True(orphan.StagingDirectoryExistsForTest);

        var liveStagingPath = Directory.GetDirectories(
            temporary.Path,
            ".tk-native-stage-v1-*",
            SearchOption.AllDirectories).Single();
        var ownerBytes = await File.ReadAllBytesAsync(Path.Combine(liveStagingPath, ".tenkings-owner.json"));
        await Assert.ThrowsAsync<IOException>(() =>
            writer.BeginPackageAsync("session-safe", plan, CancellationToken.None).AsTask());
        Assert.True(orphan.StagingDirectoryExistsForTest);
        Assert.DoesNotContain(
            Directory.GetDirectories(temporary.Path, ".tk-native-stage-v1-*", SearchOption.AllDirectories),
            path => path.Contains(".quarantine", StringComparison.OrdinalIgnoreCase));

        await orphan.AbortAsync();
        Directory.CreateDirectory(liveStagingPath);
        await File.WriteAllBytesAsync(Path.Combine(liveStagingPath, ".tenkings-owner.json"), ownerBytes);
        await File.WriteAllBytesAsync(Path.Combine(liveStagingPath, ".tenkings-lease.lock"), []);

        var retry = await writer.BeginPackageAsync("session-safe", plan, CancellationToken.None);
        Assert.False(Directory.Exists(liveStagingPath));
        Assert.True(retry.StagingDirectoryExistsForTest);
        await retry.AbortAsync();

        var untrusted = await writer.BeginPackageAsync("session-safe", plan, CancellationToken.None);
        var untrustedPath = Directory.GetDirectories(
            temporary.Path,
            ".tk-native-stage-v1-*",
            SearchOption.AllDirectories).Single(path => !path.Contains(".quarantine", StringComparison.OrdinalIgnoreCase));
        await untrusted.AbortAsync();
        Directory.CreateDirectory(untrustedPath);
        await File.WriteAllTextAsync(Path.Combine(untrustedPath, ".tenkings-owner.json"), "{}");
        await File.WriteAllBytesAsync(Path.Combine(untrustedPath, ".tenkings-lease.lock"), []);
        var afterUntrusted = await writer.BeginPackageAsync("session-safe", plan, CancellationToken.None);
        Assert.False(Directory.Exists(untrustedPath));
        Assert.Contains(
            Directory.GetDirectories(temporary.Path, ".tk-native-stage-v1-*", SearchOption.AllDirectories),
            path => path.Contains(".quarantine", StringComparison.OrdinalIgnoreCase));
        await afterUntrusted.AbortAsync();
    }

    private static async Task<StagedPackage> StageCompleteAsync(
        ForensicCaptureWriter writer,
        ForensicSidePlan plan,
        IReadOnlyList<CameraFrame> frames)
    {
        var package = await writer.BeginPackageAsync("session-safe", plan, CancellationToken.None);
        ForensicArtifact? allOn = null;
        for (var index = 0; index < ForensicRoles.Required.Count; index++)
        {
            var artifact = await package.StageRoleAsync(ForensicRoles.Required[index], frames[index], 1, CancellationToken.None);
            if (artifact.Role == "all_on") allOn = artifact;
        }

        var geometry = ReadyGeometry(frames[1], plan);
        var transform = new ForensicTransformProvenance(
            "all_on",
            allOn!.FrameId,
            allOn.Sha256,
            allOn.Width,
            allOn.Height,
            1200,
            1680,
            geometry.SourceToNormalizedHomography,
            ForensicRoles.Required.Skip(2).ToArray());
        return new StagedPackage(package, geometry, transform);
    }

    private static GeometryResult ReadyGeometry(CameraFrame frame, ForensicSidePlan plan)
    {
        var sourceCorners = new[]
        {
            new PointD(8, 8),
            new PointD(56, 8),
            new PointD(56, 88),
            new PointD(8, 88),
        };
        var normalizedCorners = new[]
        {
            new PointD(0, 0),
            new PointD(1199, 0),
            new PointD(1199, 1679),
            new PointD(0, 1679),
        };
        var edges = Enumerable.Range(0, 4).Select(_ => new EdgeEvidence(0.9, 0.9, 0.2, false)).ToArray();
        var attestation = RigConfigurationDefaults.SafeFakeAttestation;
        return GeometryResult.NotDetected(frame, plan.Epochs, plan.Side, "none") with
        {
            Status = "ready",
            ReasonCodes = ["none"],
            SourceCorners = sourceCorners,
            NormalizedCorners = normalizedCorners,
            FittedLines =
            [
                new LineD(0, 1, -8),
                new LineD(1, 0, -56),
                new LineD(0, 1, -88),
                new LineD(1, 0, -8),
            ],
            SourceToNormalizedHomography = [1199d / 48, 0, -(1199d * 8 / 48), 0, 1679d / 80, -(1679d * 8 / 80), 0, 0, 1],
            Center = new PointD(32, 48),
            Scale = 0.8,
            Confidence = 0.95,
            Metrics = new GeometryMetrics(edges, 1, 0.75, 1, 1, 1, 1, true)
            {
                AspectRatio = 80d / 48,
                ClearanceFraction = 0.08,
                PerspectiveSkew = 0.01,
                EdgeSupportScore = 0.9,
                ContinuityScore = 0.9,
                MeanResidualPixels = 0.2,
            },
            Hysteresis = new HysteresisEvidence(1, 3, true, string.Empty),
            CalibrationId = attestation.CalibrationId,
            CalibrationSha256 = attestation.CalibrationSha256,
            SensorOrientation = new SensorOrientationResult(
                attestation.Orientation.RotationDegrees,
                attestation.Orientation.MirrorX,
                attestation.Orientation.MirrorY,
                attestation.Orientation.SupportsMirrorX,
                attestation.Orientation.SupportsMirrorY),
            CurrentFrameAuthority = new CurrentFrameAuthorityResult(true, true, []),
            SourceWidth = frame.Width,
            SourceHeight = frame.Height,
            NormalizedWidth = 1200,
            NormalizedHeight = 1680,
        };
    }

    private static CameraFrame[] Frames() => Enumerable.Range(1, ForensicRoles.Required.Count)
        .Select(sequence => FakeCameraBackend.CreateGradientFrame(sequence, 64, 96))
        .ToArray();

    private static ForensicSidePlan Plan(string captureId, string requestId) => new(
        requestId,
        captureId,
        CardSide.Front,
        new Epochs(1, 1, 1, 1),
        ForensicCaptureProfile.FullForensic,
        ForensicRoles.Required);

    private static NativeCameraWorker CreateWorker(FakeCameraBackend camera, ILightingCoordinator lighting, string output) => new(
        camera,
        new NoCardFrameAnalyzer(),
        new TestJpegEncoder(),
        lighting,
        new ForensicCaptureWriter(output),
        "worker-atomic-protocol",
        1,
        true);

    private static string Command(string command, string requestId, long sequence, object payload) =>
        JsonSerializer.Serialize(new
        {
            protocolVersion = NativeCameraProtocolServer.ProtocolVersion,
            kind = "command",
            command,
            requestId,
            sessionId = "session-lifetime",
            workerEpoch = 1,
            sessionEpoch = 1,
            previewEpoch = 0,
            sideEpoch = 0,
            side = "none",
            timeoutMs = 30_000,
            deadlineUnixMs = DateTimeOffset.UtcNow.AddSeconds(30).ToUnixTimeMilliseconds(),
            sequence,
            payload,
        });

    private sealed class TestJpegEncoder : IPreviewFrameEncoder
    {
        public int JpegQuality => 85;
        public ValueTask<PreviewJpeg> EncodeJpegAsync(CameraFrame frame, CancellationToken cancellationToken) =>
            ValueTask.FromResult(new PreviewJpeg([0xff, 0xd8, 1, 0xff, 0xd9], frame.Width, frame.Height));
    }

    private sealed record StagedPackage(
        ForensicCapturePackage Package,
        GeometryResult Geometry,
        ForensicTransformProvenance Transform);
}
