using System.Text;
using System.Text.Json;
using TenKings.AiGrader.Pylon.Host;
using TenKings.AiGrader.Worker.Core;
using TenKings.AiGrader.Worker.Host;
using System.Security.Cryptography;
using System.Threading.Channels;

namespace TenKings.AiGrader.Worker.Tests;

public sealed class SafetyAndProtocolTests
{
    [Fact]
    public void DefaultBuildCannotContainOrInstantiatePylonBackend()
    {
        Assert.False(PylonActivationGuard.IsSdkCompiled);
        Assert.Null(typeof(PylonActivationGuard).Assembly.GetType("TenKings.AiGrader.Pylon.Host.PylonCameraBackend", throwOnError: false));
    }

    [Fact]
    public async Task MalformedAndTruncatedProtocolTerminallyFaultAndSafeOff()
    {
        using var temporary = new TemporaryDirectory();
        var protocolLighting = new ProtocolLightingCoordinator();
        var lighting = new CountingSafeOffLightingCoordinator(protocolLighting);
        await using var worker = CreateWorker(temporary.Path, lighting);
        await using var input = new MemoryStream(Encoding.UTF8.GetBytes("{not-json"));
        await using var output = new MemoryStream();
        var server = new NativeCameraProtocolServer(worker, protocolLighting, input, output, TextWriter.Null);

        Assert.Equal(2, await server.RunAsync(CancellationToken.None));
        Assert.Equal(WorkerState.TerminalFault, worker.State);
        Assert.True(lighting.SafeOffCalls >= 1);
        var text = Encoding.UTF8.GetString(output.ToArray());
        Assert.Contains("terminal_fault", text, StringComparison.Ordinal);
        Assert.DoesNotContain(temporary.Path, text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task OversizeProtocolIsRejectedBeforeJsonParsing()
    {
        using var temporary = new TemporaryDirectory();
        var protocolLighting = new ProtocolLightingCoordinator();
        await using var worker = CreateWorker(temporary.Path, protocolLighting);
        var bytes = Enumerable.Repeat((byte)'x', NativeCameraProtocolServer.MaximumMessageBytes + 1).Append((byte)'\n').ToArray();
        await using var input = new MemoryStream(bytes);
        await using var output = new MemoryStream();
        var server = new NativeCameraProtocolServer(worker, protocolLighting, input, output, TextWriter.Null);

        Assert.Equal(2, await server.RunAsync(CancellationToken.None));
        Assert.Equal(WorkerState.TerminalFault, worker.State);
    }

    [Fact]
    public async Task SuccessfulResultsAreStrictNdjsonWithMonotonicOutputSequenceAndTiming()
    {
        using var temporary = new TemporaryDirectory();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var commands = string.Join('\n',
        [
            Command("initialize", "request-1", 1, now, new { backend = "fake", configurationId = "rig-1" }),
            Command("health", "request-2", 2, now, new { }),
            Command("capabilities", "request-3", 3, now, new { }),
            Command("shutdown", "request-4", 4, now, new { }),
        ]) + "\n";
        var protocolLighting = new ProtocolLightingCoordinator();
        var lighting = new CountingSafeOffLightingCoordinator(protocolLighting);
        var camera = new FakeCameraBackend();
        await using var worker = CreateWorker(temporary.Path, lighting, camera);
        await using var input = new MemoryStream(Encoding.UTF8.GetBytes(commands));
        await using var output = new MemoryStream();

        Assert.Equal(0, await new NativeCameraProtocolServer(worker, protocolLighting, input, output, TextWriter.Null).RunAsync(CancellationToken.None));
        var lines = Encoding.UTF8.GetString(output.ToArray()).Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(4, lines.Length);
        var sequences = new List<long>();
        foreach (var line in lines)
        {
            using var document = JsonDocument.Parse(line);
            var root = document.RootElement;
            sequences.Add(root.GetProperty("sequence").GetInt64());
            Assert.Equal("result", root.GetProperty("kind").GetString());
            Assert.True(root.GetProperty("ok").GetBoolean());
            var timing = root.GetProperty("payload").GetProperty("timing");
            Assert.Equal(18, timing.EnumerateObject().Count());
        }

        Assert.Equal(new long[] { 1, 2, 3, 4 }, sequences);
        Assert.Equal(1, camera.OpenCount);
    }

    [Fact]
    public async Task OutOfOrderCommandFaultsWithoutOpeningOrFallback()
    {
        using var temporary = new TemporaryDirectory();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var commands = Command("initialize", "request-1", 2, now, new { backend = "fake", configurationId = "rig-1" }) + "\n";
        var protocolLighting = new ProtocolLightingCoordinator();
        var camera = new FakeCameraBackend();
        await using var worker = CreateWorker(temporary.Path, protocolLighting, camera);
        await using var input = new MemoryStream(Encoding.UTF8.GetBytes(commands));
        await using var output = new MemoryStream();

        Assert.Equal(2, await new NativeCameraProtocolServer(worker, protocolLighting, input, output, TextWriter.Null).RunAsync(CancellationToken.None));
        Assert.Equal(0, camera.OpenCount);
        Assert.Equal(WorkerState.TerminalFault, worker.State);
    }

    [Fact]
    public async Task ExactDuplicateRequestIsIdempotentlyRejected()
    {
        using var temporary = new TemporaryDirectory();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var initialize = Command("initialize", "request-1", 1, now, new { backend = "fake", configurationId = "rig-1" });
        var commands = initialize + "\n" + initialize + "\n";
        var protocolLighting = new ProtocolLightingCoordinator();
        await using var worker = CreateWorker(temporary.Path, protocolLighting);
        await using var input = new MemoryStream(Encoding.UTF8.GetBytes(commands));
        await using var output = new MemoryStream();

        Assert.Equal(0, await new NativeCameraProtocolServer(worker, protocolLighting, input, output, TextWriter.Null).RunAsync(CancellationToken.None));
        var lines = Encoding.UTF8.GetString(output.ToArray()).Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(2, lines.Length);
        using var duplicate = JsonDocument.Parse(lines[1]);
        Assert.False(duplicate.RootElement.GetProperty("ok").GetBoolean());
        Assert.Equal("DUPLICATE_REQUEST", duplicate.RootElement.GetProperty("error").GetProperty("code").GetString());
        Assert.Equal(1, worker.GetHealth().TelemetryMilliseconds.Count(static entry => entry.Key == "spawn_to_initialize"));
    }

    [Fact]
    public async Task ExpiredDeadlineIsTerminalAndDoesNotFallback()
    {
        using var temporary = new TemporaryDirectory();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 60_000;
        var commands = Command("initialize", "request-1", 1, now, new { backend = "fake", configurationId = "rig-1" }) + "\n";
        var protocolLighting = new ProtocolLightingCoordinator();
        var camera = new FakeCameraBackend();
        await using var worker = CreateWorker(temporary.Path, protocolLighting, camera);
        await using var input = new MemoryStream(Encoding.UTF8.GetBytes(commands));
        await using var output = new MemoryStream();

        Assert.Equal(2, await new NativeCameraProtocolServer(worker, protocolLighting, input, output, TextWriter.Null).RunAsync(CancellationToken.None));
        Assert.Equal(0, camera.OpenCount);
        Assert.Equal(WorkerState.TerminalFault, worker.State);
    }

    [Fact]
    public void ReplayManifestRequiresAndVerifiesPermittedFrameSha256()
    {
        using var temporary = new TemporaryDirectory();
        var pixels = FakeCameraBackend.CreateCardSceneFrame(1, 160, 224).Mono8;
        var rawPath = Path.Combine(temporary.Path, "frame.mono8");
        File.WriteAllBytes(rawPath, pixels);
        var sha256 = Convert.ToHexString(SHA256.HashData(pixels)).ToLowerInvariant();
        var manifestPath = Path.Combine(temporary.Path, "manifest.json");
        File.WriteAllText(manifestPath, JsonSerializer.Serialize(new
        {
            schemaVersion = "tenkings.native-replay.v1",
            frames = new[]
            {
                new
                {
                    frameId = "replay-1",
                    blockId = "1",
                    hardwareTimestampTicks = "1000",
                    width = 160,
                    height = 224,
                    stride = 160,
                    mono8File = "frame.mono8",
                    sha256,
                },
            },
        }));
        Assert.Single(ReplayManifestLoader.Load(manifestPath));

        pixels[0] ^= 0xff;
        File.WriteAllBytes(rawPath, pixels);
        Assert.Throws<InvalidDataException>(() => ReplayManifestLoader.Load(manifestPath));

        pixels[0] ^= 0xff;
        File.WriteAllBytes(rawPath, pixels);
        File.WriteAllText(manifestPath, JsonSerializer.Serialize(new
        {
            schemaVersion = "tenkings.native-replay.v1",
            frames = new[]
            {
                new
                {
                    frameId = "../unsafe",
                    blockId = "1/2",
                    hardwareTimestampTicks = "1000",
                    width = 160,
                    height = 224,
                    stride = 160,
                    mono8File = "frame.mono8",
                    sha256,
                },
            },
        }));
        Assert.Throws<InvalidDataException>(() => ReplayManifestLoader.Load(manifestPath));
    }

    [Fact]
    public async Task PreviewAndLightingEventsCorrelateAndFollowStartResult()
    {
        using var temporary = new TemporaryDirectory();
        var protocolLighting = new ProtocolLightingCoordinator();
        var lighting = new CountingSafeOffLightingCoordinator(protocolLighting);
        await using var worker = new NativeCameraWorker(
            new FakeCameraBackend(),
            new VisionFrameAnalyzer(),
            new TestJpegEncoder(),
            lighting,
            new ForensicCaptureWriter(temporary.Path),
            "worker-protocol-correlation",
            1,
            true);
        await using var input = new FeedableInputStream();
        await using var output = new LineCaptureStream();
        var server = new NativeCameraProtocolServer(worker, protocolLighting, input, output, TextWriter.Null);
        var serverTask = server.RunAsync(CancellationToken.None);
        long sequence = 0;

        input.Feed(ProtocolCommand("initialize", "correlation-init", ++sequence, "none", 0, 0, new { backend = "fake", configurationId = "rig-1" }));
        _ = await ReadResultAsync(output, "correlation-init");
        input.Feed(ProtocolCommand("set_side", "correlation-side", ++sequence, "front", 0, 1, new { side = "front" }));
        _ = await ReadResultAsync(output, "correlation-side");
        input.Feed(ProtocolCommand("start_preview", "correlation-preview", ++sequence, "front", 1, 1, new { maxFps = 15, jpegQuality = 85 }));

        var startResult = await ReadResultAsync(output, "correlation-preview", failOnPreview: true);
        var preview = await ReadEventAsync(output, "preview_frame");
        Assert.Equal("correlation-preview", preview.GetProperty("requestId").GetString());
        Assert.True(preview.GetProperty("sequence").GetInt64() > startResult.GetProperty("sequence").GetInt64());

        input.Feed(ProtocolCommand("stop_drain", "correlation-drain", ++sequence, "front", 1, 1, new { }));
        _ = await ReadResultAsync(output, "correlation-drain");
        const string captureRequestId = "correlation-capture";
        input.Feed(ProtocolCommand(
            "execute_forensic_plan",
            captureRequestId,
            ++sequence,
            "front",
            1,
            1,
            new
            {
                captureId = "capture-correlation",
                forensicProfile = "full_forensic",
                roles = ForensicRoles.Required,
                normalizedWidth = 1200,
                normalizedHeight = 1680,
            }));

        JsonElement? captureResult = null;
        var roleCompletions = 0;
        using var captureTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        while (captureResult is null)
        {
            var message = await output.ReadMessageAsync(captureTimeout.Token);
            var kind = message.GetProperty("kind").GetString();
            if (kind == "event")
            {
                var eventName = message.GetProperty("event").GetString();
                if (eventName == "lighting_profile_requested")
                {
                    Assert.Equal(captureRequestId, message.GetProperty("requestId").GetString());
                    var payload = message.GetProperty("payload");
                    Assert.Equal(captureRequestId, payload.GetProperty("captureRequestId").GetString());
                    var role = payload.GetProperty("role").GetString()!;
                    input.Feed(ProtocolCommand(
                        "lighting_ack",
                        $"ack-{role}",
                        ++sequence,
                        "front",
                        1,
                        1,
                        new
                        {
                            captureRequestId,
                            role,
                            stableAcknowledgementId = $"stable-{role}",
                            authorizationId = $"authorization-{role}",
                            stableAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                            expiresAtUnixMs = DateTimeOffset.UtcNow.AddSeconds(30).ToUnixTimeMilliseconds(),
                        }));
                }
                else if (eventName == "lighting_grab_completed")
                {
                    Assert.Equal(captureRequestId, message.GetProperty("requestId").GetString());
                    var payload = message.GetProperty("payload");
                    Assert.Equal(captureRequestId, payload.GetProperty("captureRequestId").GetString());
                    var role = payload.GetProperty("role").GetString()!;
                    input.Feed(ProtocolCommand(
                        "lighting_completion",
                        $"completion-{role}",
                        ++sequence,
                        "front",
                        1,
                        1,
                        new
                        {
                            captureRequestId,
                            role,
                            authorizationId = $"authorization-{role}",
                            completedAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        }));
                    roleCompletions++;
                }
            }
            else if (kind == "result" && message.GetProperty("requestId").GetString() == captureRequestId)
            {
                captureResult = message;
            }
        }

        Assert.Equal(11, roleCompletions);
        Assert.True(captureResult.Value.GetProperty("ok").GetBoolean());
        Assert.Equal(11, captureResult.Value.GetProperty("payload").GetProperty("artifacts").GetArrayLength());
        input.Feed(ProtocolCommand("shutdown", "correlation-shutdown", ++sequence, "front", 1, 1, new { }));
        _ = await ReadResultAsync(output, "correlation-shutdown");
        input.Complete();
        Assert.Equal(0, await serverTask.WaitAsync(TimeSpan.FromSeconds(10)));
    }

    [Fact]
    public async Task SafeIdleAndShutdownWaitForExplicitSafeOffCompletionInProtocolOrder()
    {
        using var temporary = new TemporaryDirectory();
        var protocolLighting = new ProtocolLightingCoordinator();
        await using var worker = CreateWorker(temporary.Path, protocolLighting);
        await using var input = new FeedableInputStream();
        await using var output = new LineCaptureStream();
        var serverTask = new NativeCameraProtocolServer(worker, protocolLighting, input, output, TextWriter.Null)
            .RunAsync(CancellationToken.None);
        long sequence = 0;

        input.Feed(ProtocolCommand("initialize", "safe-init", ++sequence, "none", 0, 0, new { backend = "fake", configurationId = "rig-1" }));
        _ = await ReadResultAsync(output, "safe-init");
        input.Feed(ProtocolCommand("set_side", "safe-side", ++sequence, "front", 0, 1, new { side = "front" }));
        _ = await ReadResultAsync(output, "safe-side");
        input.Feed(ProtocolCommand("start_preview", "safe-preview", ++sequence, "front", 1, 1, new { maxFps = 15, jpegQuality = 85 }));
        _ = await ReadResultAsync(output, "safe-preview", failOnPreview: true);
        input.Feed(ProtocolCommand("stop_drain", "safe-drain", ++sequence, "front", 1, 1, new { }));
        _ = await ReadResultAsync(output, "safe-drain");
        Assert.Equal(WorkerState.CaptureReady, worker.State);

        input.Feed(ProtocolCommand("safe_idle", "safe-idle", ++sequence, "front", 1, 1, new { }));
        var safeEvent = await ReadEventAsync(output, "safe_off_requested");
        var safeRequestId = safeEvent.GetProperty("payload").GetProperty("safeOffRequestId").GetString()!;
        Assert.Equal(safeRequestId, safeEvent.GetProperty("requestId").GetString());
        Assert.Equal(WorkerState.CaptureReady, worker.State);
        input.Feed(ProtocolCommand(
            "safe_off_completion",
            "safe-idle-completion",
            ++sequence,
            "front",
            1,
            1,
            new { safeOffRequestId = safeRequestId, safe = true, completedAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }));
        var safeCompletion = await ReadResultAsync(output, "safe-idle-completion");
        var safeIdle = await ReadResultAsync(output, "safe-idle");
        Assert.True(safeEvent.GetProperty("sequence").GetInt64() < safeCompletion.GetProperty("sequence").GetInt64());
        Assert.True(safeCompletion.GetProperty("sequence").GetInt64() < safeIdle.GetProperty("sequence").GetInt64());
        Assert.Equal("idle_safe", safeIdle.GetProperty("payload").GetProperty("state").GetString());

        input.Feed(ProtocolCommand("shutdown", "safe-shutdown", ++sequence, "front", 1, 1, new { }));
        var shutdownEvent = await ReadEventAsync(output, "safe_off_requested");
        var shutdownSafeId = shutdownEvent.GetProperty("payload").GetProperty("safeOffRequestId").GetString()!;
        Assert.Equal(WorkerState.IdleSafe, worker.State);
        input.Feed(ProtocolCommand(
            "safe_off_completion",
            "safe-shutdown-completion",
            ++sequence,
            "front",
            1,
            1,
            new { safeOffRequestId = shutdownSafeId, safe = true, completedAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }));
        var shutdownCompletion = await ReadResultAsync(output, "safe-shutdown-completion");
        var shutdown = await ReadResultAsync(output, "safe-shutdown");
        Assert.True(shutdownEvent.GetProperty("sequence").GetInt64() < shutdownCompletion.GetProperty("sequence").GetInt64());
        Assert.True(shutdownCompletion.GetProperty("sequence").GetInt64() < shutdown.GetProperty("sequence").GetInt64());
        Assert.Equal("shutdown", shutdown.GetProperty("payload").GetProperty("state").GetString());

        input.Complete();
        Assert.Equal(0, await serverTask.WaitAsync(TimeSpan.FromSeconds(10)));
    }

    [Fact]
    public async Task SafeOffFailureTerminallyFaultsInsteadOfReportingIdleSafe()
    {
        using var temporary = new TemporaryDirectory();
        var protocolLighting = new ProtocolLightingCoordinator();
        await using var worker = CreateWorker(temporary.Path, protocolLighting);
        await using var input = new FeedableInputStream();
        await using var output = new LineCaptureStream();
        var serverTask = new NativeCameraProtocolServer(worker, protocolLighting, input, output, TextWriter.Null)
            .RunAsync(CancellationToken.None);
        long sequence = 0;

        input.Feed(ProtocolCommand("initialize", "unsafe-init", ++sequence, "none", 0, 0, new { backend = "fake", configurationId = "rig-1" }));
        _ = await ReadResultAsync(output, "unsafe-init");
        input.Feed(ProtocolCommand("set_side", "unsafe-side", ++sequence, "front", 0, 1, new { side = "front" }));
        _ = await ReadResultAsync(output, "unsafe-side");
        input.Feed(ProtocolCommand("start_preview", "unsafe-preview", ++sequence, "front", 1, 1, new { maxFps = 15, jpegQuality = 85 }));
        _ = await ReadResultAsync(output, "unsafe-preview", failOnPreview: true);
        input.Feed(ProtocolCommand("stop_drain", "unsafe-drain", ++sequence, "front", 1, 1, new { }));
        _ = await ReadResultAsync(output, "unsafe-drain");
        input.Feed(ProtocolCommand("safe_idle", "unsafe-idle", ++sequence, "front", 1, 1, new { }));
        var safeEvent = await ReadEventAsync(output, "safe_off_requested");
        var safeRequestId = safeEvent.GetProperty("payload").GetProperty("safeOffRequestId").GetString()!;
        input.Feed(ProtocolCommand(
            "safe_off_completion",
            "unsafe-completion",
            ++sequence,
            "front",
            1,
            1,
            new { safeOffRequestId = safeRequestId, safe = false, completedAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }));
        _ = await ReadResultAsync(output, "unsafe-completion");
        var terminal = await ReadEventAsync(output, "terminal_fault");
        Assert.Equal("terminal-fault", terminal.GetProperty("requestId").GetString());
        Assert.Equal(WorkerState.TerminalFault, worker.State);
        Assert.Equal(2, await serverTask.WaitAsync(TimeSpan.FromSeconds(10)));
    }

    [Fact]
    public async Task AutonomousPreviewFailureEmitsOneTerminalFaultAndEndsServer()
    {
        using var temporary = new TemporaryDirectory();
        var protocolLighting = new ProtocolLightingCoordinator();
        await using var worker = new NativeCameraWorker(
            new FakeCameraBackend(),
            new NoCardFrameAnalyzer(),
            new FailingPreviewEncoder(),
            protocolLighting,
            new ForensicCaptureWriter(temporary.Path),
            "worker-autonomous-fault",
            1,
            true);
        await using var input = new FeedableInputStream();
        await using var output = new LineCaptureStream();
        var server = new NativeCameraProtocolServer(worker, protocolLighting, input, output, TextWriter.Null);
        var serverTask = server.RunAsync(CancellationToken.None);
        long sequence = 0;

        input.Feed(ProtocolCommand("initialize", "fault-init", ++sequence, "none", 0, 0, new { backend = "fake", configurationId = "rig-1" }));
        _ = await ReadResultAsync(output, "fault-init");
        input.Feed(ProtocolCommand("set_side", "fault-side", ++sequence, "front", 0, 1, new { side = "front" }));
        _ = await ReadResultAsync(output, "fault-side");
        input.Feed(ProtocolCommand("start_preview", "fault-preview", ++sequence, "front", 1, 1, new { maxFps = 15, jpegQuality = 85 }));
        _ = await ReadResultAsync(output, "fault-preview", failOnPreview: true);

        var terminal = await ReadEventAsync(output, "terminal_fault");
        Assert.Equal("terminal-fault", terminal.GetProperty("requestId").GetString());
        Assert.Equal(WorkerState.TerminalFault, worker.State);
        Assert.Equal(2, await serverTask.WaitAsync(TimeSpan.FromSeconds(10)));
        Assert.Equal(1, server.TerminalFaultEventCountForTest);
    }

    [Fact]
    public async Task ExpiredAuthorizationIsRejectedImmediatelyBeforeCameraGrab()
    {
        using var temporary = new TemporaryDirectory();
        var camera = new FakeCameraBackend();
        var lighting = new ExpiredAuthorizationLightingCoordinator();
        await using var worker = CreateWorker(temporary.Path, lighting, camera);
        await worker.InitializeAsync("expired-session", 1, CancellationToken.None);
        await worker.SetSideAsync(CardSide.Front, 1, CancellationToken.None);
        await worker.StartPreviewAsync(1, 15, 85, CancellationToken.None);
        await worker.StopAndDrainAsync(CancellationToken.None);
        var grabsBeforeCapture = camera.GrabCount;

        await Assert.ThrowsAnyAsync<Exception>(async () =>
            await worker.ExecuteForensicSidePlanAsync(
                new ForensicSidePlan("expired-request", "expired-capture", worker.Side, worker.Epochs, ForensicCaptureProfile.FullForensic, ForensicRoles.Required),
                CancellationToken.None));

        Assert.Equal(grabsBeforeCapture, camera.GrabCount);
        Assert.Equal(WorkerState.TerminalFault, worker.State);
        Assert.True(lighting.SafeOffCount >= 1);
    }

    [Fact]
    public async Task HighEntropyFullSizePreviewProducesBoundedJpegAndNdjsonEnvelope()
    {
        const int width = 4096;
        const int height = 3072;
        var pixels = new byte[width * height];
        new Random(0x5eed).NextBytes(pixels);
        var frame = new CameraFrame(
            "entropy-frame-1",
            1,
            "entropy-block-1",
            1234,
            MonotonicClock.NowTicks,
            DateTimeOffset.UtcNow,
            width,
            height,
            width,
            pixels);
        var encoder = new OpenCvPreviewFrameEncoder(100);
        var encoded = await encoder.EncodeJpegAsync(frame, CancellationToken.None);
        encoded.Validate();
        Assert.True(encoded.Bytes.Length <= PreviewJpeg.MaximumBytes);
        Assert.True(encoded.Width <= width && encoded.Height <= height);

        using var temporary = new TemporaryDirectory();
        var protocolLighting = new ProtocolLightingCoordinator();
        var lighting = new CountingSafeOffLightingCoordinator(protocolLighting);
        await using var worker = new NativeCameraWorker(
            new SingleFrameCameraBackend(frame),
            new NoCardFrameAnalyzer(),
            encoder,
            lighting,
            new ForensicCaptureWriter(temporary.Path),
            "worker-entropy-preview",
            1,
            true);
        await using var input = new FeedableInputStream();
        await using var output = new LineCaptureStream();
        var serverTask = new NativeCameraProtocolServer(worker, protocolLighting, input, output, TextWriter.Null)
            .RunAsync(CancellationToken.None);
        long sequence = 0;

        input.Feed(ProtocolCommand("initialize", "entropy-init", ++sequence, "none", 0, 0, new { backend = "fake", configurationId = "rig-1" }));
        _ = await ReadResultAsync(output, "entropy-init");
        input.Feed(ProtocolCommand("set_side", "entropy-side", ++sequence, "front", 0, 1, new { side = "front" }));
        _ = await ReadResultAsync(output, "entropy-side");
        input.Feed(ProtocolCommand("start_preview", "entropy-preview", ++sequence, "front", 1, 1, new { maxFps = 15, jpegQuality = 100 }));
        _ = await ReadResultAsync(output, "entropy-preview", failOnPreview: true);
        var previewLine = await output.ReadLineAsync(CancellationToken.None);
        Assert.True(Encoding.UTF8.GetByteCount(previewLine) <= NativeCameraProtocolServer.MaximumMessageBytes);
        using var previewDocument = JsonDocument.Parse(previewLine);
        var jpeg = previewDocument.RootElement.GetProperty("payload").GetProperty("jpeg");
        Assert.Equal(encoded.Width, jpeg.GetProperty("width").GetInt32());
        Assert.Equal(encoded.Height, jpeg.GetProperty("height").GetInt32());

        input.Feed(ProtocolCommand("shutdown", "entropy-shutdown", ++sequence, "front", 1, 1, new { }));
        _ = await ReadResultAsync(output, "entropy-shutdown");
        input.Complete();
        Assert.Equal(0, await serverTask.WaitAsync(TimeSpan.FromSeconds(10)));
    }

    [Fact]
    public async Task StopDrainWaitsForCorrelatedPreviewAlreadyInProgress()
    {
        using var temporary = new TemporaryDirectory();
        var protocolLighting = new ProtocolLightingCoordinator();
        var lighting = new CountingSafeOffLightingCoordinator(protocolLighting);
        await using var worker = new NativeCameraWorker(
            new FakeCameraBackend(),
            new NoCardFrameAnalyzer(),
            new TestJpegEncoder(),
            lighting,
            new ForensicCaptureWriter(temporary.Path),
            "worker-preview-drain-order",
            1,
            true);
        await using var input = new FeedableInputStream();
        await using var output = new LineCaptureStream();
        var emissionCorrelated = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseEmission = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var drainStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var server = new NativeCameraProtocolServer(worker, protocolLighting, input, output, TextWriter.Null)
        {
            PreviewEmissionAfterCorrelationTestHook = async cancellationToken =>
            {
                emissionCorrelated.TrySetResult();
                await releaseEmission.Task.WaitAsync(cancellationToken);
            },
            PreviewDrainStartedTestHook = () => drainStarted.TrySetResult(),
        };
        var serverTask = server.RunAsync(CancellationToken.None);
        long sequence = 0;

        input.Feed(ProtocolCommand("initialize", "drain-init", ++sequence, "none", 0, 0, new { backend = "fake", configurationId = "rig-1" }));
        _ = await ReadResultAsync(output, "drain-init");
        input.Feed(ProtocolCommand("set_side", "drain-side", ++sequence, "front", 0, 1, new { side = "front" }));
        _ = await ReadResultAsync(output, "drain-side");
        input.Feed(ProtocolCommand("start_preview", "drain-preview", ++sequence, "front", 1, 1, new { maxFps = 15, jpegQuality = 85 }));
        var startResult = await ReadResultAsync(output, "drain-preview", failOnPreview: true);
        await emissionCorrelated.Task.WaitAsync(TimeSpan.FromSeconds(10));

        input.Feed(ProtocolCommand("stop_drain", "drain-stop", ++sequence, "front", 1, 1, new { }));
        await drainStarted.Task.WaitAsync(TimeSpan.FromSeconds(10));
        releaseEmission.TrySetResult();

        var preview = await ReadEventAsync(output, "preview_frame");
        var stopResult = await ReadResultAsync(output, "drain-stop");
        Assert.Equal("drain-preview", preview.GetProperty("requestId").GetString());
        Assert.True(preview.GetProperty("sequence").GetInt64() > startResult.GetProperty("sequence").GetInt64());
        Assert.True(preview.GetProperty("sequence").GetInt64() < stopResult.GetProperty("sequence").GetInt64());

        input.Feed(ProtocolCommand("shutdown", "drain-shutdown", ++sequence, "front", 1, 1, new { }));
        _ = await ReadResultAsync(output, "drain-shutdown");
        input.Complete();
        Assert.Equal(0, await serverTask.WaitAsync(TimeSpan.FromSeconds(10)));
    }

    private static NativeCameraWorker CreateWorker(string output, ILightingCoordinator lighting, FakeCameraBackend? camera = null) => new(
        camera ?? new FakeCameraBackend(), new NoCardFrameAnalyzer(), new TestJpegEncoder(), lighting,
        new ForensicCaptureWriter(output), "worker-1", 1, true);

    private static string Command(string command, string requestId, long sequence, long now, object payload) =>
        JsonSerializer.Serialize(new
        {
            protocolVersion = NativeCameraProtocolServer.ProtocolVersion,
            kind = "command",
            command,
            requestId,
            sessionId = "session-1",
            workerEpoch = 1,
            sessionEpoch = 1,
            previewEpoch = 0,
            sideEpoch = 0,
            side = "none",
            timeoutMs = 30_000,
            deadlineUnixMs = now + 30_000,
            sequence,
            payload,
        });

    private static string ProtocolCommand(
        string command,
        string requestId,
        long sequence,
        string side,
        long previewEpoch,
        long sideEpoch,
        object payload) =>
        JsonSerializer.Serialize(new
        {
            protocolVersion = NativeCameraProtocolServer.ProtocolVersion,
            kind = "command",
            command,
            requestId,
            sessionId = "session-correlation",
            workerEpoch = 1,
            sessionEpoch = 1,
            previewEpoch,
            sideEpoch,
            side,
            timeoutMs = 120_000,
            deadlineUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 120_000,
            sequence,
            payload,
        });

    private static async Task<JsonElement> ReadResultAsync(LineCaptureStream output, string requestId, bool failOnPreview = false)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        for (;;)
        {
            var message = await output.ReadMessageAsync(timeout.Token);
            if (failOnPreview && message.GetProperty("kind").GetString() == "event" &&
                message.GetProperty("event").GetString() == "preview_frame")
            {
                throw new Xunit.Sdk.XunitException("Preview event preceded successful start result.");
            }

            if (message.GetProperty("kind").GetString() == "result" &&
                message.GetProperty("requestId").GetString() == requestId)
            {
                return message;
            }
        }
    }

    private static async Task<JsonElement> ReadEventAsync(LineCaptureStream output, string eventName)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        for (;;)
        {
            var message = await output.ReadMessageAsync(timeout.Token);
            if (message.GetProperty("kind").GetString() == "event" &&
                message.GetProperty("event").GetString() == eventName)
            {
                return message;
            }
        }
    }

