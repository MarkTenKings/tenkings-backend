#if PYLON_SDK
using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using Basler.Pylon;
using TenKings.AiGrader.Worker.Core;

namespace TenKings.AiGrader.Pylon.Host;

internal sealed class PylonCameraBackend : ICameraBackend
{
    private readonly SemaphoreSlim _owner = new(1, 1);
    private readonly PylonActivationPermit _permit;
    private readonly TrustedRigConfiguration _configuration;
    private readonly RigSettingsPlan _settingsPlan;
    private Camera? _camera;
    private long _sequence;
    private long _sourceDroppedFrames;
    private bool _disposed;
    private bool _pylonInitialized;
    private bool _expectationVerified;
    private readonly Dictionary<string, double> _timing = new(StringComparer.Ordinal);

    internal PylonCameraBackend(PylonActivationPermit permit, TrustedRigConfiguration configuration)
    {
        _permit = permit ?? throw new ArgumentNullException(nameof(permit));
        _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
        _configuration.Validate();
        if (string.Equals(_configuration.Camera.SelectorValue, "UNCONFIGURED_DO_NOT_USE", StringComparison.Ordinal))
        {
            throw new InvalidDataException("rig_camera_selector_placeholder");
        }
        _settingsPlan = RigSettingsPlan.Create(_configuration);
    }

    public string BackendKind => "pylon";
    public bool IsOpen => _camera?.IsOpen == true;
    public CameraCapabilities Capabilities { get; private set; } = new(0, 0, 0, true, true);
    public IReadOnlyDictionary<string, double> TimingMilliseconds => _timing;
    public RigConfigurationAttestation LoadedRigConfiguration => _configuration.Attestation;
    public RigRuntimePolicy RuntimePolicy => _configuration.RuntimePolicy;

    public ValueTask OpenAndConfigureAsync(CancellationToken cancellationToken) =>
        ValueTask.FromException(new InvalidOperationException("rig_configuration_expectation_required"));

