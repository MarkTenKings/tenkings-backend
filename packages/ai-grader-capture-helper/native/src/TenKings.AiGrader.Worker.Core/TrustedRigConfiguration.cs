using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TenKings.AiGrader.Worker.Core;

public sealed record RigConfigurationExpectation(string ConfigurationId, string CanonicalSha256)
{
    public RigConfigurationExpectation Validate()
    {
        RigContractValidation.Identifier(ConfigurationId, nameof(ConfigurationId));
        RigContractValidation.Sha256(CanonicalSha256, nameof(CanonicalSha256));
        return this with { CanonicalSha256 = CanonicalSha256.ToLowerInvariant() };
    }
}

public sealed record RigSensorOrientation(
    int RotationDegrees,
    bool MirrorX,
    bool MirrorY,
    bool SupportsMirrorX,
    bool SupportsMirrorY)
{
    public void Validate()
    {
        if (RotationDegrees is not (0 or 90 or 180 or 270))
        {
            throw new InvalidDataException("rig_orientation_rotation_invalid");
        }

        if ((MirrorX && !SupportsMirrorX) || (MirrorY && !SupportsMirrorY))
        {
            throw new InvalidDataException("rig_orientation_mirror_unsupported");
        }
    }
}

public sealed record RigConfigurationAttestation(
    string ConfigurationId,
    string CanonicalSha256,
    string CalibrationId,
    string CalibrationSha256,
    RigSensorOrientation Orientation)
{
    public void Require(RigConfigurationExpectation expectation)
    {
        RigContractValidation.Identifier(ConfigurationId, nameof(ConfigurationId));
        RigContractValidation.Sha256(CanonicalSha256, nameof(CanonicalSha256));
        RigContractValidation.Identifier(CalibrationId, nameof(CalibrationId));
        RigContractValidation.Sha256(CalibrationSha256, nameof(CalibrationSha256));
        Orientation.Validate();
        var validated = expectation.Validate();
        if (!string.Equals(ConfigurationId, validated.ConfigurationId, StringComparison.Ordinal) ||
            !CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(CanonicalSha256),
                Convert.FromHexString(validated.CanonicalSha256)))
        {
            throw new InvalidDataException("rig_configuration_expectation_mismatch");
        }
    }
}

public sealed record RigCameraSelector(
    string SelectorKind,
    string SelectorValue,
    string ExpectedVendor,
    string ExpectedModel,
    string ExpectedDeviceType,
    string ExpectedTransport)
{
    public void Validate()
    {
        if (SelectorKind is not ("serial_number" or "user_defined_name"))
        {
            throw new InvalidDataException("rig_camera_selector_kind_invalid");
        }

        RigContractValidation.Identifier(SelectorValue, nameof(SelectorValue));
        RigContractValidation.SafeText(ExpectedVendor, nameof(ExpectedVendor));
        RigContractValidation.SafeText(ExpectedModel, nameof(ExpectedModel));
        if (!string.Equals(ExpectedDeviceType, "BaslerGigE", StringComparison.Ordinal) ||
            !string.Equals(ExpectedTransport, "GEV", StringComparison.Ordinal))
        {
            throw new InvalidDataException("rig_camera_transport_invalid");
        }
    }
}

public sealed record RigCameraSettings(
    string PixelFormat,
    int SensorWidth,
    int SensorHeight,
    int OffsetX,
    int OffsetY,
    double ExposureMicroseconds,
    double Gain,
    string ExposureAuto,
    string GainAuto,
    string AcquisitionMode,
    string TriggerSelector,
    string TriggerMode,
    string TriggerSource,
    string LineSelector,
    string LineMode,
    bool LineInverter,
    string LineSource)
{
    public void Validate()
    {
        if (!string.Equals(PixelFormat, "Mono8", StringComparison.Ordinal) ||
            SensorWidth is < 64 or > 8192 || SensorHeight is < 64 or > 8192 ||
            (long)SensorWidth * SensorHeight > 96L * 1024 * 1024 ||
            OffsetX is < 0 or > 8192 || OffsetY is < 0 or > 8192 ||
            !double.IsFinite(ExposureMicroseconds) || ExposureMicroseconds is < 1 or > 100_000 ||
            !double.IsFinite(Gain) || Gain is < -24 or > 48 ||
            !string.Equals(ExposureAuto, "Off", StringComparison.Ordinal) ||
            !string.Equals(GainAuto, "Off", StringComparison.Ordinal) ||
            !string.Equals(AcquisitionMode, "Continuous", StringComparison.Ordinal) ||
            !string.Equals(TriggerSelector, "FrameStart", StringComparison.Ordinal) ||
            !string.Equals(TriggerMode, "Off", StringComparison.Ordinal) ||
            !string.Equals(TriggerSource, "Software", StringComparison.Ordinal) ||
            !string.Equals(LineSelector, "Line2", StringComparison.Ordinal) ||
            !string.Equals(LineMode, "Output", StringComparison.Ordinal) ||
            !LineInverter ||
            !string.Equals(LineSource, "ExposureActive", StringComparison.Ordinal))
        {
            throw new InvalidDataException("rig_camera_settings_invalid");
        }
    }
}

