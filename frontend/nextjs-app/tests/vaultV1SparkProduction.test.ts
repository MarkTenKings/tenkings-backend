import test, { type TestContext } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { authenticateSparkCallback, buildSparkReceipt, configuredSparkBindings, sparkBindings, sparkStage, type SparkStage } from "../lib/server/vaultV1/sparkWebhook";
import { persistSparkReceipt, sparkObservationHints, sparkReceiptFeed, sparkReceiptBinding } from "../lib/server/vaultV1/sparkInbox";
const { buildSparkProvisioning, compareSparkCloudBinding } = require("../../../packages/vault-machine/dist/spark-provisioning");
const { input } = require("../../../packages/vault-machine/tests/spark-provisioning-fixture");
const session = "12c7cec2-c690-4425-9a1f-db0db60e2d8c";
function plans() {
  const sandbox = input(), production = input(); production.stage = production.profile.environment = "PRODUCTION";
  production.profile.sandboxConfirmed = false; production.profile.productionConfirmed = true;
  production.profile.credentialGeneration = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const a = buildSparkProvisioning(sandbox), b = buildSparkProvisioning(production);
  const env = { ...a.cloudEnvironment, ...b.cloudEnvironment, VAULT_NAYAX_SPARK_CALLBACKS_ENABLED: "true", VAULT_NAYAX_SPARK_PRODUCTION_CALLBACKS_ENABLED: "true",
    VAULT_NAYAX_SPARK_CALLBACK_SECRET: "sandbox-only-callback-".repeat(3), VAULT_NAYAX_SPARK_PRODUCTION_CALLBACK_SECRET: "production-only-callback-".repeat(3) };
  return { a, b, env };
}
function callback(changes = {}) { return Buffer.from(JSON.stringify({ SparkTransactionId: session, NayaxTransactionId: 2004545072, SiteId: 2,
  MachineId: 71234996, HwSerial: "0434334921100366", TerminalId: "0434334921100366", MachineAuTime: "20261007120000123", Amount: 25,
  CurrencyCode: "USD", AuthStatus: { Verdict: "Approved", ErrorCode: 0 }, CardBrand: "Visa", ...changes })); }

test("production callback ingress requires independent explicit environment, header and secret", () => {
  const { env } = plans();
  authenticateSparkCallback({ "x-vault-spark-secret": env.VAULT_NAYAX_SPARK_PRODUCTION_CALLBACK_SECRET }, env, "PRODUCTION");
  authenticateSparkCallback({ "x-vault-spark-secret": env.VAULT_NAYAX_SPARK_CALLBACK_SECRET }, env);
  for (const stage of ["SANDBOX", "PRODUCTION"] as SparkStage[]) {
    const wrong = stage === "PRODUCTION" ? env.VAULT_NAYAX_SPARK_CALLBACK_SECRET : env.VAULT_NAYAX_SPARK_PRODUCTION_CALLBACK_SECRET;
    assert.throws(() => authenticateSparkCallback({ "x-vault-spark-secret": wrong }, env, stage), /AUTH_INVALID/);
  }
  for (const change of [{ VAULT_NAYAX_SPARK_PRODUCTION_CALLBACKS_ENABLED: undefined }, { VAULT_NAYAX_SPARK_PRODUCTION_ENVIRONMENT: undefined },
    { VAULT_NAYAX_SPARK_PRODUCTION_ENVIRONMENT: "SANDBOX" }, { VAULT_NAYAX_SPARK_PRODUCTION_CALLBACK_HEADER: undefined },
    { VAULT_NAYAX_SPARK_PRODUCTION_CALLBACK_SECRET: env.VAULT_NAYAX_SPARK_CALLBACK_SECRET }]) {
    assert.throws(() => authenticateSparkCallback({ "x-vault-spark-secret": env.VAULT_NAYAX_SPARK_PRODUCTION_CALLBACK_SECRET }, { ...env, ...change }, "PRODUCTION"));
  }
  assert.throws(() => authenticateSparkCallback({ "x-vault-spark-secret": [env.VAULT_NAYAX_SPARK_PRODUCTION_CALLBACK_SECRET] }, env, "PRODUCTION"), /AUTH_INVALID/);
  for (const value of ["LIVE", "production", ["PRODUCTION"], null, {}, ""]) assert.throws(() => sparkStage(value), /STAGE_INVALID/);
});

