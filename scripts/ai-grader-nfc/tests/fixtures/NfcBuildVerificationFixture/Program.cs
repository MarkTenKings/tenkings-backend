using System.Text.Json;

if (args is not ["--verify-build"])
    return 2;

var versionPath = Path.Combine(AppContext.BaseDirectory, "helper-version.txt");
var version = File.ReadAllText(versionPath).Trim();
var result = new Dictionary<string, object?>
{
    ["ok"] = true,
    ["helperVersion"] = version,
    ["helperProtocolVersion"] = "tenkings-ai-grader-nfc-loopback-v2",
    ["attestationSchemaVersion"] = "ai-grader-nfc-helper-attestation-v1",
    ["attestationAlgorithm"] = "ecdsa-p256-sha256-p1363",
    ["hardwareAccessed"] = false,
    ["productionKeyAccessed"] = false,
};
if (version == "tenkings-ai-grader-nfc-helper-v3")
    result["multiProfileAttestationSchemaVersion"] = "ai-grader-nfc-helper-attestation-v2";

Console.WriteLine(JsonSerializer.Serialize(result));
return 0;
