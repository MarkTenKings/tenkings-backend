using System.Security.Cryptography;
using System.Text;

namespace TenKings.AiGrader.Worker.Core;

public sealed record WorkerHealth(
    WorkerState State,
    string BackendKind,
    bool CameraOpen,
    CardSide Side,
    Epochs Epochs,
    bool NativeModeEnabled,
    string? PublicFaultCode,
    IReadOnlyDictionary<string, double> TelemetryMilliseconds,
    long PreviewDrops);

public sealed record PreviewFrameResult(
    string FrameId,
    long Sequence,
    string? BlockId,
    long? HardwareTimestampTicks,
    Epochs Epochs,
    CardSide Side,
    int Width,
    int Height,
    int DisplayWidth,
    int DisplayHeight,
    byte[] JpegBytes,
    GeometryResult Geometry,
    long ReceiveMonotonicTicks,
    long DetectStartMonotonicTicks,
    long DetectEndMonotonicTicks,
    long EncodeEndMonotonicTicks,
    long QueueMonotonicTicks,
    double DetectMilliseconds,
    double EncodeMilliseconds,
    double FrameAgeMilliseconds,
    long DroppedFrames,
    bool Frozen);

public sealed class NativeCameraWorker : IAsyncDisposable
{
    private readonly ICameraBackend _camera;
    private readonly IFrameAnalyzer _analyzer;
    private readonly IPreviewFrameEncoder _previewEncoder;
    private readonly ILightingCoordinator _lighting;
    private readonly ForensicCaptureWriter _writer;
    private readonly LatestFrameQueue<PreviewFrameResult> _previewFrames = new();
    private readonly SemaphoreSlim _stateGate = new(1, 1);
    private readonly long _spawnTicks = MonotonicClock.NowTicks;
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, double> _telemetry = new(StringComparer.Ordinal);
    private CancellationTokenSource? _previewCancellation;
    private Task? _previewTask;
    private string? _lastPreviewFrameId;
    private string? _lastPreviewBlockId;
    private string _sessionId = string.Empty;
    private long _previewFrameIntervalTicks;
    private bool _disposed;
    private int _terminalFaultStarted;
    private readonly TaskCompletionSource _terminalFaultCompleted = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public Func<string, ValueTask>? TerminalFaulted { get; set; }

    public NativeCameraWorker(
        ICameraBackend camera,
        IFrameAnalyzer analyzer,
        IPreviewFrameEncoder previewEncoder,
        ILightingCoordinator lighting,
        ForensicCaptureWriter writer,
        string workerId,
        long workerEpoch,
        bool nativeModeEnabled)
    {
        _camera = camera;
        _analyzer = analyzer;
        _previewEncoder = previewEncoder;
        _lighting = lighting;
        _writer = writer;
        WorkerId = ValidateIdentifier(workerId, 128, nameof(workerId));
        Epochs = new Epochs(workerEpoch, 0, 0, 0);
        NativeModeEnabled = nativeModeEnabled;
    }

    public string WorkerId { get; }
    public WorkerState State { get; private set; } = WorkerState.Uninitialized;
    public Epochs Epochs { get; private set; }
    public CardSide Side { get; private set; } = CardSide.None;
    public bool NativeModeEnabled { get; }
    public string? PublicFaultCode { get; private set; }
    public CameraCapabilities Capabilities => _camera.Capabilities;

