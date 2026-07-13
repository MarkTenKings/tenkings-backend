using System.Diagnostics;

namespace TenKings.AiGrader.Worker.Core;

public sealed class FakeCameraBackend : ICameraBackend
{
    private readonly SemaphoreSlim _owner = new(1, 1);
    private readonly Func<long, CameraFrame> _frameFactory;
    private readonly TimeSpan _grabDelay;
    private long _sequence;
    private bool _disposed;

    public FakeCameraBackend(
        int width = 640,
        int height = 896,
        TimeSpan? grabDelay = null,
        Func<long, CameraFrame>? frameFactory = null)
    {
        Capabilities = new CameraCapabilities(width, height, 60, true, true);
        _grabDelay = grabDelay ?? TimeSpan.Zero;
        _frameFactory = frameFactory ?? (sequence => CreateCardSceneFrame(sequence, width, height));
    }

    public string BackendKind => "fake";
    public bool IsOpen { get; private set; }
    public CameraCapabilities Capabilities { get; }
    public IReadOnlyDictionary<string, double> TimingMilliseconds { get; } = new Dictionary<string, double>();
    public RigConfigurationAttestation LoadedRigConfiguration => RigConfigurationDefaults.SafeFakeAttestation;
    public RigRuntimePolicy RuntimePolicy => RigConfigurationDefaults.SafeFakeConfiguration.RuntimePolicy;
    public int OpenCount { get; private set; }
    public int CloseCount { get; private set; }
    public int MaximumConcurrentOwners { get; private set; }
    public int GrabCount { get; private set; }
    public bool IsPreviewing { get; private set; }
    public int? FailOnGrabNumber { get; set; }

    public async ValueTask OpenAndConfigureAsync(CancellationToken cancellationToken)
    {
        await EnterOwnerAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            if (IsOpen)
            {
                return;
            }

            IsOpen = true;
            OpenCount++;
        }
        finally
        {
            _owner.Release();
        }
    }

    public ValueTask OpenAndConfigureAsync(
        RigConfigurationExpectation expectedConfiguration,
        CancellationToken cancellationToken)
    {
        LoadedRigConfiguration.Require(expectedConfiguration);
        return OpenAndConfigureAsync(cancellationToken);
    }

    public async ValueTask StartPreviewAsync(CancellationToken cancellationToken)
    {
        await EnterOwnerAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            EnsureOpen();
            IsPreviewing = true;
        }
        finally
        {
            _owner.Release();
        }
    }

    public async ValueTask StopAndDrainAsync(CancellationToken cancellationToken)
    {
        await EnterOwnerAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            EnsureOpen();
            IsPreviewing = false;
        }
        finally
        {
            _owner.Release();
        }
    }

    public async ValueTask<CameraFrame> GrabAsync(CancellationToken cancellationToken)
    {
        await EnterOwnerAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            EnsureOpen();
            if (_grabDelay > TimeSpan.Zero)
            {
                await Task.Delay(_grabDelay, cancellationToken).ConfigureAwait(false);
            }

            GrabCount++;
            if (FailOnGrabNumber == GrabCount)
            {
                throw new IOException("Injected fake camera loss.");
            }

            return _frameFactory(Interlocked.Increment(ref _sequence));
        }
        finally
        {
            _owner.Release();
        }
    }

    public async ValueTask CloseAsync(CancellationToken cancellationToken)
    {
        await EnterOwnerAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (!IsOpen)
            {
                return;
            }

            IsPreviewing = false;
            IsOpen = false;
            CloseCount++;
        }
        finally
        {
            _owner.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        if (IsOpen)
        {
            await CloseAsync(CancellationToken.None).ConfigureAwait(false);
        }

        _disposed = true;
        _owner.Dispose();
    }

    public static CameraFrame CreateGradientFrame(long sequence, int width, int height)
    {
        var pixels = new byte[checked(width * height)];
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                pixels[(y * width) + x] = (byte)((x + y + sequence) % 256);
            }
        }

        return new CameraFrame(
            $"fake-{sequence}",
            sequence,
            sequence.ToString(System.Globalization.CultureInfo.InvariantCulture),
            sequence * 1_000,
            Stopwatch.GetTimestamp(),
            DateTimeOffset.UtcNow,
            width,
            height,
            width,
            pixels);
    }

    public static CameraFrame CreateCardSceneFrame(long sequence, int width = 640, int height = 896)
    {
        if (width < 160 || height < 224)
        {
            throw new ArgumentOutOfRangeException(nameof(width), "Synthetic card scene requires at least 160x224 pixels.");
        }

        var pixels = new byte[checked(width * height)];
        var cardWidth = (int)Math.Round(width * 0.54);
        var cardHeight = (int)Math.Round(cardWidth * 1.4);
        if (cardHeight > height * 0.72)
        {
            cardHeight = (int)Math.Round(height * 0.64);
            cardWidth = (int)Math.Round(cardHeight / 1.4);
        }

        var left = (width - cardWidth) / 2;
        var top = (height - cardHeight) / 2;
        var right = left + cardWidth - 1;
        var bottom = top + cardHeight - 1;
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var index = (y * width) + x;
                var background = 28 + ((x + (y * 3) + sequence) % 7);
                if (x >= left && x <= right && y >= top && y <= bottom)
                {
                    var borderDistance = Math.Min(Math.Min(x - left, right - x), Math.Min(y - top, bottom - y));
                    pixels[index] = borderDistance < 3
                        ? (byte)238
                        : (byte)(184 + ((x + y + sequence) % 12));
                }
                else
                {
                    pixels[index] = (byte)background;
                }
            }
        }

        return new CameraFrame(
            $"fake-{sequence}",
            sequence,
            sequence.ToString(System.Globalization.CultureInfo.InvariantCulture),
            sequence * 1_000,
            Stopwatch.GetTimestamp(),
            DateTimeOffset.UtcNow,
            width,
            height,
            width,
            pixels);
    }

    private async ValueTask EnterOwnerAsync(CancellationToken cancellationToken)
    {
        await _owner.WaitAsync(cancellationToken).ConfigureAwait(false);
        MaximumConcurrentOwners = Math.Max(MaximumConcurrentOwners, 1);
    }

    private void EnsureOpen()
    {
        ThrowIfDisposed();
        if (!IsOpen)
        {
            throw new InvalidOperationException("Camera is not open.");
        }
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);
}

