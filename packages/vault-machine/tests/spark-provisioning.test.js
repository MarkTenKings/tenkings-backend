const test = require("node:test"), assert = require("node:assert/strict");
const { generateKeyPairSync, sign, createHash } = require("node:crypto");
const { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync, symlinkSync } = require("node:fs");
const { tmpdir } = require("node:os"), { join } = require("node:path");
const { canonicalJson } = require("../../vault-contracts/dist");
const p = require("../dist/spark-provisioning"), { NayaxSparkTestAdapter } = require("../dist/nayax-spark-test-adapter"), { input } = require("./spark-provisioning-fixture");
const { main } = require("../scripts/spark-provisioning.cjs");
const { spawnSync } = require("node:child_process");

test("generated provisioning matches the actual local adapter binding and stays disabled", async () => {
  const i = input(), plan = p.buildSparkProvisioning(i);
  const adapter = new NayaxSparkTestAdapter({ ...plan.localProfile, machineId: i.machineId, journalPath: ":memory:",
    tokenSecret: "fixture-token-0123456789abcdefghijklmnopqrstuvwxyz", signKey: "fixture-sign-key-0123456789",
    fetchImpl: async () => { throw new Error("unexpected network"); }, readObservations: async () => [] });
  try { assert.equal((await adapter.capabilities()).bindingDigest, plan.bindingDigest); } finally { adapter.close(); }
  assert.equal(plan.activationAllowed, false); assert.equal(plan.cloudEnvironment.VAULT_NAYAX_SPARK_CALLBACKS_ENABLED, "false");
  assert.equal(plan.callbackUrls.decline, "https://vault.example.test/api/vault/v1/spark/DeclineCallback");
  assert.equal(p.compareSparkCloudBinding(i, plan.cloudBindings).matches, true);
  const wrong = structuredClone(plan.cloudBindings); wrong[0].acquiringCardBrands.push("Mastercard");
  assert.throws(() => p.compareSparkCloudBinding(i, wrong), /CLOUD_LOCAL_MISMATCH/);
  assert.throws(() => p.compareSparkCloudBinding(i, [...plan.cloudBindings, ...plan.cloudBindings]), /CLOUD_LOCAL_MISMATCH/);
});

test("provisioning rejects unconfirmed, ambiguous, unsupported and secret-bearing inputs", () => {
  for (const edit of [i => i.profile.sandboxConfirmed = false, i => i.profile.maxTotalCents = null,
    i => i.profile.terminalIdType = "1", i => i.profile.terminalId = "other", i => i.profile.acquiringCardBrands = ["x".repeat(41)],
    i => i.profile.unsupportedCardBrands.push("Visa"), i => i.profile.maxTriggerAttempts = 2, i => i.profile.tokenSecret = "do-not-print-this",
    i => i.callbackOrigin = "http://127.0.0.1:1234", i => i.profile.apiBase = "https://attacker.example/api",
    i => i.profile.nayaxMachineId = "9223372036854775808", i => i.profile.productionConfirmed = true]) {
    const i = input(); edit(i); assert.throws(() => p.buildSparkProvisioning(i), /^Error: SPARK_PROVISIONING_[A-Z_]+$/);
  }
});

test("production preparation gets a distinct binding without activating a runtime", () => {
  const sandbox = input(), production = input(); production.stage = production.profile.environment = "PRODUCTION";
  production.profile.sandboxConfirmed = false; production.profile.productionConfirmed = true; production.profile.credentialGeneration = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const a = p.buildSparkProvisioning(sandbox), b = p.buildSparkProvisioning(production);
  assert.notEqual(a.bindingDigest, b.bindingDigest); assert.equal(b.activationAllowed, false);
  assert.equal(b.cloudEnvironment.VAULT_NAYAX_SPARK_PRODUCTION_CALLBACKS_ENABLED, "false");
});

