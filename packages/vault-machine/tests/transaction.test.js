const test = require("node:test");
const assert = require("node:assert/strict");
const { createRig, makeDoorAvailable, crypto } = require("./helpers");

async function reserve(rig, doors = ["X-01"]) {
  for (const doorId of doors) rig.machine.selectCartDoor(doorId, "sports-25", true);
  return rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: "PRODUCTION", configVersion: 1, doorIds: doors });
}

test("checkout atomically reserves exact doors and pins product, tax, config and mapping snapshots", async () => {
  const rig = await createRig(); makeDoorAvailable(rig, ["X-01", "K-01"]);
  const result = await reserve(rig, ["X-01", "K-01"]); assert.ok(result.sale);
  assert.equal(result.sale.subtotalCents, 5000); assert.equal(result.sale.taxCents, 413); assert.equal(result.sale.totalCents, 5413);
  assert.deepEqual(rig.store.all(`SELECT state FROM door WHERE door_id IN ('X-01','K-01') ORDER BY door_id`).map((row) => row.state), ["RESERVED", "RESERVED"]);
  const sale = rig.store.one(`SELECT city,state_region,tax_rate_basis_points,config_version FROM sale WHERE sale_id=?`, result.sale.saleId);
  assert.deepEqual(sale, { city: "Los Angeles", state_region: "CA", tax_rate_basis_points: 825, config_version: 1 });
  const reservedEvent = JSON.parse(rig.store.one(`SELECT payload_json FROM machine_event WHERE type='SALE_RESERVED'`).payload_json);
  assert.equal(reservedEvent.saleId, result.sale.saleId);
  assert.equal(reservedEvent.supportReference, result.sale.supportReference);
  assert.equal(reservedEvent.configDigest.length, 64);
  assert.equal(reservedEvent.items.length, 2);
  assert.deepEqual(reservedEvent.items.map((item) => item.doorId).sort(), ["K-01", "X-01"]);
  assert.ok(reservedEvent.items.every((item) => item.lineId && item.productName === "Sports Mystery Pack"));
  rig.store.close();
});

test("reservation conflict removes only changed door and preserves valid cart lines", async () => {
  const rig = await createRig(); makeDoorAvailable(rig, ["X-01", "K-01"]);
  rig.machine.selectCartDoor("X-01", "sports-25", true); rig.machine.selectCartDoor("K-01", "sports-25", true);
  rig.store.run(`UPDATE door SET state='SERVICE_HOLD' WHERE door_id='K-01'`);
  const result = await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: "PRODUCTION", configVersion: 1, doorIds: ["X-01", "K-01"] });
  assert.equal(result.sale, null); assert.deepEqual(result.conflictedDoorIds, ["K-01"]); assert.deepEqual(result.preservedDoorIds, ["X-01"]);
  assert.deepEqual(rig.store.all(`SELECT door_id FROM cart_item`).map((row) => row.door_id), ["X-01"]); rig.store.close();
});

test("secure pick persists one unbiased eligible selection before returning", async () => {
  const rig = await createRig(); makeDoorAvailable(rig, ["X-01", "K-01", "I-01"]);
  const picked = rig.machine.pickForMe("sports-25"); assert.ok(["X-01", "K-01", "I-01"].includes(picked.doorId));
  assert.equal(rig.store.one(`SELECT product_id FROM cart_item WHERE door_id=?`, picked.doorId).product_id, "sports-25"); assert.equal(rig.store.one(`SELECT COUNT(*) AS count FROM machine_event WHERE type='CART_SECURE_PICK_PERSISTED'`).count, 1); rig.store.close();
});

test("authorization commits sold doors and deterministic intents before serialized commands; retry is exactly all original doors once", async () => {
  const rig = await createRig(); makeDoorAvailable(rig, ["X-01", "K-01", "I-01"]);
  rig.controller.script({ fault: "ACK", delayMs: 5 }, { fault: "TIMEOUT" }, { fault: "NAK" }, { fault: "ACK" }, { fault: "ACK" }, { fault: "ACK" });
  const checkout = await reserve(rig, ["X-01", "K-01", "I-01"]); const paymentKey = crypto.randomUUID();
  const paid = await rig.machine.startPayment(checkout.sale.saleId, paymentKey);
  assert.equal(paid.paymentState, "AUTHORIZED"); assert.equal(rig.controller.maxObservedConcurrency(), 1);
  assert.deepEqual(rig.store.all(`SELECT DISTINCT state FROM door WHERE owning_sale_id=?`, paid.saleId).map((row) => row.state), ["COMMITTED_SOLD"]);
  assert.equal(rig.store.one(`SELECT COUNT(*) AS count FROM command_intent WHERE sale_id=? AND attempt=1`, paid.saleId).count, 3);
  const retryKey = crypto.randomUUID(); await rig.machine.openPaidDoorsAgain(paid.saleId, retryKey);
  const attempts = rig.store.all(`SELECT door_id,attempt FROM command_intent WHERE sale_id=? ORDER BY attempt,door_id`, paid.saleId);
  assert.equal(attempts.length, 6); assert.deepEqual(attempts.filter((row) => row.attempt === 2).map((row) => row.door_id), ["I-01", "K-01", "X-01"]);
  for (const type of ["FULFILLMENT_COMMITTED", "PAID_DOOR_GROUP_RETRY_COMMITTED"]) {
    const event = JSON.parse(rig.store.one(`SELECT payload_json FROM machine_event WHERE type=?`, type).payload_json);
    assert.equal(event.commands.length, 3);
    assert.ok(event.commands.every((command) => command.commandId && command.doorId && [1, 2].includes(command.attempt)));
  }
  await assert.rejects(() => rig.machine.openPaidDoorsAgain(paid.saleId, crypto.randomUUID()), /already consumed/i);
  await rig.machine.openPaidDoorsAgain(paid.saleId, retryKey); // same request is an idempotent replay
  assert.equal(rig.store.one(`SELECT COUNT(*) AS count FROM command_intent WHERE sale_id=?`, paid.saleId).count, 6); rig.store.close();
});

