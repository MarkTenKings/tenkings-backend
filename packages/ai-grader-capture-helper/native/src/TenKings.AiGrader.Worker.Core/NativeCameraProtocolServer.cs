using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace TenKings.AiGrader.Worker.Core;

public sealed class NativeCameraProtocolServer
{
    public const string ProtocolVersion = "tenkings.ai-grader.native-camera.v1";
    public const int MaximumMessageBytes = 1024 * 1024;
    public const int MaximumTimeoutMilliseconds = 120_000;
    public const int MaximumInFlightCommands = 32;
    public const int MaximumRememberedRequests = 256;

    private static readonly Regex SafeIdentifier = new(
        "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    private readonly NativeCameraWorker _worker;
    private readonly ProtocolLightingCoordinator _lighting;
    private readonly Stream _input;
    private readonly Stream _output;
    private readonly TextWriter _diagnostics;
    private readonly SemaphoreSlim _outputGate = new(1, 1);
    private readonly SemaphoreSlim _previewEmissionGate = new(1, 1);
    private readonly object _requestGate = new();
    private readonly Dictionary<string, RequestRecord> _requests = new(StringComparer.Ordinal);
    private readonly Queue<string> _requestOrder = new();
    private readonly HashSet<Task> _activeCommands = [];
    private readonly HashSet<string> _activeRequestIds = new(StringComparer.Ordinal);
    private readonly CancellationTokenSource _lifetime = new();
    private long _lastInputSequence;
    private long _outputSequence;
    private double? _lastEmitDurationMilliseconds;
    private string _sessionId = "uninitialized";
    private string? _activePreviewRequestId;
    private int _terminalFaultEventEmitted;

    internal Func<CancellationToken, ValueTask>? PreviewEmissionAfterCorrelationTestHook { get; set; }
    internal Action? PreviewDrainStartedTestHook { get; set; }
    internal int TerminalFaultEventCountForTest => Volatile.Read(ref _terminalFaultEventEmitted);
    internal int ActiveCommandCountForTest
    {
        get
        {
            lock (_requestGate)
            {
                return _activeCommands.Count;
            }
        }
    }

    internal int RememberedRequestCountForTest
    {
        get
        {
            lock (_requestGate)
            {
                return _requests.Count;
            }
        }
    }

    internal void TrackCommandForTest(Task task) => TrackCommand(task, requestId: null);

    public NativeCameraProtocolServer(
        NativeCameraWorker worker,
        ProtocolLightingCoordinator lighting,
        Stream input,
        Stream output,
        TextWriter diagnostics)
    {
        _worker = worker;
        _lighting = lighting;
        _input = input;
        _output = output;
        _diagnostics = diagnostics;
        _lighting.ProfileRequested = EmitLightingProfileRequestedAsync;
        _lighting.GrabCompleted = EmitLightingGrabCompletedAsync;
        _lighting.SafeOffRequested = EmitSafeOffRequestedAsync;
        _worker.TerminalFaulted = HandleWorkerTerminalFaultAsync;
    }

    public async Task<int> RunAsync(CancellationToken cancellationToken)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token);
        var previewTask = EmitPreviewFramesWithFaultBoundaryAsync(linked.Token);
        var pendingLine = new MemoryStream();
        var buffer = new byte[8192];
        try
        {
            while (!linked.IsCancellationRequested)
            {
                var count = await _input.ReadAsync(buffer, linked.Token).ConfigureAwait(false);
                if (count == 0)
                {
                    if (pendingLine.Length > 0)
                    {
                        await FaultMalformedAsync("TRUNCATED_MESSAGE", "Protocol input ended before a newline.", linked.Token).ConfigureAwait(false);
                        return await DrainActiveAndReturnTerminalAsync().ConfigureAwait(false);
                    }

                    break;
                }

                for (var index = 0; index < count; index++)
                {
                    var value = buffer[index];
                    if (value == (byte)'\n')
                    {
                        if (pendingLine.Length == 0)
                        {
                            await FaultMalformedAsync("EMPTY_MESSAGE", "Empty protocol lines are forbidden.", linked.Token).ConfigureAwait(false);
                            return await DrainActiveAndReturnTerminalAsync().ConfigureAwait(false);
                        }

                        var line = pendingLine.ToArray();
                        pendingLine.SetLength(0);
                        if (line.Length > 0 && line[^1] == (byte)'\r')
                        {
                            Array.Resize(ref line, line.Length - 1);
                        }

                        if (!await AcceptLineAsync(line, linked.Token).ConfigureAwait(false))
                        {
                            return await DrainActiveAndReturnTerminalAsync().ConfigureAwait(false);
                        }
                    }
                    else
                    {
                        pendingLine.WriteByte(value);
                        if (pendingLine.Length > MaximumMessageBytes)
                        {
                            await FaultMalformedAsync("MESSAGE_TOO_LARGE", "Protocol line exceeds one MiB.", linked.Token).ConfigureAwait(false);
                            return await DrainActiveAndReturnTerminalAsync().ConfigureAwait(false);
                        }
                    }
                }
            }

            await AwaitActiveCommandsAsync(bounded: false).ConfigureAwait(false);
            return _worker.State == WorkerState.TerminalFault ? 2 : 0;
        }
        catch (OperationCanceledException) when (linked.IsCancellationRequested)
        {
            if (_worker.State is not (WorkerState.Shutdown or WorkerState.TerminalFault))
            {
                await _worker.TerminalFaultAsync("protocol_cancelled").ConfigureAwait(false);
            }

            await AwaitActiveCommandsAsync(bounded: true).ConfigureAwait(false);
            return _worker.State is WorkerState.Shutdown ? 0 : 2;
        }
        catch (Exception)
        {
            await _diagnostics.WriteLineAsync("native_worker_protocol_fault").ConfigureAwait(false);
            await _worker.TerminalFaultAsync("protocol_server_crash").ConfigureAwait(false);
            await AwaitActiveCommandsAsync(bounded: true).ConfigureAwait(false);
            return 2;
        }
        finally
        {
            _lifetime.Cancel();
            pendingLine.Dispose();
            try
            {
                await previewTask.WaitAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
            }
            catch (TimeoutException)
            {
                ObserveTask(previewTask);
            }
        }
    }

    private async ValueTask<bool> AcceptLineAsync(byte[] line, CancellationToken cancellationToken)
    {
        ValidatedCommand command;
        try
        {
            using var document = JsonDocument.Parse(line, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 32,
            });
            command = ValidateCommand(document.RootElement);
        }
        catch (Exception exception) when (exception is JsonException or InvalidDataException or OverflowException)
        {
            await FaultMalformedAsync("MALFORMED_PROTOCOL", "Protocol command failed strict validation.", cancellationToken).ConfigureAwait(false);
            return false;
        }

        var fingerprint = Convert.ToHexString(SHA256.HashData(line));
        ProtocolAdmission admission;
        lock (_requestGate)
        {
            if (_requests.TryGetValue(command.RequestId, out var prior))
            {
                if (!string.Equals(prior.Fingerprint, fingerprint, StringComparison.Ordinal))
                {
                    admission = ProtocolAdmission.DuplicateMismatch;
                }
                else
                {
                    admission = ProtocolAdmission.ExactDuplicate;
                }
            }
            else if (command.Sequence != checked(_lastInputSequence + 1))
            {
                admission = ProtocolAdmission.OutOfOrder;
            }
            else if (_activeCommands.Count >= MaximumInFlightCommands)
            {
                admission = ProtocolAdmission.TooManyInFlight;
            }
            else
            {
                _lastInputSequence = command.Sequence;
                _requests.Add(command.RequestId, new RequestRecord(fingerprint));
                _requestOrder.Enqueue(command.RequestId);
                _activeRequestIds.Add(command.RequestId);
                while (_requests.Count > MaximumRememberedRequests)
                {
                    var candidates = _requestOrder.Count;
                    var removed = false;
                    while (candidates-- > 0)
                    {
                        var oldest = _requestOrder.Dequeue();
                        if (_activeRequestIds.Contains(oldest))
                        {
                            _requestOrder.Enqueue(oldest);
                            continue;
                        }

                        _requests.Remove(oldest);
                        removed = true;
                        break;
                    }

                    if (!removed)
                    {
                        throw new InvalidOperationException("No completed request was available for bounded eviction.");
                    }
                }

                admission = ProtocolAdmission.Accepted;
            }
        }

        switch (admission)
        {
            case ProtocolAdmission.DuplicateMismatch:
                await FaultMalformedAsync("DUPLICATE_REQUEST_MISMATCH", "Duplicate request ID changed content.", CancellationToken.None).ConfigureAwait(false);
                return false;
            case ProtocolAdmission.OutOfOrder:
                await FaultMalformedAsync("OUT_OF_ORDER_COMMAND", "Command sequence did not advance by one.", CancellationToken.None).ConfigureAwait(false);
                return false;
            case ProtocolAdmission.TooManyInFlight:
                await FaultMalformedAsync("TOO_MANY_IN_FLIGHT", "Protocol command concurrency exceeded the fixed bound.", CancellationToken.None).ConfigureAwait(false);
                return false;
            case ProtocolAdmission.ExactDuplicate:
                await EmitFailureResultAsync(
                    command,
                    "DUPLICATE_REQUEST",
                    "Request ID was already accepted.",
                    cancellationToken).ConfigureAwait(false);
                return true;
            case ProtocolAdmission.Accepted:
                break;
            default:
                throw new InvalidOperationException("Unknown protocol admission result.");
        }

        var task = ExecuteCommandAsync(command, cancellationToken);
        TrackCommand(task, command.RequestId);

        if (command.Command is not (
            "execute_forensic_plan" or "lighting_ack" or "lighting_completion" or
            "safe_off_completion" or "safe_idle" or "shutdown"))
        {
            await task.ConfigureAwait(false);
        }

        return _worker.State != WorkerState.TerminalFault;
    }

    private async Task AwaitActiveCommandsAsync(bool bounded)
    {
        Task[] active;
        lock (_requestGate)
        {
            active = _activeCommands.ToArray();
        }

        if (active.Length == 0)
        {
            return;
        }

        var all = Task.WhenAll(active);
        try
        {
            if (bounded)
            {
                await all.WaitAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false);
            }
            else
            {
                await all.ConfigureAwait(false);
            }
        }
        catch (TimeoutException)
        {
            ObserveTask(all);
        }
        catch (Exception) when (bounded)
        {
            ObserveTask(all);
        }
    }

    private async Task<int> DrainActiveAndReturnTerminalAsync()
    {
        await AwaitActiveCommandsAsync(bounded: true).ConfigureAwait(false);
        return 2;
    }

    private static void ObserveTask(Task task) => _ = task.ContinueWith(
        static completed => _ = completed.Exception,
        CancellationToken.None,
        TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
        TaskScheduler.Default);

    private void TrackCommand(Task task, string? requestId)
    {
        lock (_requestGate)
        {
            if (_activeCommands.Count >= MaximumInFlightCommands)
            {
                throw new InvalidOperationException("Protocol in-flight command bound was exceeded.");
            }

            if (!_activeCommands.Add(task))
            {
                throw new InvalidOperationException("Protocol task was already tracked.");
            }
        }

        _ = task.ContinueWith(
            static (completed, state) =>
            {
                var tracked = ((NativeCameraProtocolServer Server, string? RequestId))state!;
                if (completed.IsFaulted)
                {
                    // Reading Exception marks the aggregate observed; command handling normally
                    // converts failures into terminal results, but no task may become unobserved.
                    _ = completed.Exception;
                }

                lock (tracked.Server._requestGate)
                {
                    tracked.Server._activeCommands.Remove(completed);
                    if (tracked.RequestId is not null)
                    {
                        tracked.Server._activeRequestIds.Remove(tracked.RequestId);
                    }
                }
            },
            (this, requestId),
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
    }

    private async Task ExecuteCommandAsync(ValidatedCommand command, CancellationToken serverCancellationToken)
    {
        CancellationTokenSource? commandTimeout = null;
        try
        {
            commandTimeout = CreateCommandTimeout(command, serverCancellationToken);
            ValidateCommandAgainstWorker(command);
            object payload;
            SafeOffCompletionPayload? acceptedSafeOff = null;
            switch (command.Command)
            {
                case "initialize":
                    var expectedConfiguration = ValidateInitializePayload(command.Payload);
                    _sessionId = command.SessionId;
                    await _worker.InitializeAsync(command.SessionId, command.SessionEpoch, expectedConfiguration, commandTimeout.Token).ConfigureAwait(false);
                    payload = new
                    {
                        state = StateName(_worker.State),
                        rigConfiguration = RigAttestationPayload(),
                        timing = TimingPayload(),
                    };
                    break;
                case "health":
                    RequireEmptyPayload(command.Payload);
                    var health = _worker.GetHealth();
                    payload = new
                    {
                        state = StateName(health.State),
                        healthy = health.State is not (WorkerState.TerminalFault or WorkerState.Shutdown),
                        backend = health.BackendKind,
                        cameraOpen = health.CameraOpen,
                        rigConfigurationVerified = _worker.RigConfiguration is not null,
                        automaticFallbackAttempted = false,
                        timing = TimingPayload(),
                    };
                    break;
                case "capabilities":
                    RequireEmptyPayload(command.Payload);
                    payload = new
                    {
                        state = StateName(_worker.State),
                        backends = new[] { _worker.GetHealth().BackendKind },
                        forensicRoles = ForensicRoles.Required,
                        normalizedWidth = 1200,
                        normalizedHeight = 1680,
                        queueDepth = 1,
                        timing = TimingPayload(),
                    };
                    break;
                case "start_preview":
                    RequireEmptyPayload(command.Payload);
                    await _worker.StartPreviewAsync(command.PreviewEpoch, commandTimeout.Token).ConfigureAwait(false);
                    payload = StatePayload();
                    break;
                case "stop_drain":
                    RequireEmptyPayload(command.Payload);
                    await DisarmAndDrainPreviewEmissionAsync(commandTimeout.Token).ConfigureAwait(false);
                    await _worker.StopAndDrainAsync(commandTimeout.Token).ConfigureAwait(false);
                    payload = StatePayload();
                    break;
                case "set_side":
                    var requestedSide = ParseSetSidePayload(command.Payload);
                    if (requestedSide != command.Side)
                    {
                        throw new InvalidDataException("set_side envelope and payload disagree.");
                    }
                    await _worker.SetSideAsync(requestedSide, command.SideEpoch, commandTimeout.Token).ConfigureAwait(false);
                    payload = StatePayload();
                    break;
                case "execute_forensic_plan":
                    var capturePayload = ParseForensicPlanPayload(command.Payload);
                    var captureStart = MonotonicClock.NowTicks;
                    var capture = await _worker.ExecuteForensicSidePlanAsync(
                        new ForensicSidePlan(
                            command.RequestId,
                            capturePayload.CaptureId,
                            command.Side,
                            new Epochs(command.WorkerEpoch, command.SessionEpoch, command.PreviewEpoch, command.SideEpoch),
                            capturePayload.Profile,
                            capturePayload.Roles),
                        commandTimeout.Token).ConfigureAwait(false);
                    payload = new
                    {
                        state = StateName(_worker.State),
                        captureId = capturePayload.CaptureId,
                        forensicProfile = capturePayload.Profile == ForensicCaptureProfile.FullForensic ? "full_forensic" : "production_fast",
                        artifacts = capture.Artifacts.Select(artifact => ArtifactPayload(artifact, capture.Side, capture.Epochs)),
                        authoritativeAllOnGeometry = GeometryPayload(
                            capture.AuthoritativeAllOnGeometry,
                            capture.AuthoritativeTransform.SourceWidth,
                            capture.AuthoritativeTransform.SourceHeight,
                            capture.AuthoritativeAllOnGeometry.FrameAgeMilliseconds,
                            capture.AuthoritativeAllOnGeometry.DroppedFrames,
                            capture.AuthoritativeAllOnGeometry.Frozen,
                            capture.AuthoritativeAllOnGeometry.ProcessingMilliseconds,
                            ArtifactFrameIdentity(
                                capture.Artifacts.Single(static artifact => artifact.Role == "all_on"),
                                capture.Side,
                                capture.Epochs)),
                        authoritativeTransform = new
                        {
                            sourceFrameId = capture.AuthoritativeTransform.SourceFrameId,
                            sourceSha256 = capture.AuthoritativeTransform.SourceSha256,
                            sourceWidth = capture.AuthoritativeTransform.SourceWidth,
                            sourceHeight = capture.AuthoritativeTransform.SourceHeight,
                            normalizedWidth = capture.AuthoritativeTransform.NormalizedWidth,
                            normalizedHeight = capture.AuthoritativeTransform.NormalizedHeight,
                            homography = capture.AuthoritativeTransform.Homography,
                            reusedByRoles = capture.AuthoritativeTransform.ReusedByRoles,
                        },
                        rigConfiguration = RigAttestationPayload(),
                        package = new
                        {
                            packageId = capture.Package.PackageId,
                            packageSha256 = capture.Package.PackageSha256,
                            manifestSha256 = capture.Package.ManifestSha256,
                            capturePlanSha256 = capture.Package.CapturePlanSha256,
                            idempotent = capture.Package.Idempotent,
                        },
                        captureDurationMs = MonotonicClock.ElapsedMilliseconds(captureStart),
                        droppedFrames = _worker.GetHealth().PreviewDrops,
                        timing = TimingPayload(),
                    };
                    break;
                case "lighting_ack":
                    var acknowledgement = ParseLightingAcknowledgement(command.Payload);
                    _lighting.AcceptAcknowledgement(
                        acknowledgement.CaptureRequestId,
                        acknowledgement.Role,
                        acknowledgement.StableAcknowledgementId,
                        acknowledgement.AuthorizationId,
                        acknowledgement.ExpiresAtUnixMs);
                    payload = StatePayload();
                    break;
                case "lighting_completion":
                    var completion = ParseLightingCompletion(command.Payload);
                    _lighting.AcceptCompletion(completion.CaptureRequestId, completion.Role, completion.AuthorizationId);
                    payload = StatePayload();
                    break;
                case "safe_off_completion":
                    var safeOffCompletion = ParseSafeOffCompletion(command.Payload);
                    _lighting.AcceptSafeOffCompletion(safeOffCompletion.SafeOffRequestId, safeOffCompletion.Safe);
                    acceptedSafeOff = safeOffCompletion;
                    payload = StatePayload();
                    break;
                case "resume_preview":
                    RequireEmptyPayload(command.Payload);
                    await _worker.ResumePreviewAsync(command.PreviewEpoch, commandTimeout.Token).ConfigureAwait(false);
                    payload = StatePayload();
                    break;
                case "safe_idle":
                    RequireEmptyPayload(command.Payload);
                    await DisarmAndDrainPreviewEmissionAsync(commandTimeout.Token).ConfigureAwait(false);
                    await _worker.SafeIdleAsync(commandTimeout.Token).ConfigureAwait(false);
                    payload = StatePayload();
                    break;
                case "shutdown":
                    RequireEmptyPayload(command.Payload);
                    await DisarmAndDrainPreviewEmissionAsync(commandTimeout.Token).ConfigureAwait(false);
                    await _worker.ShutdownAsync(commandTimeout.Token).ConfigureAwait(false);
                    payload = StatePayload();
                    break;
                default:
                    throw new InvalidDataException("Unsupported command.");
            }

            await EmitResultAsync(command, ok: true, payload, null, commandTimeout.Token).ConfigureAwait(false);
            if (acceptedSafeOff is not null)
            {
                _lighting.CompleteSafeOffAcceptance(acceptedSafeOff.SafeOffRequestId);
            }
            if (command.Command is "start_preview" or "resume_preview")
            {
                // Arm only after the successful correlated result has been
                // completely written, so preview can never precede it.
                Volatile.Write(ref _activePreviewRequestId, command.RequestId);
            }
            if (command.Command == "shutdown")
            {
                _lifetime.Cancel();
            }
        }
        catch (Exception exception)
        {
            var code = exception is OperationCanceledException ? "WORKER_TIMEOUT" : "WORKER_FAILURE";
            await _worker.TerminalFaultAsync(code.ToLowerInvariant()).ConfigureAwait(false);
            await TryEmitFailureResultAsync(command, code).ConfigureAwait(false);
        }
        finally
        {
            commandTimeout?.Dispose();
        }
    }

    private async Task EmitPreviewFramesWithFaultBoundaryAsync(CancellationToken cancellationToken)
    {
        try
        {
            await EmitPreviewFramesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception)
        {
            await _diagnostics.WriteLineAsync("native_worker_preview_protocol_fault").ConfigureAwait(false);
            await _worker.TerminalFaultAsync("preview_protocol_emission_failed").ConfigureAwait(false);
        }
    }

    private async Task TryEmitFailureResultAsync(ValidatedCommand command, string code)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        var emission = EmitFailureResultAsync(
            command,
            code,
            "Native command failed terminally.",
            timeout.Token).AsTask();
        try
        {
            await emission.WaitAsync(TimeSpan.FromMilliseconds(1500)).ConfigureAwait(false);
        }
        catch
        {
            ObserveTask(emission);
        }
    }

    private void ValidateCommandAgainstWorker(ValidatedCommand command)
    {
        if (command.WorkerEpoch != _worker.Epochs.WorkerEpoch)
        {
            throw new InvalidDataException("Wrong worker epoch.");
        }

        if (command.Command == "initialize")
        {
            if (command.PreviewEpoch != 0 || command.SideEpoch != 0 || command.Side != CardSide.None)
            {
                throw new InvalidDataException("Initialize epochs or side are invalid.");
            }

            return;
        }

        if (!string.Equals(command.SessionId, _sessionId, StringComparison.Ordinal) || command.SessionEpoch != _worker.Epochs.SessionEpoch)
        {
            throw new InvalidDataException("Wrong session or session epoch.");
        }

        if (command.Command is "start_preview" or "resume_preview")
        {
            if (command.PreviewEpoch != checked(_worker.Epochs.PreviewEpoch + 1) || command.SideEpoch != _worker.Epochs.SideEpoch || command.Side != _worker.Side)
            {
                throw new InvalidDataException("Preview command epochs are out of order.");
            }
        }
        else if (command.Command == "set_side")
        {
            if (command.PreviewEpoch != _worker.Epochs.PreviewEpoch || command.SideEpoch != checked(_worker.Epochs.SideEpoch + 1))
            {
                throw new InvalidDataException("Side epoch is out of order.");
            }
        }
        else if (command.PreviewEpoch != _worker.Epochs.PreviewEpoch || command.SideEpoch != _worker.Epochs.SideEpoch || command.Side != _worker.Side)
        {
            throw new InvalidDataException("Command used stale or wrong epochs.");
        }
    }

    private static CancellationTokenSource CreateCommandTimeout(ValidatedCommand command, CancellationToken serverCancellationToken)
    {
        var remaining = command.DeadlineUnixMs - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (remaining <= 0)
        {
            throw new OperationCanceledException("Command deadline expired.");
        }

        var timeout = Math.Min(command.TimeoutMs, remaining);
        var linked = CancellationTokenSource.CreateLinkedTokenSource(serverCancellationToken);
        linked.CancelAfter(TimeSpan.FromMilliseconds(timeout));
        return linked;
    }

    private async Task EmitPreviewFramesAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var preview = await _worker.ReadLatestPreviewAsync(cancellationToken).ConfigureAwait(false);
            await _previewEmissionGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                var previewRequestId = Volatile.Read(ref _activePreviewRequestId);
                if (previewRequestId is null)
                {
                    continue;
                }

                if (PreviewEmissionAfterCorrelationTestHook is not null)
                {
                    await PreviewEmissionAfterCorrelationTestHook(cancellationToken).ConfigureAwait(false);
                }

                var epochs = preview.Epochs;
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var payload = PreviewPayload(preview);
                await EmitEnvelopeAsync(sequence => new
                {
                    protocolVersion = ProtocolVersion,
                    kind = "event",
                    @event = "preview_frame",
                    requestId = previewRequestId,
                    sessionId = _sessionId,
                    workerEpoch = epochs.WorkerEpoch,
                    sessionEpoch = epochs.SessionEpoch,
                    previewEpoch = epochs.PreviewEpoch,
                    sideEpoch = epochs.SideEpoch,
                    side = SideName(preview.Side),
                    timeoutMs = MaximumTimeoutMilliseconds,
                    deadlineUnixMs = now + MaximumTimeoutMilliseconds,
                    sequence,
                    payload,
                }, cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                _previewEmissionGate.Release();
            }
        }
    }

    private async ValueTask DisarmAndDrainPreviewEmissionAsync(CancellationToken cancellationToken)
    {
        Volatile.Write(ref _activePreviewRequestId, null);
        PreviewDrainStartedTestHook?.Invoke();
        await _previewEmissionGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        _previewEmissionGate.Release();
    }

    private ValueTask EmitLightingProfileRequestedAsync(LightingProfileRequestedEvent request, CancellationToken cancellationToken) =>
        EmitEventAsync(
            "lighting_profile_requested",
            new { captureRequestId = request.CaptureRequestId, role = request.Role, ordinal = request.Ordinal },
            request.CaptureRequestId,
            cancellationToken);

    private ValueTask EmitLightingGrabCompletedAsync(LightingGrabCompletedEvent completed, CancellationToken cancellationToken) =>
        EmitEventAsync(
            "lighting_grab_completed",
            new
            {
                captureRequestId = completed.CaptureRequestId,
                role = completed.Role,
                authorizationId = completed.AuthorizationId,
                frame = FrameIdentity(completed.Frame, _worker.Epochs, _worker.Side),
            },
            completed.CaptureRequestId,
            cancellationToken);

    private ValueTask EmitSafeOffRequestedAsync(SafeOffRequestedEvent request, CancellationToken cancellationToken) =>
        EmitEventAsync(
            "safe_off_requested",
            new { safeOffRequestId = request.SafeOffRequestId, reason = request.Reason },
            request.SafeOffRequestId,
            cancellationToken);

    private ValueTask EmitEventAsync(string eventName, object payload, string requestId, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var epochs = _worker.Epochs;
        return EmitEnvelopeAsync(sequence => new
        {
            protocolVersion = ProtocolVersion,
            kind = "event",
            @event = eventName,
            requestId,
            sessionId = _sessionId,
            workerEpoch = epochs.WorkerEpoch,
            sessionEpoch = epochs.SessionEpoch,
            previewEpoch = epochs.PreviewEpoch,
            sideEpoch = epochs.SideEpoch,
            side = SideName(_worker.Side),
            timeoutMs = MaximumTimeoutMilliseconds,
            deadlineUnixMs = now + MaximumTimeoutMilliseconds,
            sequence,
            payload,
        }, cancellationToken);
    }

    private async ValueTask FaultMalformedAsync(string code, string message, CancellationToken cancellationToken)
    {
        await _worker.TerminalFaultAsync(code.ToLowerInvariant()).ConfigureAwait(false);
    }

    private async ValueTask HandleWorkerTerminalFaultAsync(string publicCode)
    {
        if (Interlocked.Exchange(ref _terminalFaultEventEmitted, 1) != 0)
        {
            return;
        }

        _lifetime.Cancel();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        var emission = EmitTerminalFaultAsync(
            publicCode.ToUpperInvariant(),
            "Native worker terminally faulted.",
            timeout.Token).AsTask();
        try
        {
            await emission.WaitAsync(TimeSpan.FromMilliseconds(1500)).ConfigureAwait(false);
        }
        catch
        {
            ObserveTask(emission);
        }
    }

    private ValueTask EmitTerminalFaultAsync(string code, string message, CancellationToken cancellationToken) =>
        EmitEventAsync("terminal_fault", new { code, message }, "terminal-fault", cancellationToken);

    private ValueTask EmitFailureResultAsync(ValidatedCommand command, string code, string message, CancellationToken cancellationToken) =>
        EmitResultAsync(command, ok: false, null, new { code, message, retryable = false }, cancellationToken);

    private ValueTask EmitResultAsync(ValidatedCommand command, bool ok, object? payload, object? error, CancellationToken cancellationToken) =>
        EmitEnvelopeAsync(sequence => new
        {
            protocolVersion = ProtocolVersion,
            kind = "result",
            command = command.Command,
            requestId = command.RequestId,
            sessionId = command.SessionId,
            workerEpoch = command.WorkerEpoch,
            sessionEpoch = command.SessionEpoch,
            previewEpoch = command.PreviewEpoch,
            sideEpoch = command.SideEpoch,
            side = SideName(command.Side),
            timeoutMs = command.TimeoutMs,
            deadlineUnixMs = command.DeadlineUnixMs,
            sequence,
            ok,
            payload,
            error,
        }, cancellationToken);

    private async ValueTask EmitEnvelopeAsync(Func<long, object> envelopeFactory, CancellationToken cancellationToken)
    {
        await _outputGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        var emitStart = MonotonicClock.NowTicks;
        var oversized = false;
        try
        {
            var sequence = ++_outputSequence;
            var bytes = JsonSerializer.SerializeToUtf8Bytes(envelopeFactory(sequence), JsonOptions);
            if (bytes.Length > MaximumMessageBytes)
            {
                oversized = true;
            }
            else
            {
                await _output.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
                await _output.WriteAsync("\n"u8.ToArray(), cancellationToken).ConfigureAwait(false);
                await _output.FlushAsync(cancellationToken).ConfigureAwait(false);
            }
        }
        finally
        {
            _lastEmitDurationMilliseconds = MonotonicClock.ElapsedMilliseconds(emitStart);
            _outputGate.Release();
        }

        if (oversized)
        {
            await _worker.TerminalFaultAsync("output_message_too_large").ConfigureAwait(false);
            throw new InvalidDataException("Protocol output exceeded one MiB.");
        }
    }

    private object PreviewPayload(PreviewFrameResult preview)
    {
        var frame = FrameIdentityFromPreview(preview);
        var geometry = GeometryPayload(
            preview.Geometry,
            preview.Width,
            preview.Height,
            preview.FrameAgeMilliseconds,
            preview.DroppedFrames,
            preview.Frozen,
            preview.DetectMilliseconds,
            frame);
        var bytes = preview.JpegBytes;
        var emitTicks = MonotonicClock.NowTicks;
        return new
        {
            frame,
            jpeg = new
            {
                mimeType = "image/jpeg",
                base64 = Convert.ToBase64String(bytes),
                byteSize = bytes.Length,
                sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
                width = preview.DisplayWidth,
                height = preview.DisplayHeight,
            },
            geometry,
            telemetry = new
            {
                receiveMonotonicMs = TicksToMilliseconds(preview.ReceiveMonotonicTicks),
                detectMonotonicMs = TicksToMilliseconds(preview.DetectEndMonotonicTicks),
                encodeMonotonicMs = TicksToMilliseconds(preview.EncodeEndMonotonicTicks),
                emitMonotonicMs = TicksToMilliseconds(emitTicks),
                processingMs = preview.DetectMilliseconds + preview.EncodeMilliseconds,
                frameAgeMs = preview.FrameAgeMilliseconds,
                droppedFrames = preview.DroppedFrames,
                frozen = preview.Frozen,
            },
        };
    }

    private static object GeometryPayload(
        GeometryResult geometry,
        int sourceWidth,
        int sourceHeight,
        double frameAgeMilliseconds,
        long droppedFrames,
        bool frozen,
        double processingMilliseconds,
        object frameIdentity)
    {
        var edgeNames = new[] { "top", "right", "bottom", "left" };
        var edges = geometry.Metrics.Edges.Take(4).ToArray();
        var sourceCorners = CornersPayload(geometry.SourceCorners);
        var normalizedCorners = CornersPayload(geometry.NormalizedCorners);
        var fittedLines = geometry.FittedLines.Take(4).Select((line, index) => new
        {
            edge = edgeNames[index],
            a = line.A,
            b = line.B,
            c = line.C,
            support = index < edges.Length ? edges[index].GradientSupport : 0,
            continuity = index < edges.Length ? edges[index].Continuity : 0,
            residualPixels = index < edges.Length ? edges[index].Residual : 0,
        });
        var perEdge = Enumerable.Range(0, 4).Select(index => index < edges.Length ? edges[index].GradientSupport : 0).ToArray();
        var aspectRatio = EstimateAspectRatio(geometry.SourceCorners);
        return new
        {
            detectorVersion = geometry.DetectorVersion,
            detector = geometry.Detector,
            status = geometry.Status,
            reasonCodes = geometry.ReasonCodes.Take(16),
            sourceCorners,
            normalizedCorners,
            fittedLines,
            sourceWidth,
            sourceHeight,
            normalizedWidth = 1200,
            normalizedHeight = 1680,
            sourceToNormalizedHomography = geometry.SourceToNormalizedHomography.Count == 9
                ? geometry.SourceToNormalizedHomography
                : null,
            calibration = new
            {
                id = geometry.CalibrationId,
                sha256 = geometry.CalibrationSha256,
            },
            sensorOrientation = geometry.SensorOrientation is null
                ? null
                : new
                {
                    rotationDegrees = geometry.SensorOrientation.SensorToPortraitRotationDegrees,
                    mirrorHorizontal = geometry.SensorOrientation.MirrorHorizontal,
                    mirrorVertical = geometry.SensorOrientation.MirrorVertical,
                    supportsMirrorHorizontal = geometry.SensorOrientation.SupportsMirrorHorizontal,
                    supportsMirrorVertical = geometry.SensorOrientation.SupportsMirrorVertical,
                },
            currentFrameAuthority = new
            {
                normalizationSafe = geometry.CurrentFrameAuthority.NormalizationSafe,
                captureReady = geometry.CurrentFrameAuthority.CaptureReady,
                rejectionCodes = geometry.CurrentFrameAuthority.RejectionCodes.Take(32),
            },
            center = sourceCorners is null ? null : new { x = geometry.Center.X, y = geometry.Center.Y },
            scale = sourceCorners is null ? (double?)null : geometry.Scale,
            rotationDegrees = sourceCorners is null ? (double?)null : geometry.RotationDegrees,
            confidence = geometry.Confidence,
            metrics = new
            {
                perEdgeSupport = new { top = perEdge[0], right = perEdge[1], bottom = perEdge[2], left = perEdge[3] },
                edgeSupport = perEdge.Average(),
                continuity = edges.Length == 0 ? 0 : edges.Average(static edge => edge.Continuity),
                residualPixels = edges.Length == 0 ? 0 : edges.Average(static edge => edge.Residual),
                convexity = geometry.Metrics.ConvexityScore,
                aspectRatio,
                aspectScore = geometry.Metrics.AspectScore,
                coverage = geometry.Metrics.Coverage,
                clearance = geometry.Metrics.ClearanceScore,
                clearanceFraction = geometry.Metrics.ClearanceFraction,
                fullVisibility = geometry.Metrics.FullVisibility && !geometry.Stale && !frozen,
                perspective = geometry.Metrics.PerspectiveScore,
                perspectiveSkew = geometry.Metrics.PerspectiveSkew,
            },
            frame = frameIdentity,
            detectMonotonicMs = TicksToMilliseconds(geometry.DetectionMonotonicTicks),
            processingMs = processingMilliseconds,
            frameAgeMs = frameAgeMilliseconds,
            droppedFrames,
            frozen,
            stale = geometry.Stale,
            motionDelta = geometry.MotionDelta,
            hysteresis = new
            {
                currentEvidenceReady = geometry.Hysteresis.CurrentFrameQualifies && !frozen,
                consecutiveReadyFrames = geometry.Hysteresis.SupportingFrames,
                requiredReadyFrames = Math.Max(1, geometry.Hysteresis.RequiredFrames),
                removalFenceSatisfied = geometry.RemovalFenceSatisfied,
            },
        };
    }

    private static object? CornersPayload(IReadOnlyList<PointD> corners) => corners.Count == 4
        ? new
        {
            topLeft = new { x = corners[0].X, y = corners[0].Y },
            topRight = new { x = corners[1].X, y = corners[1].Y },
            bottomRight = new { x = corners[2].X, y = corners[2].Y },
            bottomLeft = new { x = corners[3].X, y = corners[3].Y },
        }
        : null;

    private static double EstimateAspectRatio(IReadOnlyList<PointD> corners)
    {
        if (corners.Count != 4)
        {
            return 0;
        }

        var width = (Distance(corners[0], corners[1]) + Distance(corners[3], corners[2])) / 2;
        var height = (Distance(corners[0], corners[3]) + Distance(corners[1], corners[2])) / 2;
        var shorter = Math.Min(width, height);
        return shorter <= double.Epsilon ? 0 : Math.Max(width, height) / shorter;
    }

    private static double Distance(PointD left, PointD right)
    {
        var x = left.X - right.X;
        var y = left.Y - right.Y;
        return Math.Sqrt((x * x) + (y * y));
    }

    private static object ArtifactPayload(ForensicArtifact artifact, CardSide side, Epochs epochs) => new
    {
        role = artifact.Role,
        fileName = artifact.FileName,
        sha256 = artifact.Sha256,
        byteSize = artifact.ByteSize,
        mimeType = artifact.MimeType,
        width = artifact.Width,
        height = artifact.Height,
        frame = ArtifactFrameIdentity(artifact, side, epochs),
        capturedAtUnixMs = artifact.ReceiveTimestampUtc.ToUnixTimeMilliseconds(),
        writeDurationMs = artifact.WriteMilliseconds,
        hashDurationMs = artifact.HashMilliseconds,
    };

    private static object ArtifactFrameIdentity(ForensicArtifact artifact, CardSide side, Epochs epochs) => new
    {
        frameId = artifact.FrameId,
        blockId = artifact.BlockId,
        hardwareTimestampTicks = artifact.HardwareTimestampTicks?.ToString(System.Globalization.CultureInfo.InvariantCulture),
        workerEpoch = epochs.WorkerEpoch,
        sessionEpoch = epochs.SessionEpoch,
        previewEpoch = epochs.PreviewEpoch,
        sideEpoch = epochs.SideEpoch,
        side = SideName(side),
    };

    private static object FrameIdentity(CameraFrame frame, Epochs epochs, CardSide side) => new
    {
        frameId = frame.FrameId,
        blockId = frame.BlockId,
        hardwareTimestampTicks = frame.HardwareTimestampTicks?.ToString(System.Globalization.CultureInfo.InvariantCulture),
        workerEpoch = epochs.WorkerEpoch,
        sessionEpoch = epochs.SessionEpoch,
        previewEpoch = epochs.PreviewEpoch,
        sideEpoch = epochs.SideEpoch,
        side = SideName(side),
    };

    private static object FrameIdentityFromPreview(PreviewFrameResult preview) => new
    {
        frameId = preview.FrameId,
        blockId = preview.BlockId,
        hardwareTimestampTicks = preview.HardwareTimestampTicks?.ToString(System.Globalization.CultureInfo.InvariantCulture),
        workerEpoch = preview.Epochs.WorkerEpoch,
        sessionEpoch = preview.Epochs.SessionEpoch,
        previewEpoch = preview.Epochs.PreviewEpoch,
        sideEpoch = preview.Epochs.SideEpoch,
        side = SideName(preview.Side),
    };

    private object StatePayload() => new { state = StateName(_worker.State), timing = TimingPayload() };

    private object RigAttestationPayload()
    {
        var rig = _worker.RigConfiguration ?? throw new InvalidOperationException("rig_configuration_not_attested");
        return new
        {
            configurationId = rig.ConfigurationId,
            configurationSha256 = rig.CanonicalSha256,
            calibrationId = rig.CalibrationId,
            calibrationSha256 = rig.CalibrationSha256,
            sensorOrientation = new
            {
                rotationDegrees = rig.Orientation.RotationDegrees,
                mirrorHorizontal = rig.Orientation.MirrorX,
                mirrorVertical = rig.Orientation.MirrorY,
                supportsMirrorHorizontal = rig.Orientation.SupportsMirrorX,
                supportsMirrorVertical = rig.Orientation.SupportsMirrorY,
            },
        };
    }

    private object TimingPayload()
    {
        var health = _worker.GetHealth();
        var timing = health.TelemetryMilliseconds;
        return new
        {
            spawnToInitializeMs = FindTiming(timing, "spawn_to_initialize"),
            pylonInitializeMs = FindTiming(timing, "pylon_initialize"),
            cameraDiscoveryMs = FindTiming(timing, "camera_discovery"),
            cameraOpenMs = FindTiming(timing, "camera_open"),
            cameraConfigureMs = FindTiming(timing, "camera_configure"),
            firstPreviewFrameMs = FindTiming(timing, "first_preview_frame"),
            detectMs = FindTiming(timing, "detect"),
            encodeMs = FindTiming(timing, "encode"),
            emitMs = _lastEmitDurationMilliseconds,
            drainMs = FindTiming(timing, "preview_drain"),
            modeSwitchMs = FindTiming(timing, "mode_switch"),
            lightingAcknowledgementMs = FindTiming(timing, "lighting_acknowledgements"),
            firstForensicFrameMs = FindTiming(timing, "first_forensic_frame"),
            forensicGrabMs = FindTiming(timing, "forensic_grabs"),
            forensicWriteMs = FindTiming(timing, "forensic_writes"),
            forensicHashMs = FindTiming(timing, "forensic_hashes"),
            resumeMs = FindTiming(timing, "preview_resume"),
            droppedFrames = health.PreviewDrops,
        };
    }

    private static double? FindTiming(IReadOnlyDictionary<string, double> timings, string key) =>
        timings.TryGetValue(key, out var value) && double.IsFinite(value) && value >= 0 ? value : null;

    private static double TicksToMilliseconds(long ticks) => ticks * 1000d / Stopwatch.Frequency;

    private static string StateName(WorkerState state) => state switch
    {
        WorkerState.Uninitialized => "uninitialized",
        WorkerState.IdleSafe => "idle_safe",
        WorkerState.Previewing => "previewing",
        WorkerState.Draining => "draining",
        WorkerState.CaptureReady => "capture_ready",
        WorkerState.Capturing => "capturing",
        WorkerState.Resuming => "resuming",
        WorkerState.TerminalFault => "faulted",
        WorkerState.Shutdown => "shutdown",
        _ => throw new ArgumentOutOfRangeException(nameof(state)),
    };

    private static string SideName(CardSide side) => side switch
    {
        CardSide.None => "none",
        CardSide.Front => "front",
        CardSide.Back => "back",
        _ => throw new ArgumentOutOfRangeException(nameof(side)),
    };

    private static CardSide ParseSide(string side) => side switch
    {
        "none" => CardSide.None,
        "front" => CardSide.Front,
        "back" => CardSide.Back,
        _ => throw new InvalidDataException("Invalid side."),
    };

    private static ValidatedCommand ValidateCommand(JsonElement root)
    {
        RequireObject(root, "command");
        RequireExactKeys(root,
        [
            "protocolVersion", "kind", "command", "requestId", "sessionId", "workerEpoch", "sessionEpoch",
            "previewEpoch", "sideEpoch", "side", "timeoutMs", "deadlineUnixMs", "sequence", "payload",
        ]);
        if (RequiredString(root, "protocolVersion", 128, safe: false) != ProtocolVersion || RequiredString(root, "kind", 16, safe: false) != "command")
        {
            throw new InvalidDataException("Invalid protocol version or kind.");
        }

        var command = RequiredString(root, "command", 64, safe: true);
        if (!AllowedCommands.Contains(command, StringComparer.Ordinal))
        {
            throw new InvalidDataException("Unknown command.");
        }

        var requestId = RequiredString(root, "requestId", 64, safe: true);
        var sessionId = RequiredString(root, "sessionId", 128, safe: true);
        var workerEpoch = RequiredInteger(root, "workerEpoch", 0);
        var sessionEpoch = RequiredInteger(root, "sessionEpoch", 0);
        var previewEpoch = RequiredInteger(root, "previewEpoch", 0);
        var sideEpoch = RequiredInteger(root, "sideEpoch", 0);
        var side = ParseSide(RequiredString(root, "side", 8, safe: false));
        var timeoutMs = RequiredInteger(root, "timeoutMs", 1, MaximumTimeoutMilliseconds);
        var deadlineUnixMs = RequiredInteger(root, "deadlineUnixMs", 0);
        var sequence = RequiredInteger(root, "sequence", 1);
        var payload = root.GetProperty("payload");
        RequireObject(payload, "payload");
        return new ValidatedCommand(
            command,
            requestId,
            sessionId,
            workerEpoch,
            sessionEpoch,
            previewEpoch,
            sideEpoch,
            side,
            timeoutMs,
            deadlineUnixMs,
            sequence,
            payload.Clone());
    }

    private static readonly string[] AllowedCommands =
    [
        "initialize", "health", "capabilities", "start_preview", "stop_drain", "set_side",
        "execute_forensic_plan", "lighting_ack", "lighting_completion", "safe_off_completion",
        "resume_preview", "safe_idle", "shutdown",
    ];

    private RigConfigurationExpectation ValidateInitializePayload(JsonElement payload)
    {
        RequireExactKeys(payload, ["configurationId", "configurationSha256"]);
        var configurationId = RequiredString(payload, "configurationId", 128, safe: true);
        var configurationSha256 = RequiredString(payload, "configurationSha256", 64, safe: false);
        if (configurationSha256.Length != 64 || configurationSha256.Any(static character => character is not (>= '0' and <= '9' or >= 'a' and <= 'f')))
        {
            throw new InvalidDataException("Configuration SHA-256 must be canonical lowercase hex.");
        }

        return new RigConfigurationExpectation(configurationId, configurationSha256);
    }

    private static CardSide ParseSetSidePayload(JsonElement payload)
    {
        RequireExactKeys(payload, ["side"]);
        var side = ParseSide(RequiredString(payload, "side", 8, safe: false));
        return side is CardSide.Front or CardSide.Back ? side : throw new InvalidDataException("set_side requires front or back.");
    }

    private static CapturePayload ParseForensicPlanPayload(JsonElement payload)
    {
        RequireExactKeys(payload, ["captureId", "forensicProfile", "roles", "normalizedWidth", "normalizedHeight"]);
        var captureId = RequiredString(payload, "captureId", 128, safe: true);
        var profileName = RequiredString(payload, "forensicProfile", 32, safe: true);
        var profile = profileName switch
        {
            "full_forensic" => ForensicCaptureProfile.FullForensic,
            "production_fast" => ForensicCaptureProfile.ProductionFast,
            _ => throw new InvalidDataException("Unknown forensic profile."),
        };
        if (RequiredInteger(payload, "normalizedWidth", 1200, 1200) != 1200 || RequiredInteger(payload, "normalizedHeight", 1680, 1680) != 1680)
        {
            throw new InvalidDataException("Normalized dimensions are fixed.");
        }

        var rolesElement = payload.GetProperty("roles");
        if (rolesElement.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidDataException("roles must be an array.");
        }

        var roles = rolesElement.EnumerateArray().Select(element => ValidateString(element, 32, safe: true)).ToArray();
        var plan = new ForensicSidePlan("validation", captureId, CardSide.Front, new Epochs(0, 0, 0, 0), profile, roles);
        ForensicPlanValidator.Validate(plan);
        return new CapturePayload(captureId, profile, roles);
    }

    private static LightingAcknowledgementPayload ParseLightingAcknowledgement(JsonElement payload)
    {
        RequireExactKeys(payload, ["captureRequestId", "role", "stableAcknowledgementId", "authorizationId", "stableAtUnixMs", "expiresAtUnixMs"]);
        var result = new LightingAcknowledgementPayload(
            RequiredString(payload, "captureRequestId", 64, safe: true),
            RequiredString(payload, "role", 32, safe: true),
            RequiredString(payload, "stableAcknowledgementId", 128, safe: true),
            RequiredString(payload, "authorizationId", 128, safe: true),
            RequiredInteger(payload, "expiresAtUnixMs", 0));
        RequiredInteger(payload, "stableAtUnixMs", 0);
        if (!ForensicRoles.Required.Contains(result.Role, StringComparer.Ordinal))
        {
            throw new InvalidDataException("Invalid forensic role.");
        }

        return result;
    }

    private static SafeOffCompletionPayload ParseSafeOffCompletion(JsonElement payload)
    {
        RequireExactKeys(payload, ["safeOffRequestId", "safe", "completedAtUnixMs"]);
        var result = new SafeOffCompletionPayload(
            RequiredString(payload, "safeOffRequestId", 64, safe: true),
            RequiredBoolean(payload, "safe"));
        RequiredInteger(payload, "completedAtUnixMs", 0);
        return result;
    }

    private static LightingCompletionPayload ParseLightingCompletion(JsonElement payload)
    {
        RequireExactKeys(payload, ["captureRequestId", "role", "authorizationId", "completedAtUnixMs"]);
        var result = new LightingCompletionPayload(
            RequiredString(payload, "captureRequestId", 64, safe: true),
            RequiredString(payload, "role", 32, safe: true),
            RequiredString(payload, "authorizationId", 128, safe: true));
        RequiredInteger(payload, "completedAtUnixMs", 0);
        if (!ForensicRoles.Required.Contains(result.Role, StringComparer.Ordinal))
        {
            throw new InvalidDataException("Invalid forensic role.");
        }

        return result;
    }

    private static void RequireEmptyPayload(JsonElement payload) => RequireExactKeys(payload, []);

    private static void RequireObject(JsonElement value, string name)
    {
        if (value.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException($"{name} must be an object.");
        }
    }

    private static void RequireExactKeys(JsonElement value, IReadOnlyCollection<string> required, IReadOnlyCollection<string>? optional = null)
    {
        RequireObject(value, "value");
        var allowed = new HashSet<string>(required, StringComparer.Ordinal);
        if (optional is not null)
        {
            allowed.UnionWith(optional);
        }

        var present = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
        {
            if (!allowed.Contains(property.Name) || !present.Add(property.Name))
            {
                throw new InvalidDataException("Unexpected or duplicate JSON field.");
            }
        }

        if (required.Any(field => !present.Contains(field)))
        {
            throw new InvalidDataException("Required JSON field is missing.");
        }
    }

    private static string RequiredString(JsonElement value, string name, int maxLength, bool safe)
    {
        if (!value.TryGetProperty(name, out var property))
        {
            throw new InvalidDataException("Required string is missing.");
        }

        return ValidateString(property, maxLength, safe);
    }

    private static string ValidateString(JsonElement value, int maxLength, bool safe)
    {
        if (value.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException("Expected a string.");
        }

        var text = value.GetString() ?? string.Empty;
        if (text.Length == 0 || text.Length > maxLength || (safe && !SafeIdentifier.IsMatch(text)))
        {
            throw new InvalidDataException("String value is out of bounds or unsafe.");
        }

        return text;
    }

    private static long RequiredInteger(JsonElement value, string name, long minimum, long maximum = 9_007_199_254_740_991)
    {
        if (!value.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.Number || !property.TryGetInt64(out var result) || result < minimum || result > maximum)
        {
            throw new InvalidDataException("Integer value is out of bounds.");
        }

        return result;
    }

    private static double RequiredNumber(JsonElement value, string name, double minimum, double maximum)
    {
        if (!value.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.Number || !property.TryGetDouble(out var result) || !double.IsFinite(result) || result < minimum || result > maximum)
        {
            throw new InvalidDataException("Number value is out of bounds.");
        }

        return result;
    }

    private static bool RequiredBoolean(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var property) || property.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            throw new InvalidDataException("Boolean value is invalid.");
        }

        return property.GetBoolean();
    }

    private sealed record ValidatedCommand(
        string Command,
        string RequestId,
        string SessionId,
        long WorkerEpoch,
        long SessionEpoch,
        long PreviewEpoch,
        long SideEpoch,
        CardSide Side,
        long TimeoutMs,
        long DeadlineUnixMs,
        long Sequence,
        JsonElement Payload);

    private sealed record CapturePayload(string CaptureId, ForensicCaptureProfile Profile, IReadOnlyList<string> Roles);
    private sealed record LightingAcknowledgementPayload(
        string CaptureRequestId,
        string Role,
        string StableAcknowledgementId,
        string AuthorizationId,
        long ExpiresAtUnixMs);
    private sealed record LightingCompletionPayload(string CaptureRequestId, string Role, string AuthorizationId);
    private sealed record SafeOffCompletionPayload(string SafeOffRequestId, bool Safe);
    private sealed record RequestRecord(string Fingerprint);

    private enum ProtocolAdmission
    {
        Accepted,
        ExactDuplicate,
        DuplicateMismatch,
        OutOfOrder,
        TooManyInFlight,
    }
}
