const test = require("node:test");
const assert = require("node:assert/strict");
const { createRig, makeDoorAvailable, crypto, vault, contracts } = require("./helpers");
const { makeSyntheticConfig } = require("../../vault-contracts/tests/profile-fixtures");

function stripeFixture() {
  const machineId = crypto.randomUUID();
  const readerId = "tmr_SimulatedWpe";
  const locationId = "tml_UnattendedVault";
  const state = { intent: null, action: null, createCalls: 0, processCalls: 0, cancelCalls: 0, failProcess: false, failCreate: false, readerStatus: "online", readerError: false, intentOverride: null, cancelError: false, settleDuringCancel: false, requests: [] };
  const reader = () => ({ id: readerId, object: "terminal.reader", location: locationId, device_type: "simulated_wisepos_e", livemode: false, status: state.readerStatus, action: state.action });
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    state.requests.push({ path, ...init });
    const fields = new URLSearchParams(init.body ?? "");
    if (path === `/v1/terminal/readers/${readerId}` && init.method === "GET") {
      if (state.readerError) throw new Error("Reader unreachable");
      return Response.json(reader());
    }
    if (path === "/v1/payment_intents" && init.method === "POST") {
      state.createCalls++;
      if (state.failCreate) throw new Error("unknown create outcome");
      if (!state.intent) state.intent = { id: "pi_VaultTest001", object: "payment_intent", amount: Number(fields.get("amount")), currency: fields.get("currency"),
        capture_method: fields.get("capture_method"), payment_method_types: [fields.get("payment_method_types[]")], livemode: false,
        status: "requires_payment_method", latest_charge: null, metadata: Object.fromEntries([...fields].filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice(9, -1), value])) };
      return Response.json(state.intent);
    }
    if (path === `/v1/payment_intents/${state.intent?.id}` && init.method === "GET") return Response.json(state.intentOverride ?? state.intent);
    if (path === `/v1/terminal/readers/${readerId}/process_payment_intent` && init.method === "POST") {
      state.processCalls++;
      if (state.failProcess) throw new Error("reader command outcome unknown");
      state.action = { type: "process_payment_intent", status: "in_progress", process_payment_intent: { payment_intent: fields.get("payment_intent") } };
      return Response.json(reader());
    }
    if (path === `/v1/terminal/readers/${readerId}/cancel_action` && init.method === "POST") {
      state.cancelCalls++;
      state.action = null;
      return Response.json(reader());
    }
    if (path === `/v1/payment_intents/${state.intent?.id}/cancel` && init.method === "POST") {
      if (state.settleDuringCancel) { state.intent.status = "succeeded"; state.intent.amount_received = state.intent.amount; state.intent.latest_charge = "ch_VaultTest001"; throw new Error("cancel raced capture"); }
      if (state.cancelError) throw new Error("cancel unknown");
      state.intent.status = "canceled";
      return Response.json(state.intent);
    }
    throw new Error(`Unexpected Stripe test request ${init.method} ${path}`);
  };
  const payment = new vault.StripeTerminalTestAdapter({ machineId, readerId, locationId, secretKey: "sk_test_FixtureOnly", fetchImpl, apiBase: "https://api.stripe.test" });
  return { machineId, payment, state };
}

async function rigWithStripe() {
  const fixture = stripeFixture();
  const rig = await createRig({ machineId: fixture.machineId, payment: fixture.payment, configure: false });
  const generated = makeSyntheticConfig(rig.machineId, 1, rig.keyPair.privateKey, 7);
  const signed = { payload: generated.payload, digest: contracts.configDigest(generated.payload), keyId: "test-config-key", algorithm: "Ed25519",
    signature: crypto.sign(null, Buffer.from(contracts.canonicalJson(generated.payload)), rig.keyPair.privateKey).toString("base64") };
  rig.machine = new vault.VaultMachine(rig.store, fixture.payment, new vault.DeterministicControllerSimulator(signed.payload.doorMapping),
    { pinnedConfigKeys: { "test-config-key": rig.keyPair.publicKey.export({ type: "spki", format: "pem" }) }, appVersion: "0.1.0", clock: rig.clock });
  rig.machine.stageConfig(signed);
  assert.equal(rig.machine.activatePendingConfig().activated, true);
  rig.machine.markCloudContact();
  const door = signed.payload.machineProfile.doors[3].doorId;
  makeDoorAvailable(rig, [door]);
  rig.machine.selectCartDoor(door, "sports-25", true);
  const sale = (await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: "CERTIFICATION", configVersion: 1, doorIds: [door] })).sale;
  return { ...fixture, rig, sale, door };
}

