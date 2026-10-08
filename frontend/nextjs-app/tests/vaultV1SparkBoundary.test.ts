import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { buildSparkReceipt, type SparkBinding, type SparkObservation } from "../lib/server/vaultV1/sparkWebhook";

// The standard vault:test command builds machine dist before cloud tests.
// For an isolated run, build @tenkings/vault-machine first, as for profile regressions.
const { NayaxSparkTestAdapter } = require("../../../packages/vault-machine/dist/nayax-spark-test-adapter.js");

const binding: SparkBinding = { machineId: "00000000-0000-4000-8000-000000000001", nayaxMachineId: "71234996", terminalId: "0434334921100366",
  hwSerial: "0434334921100366", siteId: 2, currency: "USD", callbackTerminalIdRepresentation: "HW_SERIAL", acquiringOnlyConfirmed: true,
  cardUidPolicy: "REJECT_AMBIGUOUS", acquiringCardBrands: ["Visa"], unsupportedCardBrands: ["SMC"] };

/** Use the actual cloud normalizer, never a hand-authored adapter observation. */
function fixture(t: TestContext) {
  const state: { observations: SparkObservation[]; calls: string[] } = { observations: [], calls: [] };
  const adapter = new NayaxSparkTestAdapter({ ...binding, terminalIdType: 1, integratorId: "927", tokenId: 116383,
    tokenSecret: "FixtureToken_0123456789abcdefghijklmNOPQRSTUVWXYZ", signKey: "FixtureSignKey16Characters", apiBase: "https://spark.example.test/api",
    environment: "SANDBOX", sandboxConfirmed: true, preSelectionConfirmed: true, currencyConfirmed: true, signingProfile: "CURRENT_GUID_SHA256",
    wireApiVersion: null, vendorApprovalReference: "synthetic-vendor-fixture", maxTotalCents: 100000, journalPath: ":memory:",
    triggerReplayPolicy: "DISABLED", cancelReplayPolicy: "DISABLED", maxTriggerAttempts: 1, maxCancelAttempts: 1,
    readObservations: async () => state.observations,
    fetchImpl: async (url: string, init: RequestInit) => {
      state.calls.push(url);
      const request = JSON.parse(String(init.body));
      if (url.endsWith("/StartAuthentication")) return Response.json({ HashedSparkTransactionId: createHash("sha256").update(request.SparkTransactionId).digest("hex"), Status: { Verdict: "Approved" } });
      assert.ok(url.endsWith("/TriggerTransaction"));
      return Response.json({ SparkTransactionId: request.SparkTransactionId, Status: { Verdict: "Approved" } });
    },
  });
  t.after(() => adapter.close());
  const start = () => adapter.startSession({ saleId: randomUUID(), idempotencyKey: randomUUID(), mode: "CERTIFICATION", currency: "USD", totalCents: 2500,
    items: [{ lineId: randomUUID(), name: "Sports pack", priceCents: 2500 }] });
  const decline = (id: string, code: number, configured = binding) => buildSparkReceipt(Buffer.from(JSON.stringify({
    MachineId: Number(configured.nayaxMachineId), HwSerial: configured.hwSerial, SparkTransactionId: id, Status: { Verdict: "Declined", ErrorCode: code },
  })), "DECLINE", [configured]).observation;
  const transaction = (id: string, changes: Record<string, unknown> = {}, configured = binding) => buildSparkReceipt(Buffer.from(JSON.stringify({
    NayaxTransactionId: 2004545072, SparkTransactionId: id, SiteId: configured.siteId, MachineId: Number(configured.nayaxMachineId),
    HwSerial: configured.hwSerial, TerminalId: configured.hwSerial, MachineAuTime: "20261007120000123", Amount: 25, CurrencyCode: "USD",
    AuthStatus: { Verdict: "Approved", ErrorCode: 0 }, CardBrand: "Visa", ...changes,
  })), "TRANSACTION", [configured]).observation;
  return { adapter, state, start, decline, transaction };
}

test("actual cloud DeclineCallback terminates one triggered attempt without inventing acquisition evidence", async t => {
  for (const code of [38, 44, 45]) {
    const f = fixture(t), pending = await f.start();
    const observation = f.decline(pending.providerSessionId, code);
    assert.equal(observation.methodClassification, "AMBIGUOUS");
    assert.deepEqual(observation.methodEvidence, { cardUidPresent: false, cardBrandClass: "ABSENT", authCodePresent: false, rrnPresent: false });
    assert.equal(observation.amountCents, null);
    f.state.observations = [observation];
    assert.equal((await f.adapter.reconcile(pending.providerSessionId)).state, "DECLINED");
    assert.deepEqual(await f.adapter.pollEvidence(), []);
    assert.equal(f.state.calls.length, 2, "A final decline never retries the trigger or makes another provider call");
  }
});