    public async ValueTask InitializeAsync(string sessionId, long sessionEpoch, CancellationToken cancellationToken)
    {
        try
        {
            await _stateGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                RequireState(WorkerState.Uninitialized);
                if (!NativeModeEnabled)
                {
                    throw new InvalidOperationException("native_mode_disabled");
                }

                _sessionId = ValidateIdentifier(sessionId, 128, nameof(sessionId));
                if (sessionEpoch < 0)
                {
                    throw new InvalidDataException("Session epoch must be nonnegative.");
                }

                var start = MonotonicClock.NowTicks;
                await _camera.OpenAndConfigureAsync(cancellationToken).ConfigureAwait(false);
                _telemetry["spawn_to_initialize"] = MonotonicClock.ElapsedMilliseconds(_spawnTicks);
                _telemetry["camera_initialize_open_configure"] = MonotonicClock.ElapsedMilliseconds(start);
                foreach (var timing in _camera.TimingMilliseconds)
                {
                    _telemetry[timing.Key] = timing.Value;
                }
                Epochs = Epochs with { SessionEpoch = sessionEpoch, PreviewEpoch = 0, SideEpoch = 0 };
                State = WorkerState.IdleSafe;
            }
            finally
            {
                _stateGate.Release();
            }
        }
        catch
        {
            await TerminalFaultAsync("initialize_failed").ConfigureAwait(false);
            throw;
        }
    }

    public WorkerHealth GetHealth() => new(
        State,
        _camera.BackendKind,
        _camera.IsOpen,
        Side,
        Epochs,
        NativeModeEnabled,
        PublicFaultCode,
        new Dictionary<string, double>(_telemetry, StringComparer.Ordinal),
        _previewFrames.Dropped);

    public async ValueTask StartPreviewAsync(long previewEpoch, double maxFramesPerSecond, int jpegQuality, CancellationToken cancellationToken)
    {
        try
        {
            await _stateGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                RequireState(WorkerState.IdleSafe);
                RequireNextEpoch(previewEpoch, Epochs.PreviewEpoch, "preview");
                ConfigurePreviewCadence(maxFramesPerSecond, jpegQuality);
                Epochs = Epochs with { PreviewEpoch = previewEpoch };
                ResetTracking("preview_started");
                var start = MonotonicClock.NowTicks;
                await _camera.StartPreviewAsync(cancellationToken).ConfigureAwait(false);
                _telemetry["preview_mode_start"] = MonotonicClock.ElapsedMilliseconds(start);
                State = WorkerState.Previewing;
                _previewCancellation = new CancellationTokenSource();
                _previewTask = RunPreviewLoopAsync(_previewCancellation.Token);
            }
            finally
            {
                _stateGate.Release();
            }
        }
        catch
        {
            await TerminalFaultAsync("start_preview_failed").ConfigureAwait(false);
            throw;
        }
    }

    public async ValueTask StopAndDrainAsync(CancellationToken cancellationToken)
    {
        try
        {
            Task? previewTask;
            await _stateGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                RequireState(WorkerState.Previewing);
                State = WorkerState.Draining;
                _previewCancellation?.Cancel();
                previewTask = _previewTask;
            }
            finally
            {
                _stateGate.Release();
            }

            if (previewTask is not null)
            {
                try
                {
                    await previewTask.ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                }
            }

            await _stateGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                RequireState(WorkerState.Draining);
                var start = MonotonicClock.NowTicks;
                await _camera.StopAndDrainAsync(cancellationToken).ConfigureAwait(false);
                _telemetry["preview_drain"] = MonotonicClock.ElapsedMilliseconds(start);
                _telemetry["mode_switch"] = _telemetry["preview_drain"];
                DisposePreviewCancellation();
                _previewFrames.Clear();
                ResetTracking("preview_drained");
                State = WorkerState.CaptureReady;
            }
            finally
            {
                _stateGate.Release();
            }
        }
        catch
        {
            await TerminalFaultAsync("preview_drain_failed").ConfigureAwait(false);
            throw;
        }
    }

    public async ValueTask SetSideAsync(CardSide side, long sideEpoch, CancellationToken cancellationToken)
    {
        try
        {
            await _stateGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (State is not (WorkerState.IdleSafe or WorkerState.Previewing or WorkerState.CaptureReady))
                {
                    throw new InvalidOperationException($"invalid_transition:{State}:set_side");
                }

                if (side is not (CardSide.Front or CardSide.Back))
                {
                    throw new InvalidDataException("Side must be front or back.");
                }

                RequireNextEpoch(sideEpoch, Epochs.SideEpoch, "side");
                Side = side;
                Epochs = Epochs with { SideEpoch = sideEpoch };
                ResetTracking("side_epoch_changed");
            }
            finally
            {
                _stateGate.Release();
            }
        }
        catch
        {
            await TerminalFaultAsync("set_side_failed").ConfigureAwait(false);
            throw;
        }
    }

    public async ValueTask<ForensicSideResult> ExecuteForensicSidePlanAsync(ForensicSidePlan plan, CancellationToken cancellationToken)
    {
        try
        {
            ForensicPlanValidator.Validate(plan);
            if (_lighting is ICaptureScopedLightingCoordinator captureScopedLighting)
            {
                captureScopedLighting.BeginCapture(plan.CaptureRequestId);
            }
            await _stateGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                RequireState(WorkerState.CaptureReady);
                if (plan.Side != Side || plan.Epochs != Epochs)
                {
                    throw new InvalidDataException("Forensic plan side or epochs do not match worker state.");
                }

                State = WorkerState.Capturing;
            }
            finally
            {
                _stateGate.Release();
            }

            var artifacts = new List<ForensicArtifact>(ForensicRoles.Required.Count);
            double acknowledgementMilliseconds = 0;
            double grabMilliseconds = 0;
            double writeMilliseconds = 0;
            double hashMilliseconds = 0;
            var safeOffCompleted = false;
            GeometryResult? authoritativeGeometry = null;
            ForensicArtifact? authoritativeArtifact = null;
            int? authoritativeWidth = null;
            int? authoritativeHeight = null;
            try
            {
                foreach (var role in plan.Roles)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var request = await _lighting.RequestEvidenceRoleProfileAsync(role, Side, Epochs, cancellationToken).ConfigureAwait(false);
                    var acknowledgementStart = MonotonicClock.NowTicks;
                    var acknowledgement = await _lighting.WaitForStableAcknowledgementAsync(request, cancellationToken).ConfigureAwait(false);
                    acknowledgementMilliseconds += MonotonicClock.ElapsedMilliseconds(acknowledgementStart);
                    if (!acknowledgement.Stable || !string.Equals(acknowledgement.RequestToken, request.RequestToken, StringComparison.Ordinal))
                    {
                        throw new InvalidOperationException("lighting_stable_acknowledgement_failed");
                    }

                    var authorization = await _lighting.AuthorizeOneGrabAsync(request, acknowledgement, cancellationToken).ConfigureAwait(false);
                    if (!authorization.Authorized || !string.Equals(authorization.RequestToken, request.RequestToken, StringComparison.Ordinal))
                    {
                        throw new InvalidOperationException("lighting_grab_not_authorized");
                    }

                    if (authorization.ExpiresAtUnixMs <= DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
                    {
                        throw new InvalidOperationException("lighting_grab_authorization_expired");
                    }

                    var grabStart = MonotonicClock.NowTicks;
                    var frame = await _camera.GrabAsync(cancellationToken).ConfigureAwait(false);
                    var oneGrabMilliseconds = MonotonicClock.ElapsedMilliseconds(grabStart);
                    grabMilliseconds += oneGrabMilliseconds;
                    frame.Validate();
                    if (artifacts.Count == 0)
                    {
                        _telemetry["first_forensic_frame"] = MonotonicClock.ElapsedMilliseconds(_spawnTicks);
                    }

                    if (role == "all_on")
                    {
                        _analyzer.Reset(Epochs, Side, "forensic_all_on");
                        authoritativeGeometry = await _analyzer.AnalyzeAsync(
                            frame,
                            Epochs,
                            Side,
                            _previewFrames.Dropped,
                            cancellationToken).ConfigureAwait(false);
                        ValidateAuthoritativeGeometry(authoritativeGeometry, frame);
                        authoritativeWidth = frame.Width;
                        authoritativeHeight = frame.Height;
                    }
                    else if (role != "dark_control")
                    {
                        if (authoritativeWidth is null || authoritativeHeight is null ||
                            frame.Width != authoritativeWidth || frame.Height != authoritativeHeight)
                        {
                            throw new InvalidDataException("forensic_role_dimensions_incoherent");
                        }
                    }

                    await _lighting.CompleteAuthorizedGrabAsync(request, authorization, frame, cancellationToken).ConfigureAwait(false);

                    var artifact = await _writer.WriteAsync(
                        SessionDirectoryName(_sessionId),
                        Side,
                        role,
                        plan.Profile,
                        frame,
                        oneGrabMilliseconds,
                        cancellationToken).ConfigureAwait(false);
                    artifacts.Add(artifact);
                    if (role == "all_on")
                    {
                        authoritativeArtifact = artifact;
                    }
                    writeMilliseconds += artifact.WriteMilliseconds;
                    hashMilliseconds += artifact.HashMilliseconds;
                }

                if (artifacts.Count != ForensicRoles.Required.Count || artifacts.Select(static artifact => artifact.Role).Distinct(StringComparer.Ordinal).Count() != ForensicRoles.Required.Count)
                {
                    throw new InvalidDataException("Forensic capture output is incomplete or duplicated.");
                }

                if (artifacts.Select(static artifact => artifact.FrameId).Distinct(StringComparer.Ordinal).Count() != artifacts.Count)
                {
                    throw new InvalidDataException("forensic_frame_identity_reused");
                }

                var blockIds = artifacts.Where(static artifact => artifact.BlockId is not null).Select(static artifact => artifact.BlockId!).ToArray();
                if (blockIds.Distinct(StringComparer.Ordinal).Count() != blockIds.Length)
                {
                    throw new InvalidDataException("forensic_block_identity_reused");
                }

                if (authoritativeGeometry is null || authoritativeArtifact is null)
                {
                    throw new InvalidDataException("authoritative_all_on_geometry_missing");
                }

                var darkControlArtifact = artifacts.Single(static artifact => artifact.Role == "dark_control");
                if (darkControlArtifact.Width != authoritativeArtifact.Width || darkControlArtifact.Height != authoritativeArtifact.Height)
                {
                    throw new InvalidDataException("dark_control_dimensions_incoherent");
                }

                var authoritativeTransform = new ForensicTransformProvenance(
                    "all_on",
                    authoritativeArtifact.FrameId,
                    authoritativeArtifact.Sha256,
                    authoritativeArtifact.Width,
                    authoritativeArtifact.Height,
                    1200,
                    1680,
                    authoritativeGeometry.SourceToNormalizedHomography,
                    ForensicRoles.Required.Skip(2).ToArray());

                var safeOff = await _lighting.SafeOffAsync("forensic_plan_complete", cancellationToken).ConfigureAwait(false);
                safeOffCompleted = safeOff.Completed;
                if (!safeOff.Completed)
                {
                    throw new InvalidOperationException("safe_off_failed");
                }

                await _stateGate.WaitAsync(cancellationToken).ConfigureAwait(false);
                try
                {
                    RequireState(WorkerState.Capturing);
                    State = WorkerState.IdleSafe;
                }
                finally
                {
                    _stateGate.Release();
                }

                _telemetry["lighting_acknowledgements"] = acknowledgementMilliseconds;
                _telemetry["forensic_grabs"] = grabMilliseconds;
                _telemetry["forensic_writes"] = writeMilliseconds;
                _telemetry["forensic_hashes"] = hashMilliseconds;

                return new ForensicSideResult(
                    Side,
                    Epochs,
                    plan.Profile,
                    artifacts,
                    acknowledgementMilliseconds,
                    grabMilliseconds,
                    writeMilliseconds,
                    hashMilliseconds,
                    safeOffCompleted,
                    authoritativeGeometry,
                    authoritativeTransform);
            }
            finally
            {
                if (!safeOffCompleted)
                {
                    await AttemptSafeOffAsync("forensic_plan_failed").ConfigureAwait(false);
                }
            }
        }
        catch
        {
            await TerminalFaultAsync("forensic_capture_failed").ConfigureAwait(false);
            throw;
        }
    }

    private static void ValidateAuthoritativeGeometry(GeometryResult geometry, CameraFrame frame)
    {
        if (!string.Equals(geometry.FrameId, frame.FrameId, StringComparison.Ordinal) ||
            !string.Equals(geometry.BlockId, frame.BlockId, StringComparison.Ordinal) ||
            geometry.SourceCorners.Count != 4 ||
            geometry.NormalizedCorners.Count != 4 ||
            geometry.FittedLines.Count != 4 ||
            geometry.SourceToNormalizedHomography.Count != 9 ||
            geometry.SourceToNormalizedHomography.Any(static value => !double.IsFinite(value)) ||
            geometry.Status == "not_detected" ||
            geometry.Stale ||
            geometry.Frozen ||
            !geometry.Metrics.FullVisibility ||
            geometry.Confidence <= 0)
        {
            throw new InvalidDataException("authoritative_all_on_geometry_incoherent");
        }
    }

    public async ValueTask ResumePreviewAsync(long previewEpoch, double maxFramesPerSecond, int jpegQuality, CancellationToken cancellationToken)
    {
        try
        {
            await _stateGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                RequireState(WorkerState.IdleSafe);
                RequireNextEpoch(previewEpoch, Epochs.PreviewEpoch, "preview");
                ConfigurePreviewCadence(maxFramesPerSecond, jpegQuality);
                State = WorkerState.Resuming;
                Epochs = Epochs with { PreviewEpoch = previewEpoch };
                ResetTracking("preview_resuming");
                var start = MonotonicClock.NowTicks;
                await _camera.StartPreviewAsync(cancellationToken).ConfigureAwait(false);
                _telemetry["preview_resume"] = MonotonicClock.ElapsedMilliseconds(start);
                State = WorkerState.Previewing;
                _previewCancellation = new CancellationTokenSource();
                _previewTask = RunPreviewLoopAsync(_previewCancellation.Token);
            }
            finally
            {
                _stateGate.Release();
            }
        }
        catch
        {
            await TerminalFaultAsync("resume_preview_failed").ConfigureAwait(false);
            throw;
        }
    }

    public async ValueTask SafeIdleAsync(CancellationToken cancellationToken)
    {
        try
        {
            if (State == WorkerState.Previewing)
            {
                await StopAndDrainAsync(cancellationToken).ConfigureAwait(false);
            }

            await _stateGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (State == WorkerState.CaptureReady)
                {
                    var safeOff = await _lighting.SafeOffAsync("safe_idle_requested", cancellationToken).ConfigureAwait(false);
                    if (!safeOff.Completed)
                    {
                        throw new InvalidOperationException("safe_off_failed");
                    }

                    State = WorkerState.IdleSafe;
                }
                else
                {
                    RequireState(WorkerState.IdleSafe);
                }

                ResetTracking("safe_idle");
            }
            finally
            {
                _stateGate.Release();
            }
        }
        catch
        {
            await TerminalFaultAsync("safe_idle_failed").ConfigureAwait(false);
            throw;
        }
    }

    public ValueTask<PreviewFrameResult> ReadLatestPreviewAsync(CancellationToken cancellationToken) =>
        _previewFrames.ReadAsync(cancellationToken);

    public async ValueTask ShutdownAsync(CancellationToken cancellationToken)
    {
        if (State == WorkerState.Shutdown)
        {
            return;
        }

        _previewCancellation?.Cancel();
        if (_previewTask is not null)
        {
            try
            {
                await _previewTask.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
            }
        }

        var safeOff = await _lighting.SafeOffAsync("worker_shutdown", cancellationToken).ConfigureAwait(false);
        if (!safeOff.Completed)
        {
            throw new InvalidOperationException("safe_off_failed");
        }
        await _camera.CloseAsync(cancellationToken).ConfigureAwait(false);
        State = WorkerState.Shutdown;
        DisposePreviewCancellation();
        _previewFrames.Clear();
    }

    public async ValueTask TerminalFaultAsync(string publicFaultCode)
    {
        if (State == WorkerState.Shutdown)
        {
            return;
        }

        if (Interlocked.Exchange(ref _terminalFaultStarted, 1) != 0)
        {
            await _terminalFaultCompleted.Task.ConfigureAwait(false);
            return;
        }

        try
        {
            PublicFaultCode = SanitizePublicCode(publicFaultCode);
            State = WorkerState.TerminalFault;
            _previewCancellation?.Cancel();
            var terminalFaulted = TerminalFaulted;
            if (terminalFaulted is not null)
            {
                try
                {
                    await terminalFaulted(PublicFaultCode).ConfigureAwait(false);
                }
                catch
                {
                    // The process is terminal regardless of whether the protocol
                    // sink is still writable. The host exits non-zero.
                }
            }
            await AttemptSafeOffAsync(PublicFaultCode).ConfigureAwait(false);
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            try
            {
                if (_camera.IsOpen)
                {
                    await _camera.StopAndDrainAsync(timeout.Token).ConfigureAwait(false);
                    await _camera.CloseAsync(timeout.Token).ConfigureAwait(false);
                }
            }
            catch
            {
                // The public fault remains terminal. External client also safe-offs and kills the process.
            }

            ResetTracking(PublicFaultCode);
        }
        finally
        {
            _terminalFaultCompleted.TrySetResult();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (State == WorkerState.TerminalFault)
        {
            await _terminalFaultCompleted.Task.ConfigureAwait(false);
        }
        else if (State != WorkerState.Shutdown)
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            try
            {
                await ShutdownAsync(timeout.Token).ConfigureAwait(false);
            }
            catch
            {
                using var closeTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                try
                {
                    await _camera.CloseAsync(closeTimeout.Token).ConfigureAwait(false);
                }
                catch
                {
                }
                State = WorkerState.Shutdown;
            }
        }

        await _camera.DisposeAsync().ConfigureAwait(false);
        _previewFrames.Dispose();
        _stateGate.Dispose();
    }

    private async Task RunPreviewLoopAsync(CancellationToken cancellationToken)
    {
        var firstFrame = true;
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                // Fake/replay backends may complete synchronously; always yield so
                // starting preview cannot monopolize the command dispatcher.
                await Task.Yield();
                var frame = await _camera.GrabAsync(cancellationToken).ConfigureAwait(false);
                frame.Validate();
                var frozen = string.Equals(_lastPreviewFrameId, frame.FrameId, StringComparison.Ordinal) ||
                    (!string.IsNullOrEmpty(_lastPreviewBlockId) && !string.IsNullOrEmpty(frame.BlockId) && string.Equals(_lastPreviewBlockId, frame.BlockId, StringComparison.Ordinal));
                _lastPreviewFrameId = frame.FrameId;
                _lastPreviewBlockId = frame.BlockId;

                var detectStart = MonotonicClock.NowTicks;
                var geometry = await _analyzer.AnalyzeAsync(frame, Epochs, Side, _previewFrames.Dropped, cancellationToken).ConfigureAwait(false);
                var detectEnd = MonotonicClock.NowTicks;
                if (geometry.FrameId != frame.FrameId || geometry.BlockId != frame.BlockId || geometry.Epochs != Epochs || geometry.Side != Side)
                {
                    _analyzer.Reset(Epochs, Side, "analysis_identity_mismatch");
                    throw new InvalidDataException("Analyzer returned geometry for the wrong frame or epoch.");
                }

                if (frozen)
                {
                    _analyzer.Reset(Epochs, Side, "frozen_frame");
                    geometry = GeometryResult.NotDetected(frame, Epochs, Side, "frozen_frame", _previewFrames.Dropped) with
                    {
                        Frozen = true,
                        Stale = true,
                    };
                }

                var jpeg = await _previewEncoder.EncodeJpegAsync(frame, cancellationToken).ConfigureAwait(false);
                jpeg.Validate();

                var encodeEnd = MonotonicClock.NowTicks;
                var result = new PreviewFrameResult(
                    frame.FrameId,
                    frame.Sequence,
                    frame.BlockId,
                    frame.HardwareTimestampTicks,
                    Epochs,
                    Side,
                    frame.Width,
                    frame.Height,
                    jpeg.Width,
                    jpeg.Height,
                    jpeg.Bytes,
                    geometry,
                    frame.MonotonicReceiveTicks,
                    detectStart,
                    detectEnd,
                    encodeEnd,
                    MonotonicClock.NowTicks,
                    MonotonicClock.ElapsedMilliseconds(detectStart, detectEnd),
                    MonotonicClock.ElapsedMilliseconds(detectEnd, encodeEnd),
                    MonotonicClock.ElapsedMilliseconds(frame.MonotonicReceiveTicks, encodeEnd),
                    _previewFrames.Dropped,
                    frozen);
                _previewFrames.Publish(result);
                _telemetry["detect"] = result.DetectMilliseconds;
                _telemetry["encode"] = result.EncodeMilliseconds;
                if (firstFrame)
                {
                    _telemetry["first_preview_frame"] = MonotonicClock.ElapsedMilliseconds(_spawnTicks);
                    firstFrame = false;
                }

                var elapsedTicks = MonotonicClock.NowTicks - frame.MonotonicReceiveTicks;
                var remainingTicks = _previewFrameIntervalTicks - elapsedTicks;
                if (remainingTicks > 0)
                {
                    var delay = TimeSpan.FromSeconds(remainingTicks / (double)System.Diagnostics.Stopwatch.Frequency);
                    await Task.Delay(delay, cancellationToken).ConfigureAwait(false);
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch
        {
            await TerminalFaultAsync("preview_pipeline_failed").ConfigureAwait(false);
        }
    }

    private async ValueTask AttemptSafeOffAsync(string publicReasonCode)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try
        {
            await _lighting.SafeOffAsync(SanitizePublicCode(publicReasonCode), timeout.Token).ConfigureAwait(false);
        }
        catch
        {
            // Fault status is already terminal; the parent TypeScript client owns the second safe-off fence.
        }
    }

    private void ResetTracking(string reason)
    {
        _lastPreviewFrameId = null;
        _lastPreviewBlockId = null;
        _previewFrames.Clear();
        _analyzer.Reset(Epochs, Side, reason);
    }

    private void RequireState(WorkerState expected)
    {
        if (State != expected)
        {
            throw new InvalidOperationException($"invalid_transition:{State}:expected_{expected}");
        }
    }

    private void ConfigurePreviewCadence(double maxFramesPerSecond, int jpegQuality)
    {
        if (!double.IsFinite(maxFramesPerSecond) || maxFramesPerSecond < 1 || maxFramesPerSecond > _camera.Capabilities.MaxPreviewFramesPerSecond)
        {
            throw new InvalidDataException("preview_frame_rate_out_of_bounds");
        }

        if (jpegQuality != _previewEncoder.JpegQuality)
        {
            throw new InvalidDataException("preview_jpeg_quality_mismatch");
        }

        _previewFrameIntervalTicks = Math.Max(1, (long)(System.Diagnostics.Stopwatch.Frequency / maxFramesPerSecond));
    }

    private static void RequireNextEpoch(long candidate, long current, string name)
    {
        if (candidate != checked(current + 1))
        {
            throw new InvalidDataException($"{name}_epoch_out_of_order");
        }
    }

    private static string ValidateIdentifier(string value, int maxLength, string parameterName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        if (value.Length > maxLength || !value.All(static character => char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or ':' or '-'))
        {
            throw new ArgumentException("Identifier contains disallowed characters.", parameterName);
        }

        return value;
    }

    private static string SessionDirectoryName(string sessionId)
    {
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(sessionId));
        return $"session-{Convert.ToHexString(digest.AsSpan(0, 12)).ToLowerInvariant()}";
    }

    private static string SanitizePublicCode(string value)
    {
        var sanitized = new string(value
            .Take(96)
            .Select(static character => char.IsAsciiLetterOrDigit(character) || character is '_' or '-' ? char.ToLowerInvariant(character) : '_')
            .ToArray());
        return string.IsNullOrWhiteSpace(sanitized) ? "worker_fault" : sanitized;
    }

    private void DisposePreviewCancellation()
    {
        _previewCancellation?.Dispose();
        _previewCancellation = null;
        _previewTask = null;
    }
}