    public async ValueTask OpenAndConfigureAsync(
        RigConfigurationExpectation expectedConfiguration,
        CancellationToken cancellationToken)
    {
        // This check intentionally occurs before Pylon initialization, discovery,
        // camera construction, or open. Protocol input can attest only ID/digest.
        LoadedRigConfiguration.Require(expectedConfiguration);
        _expectationVerified = true;
        await _owner.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (IsOpen)
            {
                return;
            }

            if (!_expectationVerified)
            {
                throw new InvalidOperationException("rig_configuration_expectation_required");
            }

            _ = _permit;
            cancellationToken.ThrowIfCancellationRequested();
            var pylonStart = Stopwatch.GetTimestamp();
            PylonRuntimeLifetime.Initialize();
            _pylonInitialized = true;
            _timing["pylon_initialize"] = MonotonicClock.ElapsedMilliseconds(pylonStart);
            EnforceElapsedBound("pylon_initialize", _configuration.Timeouts.InitializeMilliseconds);

            var discoveryStart = Stopwatch.GetTimestamp();
            // Enumerate every Pylon-visible camera so a second camera of any
            // transport cannot be hidden by a transport filter. The trusted
            // selector then requires the sole device to be the exact GigE rig.
            var devices = CameraFinder.Enumerate();
            _timing["camera_discovery"] = MonotonicClock.ElapsedMilliseconds(discoveryStart);
            _timing["pylon_initialize_discovery"] = MonotonicClock.ElapsedMilliseconds(pylonStart);
            EnforceElapsedBound("pylon_initialize_discovery", _configuration.Timeouts.InitializeMilliseconds);
            var discovered = devices.Select(ToRigCameraIdentity).ToArray();
            _ = TrustedRigCameraSelection.SelectExactSingle(_configuration.Camera, discovered);

            cancellationToken.ThrowIfCancellationRequested();
            var openStart = Stopwatch.GetTimestamp();
            _camera = new Camera(devices[0]);
            _camera.Open();
            _timing["camera_open"] = MonotonicClock.ElapsedMilliseconds(openStart);
            EnforceElapsedBound("camera_open", _configuration.Timeouts.OpenMilliseconds);

            cancellationToken.ThrowIfCancellationRequested();
            var configureStart = Stopwatch.GetTimestamp();
            var receipt = RigSettingsApplicator.ApplyAndVerify(
                _settingsPlan,
                new PylonRigSettingsAdapter(_camera));
            if (receipt.VerifiedSettingCount != _settingsPlan.Settings.Count)
            {
                throw new InvalidOperationException("rig_setting_readback_incomplete");
            }

            Capabilities = new CameraCapabilities(
                _configuration.Settings.SensorWidth,
                _configuration.Settings.SensorHeight,
                checked((int)Math.Ceiling(_configuration.Preview.FramesPerSecond)),
                true,
                true,
                _configuration.Settings.PixelFormat);
            Interlocked.Exchange(ref _sourceDroppedFrames, 0);
            _timing["camera_configure"] = MonotonicClock.ElapsedMilliseconds(configureStart);
            EnforceElapsedBound("camera_configure", _configuration.Timeouts.ConfigureMilliseconds);
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
            var start = MonotonicClock.NowTicks;
            var camera = RequireOpen();
            var grabber = camera.StreamGrabber ?? throw new InvalidOperationException("pylon_stream_grabber_unavailable");
            if (grabber.IsGrabbing)
            {
                grabber.Stop();
            }
            _timing["camera_drain"] = MonotonicClock.ElapsedMilliseconds(start);
            EnforceElapsedBound("camera_drain", _configuration.Timeouts.DrainMilliseconds);
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
            cancellationToken.ThrowIfCancellationRequested();
            var camera = RequireOpen();
            var grabber = camera.StreamGrabber ?? throw new InvalidOperationException("pylon_stream_grabber_unavailable");
            var oneShot = !grabber.IsGrabbing;
            if (oneShot)
            {
                grabber.Start(1, GrabStrategy.OneByOne, GrabLoop.ProvidedByUser);
            }

            using var grab = grabber.RetrieveResult(
                _configuration.Timeouts.GrabMilliseconds,
                TimeoutHandling.ThrowException)
                ?? throw new IOException("pylon_grab_result_missing");
            if (!grab.GrabSucceeded || grab.PixelData is not byte[] source)
            {
                throw new IOException("pylon_grab_failed");
            }

            var width = grab.Width;
            var height = grab.Height;
            if (width != _configuration.Settings.SensorWidth || height != _configuration.Settings.SensorHeight)
            {
                throw new IOException("pylon_frame_dimensions_mismatch");
            }

            var stride = checked(width + grab.PaddingX);
            var pixels = new byte[checked(stride * height)];
            Buffer.BlockCopy(source, 0, pixels, 0, pixels.Length);
            var sequence = Interlocked.Increment(ref _sequence);
            var skippedImages = checked((long)grab.SkippedImageCount);
            if (skippedImages < 0)
            {
                throw new IOException("pylon_skipped_image_count_invalid");
            }
            var sourceDroppedFrames = checked(Interlocked.Read(ref _sourceDroppedFrames) + skippedImages);
            Interlocked.Exchange(ref _sourceDroppedFrames, sourceDroppedFrames);
            var frame = new CameraFrame(
                $"pylon-{sequence}",
                sequence,
                grab.BlockID.ToString(CultureInfo.InvariantCulture),
                checked((long)grab.Timestamp),
                Stopwatch.GetTimestamp(),
                DateTimeOffset.UtcNow,
                width,
                height,
                stride,
                pixels)
            {
                SourceDroppedFrames = sourceDroppedFrames,
            };
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

            var start = MonotonicClock.NowTicks;
            var grabber = _camera.StreamGrabber;
            if (grabber?.IsGrabbing == true)
            {
                grabber.Stop();
            }

            _camera.Close();
            _camera.Dispose();
            _camera = null;
            _timing["camera_close"] = MonotonicClock.ElapsedMilliseconds(start);
            EnforceElapsedBound("camera_close", _configuration.Timeouts.ShutdownMilliseconds);
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

    private static DiscoveredRigCamera ToRigCameraIdentity(ICameraInfo cameraInfo) => new(
        ReadInfo(cameraInfo, CameraInfoKey.SerialNumber),
        ReadInfo(cameraInfo, CameraInfoKey.UserDefinedName),
        ReadInfo(cameraInfo, CameraInfoKey.VendorName),
        ReadInfo(cameraInfo, CameraInfoKey.ModelName),
        ReadInfo(cameraInfo, CameraInfoKey.DeviceType),
        ReadInfo(cameraInfo, CameraInfoKey.TLType));

    private static string ReadInfo(ICameraInfo cameraInfo, string key)
    {
        try
        {
            return cameraInfo[key] ?? string.Empty;
        }
        catch
        {
            return string.Empty;
        }
    }

    private void EnforceElapsedBound(string key, int maximumMilliseconds)
    {
        if (!_timing.TryGetValue(key, out var actual) || actual > maximumMilliseconds)
        {
            throw new TimeoutException($"{key}_timeout");
        }
    }

    private Camera RequireOpen() => _camera is { IsOpen: true } camera
        ? camera
        : throw new InvalidOperationException("pylon_camera_not_open");
}

internal sealed class PylonRigSettingsAdapter(Camera camera) : IRigSettingsAdapter
{
    private readonly Camera _camera = camera ?? throw new ArgumentNullException(nameof(camera));
    private readonly Dictionary<string, IParameter> _resolved = new(StringComparer.Ordinal);

