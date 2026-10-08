import test from "node:test";
import assert from "node:assert/strict";
import { authenticateSparkCallback, buildSparkReceipt, sparkBindings } from "../lib/server/vaultV1/sparkWebhook";

// The standard vault:test entry point builds the machine package before cloud
// tests, as do the existing profile and Spark adapter boundary regressions.
const { buildSparkProvisioning, compareSparkCloudBinding } = require("../../../packages/vault-machine/dist/spark-provisioning.js");
const { input } = require("../../../packages/vault-machine/tests/spark-provisioning-fixture.js");
const session = "12c7cec2-c690-4425-9a1f-db0db60e2d8c";

test("actual provisioning output parses through the cloud binding contract and produces its exact method-profile receipt digest", () => {
  for (const terminalIdType of [1, 2]) for (const representation of ["HW_SERIAL", "MACHINE_ID"]) {
    const profile = input();
    profile.profile.terminalIdType = terminalIdType;
    profile.profile.callbackTerminalIdRepresentation = representation;
    profile.profile.terminalId = terminalIdType === 1 ? profile.profile.hwSerial : profile.profile.nayaxMachineId;
    const plan = buildSparkProvisioning(profile);
    const parsed = sparkBindings(plan.cloudEnvironment.VAULT_NAYAX_SPARK_BINDINGS_JSON);
    assert.deepEqual(parsed, plan.cloudBindings);
    const callback = { SparkTransactionId: session, NayaxTransactionId: 2004545072, SiteId: profile.profile.siteId,
      MachineId: Number(profile.profile.nayaxMachineId), HwSerial: profile.profile.hwSerial,
      TerminalId: representation === "HW_SERIAL" ? profile.profile.hwSerial : Number(profile.profile.nayaxMachineId),
      MachineAuTime: "20261007120000123", Amount: 25, CurrencyCode: "USD", AuthStatus: { Verdict: "Approved", ErrorCode: 0 },
      CardBrand: profile.profile.acquiringCardBrands[0], AuthCode: "synthetic-authorization", NayaxRRN: "synthetic-reference" };
    const receipt = buildSparkReceipt(Buffer.from(JSON.stringify(callback)), "TRANSACTION", parsed);
    assert.equal(receipt.vaultMachineId, plan.machineId);
    assert.equal(receipt.observation.methodProfileDigest, plan.methodProfileDigest);
    assert.equal(receipt.observation.methodClassification, "ACQUIRING");
    assert.equal(receipt.observation.amountCents, 2500);
    assert.equal(receipt.observation.terminalId, representation === "HW_SERIAL" ? profile.profile.hwSerial : profile.profile.nayaxMachineId);
    assert.equal(compareSparkCloudBinding(profile, parsed).matches, true);
    const altered = structuredClone(parsed); altered[0]!.cardUidPolicy = "ALLOW_CONFIRMED_ACQUIRING";
    assert.notEqual(buildSparkReceipt(Buffer.from(JSON.stringify(callback)), "TRANSACTION", altered).observation.methodProfileDigest, plan.methodProfileDigest);
    assert.throws(() => compareSparkCloudBinding(profile, altered), /CLOUD_LOCAL_MISMATCH/);
  }
});

test("generated profiles remain disabled in actual callback authentication, including dormant production preparation", () => {
  for (const stage of ["SANDBOX", "PRODUCTION"]) {
    const profile = input(); profile.stage = profile.profile.environment = stage;
    profile.profile.sandboxConfirmed = stage === "SANDBOX";
    if (stage === "PRODUCTION") { profile.profile.productionConfirmed = true; profile.profile.credentialGeneration = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; }
    const plan = buildSparkProvisioning(profile);
    const secret = "synthetic-only-callback-secret-000000000000000000";
    const env = { ...plan.cloudEnvironment, VAULT_NAYAX_SPARK_CALLBACK_SECRET: secret };
    assert.throws(() => authenticateSparkCallback({ [profile.callbackHeaderName]: secret }, env, stage as "SANDBOX" | "PRODUCTION"), /SPARK_CALLBACKS_DISABLED/);
    if (stage === "PRODUCTION") assert.throws(() => authenticateSparkCallback({ [profile.callbackHeaderName]: secret }, { ...env, VAULT_NAYAX_SPARK_CALLBACKS_ENABLED: "true" }), /SPARK_SANDBOX_REQUIRED/);
    assert.equal(plan.activationAllowed, false);
  }
});