public sealed record RigPreviewSettings(double FramesPerSecond, int JpegQuality)
{
    public void Validate()
    {
        if (!double.IsFinite(FramesPerSecond) || FramesPerSecond is < 1 or > 60 || JpegQuality is < 40 or > 95)
        {
            throw new InvalidDataException("rig_preview_settings_invalid");
        }
    }
}

public sealed record RigQueueSettings(int OutputQueueSize, string PreviewGrabStrategy, string ForensicGrabStrategy)
{
    public void Validate()
    {
        if (OutputQueueSize != 1 ||
            !string.Equals(PreviewGrabStrategy, "LatestImages", StringComparison.Ordinal) ||
            !string.Equals(ForensicGrabStrategy, "OneByOne", StringComparison.Ordinal))
        {
            throw new InvalidDataException("rig_queue_settings_invalid");
        }
    }
}

public sealed record RigOutputContract(
    IReadOnlyList<string> Formats,
    bool LosslessMono8,
    int NormalizedWidth,
    int NormalizedHeight)
{
    public void Validate()
    {
        if (!LosslessMono8 || NormalizedWidth != 1200 || NormalizedHeight != 1680 ||
            Formats.Count != 2 ||
            !Formats.SequenceEqual(["png", "tiff"], StringComparer.Ordinal))
        {
            throw new InvalidDataException("rig_output_contract_invalid");
        }
    }
}

public sealed record RigNormalizedRoi(double X, double Y, double Width, double Height)
{
    public void Validate()
    {
        if (!double.IsFinite(X) || !double.IsFinite(Y) || !double.IsFinite(Width) || !double.IsFinite(Height) ||
            X < 0 || Y < 0 || Width <= 0 || Height <= 0 || X + Width > 1 || Y + Height > 1)
        {
            throw new InvalidDataException("rig_calibration_roi_invalid");
        }
    }
}

public sealed record RigLensCalibration(
    IReadOnlyList<double> CameraMatrix,
    IReadOnlyList<double> DistortionCoefficients)
{
    public void Validate()
    {
        const double maximumFocalLength = 8192 * 16d;
        if (CameraMatrix.Count != 9 || DistortionCoefficients.Count is < 4 or > 12 ||
            CameraMatrix.Any(static value => !double.IsFinite(value)) ||
            DistortionCoefficients.Any(static value => !double.IsFinite(value)) ||
            CameraMatrix[0] is < 1 or > maximumFocalLength || CameraMatrix[4] is < 1 or > maximumFocalLength ||
            Math.Abs(CameraMatrix[1]) > 8192 || CameraMatrix[2] is < 0 or > 8192 ||
            Math.Abs(CameraMatrix[3]) > 1e-12 || CameraMatrix[5] is < 0 or > 8192 ||
            Math.Abs(CameraMatrix[6]) > 1e-12 || Math.Abs(CameraMatrix[7]) > 1e-12 ||
            Math.Abs(CameraMatrix[8] - 1) > 1e-12)
        {
            throw new InvalidDataException("rig_lens_calibration_invalid");
        }
    }
}

