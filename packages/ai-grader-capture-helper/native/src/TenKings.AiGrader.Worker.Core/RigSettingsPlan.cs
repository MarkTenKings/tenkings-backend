using System.Globalization;

namespace TenKings.AiGrader.Worker.Core;

public enum RigSettingKind
{
    Enumeration,
    Integer,
    Float,
    Boolean,
}

public sealed record RigSettingRequirement(
    string Name,
    RigSettingKind Kind,
    string ExpectedCanonicalValue,
    double NumericTolerance = 0)
{
    public void Validate()
    {
        RigContractValidation.Identifier(Name, nameof(Name));
        if (string.IsNullOrWhiteSpace(ExpectedCanonicalValue) || ExpectedCanonicalValue.Length > 128 ||
            !double.IsFinite(NumericTolerance) || NumericTolerance < 0)
        {
            throw new InvalidDataException("rig_setting_requirement_invalid");
        }

        if (Kind is RigSettingKind.Integer or RigSettingKind.Float &&
            !double.TryParse(ExpectedCanonicalValue, NumberStyles.Float, CultureInfo.InvariantCulture, out var numeric))
        {
            throw new InvalidDataException("rig_setting_numeric_value_invalid");
        }

        if (Kind == RigSettingKind.Boolean && ExpectedCanonicalValue is not ("true" or "false"))
        {
            throw new InvalidDataException("rig_setting_boolean_value_invalid");
        }
    }
}

public sealed record RigSettingsPlan(
    IReadOnlyList<RigSettingRequirement> Settings,
    int OutputQueueSize,
    string PreviewGrabStrategy,
    string ForensicGrabStrategy)
{
    public static RigSettingsPlan Create(TrustedRigConfiguration configuration)
    {
        configuration.Validate();
        var settings = configuration.Settings;
        var plan = new RigSettingsPlan(
            [
                Enum("PixelFormat", settings.PixelFormat),
                Enum("ExposureAuto", settings.ExposureAuto),
                Float("ExposureTime", settings.ExposureMicroseconds, 0.5),
                Enum("GainAuto", settings.GainAuto),
                Float("Gain", settings.Gain, 0.01),
                Integer("OffsetX", settings.OffsetX),
                Integer("OffsetY", settings.OffsetY),
                Integer("Width", settings.SensorWidth),
                Integer("Height", settings.SensorHeight),
                Enum("AcquisitionMode", settings.AcquisitionMode),
                Enum("TriggerSelector", settings.TriggerSelector),
                Enum("TriggerMode", settings.TriggerMode),
                Enum("TriggerSource", settings.TriggerSource),
                Enum("LineSelector", settings.LineSelector),
                Enum("LineMode", settings.LineMode),
                Boolean("LineInverter", settings.LineInverter),
                Enum("LineSource", settings.LineSource),
                Integer("OutputQueueSize", configuration.Queue.OutputQueueSize),
            ],
            configuration.Queue.OutputQueueSize,
            configuration.Queue.PreviewGrabStrategy,
            configuration.Queue.ForensicGrabStrategy);
        plan.Validate();
        return plan;
    }

    public void Validate()
    {
        if (Settings.Count != 18 || Settings.Select(static setting => setting.Name).Distinct(StringComparer.Ordinal).Count() != Settings.Count ||
            Settings.Any(static setting => setting.Name.Contains("UserSet", StringComparison.OrdinalIgnoreCase)) ||
            OutputQueueSize != 1 || PreviewGrabStrategy != "LatestImages" || ForensicGrabStrategy != "OneByOne")
        {
            throw new InvalidDataException("rig_settings_plan_invalid");
        }

        foreach (var setting in Settings) setting.Validate();
    }

    private static RigSettingRequirement Enum(string name, string value) =>
        new(name, RigSettingKind.Enumeration, value);

    private static RigSettingRequirement Integer(string name, long value) =>
        new(name, RigSettingKind.Integer, value.ToString(CultureInfo.InvariantCulture));

    private static RigSettingRequirement Float(string name, double value, double tolerance) =>
        new(name, RigSettingKind.Float, value.ToString("R", CultureInfo.InvariantCulture), tolerance);

    private static RigSettingRequirement Boolean(string name, bool value) =>
        new(name, RigSettingKind.Boolean, value ? "true" : "false");
}

public interface IRigSettingsAdapter
{
    bool IsSupportedAndWritable(RigSettingRequirement requirement);
    void Write(RigSettingRequirement requirement);
    string ReadCanonical(RigSettingRequirement requirement);
}

public sealed record RigSettingsApplicationReceipt(IReadOnlyList<string> VerifiedSettingNames)
{
    public int VerifiedSettingCount => VerifiedSettingNames.Count;
}

public static class RigSettingsApplicator
{
    public static RigSettingsApplicationReceipt ApplyAndVerify(RigSettingsPlan plan, IRigSettingsAdapter adapter)
    {
        ArgumentNullException.ThrowIfNull(plan);
        ArgumentNullException.ThrowIfNull(adapter);
        plan.Validate();
        var verified = new List<string>(plan.Settings.Count);
        foreach (var requirement in plan.Settings)
        {
            if (!adapter.IsSupportedAndWritable(requirement))
            {
                throw new InvalidOperationException("rig_setting_missing_or_unsupported");
            }

            adapter.Write(requirement);
            var actual = adapter.ReadCanonical(requirement);
            if (!ReadbackMatches(requirement, actual))
            {
                throw new InvalidOperationException("rig_setting_readback_mismatch");
            }
            verified.Add(requirement.Name);
        }

        return new RigSettingsApplicationReceipt(verified);
    }

    private static bool ReadbackMatches(RigSettingRequirement requirement, string actual)
    {
        if (requirement.Kind is RigSettingKind.Integer or RigSettingKind.Float)
        {
            return double.TryParse(requirement.ExpectedCanonicalValue, NumberStyles.Float, CultureInfo.InvariantCulture, out var expectedNumber) &&
                double.TryParse(actual, NumberStyles.Float, CultureInfo.InvariantCulture, out var actualNumber) &&
                double.IsFinite(actualNumber) &&
                Math.Abs(expectedNumber - actualNumber) <= requirement.NumericTolerance;
        }

        return string.Equals(requirement.ExpectedCanonicalValue, actual, StringComparison.Ordinal);
    }
}

public sealed record DiscoveredRigCamera(
    string SerialNumber,
    string UserDefinedName,
    string Vendor,
    string Model,
    string DeviceType,
    string Transport);

public static class TrustedRigCameraSelection
{
    public static DiscoveredRigCamera SelectExactSingle(
        RigCameraSelector selector,
        IReadOnlyList<DiscoveredRigCamera> discovered)
    {
        selector.Validate();
        if (discovered.Count != 1)
        {
            throw new InvalidOperationException(discovered.Count == 0
                ? "rig_camera_missing"
                : "rig_multiple_cameras_rejected");
        }

        var candidate = discovered[0];
        var selectedValue = selector.SelectorKind == "serial_number"
            ? candidate.SerialNumber
            : candidate.UserDefinedName;
        if (!string.Equals(selectedValue, selector.SelectorValue, StringComparison.Ordinal) ||
            !string.Equals(candidate.Vendor, selector.ExpectedVendor, StringComparison.Ordinal) ||
            !string.Equals(candidate.Model, selector.ExpectedModel, StringComparison.Ordinal) ||
            !string.Equals(candidate.DeviceType, selector.ExpectedDeviceType, StringComparison.Ordinal) ||
            !string.Equals(candidate.Transport, selector.ExpectedTransport, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("rig_camera_identity_mismatch");
        }

        return candidate;
    }
}
