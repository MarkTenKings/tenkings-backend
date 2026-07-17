using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace TenKings.AiGrader.NfcHelper;

internal static class Program
{
    public static async Task<int> Main(string[] args)
    {
        try
        {
            if (args is ["--hardware-gate-test"])
                return await RunHardwareGateTestAsync();
            if (args is ["--f8215-hardware-gate-test"])
                return await RunF8215HardwareGateTestAsync();
            if (args is ["--ensure-workstation-attestation-key"])
                return RunEnsureWorkstationAttestationKey();
            if (args is ["--export-workstation-attestation-public-key"])
                return RunExportWorkstationAttestationPublicKey();
            if (args is ["--verify-build"])
                return RunVerifyBuild();
            if (args is ["--resolve-abandoned-f8215-job"])
                return RunResolveAbandonedF8215Job();

            var backendName = ResolveBackend(args);
            INfcReaderBackend backend = backendName switch
            {
                "pcsc" => new WindowsPcscNfcReaderBackend(),
                "fake" => new FakeNfcReaderBackend(),
                _ => throw new NfcHelperException("invalid_helper_config", "The NFC helper backend must be pcsc or fake.")
            };
            using IWorkstationAttestationSigner signer = backendName == "pcsc"
                ? ResolveProductionSigner()
                : new EphemeralTestWorkstationAttestationSigner();
            using var operationGate = new NfcOperationGate();
            var logger = new ConsoleSafeLogger();
            var timeout = ResolveOperationTimeout();
            var operations = new NfcOperationsService(
                backend,
                signer,
                logger,
                timeout,
                operationGate: operationGate);
            var options = NfcHttpServerOptions.FromEnvironment();
            var coordinator = new F8215JobCoordinator(
                GoToTagsAdapterOptions.FromEnvironment(),
                new WindowsGoToTagsAdapterRuntime(),
                new GoToTagsOperationFactory(),
                signer,
                operationGate,
                options.Port,
                logger);
            await using var server = new NfcHttpServer(options, operations, logger, coordinator);
            using var shutdown = new CancellationTokenSource();
            Console.CancelKeyPress += (_, eventArgs) =>
            {
                eventArgs.Cancel = true;
                shutdown.Cancel();
            };
            AppDomain.CurrentDomain.ProcessExit += (_, _) => shutdown.Cancel();
            logger.Info(
                "nfc_helper_started",
                "startup",
                $"backend_{backendName}_port_{options.Port}_token_{Fingerprint(options.WorkstationToken)}");
            await server.RunAsync(shutdown.Token);
            logger.Info("nfc_helper_stopped", "shutdown");
            return 0;
        }
        catch (NfcHelperException error)
        {
            new ConsoleSafeLogger().Error("nfc_helper_start_failed", "startup", error.Code);
            return 2;
        }
        catch (Exception)
        {
            new ConsoleSafeLogger().Error("nfc_helper_start_failed", "startup", "internal_error");
            return 3;
        }
    }

    private static async Task<int> RunHardwareGateTestAsync()
    {
        if (Environment.GetEnvironmentVariable("TENKINGS_NFC_HARDWARE_GATE_CONFIRMED") != "true")
            throw new NfcHelperException("hardware_gate_approval_required", "The separate typed hardware-gate authorization is required.");
        var confirmOverwrite = Environment.GetEnvironmentVariable("TENKINGS_NFC_HARDWARE_GATE_OVERWRITE_CONFIRMED") == "true";
        var operations = new NfcOperationsService(
            new WindowsPcscNfcReaderBackend(),
            logger: new ConsoleSafeLogger(),
            operationTimeoutMs: ResolveOperationTimeout());
        var result = await operations.RunHardwareGateTestAsync(confirmOverwrite, "hardware_gate", CancellationToken.None);
        Console.WriteLine(JsonSerializer.Serialize(result, NfcJsonContext.Default.HardwareGateResult));
        return result.OverwriteConfirmationRequired ? 4 : 0;
    }