public sealed record RigCalibrationReference(
    string CalibrationId,
    string CalibrationSha256,
    RigNormalizedRoi SafeRoi,
    RigLensCalibration? Lens,
    RigSensorOrientation Orientation)
{
    public void Validate()
    {
        RigContractValidation.Identifier(CalibrationId, nameof(CalibrationId));
        RigContractValidation.Sha256(CalibrationSha256, nameof(CalibrationSha256));
        SafeRoi.Validate();
        Lens?.Validate();
        Orientation.Validate();
        var calculated = CalculateCanonicalSha256();
        if (!CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(calculated),
                Convert.FromHexString(CalibrationSha256)))
        {
            throw new InvalidDataException("rig_calibration_digest_mismatch");
        }
    }

    public RigCalibrationReference Seal() =>
        this with { CalibrationSha256 = CalculateCanonicalSha256() };

    public string CalculateCanonicalSha256() =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(ToCanonicalJson(includeDigest: false)))).ToLowerInvariant();

    internal string ToCanonicalJson(bool includeDigest)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            WriteCanonical(writer, includeDigest);
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    internal void WriteCanonical(Utf8JsonWriter writer, bool includeDigest)
    {
        writer.WriteStartObject();
        writer.WriteString("calibrationId", CalibrationId);
        if (includeDigest) writer.WriteString("calibrationSha256", CalibrationSha256.ToLowerInvariant());
        writer.WriteStartObject("safeRoi");
        writer.WriteNumber("x", SafeRoi.X);
        writer.WriteNumber("y", SafeRoi.Y);
        writer.WriteNumber("width", SafeRoi.Width);
        writer.WriteNumber("height", SafeRoi.Height);
        writer.WriteEndObject();
        if (Lens is null)
        {
            writer.WriteNull("lens");
        }
        else
        {
            writer.WriteStartObject("lens");
            writer.WriteStartArray("cameraMatrix");
            foreach (var value in Lens.CameraMatrix) writer.WriteNumberValue(value);
            writer.WriteEndArray();
            writer.WriteStartArray("distortionCoefficients");
            foreach (var value in Lens.DistortionCoefficients) writer.WriteNumberValue(value);
            writer.WriteEndArray();
            writer.WriteEndObject();
        }
        WriteOrientation(writer, Orientation);
        writer.WriteEndObject();
    }

    internal static void WriteOrientation(Utf8JsonWriter writer, RigSensorOrientation orientation)
    {
        writer.WriteStartObject("orientation");
        writer.WriteNumber("rotationDegrees", orientation.RotationDegrees);
        writer.WriteBoolean("mirrorX", orientation.MirrorX);
        writer.WriteBoolean("mirrorY", orientation.MirrorY);
        writer.WriteBoolean("supportsMirrorX", orientation.SupportsMirrorX);
        writer.WriteBoolean("supportsMirrorY", orientation.SupportsMirrorY);
        writer.WriteEndObject();
    }
}

public sealed record RigTimeouts(
    int InitializeMilliseconds,
    int OpenMilliseconds,
    int ConfigureMilliseconds,
    int GrabMilliseconds,
    int DrainMilliseconds,
    int ShutdownMilliseconds)
{
    public void Validate()
    {
        var values = new[]
        {
            InitializeMilliseconds,
            OpenMilliseconds,
            ConfigureMilliseconds,
            GrabMilliseconds,
            DrainMilliseconds,
            ShutdownMilliseconds,
        };
        if (values.Any(static value => value is < 100 or > 30_000))
        {
            throw new InvalidDataException("rig_timeout_out_of_bounds");
        }
    }
}

public sealed record RigRuntimePolicy(
    RigPreviewSettings Preview,
    RigQueueSettings Queue,
    RigOutputContract Output,
    RigTimeouts Timeouts)
{
    public void Validate()
    {
        Preview.Validate();
        Queue.Validate();
        Output.Validate();
        Timeouts.Validate();
    }
}