    private sealed class TestJpegEncoder : IPreviewFrameEncoder
    {
        public int JpegQuality => 85;
        public ValueTask<PreviewJpeg> EncodeJpegAsync(CameraFrame frame, CancellationToken cancellationToken) =>
            ValueTask.FromResult(new PreviewJpeg([0xff, 0xd8, 1, 0xff, 0xd9], frame.Width, frame.Height));
    }

    private sealed class FailingPreviewEncoder : IPreviewFrameEncoder
    {
        public int JpegQuality => 85;
        public ValueTask<PreviewJpeg> EncodeJpegAsync(CameraFrame frame, CancellationToken cancellationToken) =>
            ValueTask.FromException<PreviewJpeg>(new InvalidOperationException("synthetic_preview_encoder_failure"));
    }

    private sealed class ExpiredAuthorizationLightingCoordinator : ILightingCoordinator
    {
        public int SafeOffCount { get; private set; }

        public ValueTask<LightingRequest> RequestEvidenceRoleProfileAsync(string evidenceRole, CardSide side, Epochs epochs, CancellationToken cancellationToken) =>
            ValueTask.FromResult(new LightingRequest("expired-light", evidenceRole, side, epochs, MonotonicClock.NowTicks));

        public ValueTask<LightingStableAcknowledgement> WaitForStableAcknowledgementAsync(LightingRequest request, CancellationToken cancellationToken) =>
            ValueTask.FromResult(new LightingStableAcknowledgement(request.RequestToken, true, MonotonicClock.NowTicks, "stable"));