test("unknown cloud DeclineCallback codes cannot establish final payment absence", async t => {
  for (const code of [37, 992, 997, 999]) {
    const f = fixture(t), pending = await f.start();
    f.state.observations = [f.decline(pending.providerSessionId, code)];
    assert.equal((await f.adapter.reconcile(pending.providerSessionId)).state, "REQUESTED");
    assert.equal(f.state.calls.length, 2);
  }
});

test("normalized decline still requires the exact session, device and method-profile binding", async t => {
  const foreignSession = fixture(t), pending = await foreignSession.start();
  foreignSession.state.observations = [foreignSession.decline(randomUUID(), 44)];
  await assert.rejects(foreignSession.adapter.reconcile(pending.providerSessionId), { code: "SPARK_OBSERVATION_BINDING_INVALID" });
  for (const configured of [{ ...binding, acquiringCardBrands: ["Visa", "Mastercard"] }, { ...binding, nayaxMachineId: "71234997" }, { ...binding, hwSerial: "other-terminal" }]) {
    const f = fixture(t), attempt = await f.start();
    f.state.observations = [f.decline(attempt.providerSessionId, 44, configured)];
    assert.equal((await f.adapter.reconcile(attempt.providerSessionId)).state, "UNKNOWN");
    assert.equal((await f.adapter.pollEvidence())[0].code, "SPARK_OBSERVATION_BINDING_INVALID");
  }
});

test("normalized approved payments still require confirmed acquiring evidence", async t => {
  const acquiring = fixture(t), pending = await acquiring.start();
  acquiring.state.observations = [acquiring.transaction(pending.providerSessionId)];
  assert.equal((await acquiring.adapter.reconcile(pending.providerSessionId)).state, "SETTLED");
  for (const changes of [{ CardUid: "synthetic-unverified-method" }, { CardBrand: "Unconfirmed" }, { CardBrand: "SMC" }]) {
    const f = fixture(t), attempt = await f.start();
    f.state.observations = [f.transaction(attempt.providerSessionId, changes)];
    assert.equal((await f.adapter.reconcile(attempt.providerSessionId)).state, "UNKNOWN");
    assert.equal((await f.adapter.pollEvidence())[0].code, "SPARK_PAYMENT_METHOD_UNVERIFIED");
  }
});

test("normalized declined TransactionCallback retains acquisition-profile requirements", async t => {
  for (const unverified of [false, true]) {
    const f = fixture(t), pending = await f.start();
    f.state.observations = [f.transaction(pending.providerSessionId, { Amount: undefined, AuthStatus: { Verdict: "Declined", ErrorCode: 37 }, ...(unverified ? { CardUid: "synthetic-unverified-method" } : {}) })];
    assert.equal((await f.adapter.reconcile(pending.providerSessionId)).state, unverified ? "UNKNOWN" : "DECLINED");
  }
});

test("an unverified transaction notice identifies that receipt after a separate session decline", async t => {
  const f = fixture(t), pending = await f.start();
  f.state.observations = [f.decline(pending.providerSessionId, 44), f.transaction(pending.providerSessionId, {
    Amount: undefined, AuthStatus: { Verdict: "Declined", ErrorCode: 37 }, CardUid: "synthetic-unverified-method",
  })];
  assert.equal((await f.adapter.reconcile(pending.providerSessionId)).state, "UNKNOWN");
  const notices = await f.adapter.pollEvidence();
  assert.equal(notices[0].code, "SPARK_PAYMENT_METHOD_UNVERIFIED");
  assert.equal(notices[0].providerTransactionId, "2004545072");
  assert.equal(notices[0].captureConfirmed, false);
});

test("normalized decline and capture conflicts remain held in either arrival order", async t => {
  for (const declineFirst of [false, true]) {
    const f = fixture(t), pending = await f.start();
    const declined = f.decline(pending.providerSessionId, 45), captured = f.transaction(pending.providerSessionId);
    f.state.observations = [declineFirst ? declined : captured];
    assert.equal((await f.adapter.reconcile(pending.providerSessionId)).state, declineFirst ? "DECLINED" : "SETTLED");
    f.state.observations = [declineFirst ? captured : declined];
    assert.equal((await f.adapter.reconcile(pending.providerSessionId)).state, "UNKNOWN");
    const notices = await f.adapter.pollEvidence();
    assert.equal(notices[0].code, "SPARK_APPROVAL_NEGATIVE_CONFLICT");
    assert.equal(notices[0].captureConfirmed, true);
    assert.equal(f.state.calls.length, 2);
  }
});