public sealed record TrustedRigConfiguration(
    string Schema,
    int Version,
    string ConfigurationId,
    string CanonicalSha256,
    RigCameraSelector Camera,
    RigCameraSettings Settings,
    RigPreviewSettings Preview,
    RigQueueSettings Queue,
    RigOutputContract Output,
    RigCalibrationReference Calibration,
    RigSensorOrientation Orientation,
    RigTimeouts Timeouts)
{
    public const string CurrentSchema = "tenkings.ai-grader.trusted-rig";
    public const int CurrentVersion = 1;
    public const int MaximumJsonBytes = 64 * 1024;

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = false,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    public RigConfigurationAttestation Attestation => new(
        ConfigurationId,
        CanonicalSha256.ToLowerInvariant(),
        Calibration.CalibrationId,
        Calibration.CalibrationSha256.ToLowerInvariant(),
        Orientation);

    public RigRuntimePolicy RuntimePolicy => new(Preview, Queue, Output, Timeouts);

    public void Validate(bool verifyDigest = true)
    {
        if (!string.Equals(Schema, CurrentSchema, StringComparison.Ordinal) || Version != CurrentVersion)
        {
            throw new InvalidDataException("rig_schema_or_version_invalid");
        }

        RigContractValidation.Identifier(ConfigurationId, nameof(ConfigurationId));
        RigContractValidation.Sha256(CanonicalSha256, nameof(CanonicalSha256));
        Camera.Validate();
        Settings.Validate();
        Preview.Validate();
        Queue.Validate();
        Output.Validate();
        Calibration.Validate();
        Orientation.Validate();
        if (Calibration.Orientation != Orientation)
        {
            throw new InvalidDataException("rig_calibration_orientation_mismatch");
        }
        Timeouts.Validate();

        if (verifyDigest)
        {
            var calculated = CalculateCanonicalSha256();
            if (!CryptographicOperations.FixedTimeEquals(
                    Convert.FromHexString(calculated),
                    Convert.FromHexString(CanonicalSha256)))
            {
                throw new InvalidDataException("rig_configuration_digest_mismatch");
            }
        }
    }

    public TrustedRigConfiguration Seal()
    {
        var sealedCalibration = Calibration.Seal();
        var candidate = this with
        {
            CanonicalSha256 = new string('0', 64),
            Calibration = sealedCalibration,
        };
        candidate.Validate(verifyDigest: false);
        return candidate with { CanonicalSha256 = candidate.CalculateCanonicalSha256() };
    }

    public string CalculateCanonicalSha256() =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(ToCanonicalJson(includeDigest: false)))).ToLowerInvariant();

    public string ToCanonicalJson(bool includeDigest = true)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = false }))
        {
            writer.WriteStartObject();
            writer.WriteString("schema", Schema);
            writer.WriteNumber("version", Version);
            writer.WriteString("configurationId", ConfigurationId);
            if (includeDigest) writer.WriteString("canonicalSha256", CanonicalSha256.ToLowerInvariant());
            WriteCamera(writer, Camera);
            WriteSettings(writer, Settings);
            writer.WriteStartObject("preview");
            writer.WriteNumber("framesPerSecond", Preview.FramesPerSecond);
            writer.WriteNumber("jpegQuality", Preview.JpegQuality);
            writer.WriteEndObject();
            writer.WriteStartObject("queue");
            writer.WriteNumber("outputQueueSize", Queue.OutputQueueSize);
            writer.WriteString("previewGrabStrategy", Queue.PreviewGrabStrategy);
            writer.WriteString("forensicGrabStrategy", Queue.ForensicGrabStrategy);
            writer.WriteEndObject();
            writer.WriteStartObject("output");
            writer.WriteStartArray("formats");
            foreach (var format in Output.Formats) writer.WriteStringValue(format);
            writer.WriteEndArray();
            writer.WriteBoolean("losslessMono8", Output.LosslessMono8);
            writer.WriteNumber("normalizedWidth", Output.NormalizedWidth);
            writer.WriteNumber("normalizedHeight", Output.NormalizedHeight);
            writer.WriteEndObject();
            writer.WritePropertyName("calibration");
            Calibration.WriteCanonical(writer, includeDigest: true);
            writer.WriteStartObject("orientation");
            writer.WriteNumber("rotationDegrees", Orientation.RotationDegrees);
            writer.WriteBoolean("mirrorX", Orientation.MirrorX);
            writer.WriteBoolean("mirrorY", Orientation.MirrorY);
            writer.WriteBoolean("supportsMirrorX", Orientation.SupportsMirrorX);
            writer.WriteBoolean("supportsMirrorY", Orientation.SupportsMirrorY);
            writer.WriteEndObject();
            writer.WriteStartObject("timeouts");
            writer.WriteNumber("initializeMilliseconds", Timeouts.InitializeMilliseconds);
            writer.WriteNumber("openMilliseconds", Timeouts.OpenMilliseconds);
            writer.WriteNumber("configureMilliseconds", Timeouts.ConfigureMilliseconds);
            writer.WriteNumber("grabMilliseconds", Timeouts.GrabMilliseconds);
            writer.WriteNumber("drainMilliseconds", Timeouts.DrainMilliseconds);
            writer.WriteNumber("shutdownMilliseconds", Timeouts.ShutdownMilliseconds);
            writer.WriteEndObject();
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    public static TrustedRigConfiguration Parse(ReadOnlySpan<byte> utf8Json)
    {
        if (utf8Json.Length is 0 or > MaximumJsonBytes)
        {
            throw new InvalidDataException("rig_configuration_size_invalid");
        }

        try
        {
            using (var document = JsonDocument.Parse(
                utf8Json.ToArray(),
                new JsonDocumentOptions
                {
                    AllowTrailingCommas = false,
                    CommentHandling = JsonCommentHandling.Disallow,
                    MaxDepth = 32,
                }))
            {
                RequireUniqueProperties(document.RootElement);
            }
            var parsed = JsonSerializer.Deserialize<TrustedRigConfiguration>(utf8Json, SerializerOptions)
                ?? throw new InvalidDataException("rig_configuration_missing");
            parsed.Validate();
            return parsed;
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("rig_configuration_json_invalid", exception);
        }
    }

    private static void RequireUniqueProperties(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!names.Add(property.Name))
                {
                    throw new InvalidDataException("rig_configuration_duplicate_property");
                }
                RequireUniqueProperties(property.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var value in element.EnumerateArray()) RequireUniqueProperties(value);
        }
    }

    private static void WriteCamera(Utf8JsonWriter writer, RigCameraSelector value)
    {
        writer.WriteStartObject("camera");
        writer.WriteString("selectorKind", value.SelectorKind);
        writer.WriteString("selectorValue", value.SelectorValue);
        writer.WriteString("expectedVendor", value.ExpectedVendor);
        writer.WriteString("expectedModel", value.ExpectedModel);
        writer.WriteString("expectedDeviceType", value.ExpectedDeviceType);
        writer.WriteString("expectedTransport", value.ExpectedTransport);
        writer.WriteEndObject();
    }

    private static void WriteSettings(Utf8JsonWriter writer, RigCameraSettings value)
    {
        writer.WriteStartObject("settings");
        writer.WriteString("pixelFormat", value.PixelFormat);
        writer.WriteNumber("sensorWidth", value.SensorWidth);
        writer.WriteNumber("sensorHeight", value.SensorHeight);
        writer.WriteNumber("offsetX", value.OffsetX);
        writer.WriteNumber("offsetY", value.OffsetY);
        writer.WriteNumber("exposureMicroseconds", value.ExposureMicroseconds);
        writer.WriteNumber("gain", value.Gain);
        writer.WriteString("exposureAuto", value.ExposureAuto);
        writer.WriteString("gainAuto", value.GainAuto);
        writer.WriteString("acquisitionMode", value.AcquisitionMode);
        writer.WriteString("triggerSelector", value.TriggerSelector);
        writer.WriteString("triggerMode", value.TriggerMode);
        writer.WriteString("triggerSource", value.TriggerSource);
        writer.WriteString("lineSelector", value.LineSelector);
        writer.WriteString("lineMode", value.LineMode);
        writer.WriteBoolean("lineInverter", value.LineInverter);
        writer.WriteString("lineSource", value.LineSource);
        writer.WriteEndObject();
    }
}