test("production binding parser agrees with provisioning and cannot consume or reinterpret a sandbox binding", () => {
  const { a, b, env } = plans(); const parsed = configuredSparkBindings(env, "PRODUCTION");
  assert.deepEqual(parsed, b.cloudBindings); assert.equal(compareSparkCloudBinding({ ...input(), stage: "PRODUCTION", profile: b.localProfile }, parsed).matches, true);
  assert.throws(() => sparkBindings(JSON.stringify(a.cloudBindings), "PRODUCTION"), /STAGE_INVALID/);
  assert.throws(() => sparkBindings(JSON.stringify(b.cloudBindings)), /STAGE_INVALID/);
  for (const change of [{ stage: "SANDBOX" }, { paymentBindingDigest: undefined }, { paymentBindingDigest: "wrong" }])
    assert.throws(() => sparkBindings(JSON.stringify([{ ...b.cloudBindings[0], ...change }]), "PRODUCTION"), /STAGE_INVALID/);
  assert.throws(() => sparkBindings(JSON.stringify([...b.cloudBindings, ...b.cloudBindings]), "PRODUCTION"), /BINDINGS_INVALID/);
});

test("same exact provider identifiers and callback body occupy distinct durable receipt domains", () => {
  const { a, b } = plans(); const sandbox = buildSparkReceipt(callback(), "TRANSACTION", a.cloudBindings);
  const production = buildSparkReceipt(callback(), "TRANSACTION", b.cloudBindings, "PRODUCTION");
  assert.equal(sandbox.observation.receiptId, "spark-sandbox:78c399224bc3b2d1e97d5ee9d73b2dd2faedb85e4cf9c2236e6d0cdfc08dfdee"); assert.match(production.observation.receiptId, /^spark-production:/);
  assert.equal(sandbox.stage, undefined); assert.equal(sandbox.observation.stage, undefined); assert.equal(sandbox.observation.paymentBindingDigest, undefined);
  assert.equal(production.stage, "PRODUCTION"); assert.equal(production.observation.paymentBindingDigest, b.bindingDigest);
  assert.notEqual(sandbox.payloadDigest, production.payloadDigest); assert.notEqual(sandbox.observation.receiptId, production.observation.receiptId);
  assert.equal(buildSparkReceipt(callback(), "TRANSACTION", a.cloudBindings).observation.receiptId, sandbox.observation.receiptId);
  assert.throws(() => buildSparkReceipt(callback(), "TRANSACTION", a.cloudBindings, "PRODUCTION"), /STAGE_INVALID/);
  assert.throws(() => buildSparkReceipt(callback(), "TRANSACTION", b.cloudBindings), /STAGE_INVALID/);
  const changed = structuredClone(b.cloudBindings); changed[0].paymentBindingDigest = "c".repeat(64);
  assert.notEqual(buildSparkReceipt(callback(), "TRANSACTION", changed, "PRODUCTION").observation.receiptId, production.observation.receiptId);
});

test("production malformed and mismatched callback identities are rejected before durable receipt creation", () => {
  const { b } = plans();
  for (const change of [{ SparkTransactionId: "invalid" }, { NayaxTransactionId: "2004545072" }, { MachineId: 71234997 }, { SiteId: 3 }, { HwSerial: "other" },
    { TerminalId: "other" }, { Amount: 25.001 }, { CurrencyCode: "EUR" }]) assert.throws(() => buildSparkReceipt(callback(change), "TRANSACTION", b.cloudBindings, "PRODUCTION"));
  assert.throws(() => buildSparkReceipt(Buffer.from(callback().toString().replace('"Amount":25', '"Amount":25,"Amount":30')), "TRANSACTION", b.cloudBindings, "PRODUCTION"), /BODY_INVALID/);
});

