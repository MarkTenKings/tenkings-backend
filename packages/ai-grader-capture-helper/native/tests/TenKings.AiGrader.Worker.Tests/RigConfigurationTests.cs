using System.Security.AccessControl;
using System.Security.Principal;
using TenKings.AiGrader.Pylon.Host;
using TenKings.AiGrader.Worker.Core;
using TenKings.AiGrader.Worker.Host;

namespace TenKings.AiGrader.Worker.Tests;

public sealed class RigConfigurationTests
{
    private const string ExampleCalibrationSha256 = "1218d5d01e21a67cbc0bbfb43da51368c3d468b23db99f3e90852325c4807d57";
    private const string ExampleConfigurationSha256 = "2c80972da97473206429fc42aee8262203d3a322b4d663f8e24e1267490e8847";

    [Fact]
    public void CanonicalContractPinsReviewedDellSemanticsAndDigests()
    {
        var configuration = CreateExampleConfiguration();

        Assert.Equal(ExampleCalibrationSha256, configuration.Calibration.CalibrationSha256);
        Assert.Equal(ExampleConfigurationSha256, configuration.CanonicalSha256);
        Assert.Equal("a2A2448-23gmBAS", configuration.Camera.ExpectedModel);
        Assert.Equal(("Mono8", 2448, 2048, 45_000d, 0d),
            (configuration.Settings.PixelFormat, configuration.Settings.SensorWidth, configuration.Settings.SensorHeight,
                configuration.Settings.ExposureMicroseconds, configuration.Settings.Gain));
        Assert.Equal(("Off", "Off", "Continuous", "FrameStart", "Off", "Software"),
            (configuration.Settings.ExposureAuto, configuration.Settings.GainAuto, configuration.Settings.AcquisitionMode,
                configuration.Settings.TriggerSelector, configuration.Settings.TriggerMode, configuration.Settings.TriggerSource));
        Assert.Equal(("Line2", "Output", true, "ExposureActive"),
            (configuration.Settings.LineSelector, configuration.Settings.LineMode,
                configuration.Settings.LineInverter, configuration.Settings.LineSource));
        Assert.Equal((90, false, false),
            (configuration.Orientation.RotationDegrees, configuration.Orientation.MirrorX, configuration.Orientation.MirrorY));
        Assert.Equal((1200, 1680), (configuration.Output.NormalizedWidth, configuration.Output.NormalizedHeight));
        configuration.RuntimePolicy.Validate();
        Assert.Equal((15d, 72), (
            configuration.RuntimePolicy.Preview.FramesPerSecond,
            configuration.RuntimePolicy.Preview.JpegQuality));
        configuration.Validate();

        var tracked = TrustedRigConfiguration.Parse(File.ReadAllBytes(Path.Combine(
            FindNativeRoot(), "config", "trusted-rig.redacted-example.json")));
        Assert.Equal(ExampleConfigurationSha256, tracked.CanonicalSha256);
        Assert.Equal("UNCONFIGURED_DO_NOT_USE", tracked.Camera.SelectorValue);
        Assert.Equal(configuration.ToCanonicalJson(), tracked.ToCanonicalJson());
    }

    [Fact]
    public void StrictParserRejectsUnknownFieldsAndDigestTampering()
    {
        var configuration = CreateExampleConfiguration();
        var json = configuration.ToCanonicalJson();
        var parsed = TrustedRigConfiguration.Parse(System.Text.Encoding.UTF8.GetBytes(json));
        Assert.Equal(configuration.ConfigurationId, parsed.ConfigurationId);
        Assert.Equal(configuration.CanonicalSha256, parsed.CanonicalSha256);
        Assert.Equal(json, parsed.ToCanonicalJson());

        var configurationToken =
            System.Text.Json.JsonSerializer.Serialize("configurationId") + ":" +
            System.Text.Json.JsonSerializer.Serialize("redacted-dell-fixed-rig-v1");
        var withUnknown = json.Replace(
            configurationToken,
            configurationToken + "," + System.Text.Json.JsonSerializer.Serialize("deviceOverride") + ":true",
            StringComparison.Ordinal);
        Assert.Throws<InvalidDataException>(() =>
            TrustedRigConfiguration.Parse(System.Text.Encoding.UTF8.GetBytes(withUnknown)));
        var duplicate = json.Replace(
            configurationToken,
            configurationToken + "," + configurationToken,
            StringComparison.Ordinal);
        Assert.Throws<InvalidDataException>(() =>
            TrustedRigConfiguration.Parse(System.Text.Encoding.UTF8.GetBytes(duplicate)));

        var exposureToken = System.Text.Json.JsonSerializer.Serialize("exposureMicroseconds");
        var tampered = json.Replace(exposureToken + ":45000", exposureToken + ":45001", StringComparison.Ordinal);
        Assert.Throws<InvalidDataException>(() =>
            TrustedRigConfiguration.Parse(System.Text.Encoding.UTF8.GetBytes(tampered)));
    }