public static class TrustedRigConfigurationLoader
{
    public static TrustedRigConfiguration LoadProtectedLocalFile(
        string path,
        ILocalConfigurationProtectionVerifier? protectionVerifier = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        if (!Path.IsPathFullyQualified(path))
        {
            throw new InvalidDataException("rig_configuration_path_not_absolute");
        }

        var fullPath = Path.GetFullPath(path);
        var attributes = File.GetAttributes(fullPath);
        if ((attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0)
        {
            throw new InvalidDataException("rig_configuration_path_unsafe");
        }

        (protectionVerifier ?? WindowsLocalConfigurationProtectionVerifier.Instance).Verify(fullPath);
        using var stream = new FileStream(
            fullPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 4096,
            FileOptions.SequentialScan);
        if (stream.Length is 0 or > TrustedRigConfiguration.MaximumJsonBytes)
        {
            throw new InvalidDataException("rig_configuration_size_invalid");
        }

        var bytes = new byte[checked((int)stream.Length)];
        stream.ReadExactly(bytes);
        return TrustedRigConfiguration.Parse(bytes);
    }
}

public interface ILocalConfigurationProtectionVerifier
{
    void Verify(string fullPath);
}

internal sealed class WindowsLocalConfigurationProtectionVerifier : ILocalConfigurationProtectionVerifier
{
    public static WindowsLocalConfigurationProtectionVerifier Instance { get; } = new();

