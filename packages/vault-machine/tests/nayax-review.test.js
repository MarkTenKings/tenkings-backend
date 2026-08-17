const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRig, makeDoorAvailable, crypto, vault } = require("./helpers");

function request(overrides = {}) {
  return {
    idempotencyKey: crypto.randomUUID(),
    saleId: crypto.randomUUID(),
    mode: "PRODUCTION",
    currency: "USD",
    totalCents: 2706,
    items: [{ lineId: crypto.randomUUID(), name: "Sports Mystery Pack", priceCents: 2500 }],
    ...overrides,
  };
}

function hasCode(code) {
  return (error) => error && error.code === code;
}

test("normalized Nayax mock is deterministically MOCK-only and covers normalized outcomes", async () => {
  const mock = new vault.DeterministicNayaxMock();
  assert.deepEqual(await mock.capabilities(), {
    adapterName: "ten-kings-deterministic-nayax-mock",
    adapterVersion: "1.0.0",
    sdkVersion: null,
    mode: "MOCK",
    maxItems: 25,
    maxTotalCents: 500000,
    cancellationBeforeAuthorization: true,
  });
  assert.throws(() => mock.scriptStart({ outcome: "SETTLE" }), hasCode("MOCK_SCRIPT_INVALID"));

  mock.scriptStart(
    { outcome: "AUTHORIZE" },
    { outcome: "DECLINE" },
    { outcome: "CANCEL" },
    { outcome: "TIMEOUT" },
    { outcome: "UNKNOWN" },
  );
  const observed = [];
  for (let index = 0; index < 5; index += 1) observed.push((await mock.startSession(request())).state);
  assert.deepEqual(observed, ["AUTHORIZED", "DECLINED", "CANCELLED", "UNKNOWN", "UNKNOWN"]);

  const reconciliation = new vault.DeterministicNayaxMock()
    .scriptStart({ outcome: "UNKNOWN" })
    .scriptReconcile({ outcome: "AUTHORIZE" }, { outcome: "SETTLE" });
  const started = await reconciliation.startSession(request());
  assert.equal((await reconciliation.reconcile(started.providerSessionId)).state, "AUTHORIZED");
  assert.equal((await reconciliation.reconcile(started.providerSessionId)).state, "SETTLED");
});

test("start and cancellation operations replay identical keys and hard-fail conflicting reuse", async () => {
  const mock = new vault.DeterministicNayaxMock().scriptStart({ outcome: "UNKNOWN" }, { outcome: "DECLINE" });
  const firstRequest = request();
  const first = await mock.startSession(firstRequest);
  assert.deepEqual(await mock.startSession(structuredClone(firstRequest)), first);
  await assert.rejects(
    () => mock.startSession({ ...firstRequest, totalCents: firstRequest.totalCents + 1 }),
    hasCode("PAYMENT_IDEMPOTENCY_CONFLICT"),
  );
  await assert.rejects(
    () => mock.startSession({ ...firstRequest, idempotencyKey: crypto.randomUUID() }),
    hasCode("PAYMENT_SESSION_CONFLICT"),
  );

  const cancelled = await mock.cancelSession(first.providerSessionId, "cancel-key-one");
  assert.equal(cancelled.state, "CANCELLED");
  assert.equal(cancelled.originalRequestDigest, first.originalRequestDigest);
  assert.deepEqual(await mock.cancelSession(first.providerSessionId, "cancel-key-one"), cancelled);

  const second = await mock.startSession(request());
  assert.equal(second.state, "DECLINED");
  await assert.rejects(
    () => mock.cancelSession(second.providerSessionId, "cancel-key-one"),
    hasCode("PAYMENT_IDEMPOTENCY_CONFLICT"),
  );

  const authorizedMock = new vault.DeterministicNayaxMock();
  const authorized = await authorizedMock.startSession(request());
  assert.equal((await authorizedMock.cancelSession(authorized.providerSessionId, "late-cancel")).state, "AUTHORIZED");
});