test("captured Stripe test payment commits one door group, including duplicate reconciliation", async t => {
  const { rig, sale, state, door } = await rigWithStripe(); t.after(() => rig.store.close());
  const key = crypto.randomUUID();
  const pending = await rig.machine.startPayment(sale.saleId, key);
  assert.equal(pending.paymentState, "REQUESTED");
  assert.equal(rig.store.one("SELECT COUNT(*) AS n FROM command_intent WHERE sale_id=?", sale.saleId).n, 0);
  assert.equal(state.createCalls, 1); assert.equal(state.processCalls, 1);
  state.intent.status = "succeeded"; state.intent.amount_received = state.intent.amount; state.intent.latest_charge = "ch_VaultTest001";
  state.action.status = "succeeded";
  const paid = await rig.machine.reconcileSale(sale.saleId);
  assert.equal(paid.paymentState, "SETTLED");
  assert.equal(paid.authorizationDurable, true);
  assert.equal(rig.store.one("SELECT COUNT(*) AS n FROM command_intent WHERE sale_id=?", sale.saleId).n, 1);
  assert.equal(rig.store.one("SELECT state FROM door WHERE door_id=?", door).state, "COMMITTED_SOLD");
  await rig.machine.reconcileSale(sale.saleId);
  await rig.machine.startPayment(sale.saleId, key);
  assert.equal(state.createCalls, 1);
  assert.equal(rig.store.one("SELECT COUNT(*) AS n FROM command_intent WHERE sale_id=?", sale.saleId).n, 1);
});

test("declined and connection-error outcomes never authorize a door", async t => {
  const { rig, sale, state, door } = await rigWithStripe(); t.after(() => rig.store.close());
  await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
  state.action = { type: "process_payment_intent", status: "failed", failure_code: "connection_error", process_payment_intent: { payment_intent: state.intent.id } };
  assert.equal((await rig.machine.reconcileSale(sale.saleId)).paymentState, "UNKNOWN");
  assert.equal(rig.store.one("SELECT COUNT(*) AS n FROM command_intent WHERE sale_id=?", sale.saleId).n, 0);
  state.action.failure_code = "card_declined";
  assert.equal((await rig.machine.reconcileSale(sale.saleId)).paymentState, "DECLINED");
  assert.equal(rig.store.one("SELECT state FROM door WHERE door_id=?", door).state, "AVAILABLE");
});

test("tampered Stripe amount and unbound create outcome fail closed", async t => {
  const { rig, sale, state } = await rigWithStripe(); t.after(() => rig.store.close());
  await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
  state.intent.amount += 1;
  await assert.rejects(rig.machine.reconcileSale(sale.saleId), { code: "STRIPE_INTENT_BINDING_INVALID" });
  assert.equal(rig.store.one("SELECT COUNT(*) AS n FROM command_intent WHERE sale_id=?", sale.saleId).n, 0);
  const second = stripeFixture(); second.state.failCreate = true;
  await assert.rejects(second.payment.reconcileRequest("unknown-key"), { code: "STRIPE_UNBOUND_INTENT_REQUIRES_REVIEW" });
});

test("a callback token cannot substitute for Stripe capture proof", async t => {
  const { rig, sale, state } = await rigWithStripe(); t.after(() => rig.store.close());
  await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
  await assert.rejects(rig.machine.handleProviderCallback({ callbackId: "invented-capture", saleId: sale.saleId,
    providerSessionId: state.intent.id, sequence: 1, state: "SETTLED", occurredAt: rig.clock.now().toISOString(), evidence: {} }),
  { code: "PAYMENT_CAPTURE_PROOF_MISSING" });
  assert.equal(rig.store.one("SELECT COUNT(*) AS n FROM command_intent WHERE sale_id=?", sale.saleId).n, 0);
});

test("Stripe test selection cannot pair with physical controller or live credential", () => {
  assert.throws(() => new vault.StripeTerminalTestAdapter({ machineId: crypto.randomUUID(), readerId: "tmr_test", locationId: "tml_test", secretKey: "sk_live_not_allowed" }), { code: "STRIPE_TEST_CONFIG_INVALID" });
  assert.throws(() => vault.createAdapterRuntime({ VAULT_PAYMENT_ADAPTER: "STRIPE_TEST", VAULT_CONTROLLER_ADAPTER: "WAVESHARE" }, "/unused", crypto.randomUUID()), /TEST_PAYMENT_CANNOT_AUTHORIZE_PHYSICAL_CONTROLLER/);
});