    public void Verify(string fullPath)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("rig_configuration_acl_platform_unsupported");
        }

        VerifyDescriptor(fullPath);
        var parent = Path.GetDirectoryName(fullPath);
        if (string.IsNullOrWhiteSpace(parent))
        {
            throw new InvalidDataException("rig_configuration_parent_missing");
        }
        VerifyDescriptor(parent);
    }

    [SupportedOSPlatform("windows")]
    private static void VerifyDescriptor(string path)
    {
        var result = NativeMethods.GetNamedSecurityInfo(
            path,
            NativeMethods.SeFileObject,
            NativeMethods.OwnerSecurityInformation | NativeMethods.DaclSecurityInformation,
            out _,
            out _,
            out _,
            out _,
            out var descriptorPointer);
        if (result != 0 || descriptorPointer == IntPtr.Zero)
        {
            throw new InvalidDataException("rig_configuration_acl_unreadable");
        }

        try
        {
            var length = checked((int)NativeMethods.GetSecurityDescriptorLength(descriptorPointer));
            if (length <= 0 || length > 64 * 1024)
            {
                throw new InvalidDataException("rig_configuration_acl_invalid");
            }
            var bytes = new byte[length];
            Marshal.Copy(descriptorPointer, bytes, 0, length);
            RigConfigurationAclPolicy.RequireProtected(new RawSecurityDescriptor(bytes, 0));
        }
        finally
        {
            _ = NativeMethods.LocalFree(descriptorPointer);
        }
    }

    private static class NativeMethods
    {
        public const int SeFileObject = 1;
        public const uint OwnerSecurityInformation = 0x00000001;
        public const uint DaclSecurityInformation = 0x00000004;

        [DllImport("advapi32.dll", EntryPoint = "GetNamedSecurityInfoW", CharSet = CharSet.Unicode)]
        public static extern uint GetNamedSecurityInfo(
            string objectName,
            int objectType,
            uint securityInfo,
            out IntPtr owner,
            out IntPtr group,
            out IntPtr dacl,
            out IntPtr sacl,
            out IntPtr securityDescriptor);

        [DllImport("advapi32.dll", EntryPoint = "GetSecurityDescriptorLength")]
        public static extern uint GetSecurityDescriptorLength(IntPtr securityDescriptor);

        [DllImport("kernel32.dll", EntryPoint = "LocalFree")]
        public static extern IntPtr LocalFree(IntPtr memory);
    }
}

[SupportedOSPlatform("windows")]
public static class RigConfigurationAclPolicy
{
    private const int MutatingAccessMask =
        0x40000000 | // GENERIC_WRITE
        0x10000000 | // GENERIC_ALL
        0x02000000 | // MAXIMUM_ALLOWED (conservative in an allow ACE)
        0x00000002 | // FILE_WRITE_DATA
        0x00000004 | // FILE_APPEND_DATA
        0x00000010 | // FILE_WRITE_EA
        0x00000040 | // FILE_DELETE_CHILD
        0x00000100 | // FILE_WRITE_ATTRIBUTES
        0x00010000 | // DELETE
        0x00040000 | // WRITE_DAC
        0x00080000;  // WRITE_OWNER

    private static readonly HashSet<string> TrustedFixedWriters = new(StringComparer.Ordinal)
    {
        "S-1-5-18",     // LOCAL SYSTEM
        "S-1-5-32-544", // BUILTIN\Administrators
    };

    public static void RequireProtected(RawSecurityDescriptor descriptor)
    {
        using var currentIdentity = WindowsIdentity.GetCurrent();
        RequireProtected(
            descriptor,
            currentIdentity.User is null ? [] : [currentIdentity.User.Value]);
    }