test("decline releases reservation; unknown retains it and reconcile authorization fulfills without second payment", async () => {
  const decline = await createRig(); makeDoorAvailable(decline, ["X-01"]); decline.payment.scriptStart({ outcome: "DECLINE" });
  const declinedSale = (await reserve(decline)).sale; await decline.machine.startPayment(declinedSale.saleId, crypto.randomUUID());
  assert.equal(decline.machine.publicSale(declinedSale.saleId).state, "PAYMENT_DECLINED"); assert.equal(decline.store.one(`SELECT state FROM door WHERE door_id='X-01'`).state, "AVAILABLE"); decline.store.close();

  const unknown = await createRig(); makeDoorAvailable(unknown, ["X-01"]); unknown.payment.scriptStart({ outcome: "UNKNOWN" }).scriptReconcile({ outcome: "AUTHORIZE" });
  const unknownSale = (await reserve(unknown)).sale; await unknown.machine.startPayment(unknownSale.saleId, crypto.randomUUID());
  assert.equal(unknown.machine.publicSale(unknownSale.saleId).paymentState, "UNKNOWN"); assert.equal(unknown.store.one(`SELECT state FROM door WHERE door_id='X-01'`).state, "RESERVED");
  await unknown.machine.reconcileSale(unknownSale.saleId); assert.equal(unknown.machine.publicSale(unknownSale.saleId).paymentState, "AUTHORIZED"); assert.equal(unknown.store.one(`SELECT state FROM door WHERE door_id='X-01'`).state, "COMMITTED_SOLD"); unknown.store.close();
});

test("mock provider deterministically covers cancel and timeout without inventing settlement", async () => {
  const cancelled = await createRig(); makeDoorAvailable(cancelled); cancelled.payment.scriptStart({ outcome: "CANCEL" }); const cancelledSale = (await reserve(cancelled)).sale;
  await cancelled.machine.startPayment(cancelledSale.saleId, crypto.randomUUID()); assert.equal(cancelled.machine.publicSale(cancelledSale.saleId).paymentState, "CANCELLED"); assert.equal(cancelled.store.one(`SELECT state FROM door WHERE door_id='X-01'`).state, "AVAILABLE"); cancelled.store.close();
  const timeout = await createRig(); makeDoorAvailable(timeout); timeout.payment.scriptStart({ outcome: "TIMEOUT" }); const timeoutSale = (await reserve(timeout)).sale;
  await timeout.machine.startPayment(timeoutSale.saleId, crypto.randomUUID()); assert.equal(timeout.machine.publicSale(timeoutSale.saleId).paymentState, "UNKNOWN"); assert.equal(timeout.store.one(`SELECT state FROM door WHERE door_id='X-01'`).state, "RESERVED"); timeout.store.close();
});

test("controller mapping validation rejects duplicate channels and protects command mapping", async () => {
  const rig = await createRig(); const invalid = rig.contracts.SIMULATOR_DOOR_MAPPING.map((entry) => ({ ...entry })); invalid[1].controllerChannel = invalid[0].controllerChannel;
  const result = await rig.controller.validateMapping(invalid); assert.equal(result.valid, false); assert.ok(result.errors.includes("DUPLICATE_CHANNEL")); rig.store.close();
});

test("callbacks are idempotent, conflicting IDs are quarantined, and lower sequences cannot regress", async () => {
  const rig = await createRig(); makeDoorAvailable(rig, ["X-01"]); rig.payment.scriptStart({ outcome: "UNKNOWN" });
  const sale = (await reserve(rig)).sale; await rig.machine.startPayment(sale.saleId, crypto.randomUUID()); const provider = rig.store.one(`SELECT provider_session_id FROM sale WHERE sale_id=?`, sale.saleId).provider_session_id;
  const callback = { callbackId: "cb-authorize", saleId: sale.saleId, providerSessionId: provider, sequence: 5, state: "AUTHORIZED", occurredAt: rig.clock.now().toISOString(), evidence: { pan: "4111111111111111", normalizedCode: "OK" } };
  assert.equal((await rig.machine.handleProviderCallback(callback)).disposition, "APPLIED"); assert.equal((await rig.machine.handleProviderCallback(callback)).disposition, "DUPLICATE");
  await assert.rejects(() => rig.machine.handleProviderCallback({ ...callback, state: "DECLINED" }), /conflicts/i);
  const late = await rig.machine.handleProviderCallback({ ...callback, callbackId: "cb-late", sequence: 4, state: "DECLINED" });
  assert.equal(late.disposition, "OUT_OF_ORDER"); assert.equal(late.sale.paymentState, "AUTHORIZED");
  assert.equal(JSON.parse(rig.store.one(`SELECT evidence_json FROM payment_callback WHERE callback_id='cb-authorize'`).evidence_json).pan, "[REDACTED]");
  assert.equal(rig.store.one(`SELECT COUNT(*) AS count FROM command_intent WHERE sale_id=?`, sale.saleId).count, 1); rig.store.close();
});