function request() {
  return { idempotencyKey: crypto.randomUUID(), saleId: crypto.randomUUID(), mode: "CERTIFICATION", currency: "USD", totalCents: 2500,
    items: [{ lineId: crypto.randomUUID(), name: "Sports pack", priceCents: 2500 }] };
}

test("reader offline and busy preflight cannot create or process a payment", async () => {
  for (const code of ["STRIPE_READER_OFFLINE", "STRIPE_READER_BUSY"]) {
    const { payment, state } = stripeFixture();
    if (code.endsWith("OFFLINE")) state.readerStatus = "offline";
    else state.action = { type: "process_payment_intent", status: "in_progress", process_payment_intent: { payment_intent: "pi_OtherSale" } };
    await assert.rejects(payment.startSession(request()), error => error instanceof vault.StripePaymentPreflightError && error.code === code);
    assert.equal(state.createCalls, 0); assert.equal(state.processCalls, 0);
  }
});

test("machine restores a newly reserved sale after proven no-effect preflight", async t => {
  for (const readerProblem of ["offline", "busy"]) {
    const { rig, sale, state } = await rigWithStripe(); t.after(() => rig.store.close());
    if (readerProblem === "offline") state.readerStatus = "offline";
    else state.action = { type: "process_payment_intent", status: "in_progress", process_payment_intent: { payment_intent: "pi_OtherSale" } };
    await assert.rejects(rig.machine.startPayment(sale.saleId, crypto.randomUUID()), {
      code: readerProblem === "offline" ? "STRIPE_READER_OFFLINE" : "STRIPE_READER_BUSY",
    });
    assert.equal(rig.machine.publicSale(sale.saleId).state, "RESERVED");
    assert.equal(rig.machine.publicSale(sale.saleId).paymentState, "NOT_REQUESTED");
    assert.equal(rig.store.one("SELECT payment_intent_key FROM sale WHERE sale_id=?", sale.saleId).payment_intent_key, null);
    assert.equal(rig.store.one("SELECT COUNT(*) AS n FROM machine_event WHERE type='PAYMENT_START_NO_EFFECT'").n, 1);
    assert.equal(state.createCalls, 0);
    state.readerStatus = "online"; state.action = null;
    assert.equal((await rig.machine.startPayment(sale.saleId, crypto.randomUUID())).paymentState, "REQUESTED");
    assert.equal(state.createCalls, 1);
  }
});

test("captured and canceled payment reconciliation does not depend on reader connectivity", async () => {
  for (const status of ["succeeded", "canceled"]) {
    const { payment, state } = stripeFixture();
    await payment.startSession(request());
    state.intent.status = status; state.intent.amount_received = state.intent.amount; state.intent.latest_charge = status === "succeeded" ? "ch_VaultTest001" : null;
    state.readerError = true;
    assert.equal((await payment.reconcile(state.intent.id)).state, status === "succeeded" ? "SETTLED" : "CANCELLED");
  }
});

test("reconciliation rejects substituted identity and incomplete capture evidence", async () => {
  const { payment, state } = stripeFixture();
  await payment.startSession(request());
  for (const patch of [{ id: "pi_OtherSale" }, { status: "succeeded", amount_received: 2499 }, { status: "succeeded", amount_received: 2500, latest_charge: null }, { payment_method_types: ["card_present", "card"] }, { latest_charge: { id: "ch_Expanded" } }, { livemode: true }]) {
    state.intentOverride = { ...state.intent, ...patch };
    await assert.rejects(payment.reconcile(state.intent.id), { code: "STRIPE_INTENT_BINDING_INVALID" });
  }
});

test("decline retires the PaymentIntent before releasing stock; uncertain retirement stays held", async () => {
  const { payment, state } = stripeFixture();
  await payment.startSession(request());
  state.action.status = "failed"; state.action.failure_code = "card_declined";
  state.cancelError = true;
  assert.equal((await payment.reconcile(state.intent.id)).state, "UNKNOWN");
  assert.equal(state.intent.status, "requires_payment_method");
  state.cancelError = false;
  assert.equal((await payment.reconcile(state.intent.id)).state, "DECLINED");
  assert.equal(state.intent.status, "canceled");
  assert.equal((await payment.reconcile(state.intent.id)).state, "CANCELLED");
  assert.equal(state.processCalls, 1);
});

