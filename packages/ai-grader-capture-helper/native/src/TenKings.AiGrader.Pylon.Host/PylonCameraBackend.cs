#if PYLON_SDK
using System.Diagnostics;
using System.Reflection;
using Basler.Pylon;
using TenKings.AiGrader.Worker.Core;

namespace TenKings.AiGrader.Pylon.Host;

internal sealed class PylonCameraBackend : ICameraBackend
{
    private readonly SemaphoreSlim _owner = new(1, 1);
    private readonly PylonActivationPermit _permit;
    private Camera? _camera;
    private long _sequence;
    private bool _disposed;
    private bool _pylonInitialized;
    private readonly Dictionary<string, double> _timing = new(StringComparer.Ordinal);

    internal PylonCameraBackend(PylonActivationPermit permit)
    {
        _permit = permit ?? throw new ArgumentNullException(nameof(permit));
    }

    public string BackendKind => "pylon";
    public bool IsOpen => _camera?.IsOpen == true;
    public CameraCapabilities Capabilities { get; private set; } = new(0, 0, 60, true, true);
    public IReadOnlyDictionary<string, double> TimingMilliseconds => _timing;

    public async ValueTask OpenAndConfigureAsync(CancellationToken cancellationToken)
    {
        await _owner.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (IsOpen)
            {
                return;
            }

            _ = _permit;
            var pylonStart = Stopwatch.GetTimestamp();
            PylonRuntimeLifetime.Initialize();
            _pylonInitialized = true;
            _timing["pylon_initialize"] = MonotonicClock.ElapsedMilliseconds(pylonStart);
            var discoveryStart = Stopwatch.GetTimestamp();
            var devices = CameraFinder.Enumerate();
            _timing["camera_discovery"] = MonotonicClock.ElapsedMilliseconds(discoveryStart);
            if (devices.Count != 1)
            {
                throw new InvalidOperationException("pylon_camera_count_not_one");
            }

            var openStart = Stopwatch.GetTimestamp();
            _camera = new Camera(devices[0]);
            _camera.Open();
            _timing["camera_open"] = MonotonicClock.ElapsedMilliseconds(openStart);
            var configureStart = Stopwatch.GetTimestamp();
            _camera.Parameters[PLCamera.PixelFormat].SetValue(PLCamera.PixelFormat.Mono8);
            _camera.Parameters[PLCamera.AcquisitionMode].SetValue(PLCamera.AcquisitionMode.Continuous);
            _camera.Parameters[PLCameraInstance.OutputQueueSize].SetValue(1);
            var width = checked((int)_camera.Parameters[PLCamera.Width].GetValue());
            var height = checked((int)_camera.Parameters[PLCamera.Height].GetValue());
            Capabilities = new CameraCapabilities(width, height, 60, true, true);
            _timing["camera_configure"] = MonotonicClock.ElapsedMilliseconds(configureStart);
        }
        catch
        {
            _camera?.Close();
            _camera?.Dispose();
            _camera = null;
            if (_pylonInitialized)
            {
                PylonRuntimeLifetime.Terminate();
                _pylonInitialized = false;
            }
            throw;
        }
        finally
        {
            _owner.Release();
        }
    }

    public async ValueTask StartPreviewAsync(CancellationToken cancellationToken)
    {
        await _owner.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var camera = RequireOpen();
            var grabber = camera.StreamGrabber ?? throw new InvalidOperationException("pylon_stream_grabber_unavailable");
            if (!grabber.IsGrabbing)
            {
                grabber.Start(GrabStrategy.LatestImages, GrabLoop.ProvidedByUser);
            }
        }
        finally
        {
            _owner.Release();
        }
    }

    public async ValueTask StopAndDrainAsync(CancellationToken cancellationToken)
    {
        await _owner.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var camera = RequireOpen();
            var grabber = camera.StreamGrabber ?? throw new InvalidOperationException("pylon_stream_grabber_unavailable");
            if (grabber.IsGrabbing)
            {
                grabber.Stop();
            }
        }
        finally
        {
            _owner.Release();
        }
    }

    public async ValueTask<CameraFrame> GrabAsync(CancellationToken cancellationToken)
    {
        await _owner.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var camera = RequireOpen();
            var grabber = camera.StreamGrabber ?? throw new InvalidOperationException("pylon_stream_grabber_unavailable");
            var oneShot = !grabber.IsGrabbing;
            if (oneShot)
            {
                grabber.Start(1, GrabStrategy.OneByOne, GrabLoop.ProvidedByUser);
            }

            var timeoutMilliseconds = 2_000;
            using var grab = grabber.RetrieveResult(timeoutMilliseconds, TimeoutHandling.ThrowException)
                ?? throw new IOException("pylon_grab_result_missing");
            if (!grab.GrabSucceeded || grab.PixelData is not byte[] source)
            {
                throw new IOException("pylon_grab_failed");
            }

            var width = grab.Width;
            var height = grab.Height;
            var stride = checked(width + grab.PaddingX);
            var pixels = new byte[checked(stride * height)];
            Buffer.BlockCopy(source, 0, pixels, 0, pixels.Length);
            var sequence = Interlocked.Increment(ref _sequence);
            var frame = new CameraFrame(
                $"pylon-{sequence}",
                sequence,
                grab.BlockID.ToString(System.Globalization.CultureInfo.InvariantCulture),
                checked((long)grab.Timestamp),
                Stopwatch.GetTimestamp(),
                DateTimeOffset.UtcNow,
                width,
                height,
                stride,
                pixels);
            frame.Validate();
            return frame;
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
            if (_camera is null)
            {
                return;
            }

            var grabber = _camera.StreamGrabber;
            if (grabber?.IsGrabbing == true)
            {
                grabber.Stop();
            }

            _camera.Close();
            _camera.Dispose();
            _camera = null;
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

        if (_camera is not null)
        {
            await CloseAsync(CancellationToken.None).ConfigureAwait(false);
        }

        _disposed = true;
        if (_pylonInitialized)
        {
            PylonRuntimeLifetime.Terminate();
            _pylonInitialized = false;
        }
        _owner.Dispose();
    }

    private Camera RequireOpen() => _camera is { IsOpen: true } camera
        ? camera
        : throw new InvalidOperationException("pylon_camera_not_open");
}

internal static class PylonRuntimeLifetime
{
    private static readonly Type? PublicRuntimeType =
        typeof(Camera).Assembly.GetType("Basler.Pylon.Pylon", throwOnError: false, ignoreCase: false);
    private static readonly MethodInfo? PublicInitialize =
        PublicRuntimeType?.GetMethod("Initialize", BindingFlags.Public | BindingFlags.Static, Type.EmptyTypes);
    private static readonly MethodInfo? PublicTerminate =
        PublicRuntimeType?.GetMethod("Terminate", BindingFlags.Public | BindingFlags.Static, Type.EmptyTypes);

    public static void Initialize()
    {
        // Older SDKs expose explicit public lifetime calls. Current net8 wrappers
        // own the native lifetime internally, so touching the assembly is the
        // bounded initialization step and no private API is invoked.
        PublicInitialize?.Invoke(null, null);
    }

    public static void Terminate() => PublicTerminate?.Invoke(null, null);
}
#endif