    public static void RequireProtected(
        RawSecurityDescriptor descriptor,
        IEnumerable<string> deliberateTrustedWriterSids)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        ArgumentNullException.ThrowIfNull(deliberateTrustedWriterSids);
        if (descriptor.Owner is null || descriptor.DiscretionaryAcl is null ||
            (descriptor.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0)
        {
            throw new InvalidDataException("rig_configuration_acl_not_protected");
        }

        var trustedWriters = new HashSet<string>(TrustedFixedWriters, StringComparer.Ordinal);
        foreach (var suppliedSid in deliberateTrustedWriterSids)
        {
            try
            {
                trustedWriters.Add(new SecurityIdentifier(suppliedSid).Value);
            }
            catch (ArgumentException exception)
            {
                throw new InvalidDataException("rig_configuration_acl_trusted_writer_invalid", exception);
            }
        }

        var owner = descriptor.Owner.Value;
        if (!trustedWriters.Contains(owner))
        {
            throw new InvalidDataException("rig_configuration_acl_owner_untrusted");
        }

        foreach (GenericAce ace in descriptor.DiscretionaryAcl)
        {
            if (ace is not QualifiedAce qualified)
            {
                throw new InvalidDataException("rig_configuration_acl_ace_unsupported");
            }

            if (qualified.AceQualifier == AceQualifier.AccessDenied)
            {
                continue;
            }

            if (qualified.AceQualifier != AceQualifier.AccessAllowed || qualified.IsCallback)
            {
                throw new InvalidDataException("rig_configuration_acl_ace_unsupported");
            }

            if ((qualified.AccessMask & MutatingAccessMask) != 0 &&
                (qualified.SecurityIdentifier is null || !trustedWriters.Contains(qualified.SecurityIdentifier.Value)))
            {
                throw new InvalidDataException("rig_configuration_acl_writer_untrusted");
            }
        }
    }
}

public static class RigConfigurationDefaults
{
    public static TrustedRigConfiguration SafeFakeConfiguration { get; } = CreateSafeFakeConfiguration();
    public static RigConfigurationAttestation SafeFakeAttestation => SafeFakeConfiguration.Attestation;
    public static RigConfigurationExpectation SafeFakeExpectation => new(
        SafeFakeConfiguration.ConfigurationId,
        SafeFakeConfiguration.CanonicalSha256);

    private static TrustedRigConfiguration CreateSafeFakeConfiguration()
    {
        var orientation = new RigSensorOrientation(0, false, false, false, false);
        var calibration = new RigCalibrationReference(
            "fake-calibration-v1",
            new string('0', 64),
            new RigNormalizedRoi(0.015, 0.015, 0.97, 0.97),
            null,
            orientation).Seal();
        return new TrustedRigConfiguration(
            TrustedRigConfiguration.CurrentSchema,
            TrustedRigConfiguration.CurrentVersion,
            "rig-1",
            new string('0', 64),
            new RigCameraSelector(
                "serial_number",
                "SAFE_FAKE_ONLY",
                "TenKings",
                "SyntheticReplay",
                "BaslerGigE",
                "GEV"),
            new RigCameraSettings(
                "Mono8",
                640,
                896,
                0,
                0,
                45_000,
                0,
                "Off",
                "Off",
                "Continuous",
                "FrameStart",
                "Off",
                "Software",
                "Line2",
                "Output",
                true,
                "ExposureActive"),
            new RigPreviewSettings(15, 85),
            new RigQueueSettings(1, "LatestImages", "OneByOne"),
            new RigOutputContract(["png", "tiff"], true, 1200, 1680),
            calibration,
            orientation,
            new RigTimeouts(5_000, 5_000, 3_000, 2_000, 2_000, 2_000)).Seal();
    }
}

internal static class RigContractValidation
{
    public static void Identifier(string value, string name)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 128 ||
            value.Any(static character => !char.IsAsciiLetterOrDigit(character) && character is not ('.' or '_' or ':' or '-')))
        {
            throw new InvalidDataException($"rig_identifier_invalid:{name}");
        }
    }

    public static void SafeText(string value, string name)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 128 ||
            value.Any(static character => char.IsControl(character) || character is '/' or '\\'))
        {
            throw new InvalidDataException($"rig_text_invalid:{name}");
        }
    }

    public static void Sha256(string value, string name)
    {
        if (value.Length != 64 || value.Any(static character =>
                !(character is >= '0' and <= '9' or >= 'a' and <= 'f')))
        {
            throw new InvalidDataException($"rig_sha256_invalid:{name}");
        }
    }
}
