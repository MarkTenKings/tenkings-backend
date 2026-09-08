const test = require("node:test");
const assert = require("node:assert/strict");
const { createRig, makeDoorAvailable, tempDatabase, crypto, vault, contracts } = require("./helpers");

async function reserveOne(rig) {
  rig.machine.selectCartDoor("X-01", "sports-25", true);
  return (await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: "PRODUCTION", configVersion: 1, doorIds: ["X-01"] })).sale;
}

test("restart reconciles unknown payment and preserves the original transaction", async () => {
  const temporary = tempDatabase(); const rig = await createRig({ databasePath: temporary.path, acquireProcessLock: true }); makeDoorAvailable(rig);
  rig.payment.scriptStart({ outcome: "UNKNOWN" }).scriptReconcile({ outcome: "AUTHORIZE" });
  const sale = await reserveOne(rig); await rig.machine.startPayment(sale.saleId, crypto.randomUUID()); assert.equal(rig.machine.publicSale(sale.saleId).paymentState, "UNKNOWN");
  rig.store.close();
  const reopenedStore = new vault.VaultStore(temporary.path, { machineId: rig.machineId, appVersion: "0.1.0" });
  const controller = new vault.DeterministicControllerSimulator([...contracts.SIMULATOR_DOOR_MAPPING]);
  const publicPem = rig.keyPair.publicKey.export({ type: "spki", format: "pem" });
  const restarted = new vault.VaultMachine(reopenedStore, rig.payment, controller, { pinnedConfigKeys: { "test-config-key": publicPem }, appVersion: "0.1.0", clock: rig.clock });
  const recovery = await restarted.initialize(); assert.equal(recovery.recoveredSales, 1); assert.equal(restarted.publicSale(sale.saleId).paymentState, "AUTHORIZED");
  assert.equal(reopenedStore.one(`SELECT state FROM door WHERE door_id='X-01'`).state, "COMMITTED_SOLD"); assert.equal(controller.receipts.length, 1);
  reopenedStore.close(); require("node:fs").rmSync(temporary.directory, { recursive: true, force: true });
});

test("controller effect that throws remains SENT_UNKNOWN and is never blindly resent after restart", async () => {
  const temporary = tempDatabase();
  class ThrowingController extends vault.DeterministicControllerSimulator { async sendOpenCommand() { throw new Error("power cut after write boundary"); } }
  const firstController = new ThrowingController([...contracts.SIMULATOR_DOOR_MAPPING]);
  const rig = await createRig({ databasePath: temporary.path, acquireProcessLock: true, controller: firstController }); makeDoorAvailable(rig);
  const sale = await reserveOne(rig); await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
  assert.equal(rig.store.one(`SELECT state FROM command_intent WHERE sale_id=?`, sale.saleId).state, "SENT_UNKNOWN"); rig.store.close();
  const store = new vault.VaultStore(temporary.path, { machineId: rig.machineId, appVersion: "0.1.0" }); const safeController = new vault.DeterministicControllerSimulator([...contracts.SIMULATOR_DOOR_MAPPING]);
  const machine = new vault.VaultMachine(store, rig.payment, safeController, { pinnedConfigKeys: { "test-config-key": rig.keyPair.publicKey.export({ type: "spki", format: "pem" }) }, appVersion: "0.1.0", clock: rig.clock });
  await machine.initialize(); assert.equal(safeController.receipts.length, 0); assert.equal(store.one(`SELECT state FROM command_intent WHERE sale_id=?`, sale.saleId).state, "SENT_UNKNOWN");
  store.close(); require("node:fs").rmSync(temporary.directory, { recursive: true, force: true });
});

test("restart resumes a persisted pre-effect payment intent using the same provider idempotency key", async () => {
  const temporary = tempDatabase(); const rig = await createRig({ databasePath: temporary.path, acquireProcessLock: true }); makeDoorAvailable(rig);
  const sale = await reserveOne(rig); const paymentKey = crypto.randomUUID(); const saleRow = rig.store.one(`SELECT * FROM sale WHERE sale_id=?`, sale.saleId);
  const items = rig.store.all(`SELECT line_id,product_name,price_cents FROM sale_item WHERE sale_id=? ORDER BY line_id`, sale.saleId);
  const request = { idempotencyKey: paymentKey, saleId: sale.saleId, mode: saleRow.mode, currency: "USD", totalCents: saleRow.total_cents, items: items.map((item) => ({ lineId: item.line_id, name: item.product_name, priceCents: item.price_cents })) };
  const requestDigest = crypto.createHash("sha256").update(contracts.canonicalJson(request)).digest("hex");
  rig.store.run(`UPDATE sale SET state='PAYMENT_REQUESTED',payment_state='REQUESTED',payment_intent_key=?,payment_request_digest=? WHERE sale_id=?`, paymentKey, requestDigest, sale.saleId); rig.store.close();
  const store = new vault.VaultStore(temporary.path, { machineId: rig.machineId, appVersion: "0.1.0" }); const controller = new vault.DeterministicControllerSimulator([...contracts.SIMULATOR_DOOR_MAPPING]);
  const restarted = new vault.VaultMachine(store, rig.payment, controller, { pinnedConfigKeys: { "test-config-key": rig.keyPair.publicKey.export({ type: "spki", format: "pem" }) }, appVersion: "0.1.0", clock: rig.clock });
  await restarted.initialize(); assert.equal(restarted.publicSale(sale.saleId).paymentState, "AUTHORIZED"); assert.equal(rig.payment.session(`mock_session_${sale.saleId}`).request.idempotencyKey, paymentKey); assert.equal(controller.receipts.length, 1);
  store.close(); require("node:fs").rmSync(temporary.directory, { recursive: true, force: true });
});

test("outbox replays in order, honors contiguous partial ACKs, and retains rejected evidence", async () => {
  const rig = await createRig();
  const baseline = Number(rig.store.one(`SELECT MAX(sequence) AS value FROM outbox`).value);
  rig.store.transaction(() => { rig.machine.events.append({ type: "TEST_ONE", payload: { n: 1 } }); rig.machine.events.append({ type: "TEST_TWO", payload: { n: 2 } }); rig.machine.events.append({ type: "TEST_THREE", payload: { n: 3 } }); });
  const sent = [];
  const sink = { async send(events) { sent.push(events.map((event) => event.sequence)); return { acknowledgedEventIds: [events[0].eventId, events[2].eventId], rejected: [{ eventId: events[1].eventId, code: "TEMPORARY" }] }; } };
  const sync = new vault.OutboxSynchronizer(rig.store, rig.clock, sink);
  // Acknowledge pre-existing setup events first so this assertion isolates the explicit sequence.
  rig.store.run(`UPDATE outbox SET acknowledged_at=? WHERE sequence<=?`, rig.clock.now().toISOString(), baseline);
  const result = await sync.flush(); assert.deepEqual(result, { sent: 3, acknowledged: 1, rejected: 2 });
  const rows = rig.store.all(`SELECT sequence,acknowledged_at,last_response FROM outbox WHERE sequence>? ORDER BY sequence`, baseline);
  assert.ok(rows[0].acknowledged_at); assert.equal(rows[1].acknowledged_at, null); assert.equal(rows[2].acknowledged_at, null);
  assert.deepEqual(sent[0], [baseline + 1, baseline + 2, baseline + 3]); rig.store.close();
});