test("cancellation racing successful capture preserves settled payment", async () => {
  const { payment, state } = stripeFixture();
  await payment.startSession(request()); state.settleDuringCancel = true;
  assert.equal((await payment.cancelSession(state.intent.id, crypto.randomUUID())).state, "SETTLED");
  assert.equal(state.cancelCalls, 1); assert.equal(state.processCalls, 1);
});

test("lost reader response retains one intent and settles by reconciliation", async () => {
  const { payment, state } = stripeFixture(); state.failProcess = true;
  const result = await payment.startSession(request());
  assert.equal(result.state, "UNKNOWN"); assert.equal(result.providerSessionId, state.intent.id);
  state.intent.status = "succeeded"; state.intent.amount_received = state.intent.amount; state.intent.latest_charge = "ch_VaultTest001";
  assert.equal((await payment.reconcile(result.providerSessionId)).state, "SETTLED");
  assert.equal(state.createCalls, 1); assert.equal(state.processCalls, 1);
});

test("invalid item totals and duplicate lines fail before any Stripe call", async () => {
  const { payment, state } = stripeFixture();
  const wrongTotal = request(); wrongTotal.items[0].priceCents = 3000;
  const duplicate = request(); duplicate.items.push(duplicate.items[0]); duplicate.totalCents = 5000;
  for (const candidate of [wrongTotal, duplicate]) await assert.rejects(payment.startSession(candidate), { code: "STRIPE_TEST_REQUEST_INVALID" });
  assert.equal(state.requests.length, 0);
});

test("transport rejects redirects and sanitizes authentication and rate-limit errors", async () => {
  for (const status of [401, 403, 429, 500]) {
    let captured;
    const payment = new vault.StripeTerminalTestAdapter({ machineId: crypto.randomUUID(), readerId: "tmr_test", locationId: "tml_test", secretKey: "sk_test_FixtureOnly",
      fetchImpl: async (_url, init) => { captured = init; return Response.json({ error: { message: "secret-card-data" } }, { status }); } });
    await assert.rejects(payment.startSession(request()), error => !error.message.includes("secret-card-data") && error.code === (status === 401 || status === 403 ? "STRIPE_API_ACCESS_DENIED" : status === 429 ? "STRIPE_API_RATE_LIMITED" : "STRIPE_API_RESPONSE_FAILED"));
    assert.equal(captured.redirect, "error");
  }
});

test("cancelling this intent never cancels another sale's reader action", async () => {
  const { payment, state } = stripeFixture();
  await payment.startSession(request());
  state.action.process_payment_intent.payment_intent = "pi_DifferentCustomer";
  assert.equal((await payment.cancelSession(state.intent.id, crypto.randomUUID())).state, "CANCELLED");
  assert.equal(state.cancelCalls, 0);
});

test("lost creation response remains unbound and cannot trigger a replacement charge", async () => {
  const { payment, state } = stripeFixture(); state.failCreate = true;
  const purchase = request();
  await assert.rejects(payment.startSession(purchase), error => error.code === "STRIPE_API_UNREACHABLE" && !(error instanceof vault.StripePaymentPreflightError));
  await assert.rejects(payment.reconcileRequest(purchase.idempotencyKey), { code: "STRIPE_UNBOUND_INTENT_REQUIRES_REVIEW" });
  assert.equal(state.createCalls, 1); assert.equal(state.processCalls, 0);
});

test("callback authorization and false negative outcomes cannot bypass capture or release unpaid inventory", async t => {
  const { rig, sale, state, door } = await rigWithStripe(); t.after(() => rig.store.close());
  await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
  for (const outcome of ['AUTHORIZED', 'DECLINED', 'CANCELLED']) {
    await assert.rejects(rig.machine.handleProviderCallback({ callbackId: `invented-${outcome}`, saleId: sale.saleId,
      providerSessionId: state.intent.id, sequence: 1, state: outcome, occurredAt: rig.clock.now().toISOString(), evidence: {} }),
      { code: outcome === 'AUTHORIZED' ? 'PAYMENT_CAPTURE_REQUIRED' : 'PAYMENT_RELEASE_PROOF_MISSING' });
  }
  assert.equal(rig.machine.publicSale(sale.saleId).paymentState, 'REQUESTED');
  assert.equal(rig.store.one('SELECT COUNT(*) AS n FROM command_intent').n, 0);
  assert.equal(rig.store.one('SELECT state FROM door WHERE door_id=?', door).state, 'RESERVED');
  assert.equal(state.createCalls, 1);
});