test("mock rejects non-normalized/cardholder extensions without retaining or logging them", async () => {
  const mock = new vault.DeterministicNayaxMock();
  const cardholderData = "4111111111111111";
  await assert.rejects(
    () => mock.startSession({ ...request(), pan: cardholderData }),
    hasCode("PAYMENT_REQUEST_INVALID"),
  );
  await assert.rejects(
    () => mock.startSession({ ...request(), items: [{ lineId: crypto.randomUUID(), name: "Pack", priceCents: 2500, trackData: cardholderData }] }),
    hasCode("PAYMENT_REQUEST_INVALID"),
  );
  await mock.startSession(request());
  const snapshot = mock.snapshot();
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(cardholderData));
  const tamperedSnapshot = structuredClone(snapshot);
  tamperedSnapshot.sessions[0][1].request.pan = cardholderData;
  assert.throws(() => new vault.DeterministicNayaxMock().restore(tamperedSnapshot), hasCode("MOCK_SNAPSHOT_INVALID"));

  const source = fs.readFileSync(path.join(__dirname, "../src/mock-nayax.ts"), "utf8");
  assert.doesNotMatch(source, /\b(?:console|fetch|XMLHttpRequest|node:https|node:http|node:net|child_process)\b/);
  assert.doesNotMatch(source, /mode:\s*["'](?:LIVE|OFFICIAL_TEST)["']/);
});

test("provider limits reject the whole cart and never split it into payment sessions", async () => {
  const payment = new vault.DeterministicNayaxMock({ maxItems: 1, maxTotalCents: 500000, cancellationBeforeAuthorization: true });
  const rig = await createRig({ payment });
  makeDoorAvailable(rig, ["X-01", "K-01"]);
  rig.machine.selectCartDoor("X-01", "sports-25", true);
  rig.machine.selectCartDoor("K-01", "sports-25", true);
  await assert.rejects(
    () => rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: "PRODUCTION", configVersion: 1, doorIds: ["X-01", "K-01"] }),
    hasCode("PROVIDER_LIMIT_EXCEEDED"),
  );
  assert.equal(rig.store.one("SELECT COUNT(*) AS count FROM sale").count, 0);
  assert.equal(rig.store.one("SELECT COUNT(*) AS count FROM cart_item").count, 2);
  assert.equal(JSON.parse(JSON.stringify(payment.snapshot())).sessions.length, 0);
  rig.store.close();
});

test("payment intent is durable before the mock effect is invoked", async () => {
  class InspectingMock extends vault.DeterministicNayaxMock {
    attach(store) { this.store = store; }
    async startSession(input) {
      const sale = this.store.one("SELECT payment_intent_key,payment_request_digest,payment_state,state FROM sale WHERE sale_id=?", input.saleId);
      this.observed = sale;
      return super.startSession(input);
    }
  }
  const payment = new InspectingMock().scriptStart({ outcome: "UNKNOWN" });
  const rig = await createRig({ payment });
  payment.attach(rig.store);
  makeDoorAvailable(rig, ["X-01"]);
  rig.machine.selectCartDoor("X-01", "sports-25", true);
  const sale = (await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: "PRODUCTION", configVersion: 1, doorIds: ["X-01"] })).sale;
  const paymentKey = crypto.randomUUID();
  await rig.machine.startPayment(sale.saleId, paymentKey);
  assert.equal(payment.observed.payment_intent_key, paymentKey);
  assert.match(payment.observed.payment_request_digest, /^[a-f0-9]{64}$/);
  assert.equal(payment.observed.payment_state, "REQUESTED");
  assert.equal(payment.observed.state, "PAYMENT_REQUESTED");
  assert.equal(rig.machine.publicSale(sale.saleId).paymentState, "UNKNOWN");
  rig.store.close();
});

test("duplicate, conflicting, equal-sequence, and out-of-order callbacks cannot regress authorization", async () => {
  const rig = await createRig();
  makeDoorAvailable(rig, ["X-01"]);
  rig.payment.scriptStart({ outcome: "UNKNOWN" });
  rig.machine.selectCartDoor("X-01", "sports-25", true);
  const sale = (await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: "PRODUCTION", configVersion: 1, doorIds: ["X-01"] })).sale;
  await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
  const providerSessionId = rig.store.one("SELECT provider_session_id FROM sale WHERE sale_id=?", sale.saleId).provider_session_id;
  const callback = {
    callbackId: "review-authorize",
    saleId: sale.saleId,
    providerSessionId,
    sequence: 5,
    state: "AUTHORIZED",
    occurredAt: rig.clock.now().toISOString(),
    evidence: { normalizedCode: "OK", pan: "4111111111111111" },
  };
  assert.equal((await rig.machine.handleProviderCallback(callback)).disposition, "APPLIED");
  assert.equal((await rig.machine.handleProviderCallback(structuredClone(callback))).disposition, "DUPLICATE");
  await assert.rejects(
    () => rig.machine.handleProviderCallback({ ...callback, state: "DECLINED" }),
    hasCode("PAYMENT_CALLBACK_CONFLICT"),
  );
  assert.equal((await rig.machine.handleProviderCallback({ ...callback, callbackId: "review-equal", state: "DECLINED" })).disposition, "SEQUENCE_CONFLICT");
  assert.equal((await rig.machine.handleProviderCallback({ ...callback, callbackId: "review-late", sequence: 4, state: "DECLINED" })).disposition, "OUT_OF_ORDER");
  assert.equal(rig.machine.publicSale(sale.saleId).paymentState, "AUTHORIZED");
  assert.equal(JSON.parse(rig.store.one("SELECT evidence_json FROM payment_callback WHERE callback_id='review-authorize'").evidence_json).pan, "[REDACTED]");
  assert.equal(rig.store.one("SELECT COUNT(*) AS count FROM command_intent WHERE sale_id=?", sale.saleId).count, 1);
  rig.store.close();
});