    [Fact]
    public void ExpectedIdAndDigestMustMatchBeforeAnySettingsAreApplied()
    {
        var configuration = CreateExampleConfiguration();
        var adapter = new RecordingSettingsAdapter();
        Assert.Throws<InvalidDataException>(() => configuration.Attestation.Require(
            new RigConfigurationExpectation(configuration.ConfigurationId, new string('0', 64))));
        Assert.Empty(adapter.Writes);

        configuration.Attestation.Require(
            new RigConfigurationExpectation(configuration.ConfigurationId, configuration.CanonicalSha256));
        var receipt = RigSettingsApplicator.ApplyAndVerify(RigSettingsPlan.Create(configuration), adapter);
        Assert.Equal(18, receipt.VerifiedSettingCount);
    }

    [Fact]
    public async Task BackendExpectationMismatchFailsBeforeOpen()
    {
        await using var camera = new FakeCameraBackend();
        var attestation = camera.LoadedRigConfiguration;
        await Assert.ThrowsAsync<InvalidDataException>(async () =>
            await camera.OpenAndConfigureAsync(
                new RigConfigurationExpectation(attestation.ConfigurationId, new string('0', 64)),
                CancellationToken.None));
        Assert.False(camera.IsOpen);
        Assert.Equal(0, camera.OpenCount);

        await camera.OpenAndConfigureAsync(
            new RigConfigurationExpectation(attestation.ConfigurationId, attestation.CanonicalSha256),
            CancellationToken.None);
        Assert.True(camera.IsOpen);
        Assert.Equal(1, camera.OpenCount);
    }