public sealed class ReplayCameraBackend : ICameraBackend
{
    private readonly SemaphoreSlim _owner = new(1, 1);
    private readonly IReadOnlyList<CameraFrame> _frames;
    private int _index;
    private bool _disposed;

    public ReplayCameraBackend(IEnumerable<CameraFrame> frames)
    {
        _frames = frames.ToArray();
        if (_frames.Count == 0)
        {
            throw new ArgumentException("Replay backend requires at least one frame.", nameof(frames));
        }

        foreach (var frame in _frames)
        {
            frame.Validate();
        }

        Capabilities = new CameraCapabilities(
            _frames[0].Width,
            _frames[0].Height,
            60,
            _frames.Any(static frame => frame.BlockId is not null),
            _frames.Any(static frame => frame.HardwareTimestampTicks.HasValue));
    }

    public string BackendKind => "replay";
    public bool IsOpen { get; private set; }
    public CameraCapabilities Capabilities { get; }
    public IReadOnlyDictionary<string, double> TimingMilliseconds { get; } = new Dictionary<string, double>();
    public RigConfigurationAttestation LoadedRigConfiguration => RigConfigurationDefaults.SafeFakeAttestation;
    public RigRuntimePolicy RuntimePolicy => RigConfigurationDefaults.SafeFakeConfiguration.RuntimePolicy;
    public int OpenCount { get; private set; }