test("insert-only inbox preserves sandbox and production receipts and rejects stage or binding collisions", async () => {
  const { a, b } = plans(), rows = new Map<string, any>(); let writes = 0;
  const db: any = { vaultSparkObservation: { findUnique: async ({ where }: any) => rows.get(where.id), create: async ({ data }: any) => { rows.set(data.id, data); writes++; } } };
  db.$transaction = async (fn: any) => fn({ ...db, $queryRaw: async () => [] });
  const sandbox = buildSparkReceipt(callback(), "TRANSACTION", a.cloudBindings), production = buildSparkReceipt(callback(), "TRANSACTION", b.cloudBindings, "PRODUCTION");
  assert.equal(await persistSparkReceipt(db, sandbox), "INSERTED"); assert.equal(await persistSparkReceipt(db, production), "INSERTED");
  assert.equal(await persistSparkReceipt(db, production), "DUPLICATE"); assert.equal(writes, 2);
  assert.equal(rows.get(sandbox.observation.receiptId).stage, "SANDBOX"); assert.equal(rows.get(production.observation.receiptId).stage, "PRODUCTION");
  await assert.rejects(persistSparkReceipt(db, { ...production, stage: "SANDBOX" }), /STAGE_CONFLICT/);
  const row = rows.get(production.observation.receiptId); row.paymentBindingDigest = "b".repeat(64);
  await assert.rejects(persistSparkReceipt(db, production), /RECEIPT_CONFLICT/); assert.equal(writes, 2);
});

test("receipt/session queries bind stage while preserving historical sandbox observation shapes", async () => {
  const { a, b } = plans();
  for (const stage of ["SANDBOX", "PRODUCTION"] as SparkStage[]) {
    const receipt = buildSparkReceipt(callback(), "TRANSACTION", stage === "SANDBOX" ? a.cloudBindings : b.cloudBindings, stage);
    const { receiptId, machineId: nayaxMachineId, ...fields } = receipt.observation; const queries: any[] = [];
    const db: any = { vaultSparkObservation: { findMany: async (query: any) => { queries.push(query); return [{ id: receiptId, nayaxMachineId, stage,
      paymentBindingDigest: fields.paymentBindingDigest ?? null, ...fields, ...(query.select.receiptSequence ? { receiptSequence: 9007199254740993n } : {}) }]; } } };
    const hints = await sparkObservationHints(db, receipt.vaultMachineId, session, stage, stage === "PRODUCTION" ? b.bindingDigest : undefined);
    const feed = await sparkReceiptFeed(db, receipt.vaultMachineId, "9007199254740992", stage, stage === "PRODUCTION" ? b.bindingDigest : undefined);
    assert.deepEqual(hints.observations, [receipt.observation]); assert.deepEqual(feed.observations, [receipt.observation]);
    assert.equal(feed.nextCursor, "9007199254740993");
    for (const query of queries) { assert.equal(query.where.stage, stage); assert.equal(query.where.machineId, receipt.vaultMachineId); assert.equal(query.where.paymentBindingDigest, stage === "PRODUCTION" ? b.bindingDigest : undefined); }
  }
});


test("production receipt reads require an exact historical binding and sandbox cannot request a live binding", () => {
  for (const value of [undefined, null, "", "x".repeat(64), ["a".repeat(64)]]) assert.throws(() => sparkReceiptBinding("PRODUCTION", value), /BINDING_REQUIRED/);
  assert.throws(() => sparkReceiptBinding("SANDBOX", "a".repeat(64)), /BINDING_STAGE_INVALID/);
  assert.deepEqual(sparkReceiptBinding("PRODUCTION", "a".repeat(64)), { paymentBindingDigest: "a".repeat(64) });
});