    private static async Task<int> RunF8215HardwareGateTestAsync()
    {
        var result = await F8215HardwareGateRunner.RunAsync(CancellationToken.None);
        Console.WriteLine(JsonSerializer.Serialize(result, NfcJsonContext.Default.F8215HardwareGateResult));
        return 0;
    }

    private static int RunEnsureWorkstationAttestationKey()
    {
        var metadata = WindowsCngWorkstationAttestationSigner.EnsureNamedKey();
        Console.WriteLine(JsonSerializer.Serialize(metadata, NfcJsonContext.Default.WorkstationKeyMetadata));
        return 0;
    }

    private static int RunExportWorkstationAttestationPublicKey()
    {
        var expectedKeyId = Environment.GetEnvironmentVariable("TENKINGS_NFC_WORKSTATION_KEY_ID")?.Trim() ?? string.Empty;
        var keyName = Environment.GetEnvironmentVariable("TENKINGS_NFC_WORKSTATION_KEY_NAME")?.Trim() ?? string.Empty;
        var exported = WindowsCngWorkstationAttestationSigner.ExportPublicKey(keyName, expectedKeyId);
        Console.WriteLine(JsonSerializer.Serialize(exported, NfcJsonContext.Default.WorkstationPublicKeyExport));
        return 0;
    }

    private static WindowsCngWorkstationAttestationSigner ResolveProductionSigner()
    {
        var expectedKeyId = Environment.GetEnvironmentVariable("TENKINGS_NFC_WORKSTATION_KEY_ID")?.Trim() ?? string.Empty;
        var keyName = Environment.GetEnvironmentVariable("TENKINGS_NFC_WORKSTATION_KEY_NAME")?.Trim() ?? string.Empty;
        return WindowsCngWorkstationAttestationSigner.Open(keyName, expectedKeyId);
    }

    private static int RunVerifyBuild()
    {
        var result = NfcBuildVerification.Verify();
        Console.WriteLine(JsonSerializer.Serialize(result, NfcJsonContext.Default.NfcBuildVerificationResult));
        return 0;
    }

    private static int RunResolveAbandonedF8215Job()
    {
        var jobRoot = Environment.GetEnvironmentVariable("TENKINGS_NFC_GOTOTAGS_JOB_ROOT")?.Trim() ?? string.Empty;
        var attemptId = Environment.GetEnvironmentVariable("TENKINGS_NFC_ABANDONED_ATTEMPT_ID")?.Trim() ?? string.Empty;
        var confirmation = Environment.GetEnvironmentVariable("TENKINGS_NFC_ABANDONED_CONFIRMATION") ?? string.Empty;
        var result = F8215JobCoordinator.ResolveAbandonedJob(jobRoot, attemptId, confirmation);
        Console.WriteLine(JsonSerializer.Serialize(result, NfcJsonContext.Default.F8215AbandonedResolutionResult));
        return 0;
    }

    private static string ResolveBackend(string[] args)
    {
        if (args.Length > 1 || args.Length == 1 && args[0] != "--fake")
            throw new NfcHelperException("invalid_arguments", "The NFC helper accepts only a documented fixed maintenance mode.");
        if (args.Length == 1) return "fake";
        return Environment.GetEnvironmentVariable("TENKINGS_NFC_BACKEND")?.Trim().ToLowerInvariant() ?? "pcsc";
    }

    private static int ResolveOperationTimeout()
    {
        var value = Environment.GetEnvironmentVariable("TENKINGS_NFC_OPERATION_TIMEOUT_MS");
        if (string.IsNullOrWhiteSpace(value)) return NfcProtocol.DefaultOperationTimeoutMs;
        if (!int.TryParse(value, out var timeout) || timeout is < 100 or > 30_000)
            throw new NfcHelperException("invalid_helper_config", "The NFC helper operation timeout configuration is invalid.");
        return timeout;
    }

    private static string Fingerprint(string secret)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(secret));
        try
        {
            return Convert.ToHexString(bytes.AsSpan(0, 6)).ToLowerInvariant();
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
        }
    }
}