    public async ValueTask OpenAndConfigureAsync(CancellationToken cancellationToken)
    {
        await _owner.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (!IsOpen)
            {
                IsOpen = true;
                OpenCount++;
            }
        }
        finally
        {
            _owner.Release();
        }
    }

    public ValueTask OpenAndConfigureAsync(
        RigConfigurationExpectation expectedConfiguration,
        CancellationToken cancellationToken)
    {
        LoadedRigConfiguration.Require(expectedConfiguration);
        return OpenAndConfigureAsync(cancellationToken);
    }

    public ValueTask StartPreviewAsync(CancellationToken cancellationToken) => EnsureOpenAsync(cancellationToken);

    public ValueTask StopAndDrainAsync(CancellationToken cancellationToken) => EnsureOpenAsync(cancellationToken);

    public async ValueTask<CameraFrame> GrabAsync(CancellationToken cancellationToken)
    {
        await _owner.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            EnsureOpen();
            var source = _frames[_index++ % _frames.Count];
            return source with
            {
                MonotonicReceiveTicks = MonotonicClock.NowTicks,
                Mono8 = (byte[])source.Mono8.Clone(),
            };
        }
        finally
        {
            _owner.Release();
        }
    }

    public async ValueTask CloseAsync(CancellationToken cancellationToken)
    {
        await _owner.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            IsOpen = false;
        }
        finally
        {
            _owner.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        if (IsOpen)
        {
            await CloseAsync(CancellationToken.None).ConfigureAwait(false);
        }

        _disposed = true;
        _owner.Dispose();
    }

    private async ValueTask EnsureOpenAsync(CancellationToken cancellationToken)
    {
        await _owner.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            EnsureOpen();
        }
        finally
        {
            _owner.Release();
        }
    }

    private void EnsureOpen()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!IsOpen)
        {
            throw new InvalidOperationException("Replay backend is not open.");
        }
    }
}

public sealed class FakeLightingCoordinator : ILightingCoordinator
{
    private long _token;

    public bool Stable { get; set; } = true;
    public bool Authorized { get; set; } = true;
    public bool SafeOffCompletes { get; set; } = true;
    public int RequestCount { get; private set; }
    public int AuthorizationCount { get; private set; }
    public int SafeOffCount { get; private set; }
    public List<string> RequestedRoles { get; } = [];

    public ValueTask<LightingRequest> RequestEvidenceRoleProfileAsync(string evidenceRole, CardSide side, Epochs epochs, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        RequestCount++;
        RequestedRoles.Add(evidenceRole);
        return ValueTask.FromResult(new LightingRequest(
            $"fake-light-{Interlocked.Increment(ref _token)}",
            evidenceRole,
            side,
            epochs,
            MonotonicClock.NowTicks));
    }

    public ValueTask<LightingStableAcknowledgement> WaitForStableAcknowledgementAsync(LightingRequest request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new LightingStableAcknowledgement(
            request.RequestToken,
            Stable,
            MonotonicClock.NowTicks,
            Stable ? "stable" : "not_stable"));
    }

    public ValueTask<GrabAuthorization> AuthorizeOneGrabAsync(LightingRequest request, LightingStableAcknowledgement acknowledgement, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        AuthorizationCount++;
        return ValueTask.FromResult(new GrabAuthorization(
            request.RequestToken,
            Authorized,
            MonotonicClock.NowTicks,
            DateTimeOffset.UtcNow.AddMinutes(1).ToUnixTimeMilliseconds(),
            Authorized ? "authorized" : "not_authorized"));
    }

    public ValueTask CompleteAuthorizedGrabAsync(LightingRequest request, GrabAuthorization authorization, CameraFrame frame, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.CompletedTask;
    }

    public ValueTask<SafeOffResult> SafeOffAsync(string publicReasonCode, CancellationToken cancellationToken)
    {
        SafeOffCount++;
        return ValueTask.FromResult(new SafeOffResult(
            SafeOffCompletes,
            MonotonicClock.NowTicks,
            SafeOffCompletes ? "safe_off_complete" : "safe_off_failed"));
    }
}

public sealed class NoCardFrameAnalyzer : IFrameAnalyzer
{
    public ValueTask<GeometryResult> AnalyzeAsync(CameraFrame frame, Epochs epochs, CardSide side, long droppedFrames, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.FromResult(GeometryResult.NotDetected(frame, epochs, side, "no_gradient_supported_edges", droppedFrames));
    }

    public ValueTask<GeometryResult> AnalyzeForensicCurrentFrameAsync(
        CameraFrame frame,
        Epochs epochs,
        CardSide side,
        long droppedFrames,
        CancellationToken cancellationToken) =>
        AnalyzeAsync(frame, epochs, side, droppedFrames, cancellationToken);

    public void Reset(Epochs epochs, CardSide side, string reason)
    {
    }
}