const { NayaxSparkAdapter } = require("../../../packages/vault-machine/dist/nayax-spark-test-adapter");
function adapterFixture(t: TestContext) {
  const { a, b } = plans(), state: { rows: any[]; calls: string[]; allowed: boolean } = { rows: [], calls: [], allowed: true };
  const adapter = new NayaxSparkAdapter({ ...b.localProfile, machineId: b.machineId, journalPath: ":memory:",
    tokenSecret: "fixture-token-0123456789abcdefghijklmnopqrstuvwxyz", signKey: "fixture-sign-key-0123456789",
    beforeEffect: () => { if (!state.allowed) throw Error("synthetic authority expired"); }, readObservations: async () => state.rows,
    fetchImpl: async (url: string, init: RequestInit) => {
      state.calls.push(url); const request = JSON.parse(String(init.body));
      return Response.json(url.endsWith("/StartAuthentication")
        ? { HashedSparkTransactionId: createHash("sha256").update(request.SparkTransactionId).digest("hex"), Status: { Verdict: "Approved" } }
        : { SparkTransactionId: request.SparkTransactionId, Status: { Verdict: "Approved" } });
    } });
  t.after(() => adapter.close());
  const start = () => adapter.startSession({ saleId: randomUUID(), idempotencyKey: randomUUID(), mode: "PRODUCTION", totalCents: 2500, currency: "USD",
    items: [{ lineId: randomUUID(), name: "Pack", priceCents: 2500 }] });
  const receipt = (id: string, changes = {}) => buildSparkReceipt(callback({ SparkTransactionId: id, ...changes }), "TRANSACTION", b.cloudBindings, "PRODUCTION").observation;
  return { adapter, state, start, receipt, a, b };
}

test("actual production cloud normalizer feeds complete acquiring capture and immutable late conflict to the real adapter", async t => {
  const f = adapterFixture(t), pending = await f.start(); assert.equal(pending.state, "REQUESTED");
  f.state.allowed = false; f.state.rows = [f.receipt(pending.providerSessionId)];
  assert.equal((await f.adapter.reconcile(pending.providerSessionId)).state, "SETTLED"); assert.equal(f.state.calls.length, 2);
  f.state.rows = [buildSparkReceipt(Buffer.from(JSON.stringify({ SparkTransactionId: pending.providerSessionId, MachineId: 71234996,
    HwSerial: "0434334921100366", Status: { Verdict: "Declined", ErrorCode: 44 } })), "DECLINE", f.b.cloudBindings, "PRODUCTION").observation];
  assert.equal((await f.adapter.reconcile(pending.providerSessionId)).state, "UNKNOWN");
  const notices = await f.adapter.pollEvidence(); assert.equal(notices[0].code, "SPARK_APPROVAL_NEGATIVE_CONFLICT"); assert.equal(notices[0].captureConfirmed, true);
  assert.equal(f.state.calls.length, 2);
});

test("actual cloud sandbox receipt for the same session cannot capture production; exact production receipt remains usable", async t => {
  const f = adapterFixture(t), pending = await f.start();
  f.state.rows = [buildSparkReceipt(callback({ SparkTransactionId: pending.providerSessionId }), "TRANSACTION", f.a.cloudBindings).observation];
  await assert.rejects(f.adapter.reconcile(pending.providerSessionId), { code: "SPARK_OBSERVATION_BINDING_INVALID" });
  f.state.rows = [f.receipt(pending.providerSessionId)]; assert.equal((await f.adapter.reconcile(pending.providerSessionId)).state, "SETTLED"); assert.equal(f.state.calls.length, 2);
});

test("actual production method evidence remains ambiguous or unsupported without an acquiring proof", async t => {
  for (const change of [{ CardUid: "synthetic-non-acquiring" }, { CardBrand: "SMC" }, { CardBrand: "Unknown" }]) {
    const f = adapterFixture(t), pending = await f.start(); f.state.rows = [f.receipt(pending.providerSessionId, change)];
    assert.equal((await f.adapter.reconcile(pending.providerSessionId)).state, "UNKNOWN");
    assert.equal((await f.adapter.pollEvidence())[0].code, "SPARK_PAYMENT_METHOD_UNVERIFIED"); assert.equal(f.state.calls.length, 2);
  }
});