test("promotion binds an exact fresh Ed25519 approval to every evidence artifact", () => {
  const i = input(), previousBindingDigest = p.buildSparkProvisioning(i).bindingDigest;
  i.stage = i.profile.environment = "PRODUCTION"; i.profile.sandboxConfirmed = false; i.profile.productionConfirmed = true; i.profile.credentialGeneration = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const plan = p.buildSparkProvisioning(i), keys = generateKeyPairSync("ed25519"), now = Date.parse("2026-10-07T20:00:00Z");
  const evidence = Object.fromEntries(p.SPARK_PROMOTION_EVIDENCE.map(kind => [kind, createHash("sha256").update(kind).digest("hex")]));
  const payload = { schemaVersion: 1, purpose: "VAULT_SPARK_PRODUCTION_PROMOTION", machineId: i.machineId, configurationDigest: plan.configurationDigest,
    previousBindingDigest, targetBindingDigest: plan.bindingDigest, sourceCommit: "a".repeat(40), approvedBy: "admin-fixture", approvedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60000).toISOString(),
    evidence: Object.entries(evidence).map(([kind, sha256]) => ({ kind, sha256 })) };
  const envelope = { payload, signature: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString("base64") };
  const pem = keys.publicKey.export({ type: "spki", format: "pem" });
  assert.equal(p.verifySparkPromotion(i, envelope, pem, evidence, now).approved, true);
  assert.equal(p.verifySparkPromotion(i, envelope, pem, evidence, now).activationAllowed, false);
  assert.throws(() => p.verifySparkPromotion(i, envelope, pem, evidence, now + 60001), /PROMOTION_EXPIRED/);
  assert.throws(() => p.verifySparkPromotion(i, envelope, pem, { ...evidence, CABINET_ACCEPTANCE: "0".repeat(64) }, now), /PROMOTION_EVIDENCE_INVALID/);
  const tampered = structuredClone(envelope); tampered.payload.approvedBy = "different-admin";
  assert.throws(() => p.verifySparkPromotion(i, tampered, pem, evidence, now), /PROMOTION_SIGNATURE_INVALID/);
  i.profile.maxTotalCents++; assert.throws(() => p.verifySparkPromotion(i, envelope, pem, evidence, now), /PROMOTION_BINDING_INVALID/);
});

test("secret readiness exposes only booleans and requires a separate callback secret", () => {
  const env = { VAULT_SPARK_TOKEN_SECRET: "T".repeat(40), VAULT_SPARK_SIGN_KEY: "S".repeat(40), VAULT_NAYAX_SPARK_CALLBACK_SECRET: "C".repeat(40) };
  assert.equal(p.checkSparkSecretPresence(env).ready, true);
  assert.doesNotMatch(JSON.stringify(p.checkSparkSecretPresence(env)), /TTTT|SSSS|CCCC/);
  assert.equal(p.checkSparkSecretPresence({ ...env, VAULT_NAYAX_SPARK_CALLBACK_SECRET: env.VAULT_SPARK_SIGN_KEY }).ready, false);
  assert.equal(p.checkSparkSecretPresence({}).ready, false);
});

test("offline CLI writes private create-only paired files and rejects symlink input", t => {
  const root = mkdtempSync(join(tmpdir(), "spark-provisioning-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "input.json"), out = join(root, "generated"); writeFileSync(file, JSON.stringify(input()));
  assert.equal(main(["generate", file, out]).networkRequests, 0);
  assert.equal(statSync(join(out, "local-profile.json")).mode & 0o777, 0o600);
  assert.equal(main(["compare", file, join(out, "cloud-bindings.json")]).matches, true);
  assert.throws(() => main(["compare", file, join(out, "cloud-bindings.json"), "unexpected"]), /ARGUMENTS_INVALID/);
  const missing = spawnSync(process.execPath, [join(__dirname, "../scripts/spark-provisioning.cjs"), "check-secrets", file], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(missing.status, 1); assert.equal(JSON.parse(missing.stdout).ready, false); assert.equal(missing.stderr, "");
  assert.throws(() => main(["generate", file, out]));
  const link = join(root, "link.json"); symlinkSync(file, link); assert.throws(() => main(["validate", link]));
  assert.equal(JSON.parse(readFileSync(join(out, "provisioning-plan.json"))).activationAllowed, false);
});