        public ValueTask<GrabAuthorization> AuthorizeOneGrabAsync(LightingRequest request, LightingStableAcknowledgement acknowledgement, CancellationToken cancellationToken) =>
            ValueTask.FromResult(new GrabAuthorization(
                request.RequestToken,
                true,
                MonotonicClock.NowTicks,
                DateTimeOffset.UtcNow.AddMilliseconds(-1).ToUnixTimeMilliseconds(),
                "expired-authorization"));

        public ValueTask CompleteAuthorizedGrabAsync(LightingRequest request, GrabAuthorization authorization, CameraFrame frame, CancellationToken cancellationToken) =>
            ValueTask.FromException(new Xunit.Sdk.XunitException("An expired authorization must never complete a grab."));

        public ValueTask<SafeOffResult> SafeOffAsync(string publicReasonCode, CancellationToken cancellationToken)
        {
            SafeOffCount++;
            return ValueTask.FromResult(new SafeOffResult(true, MonotonicClock.NowTicks, "safe_off_complete"));
        }
    }

    private sealed class SingleFrameCameraBackend(CameraFrame frame) : ICameraBackend
    {
        public string BackendKind => "fake";
        public bool IsOpen { get; private set; }
        public CameraCapabilities Capabilities { get; } = new(
            frame.Width,
            frame.Height,
            30,
            HasHardwareBlockId: true,
            HasHardwareTimestamp: true);
        public IReadOnlyDictionary<string, double> TimingMilliseconds { get; } = new Dictionary<string, double>();

