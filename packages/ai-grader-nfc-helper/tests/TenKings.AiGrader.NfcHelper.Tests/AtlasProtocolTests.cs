using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TenKings.AiGrader.NfcHelper;

internal static class AtlasProtocolTests
{
    // No reader, GoToTags process, CNG key, network or protected installed state is used.
    public static Task Run()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "pnpm-workspace.yaml"))) directory = directory.Parent;
        if (directory is null) throw new Exception("Repository root unavailable.");
        var path = Path.Combine(directory.FullName, "packages", "atlas-finishing", "test", "nfc-vector.json");
        using var vector = JsonDocument.Parse(File.ReadAllBytes(path));
        var root = vector.RootElement;
        var jobJson = root.GetProperty("job").GetRawText();
        var job = AtlasNfcProtocol.ParseSignedJobJson(Encoding.UTF8.GetBytes(jobJson));
        var result = JsonSerializer.Deserialize<AtlasNfcTerminalResult>(root.GetProperty("result").GetRawText(), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        var serverEntry = root.GetProperty("trust").GetProperty("serverKeys")[0];
        var serverSpki = Convert.FromBase64String(serverEntry.GetProperty("publicSpkiDerBase64").GetString()!);
        var workstationSpki = Convert.FromBase64String(root.GetProperty("trust").GetProperty("workstationKeys")[0].GetProperty("publicSpkiDerBase64").GetString()!);
        Require(AtlasNfcProtocol.CanonicalJobStatement(job) == root.GetProperty("canonicalJob").GetString());
        Require(AtlasNfcProtocol.CanonicalResultStatement(result) == root.GetProperty("canonicalResult").GetString());
        Require(AtlasNfcProtocol.VerifyJob(job, serverSpki));
        Require(AtlasNfcProtocol.VerifyTerminalResult(result, job, workstationSpki));
        Require(!AtlasNfcProtocol.VerifyJob(job with { Purpose = TenKingsV2NfcProtocol.Purpose }, serverSpki));
        Require(!AtlasNfcProtocol.VerifyJob(job with { SchemaVersion = TenKingsV2NfcProtocol.JobSchema }, serverSpki));
        Require(!AtlasNfcProtocol.VerifyJob(job with { Url = job.Url.Replace("atlasgrading.com", "collect.tenkings.co") }, serverSpki));
        Require(!AtlasNfcProtocol.VerifyJob(job with { ApprovalVersion = 3 }, serverSpki));
        Reject(() => AtlasNfcProtocol.CanonicalJobStatement(job with { ApprovalId = job.ApprovalId + "\n" }));
        Require(!AtlasNfcProtocol.VerifyJob(job with { ApprovalId = "synthetic-approval-2" }, serverSpki));
        Require(!AtlasNfcProtocol.VerifyJob(job with { PublicHash = new string('b', 64) }, serverSpki));
        Require(!AtlasNfcProtocol.VerifyTerminalResult(result with { WriteProtectionState = "unlocked" }, job, workstationSpki));
        Require(!AtlasNfcProtocol.VerifyTerminalResult(result with { ReadbackPayloadSha256 = new string('b', 64) }, job, workstationSpki));
        Require(!AtlasNfcProtocol.VerifyTerminalResult(result with { ApprovalVersion = 3 }, job, workstationSpki));
        Require(!AtlasNfcProtocol.VerifyTerminalResult(result with { ObservedAt = "2026-09-08T12:10:00.001Z" }, job, workstationSpki));
        Reject(() => AtlasNfcProtocol.RequireMayStart(job, DateTimeOffset.Parse("2026-09-08T12:10:00.001Z")));
        Reject(() => AtlasNfcProtocol.ParseSignedJobJson(Encoding.UTF8.GetBytes(jobJson.Replace("\"approvalVersion\": 2", "\"approvalVersion\": \"2\""))));
        Reject(() => AtlasNfcProtocol.ParseSignedJobJson(Encoding.UTF8.GetBytes(jobJson.Insert(1, "\"approvalVersion\":2,"))));
        Reject(() => AtlasNfcProtocol.ParseSignedJobJson(Encoding.UTF8.GetBytes(jobJson.Insert(1, "\"rawUid\":\"04112233445566\","))));
        using var signer = new EphemeralTestWorkstationAttestationSigner();
        var created = AtlasNfcProtocol.CreateTerminalResult(job, serverSpki, signer,
            NdefCodec.Sha256Hex(Encoding.UTF8.GetBytes(job.Url)), "2026-09-08T12:01:00.000Z");
        Require(AtlasNfcProtocol.VerifyTerminalResult(created, job, signer.ExportPublicSpki()));
        Require(!JsonSerializer.Serialize(created).Contains("uid", StringComparison.OrdinalIgnoreCase));
        Reject(() => AtlasNfcProtocol.CreateTerminalResult(job, serverSpki, signer, new string('b', 64), "2026-09-08T12:01:00.000Z"));
        var trustJson = JsonSerializer.Serialize(new { schemaVersion = "atlas-nfc-helper-trust-v1", purpose = AtlasNfcProtocol.Purpose,
            keys = new { current = new { algorithm = AtlasNfcProtocol.Algorithm, keyId = job.SigningKeyId,
                publicSpkiDerBase64 = Convert.ToBase64String(serverSpki) }, prior = (object?)null } });
        using var trust = AtlasServerTrust.Parse(trustJson, Array.Empty<string>());
        Require(trust.Enabled && trust.KeyIds.Single() == job.SigningKeyId);
        Reject(() => AtlasServerTrust.Parse(trustJson, new[] { job.SigningKeyId }));
        Reject(() => AtlasServerTrust.Parse(trustJson.Replace(AtlasNfcProtocol.Purpose, TenKingsV2NfcProtocol.Purpose), Array.Empty<string>()));
        using var disabled = AtlasServerTrust.Parse(null, Array.Empty<string>());
        Require(!disabled.Enabled);
        return Task.CompletedTask;
    }
    private static void Require(bool value) { if (!value) throw new Exception("ATLAS protocol assertion failed."); }
    private static void Reject(Action action)
    {
        try { action(); } catch (NfcHelperException) { return; }
        throw new Exception("ATLAS invalid input was accepted.");
    }
}