    [Fact]
    public void EveryRequiredSettingIsAppliedAndReadBackWithoutUserSetPersistence()
    {
        var plan = RigSettingsPlan.Create(CreateExampleConfiguration());
        var adapter = new RecordingSettingsAdapter();

        var receipt = RigSettingsApplicator.ApplyAndVerify(plan, adapter);

        Assert.Equal(
            new[]
            {
                "PixelFormat", "ExposureAuto", "ExposureTime", "GainAuto", "Gain",
                "OffsetX", "OffsetY", "Width", "Height", "AcquisitionMode",
                "TriggerSelector", "TriggerMode", "TriggerSource", "LineSelector",
                "LineMode", "LineInverter", "LineSource", "OutputQueueSize",
            },
            receipt.VerifiedSettingNames);
        Assert.Equal(receipt.VerifiedSettingNames, adapter.Writes);
        Assert.DoesNotContain(receipt.VerifiedSettingNames, static name =>
            name.Contains("UserSet", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void MissingUnsupportedAndReadbackMismatchFailClosed()
    {
        var plan = RigSettingsPlan.Create(CreateExampleConfiguration());
        Assert.Throws<InvalidOperationException>(() =>
            RigSettingsApplicator.ApplyAndVerify(plan, new RecordingSettingsAdapter(unsupported: "Gain")));
        Assert.Throws<InvalidOperationException>(() =>
            RigSettingsApplicator.ApplyAndVerify(
                plan,
                new RecordingSettingsAdapter(readbackOverrides: new Dictionary<string, string>
                {
                    ["ExposureTime"] = "45001",
                })));
    }

    [Fact]
    public void Pylon_alias_selection_skips_incompatible_nodes_and_retains_the_exact_candidate()
    {
        var requirement = new RigSettingRequirement(
            "Gain",
            RigSettingKind.Float,
            "0",
            0.01);
        var presentButReadOnly = new object();
        var presentButWrongType = new object();
        var compatibleAlias = new object();
        var laterAlias = new object();

        var selected = PylonParameterSelection.SelectFirstCompatible(
            requirement,
            new[]
            {
                new PylonParameterCandidate<object>(
                    "Gain", presentButReadOnly, false, true, false, RigSettingKind.Float),
                new PylonParameterCandidate<object>(
                    "GainAbs", presentButWrongType, false, true, true, RigSettingKind.Boolean),
                new PylonParameterCandidate<object>(
                    "GainRaw", compatibleAlias, false, true, true, RigSettingKind.Integer),
                new PylonParameterCandidate<object>(
                    "unreachable", laterAlias, false, true, true, RigSettingKind.Float),
            });

        Assert.NotNull(selected);
        Assert.Equal("GainRaw", selected.Name);
        Assert.Same(compatibleAlias, selected.Node);
        Assert.NotSame(laterAlias, selected.Node);
        Assert.Equal(
            ["ExposureTime", "ExposureTimeAbs"],
            PylonParameterSelection.KnownParameterNames("ExposureTime"));
        Assert.Equal(
            ["Gain", "GainAbs", "GainRaw"],
            PylonParameterSelection.KnownParameterNames("Gain"));
    }

    [Fact]
    public void CameraSelectionRequiresExactlyOneExactGigECamera()
    {
        var selector = CreateExampleConfiguration().Camera;
        var exact = new DiscoveredRigCamera(
            "UNCONFIGURED_DO_NOT_USE", string.Empty, "Basler", "a2A2448-23gmBAS", "BaslerGigE", "GEV");

        Assert.Equal(exact, TrustedRigCameraSelection.SelectExactSingle(selector, [exact]));
        Assert.Throws<InvalidOperationException>(() => TrustedRigCameraSelection.SelectExactSingle(selector, []));
        Assert.Throws<InvalidOperationException>(() => TrustedRigCameraSelection.SelectExactSingle(selector, [exact, exact]));
        Assert.Throws<InvalidOperationException>(() => TrustedRigCameraSelection.SelectExactSingle(
            selector, [exact with { Model = "wrong-model" }]));
        Assert.Throws<InvalidOperationException>(() => TrustedRigCameraSelection.SelectExactSingle(
            selector, [exact with { Transport = "USB" }]));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(90)]
    [InlineData(180)]
    [InlineData(270)]
    public void BoundedSensorRotationsAreAccepted(int rotation)
    {
        var orientation = new RigSensorOrientation(rotation, false, false, false, false);
        orientation.Validate();
    }

    [Fact]
    public void UnsupportedMirrorAndCalibrationOrientationMismatchAreRejected()
    {
        Assert.Throws<InvalidDataException>(() =>
            new RigSensorOrientation(90, true, false, false, false).Validate());

        var valid = CreateExampleConfiguration();
        var contradictory = valid with
        {
            Orientation = valid.Orientation with { RotationDegrees = 180 },
        };
        Assert.Throws<InvalidDataException>(() => contradictory.Validate());
    }

    [Fact]
    public void Oversized_sensor_contract_and_noncanonical_lens_fail_before_settings_application()
    {
        var valid = CreateExampleConfiguration();
        var adapter = new RecordingSettingsAdapter();
        var oversized = valid with { Settings = valid.Settings with { SensorWidth = 8193 } };
        Assert.Throws<InvalidDataException>(() => oversized.Validate(verifyDigest: false));
        Assert.Empty(adapter.Writes);

        var noncanonicalLens = new RigLensCalibration(
            new[] { 500d, 0, 320, 0, 500, 240, 0.01, 0, 1 },
            new[] { 0d, 0, 0, 0 });
        Assert.Throws<InvalidDataException>(() => noncanonicalLens.Validate());
        Assert.Empty(adapter.Writes);
    }

    [Fact]
    public void ProtectedLoaderRequiresAbsoluteNonReparseBoundedFile()
    {
        Assert.Throws<InvalidDataException>(() =>
            TrustedRigConfigurationLoader.LoadProtectedLocalFile("relative-rig.json"));

        var path = Path.Combine(Path.GetTempPath(), $"tenkings-rig-{Guid.NewGuid():N}.json");
        try
        {
            File.WriteAllText(path, CreateExampleConfiguration().ToCanonicalJson());
            var loaded = TrustedRigConfigurationLoader.LoadProtectedLocalFile(path, new AllowTestFileProtection());
            Assert.Equal(ExampleConfigurationSha256, loaded.CanonicalSha256);
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    [Fact]
    public void AclPolicyRequiresProtectedDaclAndExplicitTrustedOwner()
    {
        RigConfigurationAclPolicy.RequireProtected(
            new RawSecurityDescriptor("O:SYG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)"));
        Assert.Throws<InvalidDataException>(() => RigConfigurationAclPolicy.RequireProtected(
            new RawSecurityDescriptor("O:SYG:SYD:(A;;FA;;;SY)(A;;FA;;;BA)")));
        Assert.Throws<InvalidDataException>(() => RigConfigurationAclPolicy.RequireProtected(
            new RawSecurityDescriptor("O:WDG:SYD:P(A;;FA;;;SY)")));
        Assert.Throws<InvalidDataException>(() => RigConfigurationAclPolicy.RequireProtected(
            new RawSecurityDescriptor("O:BGG:SYD:P(A;;FA;;;SY)")));

        const string serviceSid = "S-1-5-21-101-202-303-404";
        var serviceOwned = new RawSecurityDescriptor(
            $"O:{serviceSid}G:SYD:P(A;;FA;;;SY)(A;;FA;;;{serviceSid})");
        RigConfigurationAclPolicy.RequireProtected(serviceOwned, [serviceSid]);
        Assert.Throws<InvalidDataException>(() =>
            RigConfigurationAclPolicy.RequireProtected(serviceOwned, []));
    }

    [Theory]
    [InlineData(0x40000000)] // GENERIC_WRITE
    [InlineData(0x10000000)] // GENERIC_ALL
    [InlineData(0x02000000)] // MAXIMUM_ALLOWED
    [InlineData(0x00000002)] // write/add file
    [InlineData(0x00000004)] // append/add subdirectory
    [InlineData(0x00000010)] // write extended attributes
    [InlineData(0x00000040)] // delete child
    [InlineData(0x00000100)] // write attributes
    [InlineData(0x00010000)] // delete
    [InlineData(0x00040000)] // WRITE_DAC
    [InlineData(0x00080000)] // WRITE_OWNER
    public void AclPolicyRejectsEveryArbitraryWriterMutation(int accessMask)
    {
        Assert.Throws<InvalidDataException>(() => RigConfigurationAclPolicy.RequireProtected(
            CreateDescriptorWithAllow("S-1-5-21-111-222-333-444", accessMask, inherited: false)));
    }

    [Fact]
    public void AclPolicyRejectsInheritedArbitraryWriterAndCallbackAce()
    {
        Assert.Throws<InvalidDataException>(() => RigConfigurationAclPolicy.RequireProtected(
            CreateDescriptorWithAllow("S-1-5-21-111-222-333-445", 0x00000002, inherited: true)));

        var callbackAcl = new RawAcl(GenericAcl.AclRevision, 1);
        callbackAcl.InsertAce(0, new CommonAce(
            AceFlags.None,
            AceQualifier.AccessAllowed,
            0x00000002,
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            isCallback: true,
            opaque: [0, 0, 0, 0]));
        var callbackDescriptor = new RawSecurityDescriptor(
            ControlFlags.DiscretionaryAclPresent | ControlFlags.DiscretionaryAclProtected,
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            systemAcl: null,
            discretionaryAcl: callbackAcl);
        Assert.Throws<InvalidDataException>(() => RigConfigurationAclPolicy.RequireProtected(callbackDescriptor));
    }

    [Fact]
    public void AclPolicyAllowsArbitraryReadOnlyAceButRejectsBroadPrincipalsWithWrite()
    {
        RigConfigurationAclPolicy.RequireProtected(
            CreateDescriptorWithAllow("S-1-5-21-111-222-333-446", 0x00000001, inherited: true));
        Assert.Throws<InvalidDataException>(() => RigConfigurationAclPolicy.RequireProtected(
            new RawSecurityDescriptor("O:SYG:SYD:P(A;;FA;;;SY)(A;;GW;;;BU)")));
        Assert.Throws<InvalidDataException>(() => RigConfigurationAclPolicy.RequireProtected(
            new RawSecurityDescriptor("O:SYG:SYD:P(A;;FA;;;SY)(A;;GW;;;AU)")));
    }

    private static RawSecurityDescriptor CreateDescriptorWithAllow(
        string writerSid,
        int accessMask,
        bool inherited)
    {
        var acl = new RawAcl(GenericAcl.AclRevision, 2);
        acl.InsertAce(0, new CommonAce(
            AceFlags.None,
            AceQualifier.AccessAllowed,
            0x10000000,
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            isCallback: false,
            opaque: null));
        acl.InsertAce(1, new CommonAce(
            inherited ? AceFlags.Inherited : AceFlags.None,
            AceQualifier.AccessAllowed,
            accessMask,
            new SecurityIdentifier(writerSid),
            isCallback: false,
            opaque: null));
        return new RawSecurityDescriptor(
            ControlFlags.DiscretionaryAclPresent | ControlFlags.DiscretionaryAclProtected,
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            systemAcl: null,
            discretionaryAcl: acl);
    }

    [Fact]
    public void SafeFakeConfigurationIsCalibratedAndDeterministic()
    {
        var first = RigConfigurationDefaults.SafeFakeConfiguration;
        var second = RigConfigurationDefaults.SafeFakeConfiguration;
        first.Validate();
        Assert.Equal("e1dc50f7f4d7d6fc08f690c8dbd5bc7382344420df9abb533805735a245c104f", first.CanonicalSha256);
        Assert.Equal(first.CanonicalSha256, second.CanonicalSha256);
        Assert.NotEqual("uncalibrated", first.Calibration.CalibrationId);
        Assert.Equal(first.Attestation, RigConfigurationDefaults.SafeFakeAttestation);
        Assert.Equal((15d, 85), (
            first.RuntimePolicy.Preview.FramesPerSecond,
            first.RuntimePolicy.Preview.JpegQuality));
    }

    [Fact]
    public void FakeHostRejectsCliPreviewOverrides()
    {
        Assert.Throws<ArgumentException>(() => WorkerOptions.Parse(
        [
            "--backend=fake",
            "--output-root=C:/safe-fake-output",
            "--jpeg-quality=72",
            "--enable-native",
        ]));
    }

    [Fact]
    public void PylonPackagingCopiesManagedDependencyAndVerificationRemainsStatic()
    {
        var nativeRoot = FindNativeRoot();
        var project = File.ReadAllText(Path.Combine(
            nativeRoot, "src", "TenKings.AiGrader.Pylon.Host", "TenKings.AiGrader.Pylon.Host.csproj"));
        var buildPylon = File.ReadAllText(Path.Combine(nativeRoot, "scripts", "build-pylon-host.ps1"));
        var publish = File.ReadAllText(Path.Combine(nativeRoot, "scripts", "publish-workers.ps1"));
        var resolver = File.ReadAllText(Path.Combine(nativeRoot, "scripts", "resolve-pylon-managed-assembly.ps1"));
        var verify = File.ReadAllText(Path.Combine(nativeRoot, "scripts", "verify-native-package.ps1"));

        Assert.Contains("<Private>true</Private>", project, StringComparison.Ordinal);
        Assert.Contains("Copy-Item -LiteralPath $resolvedPylonAssembly", publish, StringComparison.Ordinal);
        Assert.Contains("resolve-pylon-managed-assembly.ps1", buildPylon, StringComparison.Ordinal);
        Assert.Contains("resolve-pylon-managed-assembly.ps1", publish, StringComparison.Ordinal);
        Assert.Contains("$existing.Count -ne 1", resolver, StringComparison.Ordinal);
        Assert.DoesNotContain("$(ProgramFiles)", project, StringComparison.Ordinal);
        Assert.DoesNotContain("PylonSdkRoot", project, StringComparison.Ordinal);
        Assert.Contains("Basler.Pylon.dll", verify, StringComparison.Ordinal);
        Assert.Contains("OpenCvSharpExtern.dll", verify, StringComparison.Ordinal);
        Assert.Contains("sdkHostExecuted = $false", verify, StringComparison.Ordinal);
        Assert.Contains("sdkAssemblyLoaded = $false", verify, StringComparison.Ordinal);
        Assert.DoesNotContain("Assembly]::Load", verify, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Start-Process", buildPylon, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("dotnet run", buildPylon, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("tenkings-ai-grader-pylon-worker.exe", buildPylon, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Start-Process", verify, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("tenkings-ai-grader-pylon-worker.exe", publish, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("tenkings-ai-grader-pylon-worker.exe", verify, StringComparison.OrdinalIgnoreCase);
    }

    internal static TrustedRigConfiguration CreateExampleConfiguration()
    {
        var orientation = new RigSensorOrientation(90, false, false, false, false);
        var calibration = new RigCalibrationReference(
            "redacted-fixed-rig-calibration-v1",
            new string('0', 64),
            new RigNormalizedRoi(0.015, 0.015, 0.97, 0.97),
            null,
            orientation).Seal();
        return new TrustedRigConfiguration(
            TrustedRigConfiguration.CurrentSchema,
            TrustedRigConfiguration.CurrentVersion,
            "redacted-dell-fixed-rig-v1",
            new string('0', 64),
            new RigCameraSelector(
                "serial_number",
                "UNCONFIGURED_DO_NOT_USE",
                "Basler",
                "a2A2448-23gmBAS",
                "BaslerGigE",
                "GEV"),
            new RigCameraSettings(
                "Mono8", 2448, 2048, 0, 0, 45_000, 0, "Off", "Off", "Continuous",
                "FrameStart", "Off", "Software", "Line2", "Output", true, "ExposureActive"),
            new RigPreviewSettings(15, 72),
            new RigQueueSettings(1, "LatestImages", "OneByOne"),
            new RigOutputContract(["png", "tiff"], true, 1200, 1680),
            calibration,
            orientation,
            new RigTimeouts(5_000, 5_000, 3_000, 2_000, 2_000, 2_000)).Seal();
    }

    private static string FindNativeRoot()
    {
        var cursor = new DirectoryInfo(AppContext.BaseDirectory);
        while (cursor is not null)
        {
            if (File.Exists(Path.Combine(cursor.FullName, "TenKings.AiGrader.NativeCamera.sln")))
            {
                return cursor.FullName;
            }
            cursor = cursor.Parent;
        }
        throw new DirectoryNotFoundException("Native solution root not found.");
    }

    private sealed class RecordingSettingsAdapter(
        string? unsupported = null,
        IReadOnlyDictionary<string, string>? readbackOverrides = null) : IRigSettingsAdapter
    {
        private readonly Dictionary<string, string> _values = new(StringComparer.Ordinal);
        public List<string> Writes { get; } = [];

        public bool IsSupportedAndWritable(RigSettingRequirement requirement) =>
            !string.Equals(requirement.Name, unsupported, StringComparison.Ordinal);

        public void Write(RigSettingRequirement requirement)
        {
            Writes.Add(requirement.Name);
            _values[requirement.Name] = requirement.ExpectedCanonicalValue;
        }

        public string ReadCanonical(RigSettingRequirement requirement) =>
            readbackOverrides?.GetValueOrDefault(requirement.Name) ??
            _values.GetValueOrDefault(requirement.Name) ??
            throw new InvalidOperationException("Setting was not written.");
    }

    private sealed class AllowTestFileProtection : ILocalConfigurationProtectionVerifier
    {
        public void Verify(string fullPath)
        {
            Assert.True(Path.IsPathFullyQualified(fullPath));
        }
    }
}