        public ValueTask OpenAndConfigureAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            IsOpen = true;
            return ValueTask.CompletedTask;
        }

        public ValueTask StartPreviewAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return ValueTask.CompletedTask;
        }

        public ValueTask StopAndDrainAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return ValueTask.CompletedTask;
        }

        public ValueTask<CameraFrame> GrabAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return ValueTask.FromResult(frame with
            {
                MonotonicReceiveTicks = MonotonicClock.NowTicks,
                ReceiveTimestampUtc = DateTimeOffset.UtcNow,
            });
        }

        public ValueTask CloseAsync(CancellationToken cancellationToken)
        {
            IsOpen = false;
            return ValueTask.CompletedTask;
        }

        public ValueTask DisposeAsync()
        {
            IsOpen = false;
            return ValueTask.CompletedTask;
        }
    }

    private sealed class CountingSafeOffLightingCoordinator(ProtocolLightingCoordinator inner) : ILightingCoordinator, ICaptureScopedLightingCoordinator
    {
        public int SafeOffCalls { get; private set; }
        public void BeginCapture(string captureRequestId) => inner.BeginCapture(captureRequestId);
        public ValueTask<LightingRequest> RequestEvidenceRoleProfileAsync(string evidenceRole, CardSide side, Epochs epochs, CancellationToken cancellationToken) => inner.RequestEvidenceRoleProfileAsync(evidenceRole, side, epochs, cancellationToken);
        public ValueTask<LightingStableAcknowledgement> WaitForStableAcknowledgementAsync(LightingRequest request, CancellationToken cancellationToken) => inner.WaitForStableAcknowledgementAsync(request, cancellationToken);
        public ValueTask<GrabAuthorization> AuthorizeOneGrabAsync(LightingRequest request, LightingStableAcknowledgement acknowledgement, CancellationToken cancellationToken) => inner.AuthorizeOneGrabAsync(request, acknowledgement, cancellationToken);
        public ValueTask CompleteAuthorizedGrabAsync(LightingRequest request, GrabAuthorization authorization, CameraFrame frame, CancellationToken cancellationToken) => inner.CompleteAuthorizedGrabAsync(request, authorization, frame, cancellationToken);
        public ValueTask<SafeOffResult> SafeOffAsync(string publicReasonCode, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            SafeOffCalls++;
            return ValueTask.FromResult(new SafeOffResult(true, MonotonicClock.NowTicks, "safe_off_complete"));
        }
    }

    private sealed class FeedableInputStream : Stream
    {
        private readonly Channel<byte[]> _chunks = Channel.CreateUnbounded<byte[]>();
        private byte[]? _current;
        private int _offset;

        public void Feed(string line) => _chunks.Writer.TryWrite(Encoding.UTF8.GetBytes(line + "\n"));
        public void Complete() => _chunks.Writer.TryComplete();
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            while (_current is null || _offset >= _current.Length)
            {
                if (!await _chunks.Reader.WaitToReadAsync(cancellationToken) || !_chunks.Reader.TryRead(out _current))
                {
                    return 0;
                }
                _offset = 0;
            }

            var count = Math.Min(buffer.Length, _current.Length - _offset);
            _current.AsMemory(_offset, count).CopyTo(buffer);
            _offset += count;
            return count;
        }
    }

    private sealed class LineCaptureStream : Stream
    {
        private readonly object _gate = new();
        private readonly List<byte> _pending = [];
        private readonly Channel<string> _lines = Channel.CreateUnbounded<string>();

        public ValueTask<string> ReadLineAsync(CancellationToken cancellationToken) =>
            _lines.Reader.ReadAsync(cancellationToken);

        public async ValueTask<JsonElement> ReadMessageAsync(CancellationToken cancellationToken)
        {
            var line = await ReadLineAsync(cancellationToken);
            using var document = JsonDocument.Parse(line);
            return document.RootElement.Clone();
        }

        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override Task FlushAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) =>
            Accept(buffer.AsSpan(offset, count));

        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Accept(buffer.Span);
            return ValueTask.CompletedTask;
        }

        private void Accept(ReadOnlySpan<byte> bytes)
        {
            lock (_gate)
            {
                foreach (var value in bytes)
                {
                    if (value == (byte)'\n')
                    {
                        _lines.Writer.TryWrite(Encoding.UTF8.GetString(_pending.ToArray()));
                        _pending.Clear();
                    }
                    else if (value != (byte)'\r')
                    {
                        _pending.Add(value);
                    }
                }
            }
        }
    }
}
