using Microsoft.Win32;
using System.Diagnostics;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Security.Cryptography.X509Certificates;

namespace TenKings.AiGrader.NfcHelper;

public sealed partial record GoToTagsAdapterOptions(
    string ExecutablePath,
    string TemplatePath,
    string TemplateSha256,
    string JobRoot)
{
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ExecutablePath) &&
        !string.IsNullOrWhiteSpace(TemplatePath) &&
        !string.IsNullOrWhiteSpace(TemplateSha256) &&
        !string.IsNullOrWhiteSpace(JobRoot);

    public static GoToTagsAdapterOptions FromEnvironment()
    {
        var options = new GoToTagsAdapterOptions(
            Environment.GetEnvironmentVariable("TENKINGS_NFC_GOTOTAGS_EXECUTABLE_PATH")?.Trim() ?? string.Empty,
            Environment.GetEnvironmentVariable("TENKINGS_NFC_GOTOTAGS_TEMPLATE_PATH")?.Trim() ?? string.Empty,
            Environment.GetEnvironmentVariable("TENKINGS_NFC_GOTOTAGS_TEMPLATE_SHA256")?.Trim().ToLowerInvariant() ?? string.Empty,
            Environment.GetEnvironmentVariable("TENKINGS_NFC_GOTOTAGS_JOB_ROOT")?.Trim() ?? string.Empty);
        options.ValidateConfiguration();
        return options;
    }

    public void ValidateConfiguration()
    {
        if (!Path.IsPathFullyQualified(ExecutablePath) || !Path.IsPathFullyQualified(TemplatePath) ||
            !Path.IsPathFullyQualified(JobRoot) ||
            !string.Equals(TemplateSha256, NfcProtocol.ApprovedGoToTagsTemplateSha256, StringComparison.Ordinal))
            throw ConfigurationError();
        if (!File.Exists(ExecutablePath) || !File.Exists(TemplatePath) || !Directory.Exists(JobRoot))
            throw ConfigurationError();
        ProtectedJobDirectory.Assert(JobRoot);
    }

    private static NfcHelperException ConfigurationError() =>
        new("gototags_configuration_invalid", "The Feiju encoding adapter is not configured safely.", false, 503);

    [GeneratedRegex("^[a-f0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256Pattern();
}

public sealed record GoToTagsAdapterInspection(bool Ready, string? ErrorCode = null);

public interface IGoToTagsAdapterRuntime
{
    GoToTagsAdapterInspection Inspect(GoToTagsAdapterOptions options);
    void LaunchOperation(GoToTagsAdapterOptions options, string operationPath);
}

public sealed class WindowsGoToTagsAdapterRuntime : IGoToTagsAdapterRuntime
{
    private const string ExpectedPublisher = "CN=GoToTags, O=GoToTags, S=Washington, C=US";

    public GoToTagsAdapterInspection Inspect(GoToTagsAdapterOptions options)
    {
        if (!options.IsConfigured) return new(false, "gototags_configuration_invalid");
        try
        {
            options.ValidateConfiguration();
            // The signed jpackage launcher used by the approved 4.37.0.1 build
            // has no Windows FileVersion resource. Pin its exact reviewed bytes
            // before launch; the terminal callback independently binds the
            // application's reported 4.37.0.1 version.
            if (!string.Equals(Sha256File(options.ExecutablePath), NfcProtocol.ApprovedGoToTagsExecutableSha256, StringComparison.Ordinal))
                return new(false, "gototags_executable_hash_unapproved");
            if (!Authenticode.IsTrusted(options.ExecutablePath, ExpectedPublisher))
                return new(false, "gototags_publisher_untrusted");
            if (!ApprovedOperationAssociation())
                return new(false, "gototags_operation_association_unapproved");
            if (!string.Equals(Sha256File(options.TemplatePath), options.TemplateSha256, StringComparison.Ordinal))
                return new(false, "gototags_template_hash_mismatch");
            if (!WindowsServiceState.IsStoppedAndDisabled("CertPropSvc"))
                return new(false, "gototags_certificate_propagation_not_disabled");
            if (!WindowsServiceState.IsRunningAndEnabled("SCardSvr"))
                return new(false, "smart_card_service_unavailable");
            return new(true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or CryptographicException or NfcHelperException)
        {
            return new(false, "gototags_dependency_check_failed");
        }
    }

    public void LaunchOperation(GoToTagsAdapterOptions options, string operationPath)
    {
        if (!Inspect(options).Ready)
            throw new NfcHelperException("gototags_dependency_unavailable", "GoToTags is not ready for Feiju encoding.", false, 503);
        if (!File.Exists(operationPath))
            throw new NfcHelperException("gototags_operation_missing", "The protected GoToTags job is unavailable.", false, 503);
        try
        {
            var start = new ProcessStartInfo(operationPath)
            {
                UseShellExecute = true,
                ErrorDialog = false,
                WorkingDirectory = Path.GetDirectoryName(operationPath),
            };
            var process = Process.Start(start);
            if (process is null)
                throw new NfcHelperException("gototags_launch_failed", "GoToTags could not open the protected NFC job.", true, 503);
        }
        catch (NfcHelperException)
        {
            throw;
        }
        catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            throw new NfcHelperException("gototags_launch_failed", "GoToTags could not open the protected NFC job.", true, 503);
        }
    }

    private static string Sha256File(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    private static bool ApprovedOperationAssociation()
    {
        using var openWith = Registry.ClassesRoot.OpenSubKey(@".gototags\OpenWithProgids", false);
        if (openWith is null || !openWith.GetValueNames().Contains(NfcProtocol.ApprovedGoToTagsProgId, StringComparer.Ordinal))
            return false;
        using var application = Registry.ClassesRoot.OpenSubKey($@"{NfcProtocol.ApprovedGoToTagsProgId}\Application", false);
        using var command = Registry.ClassesRoot.OpenSubKey($@"{NfcProtocol.ApprovedGoToTagsProgId}\Shell\open\command", false);
        return string.Equals(application?.GetValue("ApplicationName") as string, "GoToTags", StringComparison.Ordinal) &&
            string.Equals(application?.GetValue("ApplicationCompany") as string, "GoToTags", StringComparison.Ordinal) &&
            string.Equals(application?.GetValue("AppUserModelID") as string, NfcProtocol.ApprovedGoToTagsAppUserModelId, StringComparison.Ordinal) &&
            (application?.GetValue("ApplicationIcon") as string)?.StartsWith(NfcProtocol.ApprovedGoToTagsPackageResourcePrefix, StringComparison.Ordinal) == true &&
            string.Equals(command?.GetValue("DelegateExecute") as string, NfcProtocol.ApprovedGoToTagsDelegateExecute, StringComparison.OrdinalIgnoreCase);
    }
}

internal static class ProtectedJobDirectory
{
    private static IReadOnlyList<SecurityIdentifier> AllowedIdentities()
    {
        var current = WindowsIdentity.GetCurrent().User ?? throw Invalid();
        return
        [
            current,
            new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
        ];
    }

    public static void Assert(string root)
    {
        var info = new DirectoryInfo(root);
        if (!info.Exists || info.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw Invalid();
        if (!OperatingSystem.IsWindows()) throw Invalid();
        var security = info.GetAccessControl(AccessControlSections.Access);
        if (!security.AreAccessRulesProtected) throw Invalid();
        var allowed = AllowedIdentities().Select(identity => identity.Value).ToHashSet(StringComparer.Ordinal);
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
        {
            if (rule.AccessControlType != AccessControlType.Allow || !allowed.Contains(rule.IdentityReference.Value))
                throw Invalid();
        }
    }

    public static string ContainedFile(string root, string name)
    {
        if (string.IsNullOrWhiteSpace(name) || Path.GetFileName(name) != name) throw Invalid();
        var canonicalRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var path = Path.GetFullPath(Path.Combine(canonicalRoot, name));
        if (!path.StartsWith(canonicalRoot, StringComparison.OrdinalIgnoreCase)) throw Invalid();
        return path;
    }

    public static void ProtectContainedLeaf(string root, string path)
    {
        Assert(root);
        var leaf = RequireContainedLeaf(root, path);
        var inherited = leaf.GetAccessControl(AccessControlSections.Access);
        AssertAllowedLeafRules(inherited, allowInheritance: true);

        var protectedSecurity = new FileSecurity();
        protectedSecurity.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        foreach (var identity in AllowedIdentities())
        {
            protectedSecurity.AddAccessRule(new FileSystemAccessRule(
                identity,
                FileSystemRights.FullControl,
                InheritanceFlags.None,
                PropagationFlags.None,
                AccessControlType.Allow));
        }
        leaf.SetAccessControl(protectedSecurity);
        AssertProtectedContainedLeaf(root, path);
    }

    public static void AssertProtectedContainedLeaf(string root, string path)
    {
        Assert(root);
        var leaf = RequireContainedLeaf(root, path);
        AssertAllowedLeafRules(leaf.GetAccessControl(AccessControlSections.Access), allowInheritance: false);
    }

    private static FileInfo RequireContainedLeaf(string root, string path)
    {
        if (!OperatingSystem.IsWindows()) throw Invalid();
        var fullPath = Path.GetFullPath(path);
        var contained = ContainedFile(root, Path.GetFileName(fullPath));
        if (!string.Equals(fullPath, contained, StringComparison.OrdinalIgnoreCase)) throw Invalid();
        var leaf = new FileInfo(contained);
        if (!leaf.Exists || leaf.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw Invalid();
        return leaf;
    }

    private static void AssertAllowedLeafRules(FileSecurity security, bool allowInheritance)
    {
        if (!allowInheritance && !security.AreAccessRulesProtected) throw Invalid();
        var required = AllowedIdentities().Select(identity => identity.Value).ToHashSet(StringComparer.Ordinal);
        var fullControl = new HashSet<string>(StringComparer.Ordinal);
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
        {
            if (rule.AccessControlType != AccessControlType.Allow || !required.Contains(rule.IdentityReference.Value))
                throw Invalid();
            if (!allowInheritance && rule.IsInherited) throw Invalid();
            if ((rule.FileSystemRights & FileSystemRights.FullControl) == FileSystemRights.FullControl)
                fullControl.Add(rule.IdentityReference.Value);
        }
        if (!required.SetEquals(fullControl)) throw Invalid();
    }

    private static NfcHelperException Invalid() =>
        new("gototags_job_root_unprotected", "The protected Feiju job directory is unavailable.", false, 503);
}

public sealed class GoToTagsOperationFactory
{
    private const int MaxTemplateBytes = 64 * 1024;

    public string Create(
        GoToTagsAdapterOptions options,
        string operationFileName,
        string attemptId,
        string correlationId,
        string callbackIdentity,
        string exactUrl,
        int callbackPort,
        DateTimeOffset now)
    {
        options.ValidateConfiguration();
        if (callbackPort is < 1024 or > 65535) throw TemplateInvalid();
        var operationPath = ProtectedJobDirectory.ContainedFile(options.JobRoot, operationFileName);
        if (File.Exists(operationPath))
            throw new NfcHelperException("gototags_job_conflict", "A protected Feiju job already exists.", false, 409);

        var operation = ReadAndValidateTemplate(options);
        operation["name"] = "Ten Kings F8215 Job";
        operation["externalId"] = attemptId;
        operation["id"] = RandomText(10);
        operation["createdAt"] = now.ToString("O");
        operation["updatedAt"] = now.ToString("O");
        // GoToTags redaction cannot be enabled without persisting an operation
        // password. The bounded callback therefore receives tag.uid only in
        // transient helper memory, hashes it immediately, and never logs,
        // returns, or persists the raw value.
        operation.Remove("redactionKey");
        var integration = operation["integrations"]!.AsArray()[0]!.AsObject();
        integration["urlString"] = $"http://127.0.0.1:{callbackPort}/gototags/callback/{callbackIdentity}";
        var tag = operation["tags"]!.AsArray()[0]!.AsObject();
        tag["id"] = RandomText(10);
        tag["status"] = "READY";
        var encoding = tag["encoding"]!.AsObject();
        encoding["correlationId"] = correlationId;
        encoding["dynamic"] = false;
        encoding["lock"] = true;
        var ndef = encoding["ndef"]!.AsObject();
        ndef["lock"] = true;
        var record = ndef["records"]!.AsArray()[0]!.AsObject();
        record["type"] = "WEBSITE";
        record["url"] = exactUrl;
        ValidateGenerated(operation, attemptId, correlationId, callbackIdentity, exactUrl, callbackPort);

        var bytes = JsonSerializer.SerializeToUtf8Bytes(operation, new JsonSerializerOptions { WriteIndented = false });
        try
        {
            using var stream = new FileStream(operationPath, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None);
            using var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: false);
            var entry = zip.CreateEntry("file.gototags", CompressionLevel.Optimal);
            using var output = entry.Open();
            output.Write(bytes);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
        }
        ProtectedJobDirectory.ProtectContainedLeaf(options.JobRoot, operationPath);
        return operationPath;
    }

    private static JsonObject ReadAndValidateTemplate(GoToTagsAdapterOptions options)
    {
        using var stream = new FileStream(options.TemplatePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length is <= 0 or > MaxTemplateBytes)
            throw TemplateInvalid();
        var templateHash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        if (!string.Equals(templateHash, NfcProtocol.ApprovedGoToTagsTemplateSha256, StringComparison.Ordinal) ||
            !string.Equals(templateHash, options.TemplateSha256, StringComparison.Ordinal))
            throw TemplateInvalid();
        stream.Position = 0;
        var operation = JsonNode.Parse(stream, documentOptions: new JsonDocumentOptions
        {
            AllowTrailingCommas = false,
            CommentHandling = JsonCommentHandling.Disallow,
            MaxDepth = 32,
        })?.AsObject() ?? throw TemplateInvalid();
        ValidateTemplate(operation);
        return operation;
    }

    internal static void ValidateTemplate(JsonObject operation)
    {
        var integrations = operation["integrations"] as JsonArray;
        var tags = operation["tags"] as JsonArray;
        var options = operation["options"] as JsonObject;
        var tag = tags?.Count == 1 ? tags[0] as JsonObject : null;
        var encoding = tag?["encoding"] as JsonObject;
        var ndef = encoding?["ndef"] as JsonObject;
        var records = ndef?["records"] as JsonArray;
        var record = records?.Count == 1 ? records[0] as JsonObject : null;
        var integration = integrations?.Count == 1 ? integrations[0] as JsonObject : null;
        var extra = encoding?["extra"] as JsonObject;
        if (!HasExactKeys(operation,
                "elapsedTime", "externalId", "chipType", "createdAt", "id", "integrations", "name",
                "operationType", "options", "revision", "tags", "type", "updatedAt") ||
            !HasExactKeys(options, "autoSelectNextTag", "enforceTiming", "enforceIdOrder", "queueIdsOnScan", "verify") ||
            !HasExactKeys(integration, "type", "urlString", "integrationType") ||
            !HasExactKeys(tag, "encoding", "id", "status") ||
            !HasExactKeys(encoding, "correlationId", "dynamic", "extra", "lock", "ndef") ||
            !HasExactKeys(ndef, "lock", "records") ||
            !HasExactKeys(record, "type", "url") ||
            extra is null || extra.Count != 0 ||
            operation["elapsedTime"]?.GetValue<string>() != "PT0S" ||
            operation["operationType"]?.GetValue<string>() != "VARIABLE_ENCODE_NFC_TAGS" ||
            operation["type"]?.GetValue<string>() != "VARIABLE_ENCODE_NFC_TAGS" ||
            operation["chipType"]?.GetValue<string>() != "F8215" ||
            operation["name"]?.GetValue<string>() != "Ten Kings F8215 Manual Start v1" ||
            operation["revision"]?.GetValue<int>() != 3 ||
            operation["createdAt"]?.GetValue<string>() != "2000-01-01T00:00:00.000Z" ||
            operation["updatedAt"]?.GetValue<string>() != "2000-01-01T00:00:00.000Z" ||
            options?["verify"]?.GetValue<bool>() != true ||
            options?["autoSelectNextTag"]?.GetValue<string>() != "TOP_TO_BOTTOM" ||
            options?["enforceTiming"]?.GetValue<bool>() != false ||
            options?["enforceIdOrder"]?.GetValue<bool>() != false ||
            options?["queueIdsOnScan"]?.GetValue<bool>() != false ||
            integration?["integrationType"]?.GetValue<string>() != "HTTP_POST" ||
            integration?["type"]?.GetValue<string>() != "HTTP_POST" ||
            tag?["id"]?.GetValue<string>() != "<tag-row-id>" ||
            tag?["status"]?.GetValue<string>() != "READY" ||
            encoding?["dynamic"]?.GetValue<bool>() != false ||
            encoding?["lock"]?.GetValue<bool>() != true ||
            ndef?["lock"]?.GetValue<bool>() != true ||
            record?["type"]?.GetValue<string>() != "WEBSITE" ||
            operation.ContainsKey("redactionKey") ||
            operation["externalId"]?.GetValue<string>() != "<attempt-id>" ||
            integration?["urlString"]?.GetValue<string>() != "http://127.0.0.1:47662/gototags/callback/<callback-id>" ||
            encoding?["correlationId"]?.GetValue<string>() != "<correlation-id>" ||
            record?["url"]?.GetValue<string>() != "https://collect.tenkings.co/nfc/<public-tag-id>")
            throw TemplateInvalid();
    }

    private static bool HasExactKeys(JsonObject? value, params string[] expected)
    {
        if (value is null || value.Count != expected.Length) return false;
        var keys = new HashSet<string>(value.Select(pair => pair.Key), StringComparer.Ordinal);
        return expected.All(keys.Contains);
    }

    private static void ValidateGenerated(
        JsonObject operation,
        string attemptId,
        string correlationId,
        string callbackIdentity,
        string exactUrl,
        int callbackPort)
    {
        if (operation.ContainsKey("redactionKey")) throw TemplateInvalid();
        var integration = operation["integrations"]!.AsArray()[0]!.AsObject();
        var tag = operation["tags"]!.AsArray()[0]!.AsObject();
        var encoding = tag["encoding"]!.AsObject();
        var ndef = encoding["ndef"]!.AsObject();
        var record = ndef["records"]!.AsArray()[0]!.AsObject();
        if (operation["externalId"]?.GetValue<string>() != attemptId ||
            operation["chipType"]?.GetValue<string>() != "F8215" ||
            integration["urlString"]?.GetValue<string>() != $"http://127.0.0.1:{callbackPort}/gototags/callback/{callbackIdentity}" ||
            tag["status"]?.GetValue<string>() != "READY" ||
            encoding["correlationId"]?.GetValue<string>() != correlationId ||
            encoding["lock"]?.GetValue<bool>() != true ||
            ndef["lock"]?.GetValue<bool>() != true ||
            ndef["records"]!.AsArray().Count != 1 ||
            record["type"]?.GetValue<string>() != "WEBSITE" ||
            record["url"]?.GetValue<string>() != exactUrl)
            throw TemplateInvalid();
    }

    private static string RandomText(int length)
    {
        const string alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        var bytes = RandomNumberGenerator.GetBytes(length);
        try
        {
            var chars = new char[length];
            for (var index = 0; index < length; index++) chars[index] = alphabet[bytes[index] % alphabet.Length];
            return new string(chars);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
        }
    }

    private static NfcHelperException TemplateInvalid() =>
        new("gototags_template_invalid", "The reviewed Feiju operation template is invalid.", false, 503);
}

internal static class Authenticode
{
    private static readonly Guid GenericVerifyV2 = new("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

    public static bool IsTrusted(string path, string expectedPublisher)
    {
        var file = new WinTrustFileInfo(path);
        var data = new WinTrustData(file);
        try
        {
            if (WinVerifyTrust(IntPtr.Zero, GenericVerifyV2, data) != 0) return false;
            using var certificate = new X509Certificate2(X509Certificate.CreateFromSignedFile(path));
            return string.Equals(certificate.Subject, expectedPublisher, StringComparison.Ordinal);
        }
        catch (CryptographicException)
        {
            return false;
        }
        finally
        {
            data.Dispose();
            file.Dispose();
        }
    }

    [DllImport("wintrust.dll", ExactSpelling = true, PreserveSig = true, SetLastError = true)]
    private static extern uint WinVerifyTrust(
        IntPtr hWnd,
        [MarshalAs(UnmanagedType.LPStruct)] Guid actionId,
        [In] WinTrustData data);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private sealed class WinTrustFileInfo : IDisposable
    {
        public uint cbStruct = (uint)Marshal.SizeOf<WinTrustFileInfo>();
        public IntPtr pcwszFilePath = IntPtr.Zero;
        public IntPtr hFile = IntPtr.Zero;
        public IntPtr pgKnownSubject = IntPtr.Zero;

        public WinTrustFileInfo(string path) => pcwszFilePath = Marshal.StringToCoTaskMemUni(path);
        public void Dispose()
        {
            if (pcwszFilePath != IntPtr.Zero) Marshal.FreeCoTaskMem(pcwszFilePath);
            pcwszFilePath = IntPtr.Zero;
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private sealed class WinTrustData : IDisposable
    {
        public uint cbStruct = (uint)Marshal.SizeOf<WinTrustData>();
        public IntPtr pPolicyCallbackData = IntPtr.Zero;
        public IntPtr pSIPClientData = IntPtr.Zero;
        public uint dwUIChoice = 2;
        public uint fdwRevocationChecks = 0;
        public uint dwUnionChoice = 1;
        public IntPtr pFile = IntPtr.Zero;
        public uint dwStateAction = 0;
        public IntPtr hWVTStateData = IntPtr.Zero;
        public IntPtr pwszURLReference = IntPtr.Zero;
        public uint dwProvFlags = 0x00001000;
        public uint dwUIContext = 0;

        public WinTrustData(WinTrustFileInfo file)
        {
            pFile = Marshal.AllocCoTaskMem(Marshal.SizeOf<WinTrustFileInfo>());
            Marshal.StructureToPtr(file, pFile, false);
        }

        public void Dispose()
        {
            if (pFile != IntPtr.Zero) Marshal.FreeCoTaskMem(pFile);
            pFile = IntPtr.Zero;
        }
    }
}

internal static class WindowsServiceState
{
    private const uint ScManagerConnect = 0x0001;
    private const uint ServiceQueryStatus = 0x0004;
    private const int ServiceStopped = 1;
    private const int ServiceRunning = 4;

    public static bool IsStoppedAndDisabled(string name) =>
        ReadStart(name) == 4 && ReadState(name) == ServiceStopped;

    public static bool IsRunningAndEnabled(string name) =>
        ReadStart(name) != 4 && ReadState(name) == ServiceRunning;

    private static int ReadStart(string name)
    {
        using var key = Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Services\{name}", false);
        return key?.GetValue("Start") is int value ? value : -1;
    }

    private static int ReadState(string name)
    {
        var manager = OpenSCManager(null, null, ScManagerConnect);
        if (manager == IntPtr.Zero) return -1;
        try
        {
            var service = OpenService(manager, name, ServiceQueryStatus);
            if (service == IntPtr.Zero) return -1;
            try
            {
                var status = new ServiceStatusProcess();
                return QueryServiceStatusEx(service, 0, ref status, Marshal.SizeOf<ServiceStatusProcess>(), out _)
                    ? status.dwCurrentState
                    : -1;
            }
            finally
            {
                CloseServiceHandle(service);
            }
        }
        finally
        {
            CloseServiceHandle(manager);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatusProcess
    {
        public int dwServiceType;
        public int dwCurrentState;
        public int dwControlsAccepted;
        public int dwWin32ExitCode;
        public int dwServiceSpecificExitCode;
        public int dwCheckPoint;
        public int dwWaitHint;
        public int dwProcessId;
        public int dwServiceFlags;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenSCManager(string? machineName, string? databaseName, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenService(IntPtr manager, string serviceName, uint access);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryServiceStatusEx(IntPtr service, int infoLevel, ref ServiceStatusProcess status, int bufferSize, out int bytesNeeded);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseServiceHandle(IntPtr handle);
}
