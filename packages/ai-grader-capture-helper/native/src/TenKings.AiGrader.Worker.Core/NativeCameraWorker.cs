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
    private readonly SemaphoreSlim _captureShutdownGate = new(1, 1);
    private readonly long _spawnTicks = MonotonicClock.NowTicks;
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, double> _telemetry = new(StringComparer.Ordinal);
    private CancellationTokenSource? _previewCancellation;
    private Task? _previewTask;
    private string? _lastPreviewFrameId;
    private string? _lastPreviewBlockId;
    private string _sessionId = string.Empty;
    private RigConfigurationAttestation? _rigConfiguration;
    private RigRuntimePolicy? _rigRuntimePolicy;
    private long _previewFrameIntervalTicks;
    private bool _disposed;
    private int _terminalFaultStarted;
    private int _captureAbortRequested;
    private long _backendDroppedFrames;
    private readonly TaskCompletionSource _terminalFaultCompleted = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public Func<string, ValueTask>? TerminalFaulted { get; set; }
    internal Func<int, CancellationToken, ValueTask>? ForensicRoleStagedTestHook { get; set; }

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
    public RigConfigurationAttestation? RigConfiguration => _rigConfiguration;

    public async ValueTask InitializeAsync(
        string sessionId,
        long sessionEpoch,
        RigConfigurationExpectation expectedConfiguration,
        CancellationToken cancellationToken)
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

                var validatedExpectation = expectedConfiguration.Validate();

                var start = MonotonicClock.NowTicks;
                await _camera.OpenAndConfigureAsync(validatedExpectation, cancellationToken).ConfigureAwait(false);
                var attestation = _camera.LoadedRigConfiguration;
                attestation.Require(validatedExpectation);
                attestation.Orientation.Validate();
                var runtimePolicy = _camera.RuntimePolicy;
                ValidateRuntimePolicy(runtimePolicy);
                _rigConfiguration = attestation;
                _rigRuntimePolicy = runtimePolicy;
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
        TotalDroppedFrames());

    public async ValueTask StartPreviewAsync(long previewEpoch, CancellationToken cancellationToken)
    {
        try
        {
            await _stateGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                RequireState(WorkerState.IdleSafe);
                RequireNextEpoch(previewEpoch, Epochs.PreviewEpoch, "preview");
                ConfigurePreviewCadence();
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
                if (State is not (WorkerState.IdleSafe or WorkerState.CaptureReady))
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
        var captureGateHeld = false;
        try
        {
            await _captureShutdownGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            captureGateHeld = true;
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

                Interlocked.Exchange(ref _captureAbortRequested, 0);
                State = WorkerState.Capturing;
            }
            finally
            {
                _stateGate.Release();
            }

            var rigConfiguration = _rigConfiguration ?? throw new InvalidOperationException("rig_configuration_not_attested");
            await using var package = await _writer.BeginPackageAsync(_sessionId, plan, cancellationToken).ConfigureAwait(false);
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
                    if (Volatile.Read(ref _captureAbortRequested) != 0)
                    {
                        throw new InvalidOperationException("capture_aborted_by_concurrent_shutdown");
                    }
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
                    Interlocked.Exchange(ref _backendDroppedFrames, frame.SourceDroppedFrames);
                    _telemetry["backend_dropped_frames"] = frame.SourceDroppedFrames;
                    if (artifacts.Count == 0)
                    {
                        _telemetry["first_forensic_frame"] = MonotonicClock.ElapsedMilliseconds(_spawnTicks);
                    }

                    if (role == "all_on")
                    {
                        _analyzer.Reset(Epochs, Side, "forensic_all_on");
                        authoritativeGeometry = await _analyzer.AnalyzeForensicCurrentFrameAsync(
                            frame,
                            Epochs,
                            Side,
                            TotalDroppedFrames(frame),
                            cancellationToken).ConfigureAwait(false);
                        ValidateAuthoritativeGeometry(authoritativeGeometry, frame, plan, rigConfiguration);
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

                    var artifact = await package.StageRoleAsync(
                        role,
                        frame,
                        oneGrabMilliseconds,
                        cancellationToken).ConfigureAwait(false);
                    artifacts.Add(artifact);
                    if (ForensicRoleStagedTestHook is not null)
                    {
                        await ForensicRoleStagedTestHook(artifacts.Count, cancellationToken).ConfigureAwait(false);
                    }
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

                if (artifacts.Any(static artifact => string.IsNullOrWhiteSpace(artifact.BlockId)))
                {
                    throw new InvalidDataException("forensic_block_identity_missing");
                }

                var blockIds = artifacts.Select(static artifact => artifact.BlockId!).ToArray();
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
                ForensicPackageCommitResult committedPackage;
                try
                {
                    RequireState(WorkerState.Capturing);
                    if (Volatile.Read(ref _captureAbortRequested) != 0)
                    {
                        throw new InvalidOperationException("capture_aborted_by_concurrent_shutdown");
                    }

                    var commitStart = MonotonicClock.NowTicks;
                    committedPackage = await package.CommitAsync(
                        ForensicPackageBinding.FromAttestation(rigConfiguration),
                        authoritativeGeometry,
                        authoritativeTransform,
                        cancellationToken).ConfigureAwait(false);
                    _telemetry["forensic_package_commit"] = MonotonicClock.ElapsedMilliseconds(commitStart);
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
                    authoritativeTransform,
                    committedPackage);
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
        finally
        {
            if (captureGateHeld)
            {
                _captureShutdownGate.Release();
            }
        }
    }

    private static void ValidateAuthoritativeGeometry(
        GeometryResult geometry,
        CameraFrame frame,
        ForensicSidePlan plan,
        RigConfigurationAttestation rigConfiguration)
    {
        if (!string.Equals(geometry.FrameId, frame.FrameId, StringComparison.Ordinal) ||
            string.IsNullOrWhiteSpace(frame.BlockId) ||
            string.IsNullOrWhiteSpace(geometry.BlockId) ||
            !string.Equals(geometry.BlockId, frame.BlockId, StringComparison.Ordinal) ||
            geometry.Epochs != plan.Epochs ||
            geometry.Side != plan.Side ||
            geometry.SourceWidth != frame.Width ||
            geometry.SourceHeight != frame.Height ||
            geometry.NormalizedWidth != 1200 ||
            geometry.NormalizedHeight != 1680 ||
            !string.Equals(geometry.CalibrationId, rigConfiguration.CalibrationId, StringComparison.Ordinal) ||
            !string.Equals(geometry.CalibrationSha256, rigConfiguration.CalibrationSha256, StringComparison.Ordinal) ||
            geometry.SensorOrientation is null ||
            geometry.SensorOrientation.SensorToPortraitRotationDegrees != rigConfiguration.Orientation.RotationDegrees ||
            geometry.SensorOrientation.MirrorHorizontal != rigConfiguration.Orientation.MirrorX ||
            geometry.SensorOrientation.MirrorVertical != rigConfiguration.Orientation.MirrorY ||
            geometry.SensorOrientation.SupportsMirrorHorizontal != rigConfiguration.Orientation.SupportsMirrorX ||
            geometry.SensorOrientation.SupportsMirrorVertical != rigConfiguration.Orientation.SupportsMirrorY ||
            !geometry.CurrentFrameAuthority.NormalizationSafe ||
            !geometry.CurrentFrameAuthority.CaptureReady ||
            geometry.CurrentFrameAuthority.RejectionCodes.Count != 0 ||
            geometry.SourceCorners.Count != 4 ||
            geometry.NormalizedCorners.Count != 4 ||
            geometry.FittedLines.Count != 4 ||
            geometry.SourceToNormalizedHomography.Count != 9 ||
            geometry.SourceToNormalizedHomography.Any(static value => !double.IsFinite(value)) ||
            !string.Equals(geometry.Status, "ready", StringComparison.Ordinal) ||
            geometry.ReasonCodes.Count != 1 ||
            !string.Equals(geometry.ReasonCodes[0], "none", StringComparison.Ordinal) ||
            geometry.Stale ||
            geometry.Frozen ||
            !geometry.Metrics.FullVisibility ||
            geometry.Confidence < 0.70 ||
            geometry.Metrics.AspectRatio is < 1.18 or > 1.72 ||
            geometry.Metrics.Coverage is < 0.12 or > 0.88 ||
            geometry.Metrics.ClearanceFraction < 0.008 ||
            geometry.Metrics.PerspectiveSkew > 0.36 ||
            geometry.Metrics.Edges.Count != 4 ||
            geometry.Metrics.Edges.Any(static edge =>
                !double.IsFinite(edge.GradientSupport) || edge.GradientSupport < 0.30 ||
                !double.IsFinite(edge.Continuity) || edge.Continuity < 0.34 ||
                !double.IsFinite(edge.Residual) || edge.Residual is < 0 or > 12) ||
            !CornersAreFiniteOrderedConvex(geometry.SourceCorners) ||
            !CornersAreInsideSourceFrame(geometry.SourceCorners, frame.Width, frame.Height) ||
            !CornersAreFiniteOrderedConvex(geometry.NormalizedCorners) ||
            !PhysicalLongEdgeMapsToNormalizedHeight(geometry.SourceCorners) ||
            !NormalizedCornersMatchContract(geometry.NormalizedCorners) ||
            !LinesMatchCorners(geometry.FittedLines, geometry.SourceCorners) ||
            !HomographyMapsCorners(
                geometry.SourceToNormalizedHomography,
                geometry.SourceCorners,
                geometry.NormalizedCorners))
        {
            throw new InvalidDataException("authoritative_all_on_geometry_incoherent");
        }
    }

    private static bool CornersAreInsideSourceFrame(IReadOnlyList<PointD> corners, int width, int height) =>
        width > 0 && height > 0 && corners.Count == 4 && corners.All(point =>
            double.IsFinite(point.X) && double.IsFinite(point.Y) &&
            point.X >= 0 && point.X <= width - 1 &&
            point.Y >= 0 && point.Y <= height - 1);

    private static bool CornersAreFiniteOrderedConvex(IReadOnlyList<PointD> corners)
    {
        if (corners.Count != 4 || corners.Any(static point => !double.IsFinite(point.X) || !double.IsFinite(point.Y)))
        {
            return false;
        }

        double sign = 0;
        for (var index = 0; index < 4; index++)
        {
            var first = corners[index];
            var second = corners[(index + 1) % 4];
            var third = corners[(index + 2) % 4];
            var cross = ((second.X - first.X) * (third.Y - second.Y)) -
                ((second.Y - first.Y) * (third.X - second.X));
            if (!double.IsFinite(cross) || Math.Abs(cross) <= 1e-6)
            {
                return false;
            }

            sign = sign == 0 ? Math.Sign(cross) : sign;
            if (Math.Sign(cross) != Math.Sign(sign))
            {
                return false;
            }
        }

        return true;
    }

    private static bool PhysicalLongEdgeMapsToNormalizedHeight(IReadOnlyList<PointD> corners)
    {
        var width = (Distance(corners[0], corners[1]) + Distance(corners[2], corners[3])) / 2;
        var height = (Distance(corners[1], corners[2]) + Distance(corners[3], corners[0])) / 2;
        return double.IsFinite(width) && double.IsFinite(height) && height > width;
    }

    private static bool NormalizedCornersMatchContract(IReadOnlyList<PointD> corners)
    {
        PointD[] expected = [new(0, 0), new(1199, 0), new(1199, 1679), new(0, 1679)];
        return corners.Select((point, index) => Distance(point, expected[index])).All(static distance => distance <= 1e-6);
    }

    private static bool LinesMatchCorners(IReadOnlyList<LineD> lines, IReadOnlyList<PointD> corners)
    {
        for (var index = 0; index < 4; index++)
        {
            var line = lines[index];
            var first = corners[index];
            var second = corners[(index + 1) % 4];
            var norm = Math.Sqrt((line.A * line.A) + (line.B * line.B));
            if (!double.IsFinite(line.A) || !double.IsFinite(line.B) || !double.IsFinite(line.C) ||
                norm is < 0.999 or > 1.001 ||
                Math.Abs((line.A * first.X) + (line.B * first.Y) + line.C) > 1 ||
                Math.Abs((line.A * second.X) + (line.B * second.Y) + line.C) > 1)
            {
                return false;
            }
        }

        return true;
    }

    private static bool HomographyMapsCorners(
        IReadOnlyList<double> matrix,
        IReadOnlyList<PointD> source,
        IReadOnlyList<PointD> destination)
    {
        var determinant =
            (matrix[0] * ((matrix[4] * matrix[8]) - (matrix[5] * matrix[7]))) -
            (matrix[1] * ((matrix[3] * matrix[8]) - (matrix[5] * matrix[6]))) +
            (matrix[2] * ((matrix[3] * matrix[7]) - (matrix[4] * matrix[6])));
        if (!double.IsFinite(determinant) || Math.Abs(determinant) <= 1e-12)
        {
            return false;
        }

        for (var index = 0; index < 4; index++)
        {
            var denominator = (matrix[6] * source[index].X) + (matrix[7] * source[index].Y) + matrix[8];
            if (!double.IsFinite(denominator) || Math.Abs(denominator) <= 1e-12)
            {
                return false;
            }

            var projected = new PointD(
                ((matrix[0] * source[index].X) + (matrix[1] * source[index].Y) + matrix[2]) / denominator,
                ((matrix[3] * source[index].X) + (matrix[4] * source[index].Y) + matrix[5]) / denominator);
            if (!double.IsFinite(projected.X) || !double.IsFinite(projected.Y) ||
                Distance(projected, destination[index]) > 1)
            {
                return false;
            }
        }

        return true;
    }

    private static double Distance(PointD first, PointD second)
    {
        var x = first.X - second.X;
        var y = first.Y - second.Y;
        return Math.Sqrt((x * x) + (y * y));
    }

    public async ValueTask ResumePreviewAsync(long previewEpoch, CancellationToken cancellationToken)
    {
        try
        {
            await _stateGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                RequireState(WorkerState.IdleSafe);
                RequireNextEpoch(previewEpoch, Epochs.PreviewEpoch, "preview");
                ConfigurePreviewCadence();
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
        var shutdownGateHeld = false;
        try
        {
            await _stateGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (State == WorkerState.Shutdown)
                {
                    return;
                }

                if (State == WorkerState.Capturing)
                {
                    Interlocked.Exchange(ref _captureAbortRequested, 1);
                }
                else
                {
                    RequireState(WorkerState.IdleSafe);
                }
            }
            finally
            {
                _stateGate.Release();
            }

            await _captureShutdownGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            shutdownGateHeld = true;
            await _stateGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                RequireState(WorkerState.IdleSafe);
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
            finally
            {
                _stateGate.Release();
            }
        }
        catch
        {
            await TerminalFaultAsync("shutdown_failed").ConfigureAwait(false);
            throw;
        }
        finally
        {
            if (shutdownGateHeld)
            {
                _captureShutdownGate.Release();
            }
        }
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
            await _stateGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
            try
            {
                if (State == WorkerState.Shutdown)
                {
                    return;
                }

                PublicFaultCode = SanitizePublicCode(publicFaultCode);
                State = WorkerState.TerminalFault;
                _previewCancellation?.Cancel();
            }
            finally
            {
                _stateGate.Release();
            }
            // Physical safety coordination precedes best-effort protocol
            // diagnostics. A wedged stdout sink must never delay safe-off.
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
            var terminalFaulted = TerminalFaulted;
            if (terminalFaulted is not null)
            {
                var notification = terminalFaulted(PublicFaultCode).AsTask();
                try
                {
                    await notification.WaitAsync(TimeSpan.FromMilliseconds(1500)).ConfigureAwait(false);
                }
                catch
                {
                    ObserveFaultedTask(notification);
                    // The process is terminal regardless of whether the protocol
                    // sink is still writable. The host exits non-zero.
                }
            }
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
        _captureShutdownGate.Dispose();
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
                Interlocked.Exchange(ref _backendDroppedFrames, frame.SourceDroppedFrames);
                var droppedFrames = TotalDroppedFrames(frame);
                var frozen = string.Equals(_lastPreviewFrameId, frame.FrameId, StringComparison.Ordinal) ||
                    (!string.IsNullOrEmpty(_lastPreviewBlockId) && !string.IsNullOrEmpty(frame.BlockId) && string.Equals(_lastPreviewBlockId, frame.BlockId, StringComparison.Ordinal));
                _lastPreviewFrameId = frame.FrameId;
                _lastPreviewBlockId = frame.BlockId;

                var detectStart = MonotonicClock.NowTicks;
                var geometry = await _analyzer.AnalyzeAsync(frame, Epochs, Side, droppedFrames, cancellationToken).ConfigureAwait(false);
                var detectEnd = MonotonicClock.NowTicks;
                if (geometry.FrameId != frame.FrameId || geometry.BlockId != frame.BlockId || geometry.Epochs != Epochs || geometry.Side != Side)
                {
                    _analyzer.Reset(Epochs, Side, "analysis_identity_mismatch");
                    throw new InvalidDataException("Analyzer returned geometry for the wrong frame or epoch.");
                }

                if (frozen)
                {
                    _analyzer.Reset(Epochs, Side, "frozen_frame");
                    geometry = RejectFrozenGeometry(geometry, droppedFrames);
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
                    droppedFrames,
                    frozen);
                _previewFrames.Publish(result);
                _telemetry["detect"] = result.DetectMilliseconds;
                _telemetry["encode"] = result.EncodeMilliseconds;
                _telemetry["backend_dropped_frames"] = frame.SourceDroppedFrames;
                _telemetry["queue_dropped_frames"] = _previewFrames.Dropped;
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

    private static void ObserveFaultedTask(Task task) => _ = task.ContinueWith(
        static completed => _ = completed.Exception,
        CancellationToken.None,
        TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
        TaskScheduler.Default);

    private void ResetTracking(string reason)
    {
        _lastPreviewFrameId = null;
        _lastPreviewBlockId = null;
        _previewFrames.Clear();
        _analyzer.Reset(Epochs, Side, reason);
    }

    private long TotalDroppedFrames(CameraFrame? frame = null)
    {
        var backendDrops = frame?.SourceDroppedFrames ?? Interlocked.Read(ref _backendDroppedFrames);
        return checked(backendDrops + _previewFrames.Dropped);
    }

    private static GeometryResult RejectFrozenGeometry(GeometryResult geometry, long droppedFrames) =>
        geometry with
        {
            Status = "not_detected",
            ReasonCodes = ["frozen_frame"],
            SourceCorners = [],
            NormalizedCorners = [],
            FittedLines = [],
            SourceToNormalizedHomography = [],
            Center = new PointD(0, 0),
            Scale = 0,
            RotationDegrees = 0,
            Confidence = 0,
            Metrics = new GeometryMetrics([], 0, 0, 0, 0, 0, 0),
            DroppedFrames = droppedFrames,
            Frozen = true,
            Stale = true,
            MotionDelta = 0,
            RemovalFenceSatisfied = false,
            Hysteresis = new HysteresisEvidence(0, Math.Max(1, geometry.Hysteresis.RequiredFrames), false, "frozen_frame"),
            CurrentFrameAuthority = CurrentFrameAuthorityResult.Unsafe("frozen_frame"),
        };

    private void RequireState(WorkerState expected)
    {
        if (State != expected)
        {
            throw new InvalidOperationException($"invalid_transition:{State}:expected_{expected}");
        }
    }

    private void ConfigurePreviewCadence()
    {
        var policy = _rigRuntimePolicy ?? throw new InvalidOperationException("rig_runtime_policy_unavailable");
        ValidateRuntimePolicy(policy);
        _previewFrameIntervalTicks = Math.Max(
            1,
            (long)(System.Diagnostics.Stopwatch.Frequency / policy.Preview.FramesPerSecond));
    }

    private void ValidateRuntimePolicy(RigRuntimePolicy policy)
    {
        ArgumentNullException.ThrowIfNull(policy);
        policy.Validate();
        if (policy.Preview.FramesPerSecond > _camera.Capabilities.MaxPreviewFramesPerSecond)
        {
            throw new InvalidDataException("rig_preview_frame_rate_unsupported");
        }

        if (policy.Preview.JpegQuality != _previewEncoder.JpegQuality)
        {
            throw new InvalidDataException("rig_preview_jpeg_quality_mismatch");
        }
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