    public bool IsSupportedAndWritable(RigSettingRequirement requirement)
    {
        _resolved.Remove(requirement.Name);
        var candidates = new List<PylonParameterCandidate<IParameter>>();
        foreach (var candidateName in PylonParameterSelection.KnownParameterNames(requirement.Name))
        {
            if (!_camera.Parameters.Contains(candidateName)) continue;
            var parameter = _camera.Parameters[candidateName];
            candidates.Add(new PylonParameterCandidate<IParameter>(
                candidateName,
                parameter,
                parameter.IsEmpty,
                parameter.IsReadable,
                parameter.IsWritable,
                ParameterKind(parameter)));
        }

        var selected = PylonParameterSelection.SelectFirstCompatible(requirement, candidates);
        if (selected is null) return false;
        _resolved.Add(requirement.Name, selected.Node);
        return true;
    }

    public void Write(RigSettingRequirement requirement)
    {
        var parameter = RequireResolved(requirement);
        switch (requirement.Kind)
        {
            case RigSettingKind.Enumeration:
                ((IEnumParameter)parameter).SetValue(requirement.ExpectedCanonicalValue);
                break;
            case RigSettingKind.Integer:
                ((IIntegerParameter)parameter).SetValue(
                    long.Parse(requirement.ExpectedCanonicalValue, CultureInfo.InvariantCulture));
                break;
            case RigSettingKind.Float when parameter is IFloatParameter floatParameter:
                floatParameter.SetValue(
                    double.Parse(requirement.ExpectedCanonicalValue, CultureInfo.InvariantCulture));
                break;
            case RigSettingKind.Float when parameter is IIntegerParameter integerParameter:
                integerParameter.SetValue(
                    checked((long)double.Parse(requirement.ExpectedCanonicalValue, CultureInfo.InvariantCulture)));
                break;
            case RigSettingKind.Boolean:
                ((IBooleanParameter)parameter).SetValue(
                    bool.Parse(requirement.ExpectedCanonicalValue));
                break;
            default:
                throw new InvalidOperationException("rig_setting_type_unsupported");
        }
    }

    public string ReadCanonical(RigSettingRequirement requirement)
    {
        var parameter = RequireResolved(requirement);
        return parameter switch
        {
            IEnumParameter enumParameter => enumParameter.GetValue(),
            IIntegerParameter integerParameter => integerParameter.GetValue().ToString(CultureInfo.InvariantCulture),
            IFloatParameter floatParameter => floatParameter.GetValue().ToString("R", CultureInfo.InvariantCulture),
            IBooleanParameter booleanParameter => booleanParameter.GetValue() ? "true" : "false",
            _ => throw new InvalidOperationException("rig_setting_type_unsupported"),
        };
    }

    private IParameter RequireResolved(RigSettingRequirement requirement) =>
        _resolved.TryGetValue(requirement.Name, out var parameter)
            ? parameter
            : throw new InvalidOperationException("rig_setting_missing_or_unsupported");

    private static RigSettingKind? ParameterKind(IParameter parameter) => parameter switch
    {
        IEnumParameter => RigSettingKind.Enumeration,
        IFloatParameter => RigSettingKind.Float,
        IIntegerParameter => RigSettingKind.Integer,
        IBooleanParameter => RigSettingKind.Boolean,
        _ => null,
    };
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
        PublicInitialize?.Invoke(null, null);
    }

    public static void Terminate() => PublicTerminate?.Invoke(null, null);
}
#endif
