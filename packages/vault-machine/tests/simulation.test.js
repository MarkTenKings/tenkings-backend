const test = require("node:test");
const assert = require("node:assert/strict");
const { createRig, makeDoorAvailable, crypto } = require("./helpers");

test("1,000 deterministic simulated transactions produce one sale, charge intent and command entitlement each", { timeout: 120000 }, async () => {
  const rig = await createRig(); makeDoorAvailable(rig, ["X-01"]);
  for (let index = 0; index < 1000; index += 1) {
    rig.machine.selectCartDoor("X-01", "sports-25", true);
    const sale = (await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: "CERTIFICATION", configVersion: 1, doorIds: ["X-01"] })).sale;
    await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
    const providerSessionId = rig.store.one(`SELECT provider_session_id FROM sale WHERE sale_id=?`, sale.saleId).provider_session_id;
    await rig.machine.handleProviderCallback({ callbackId: `settle-${index}`, saleId: sale.saleId, providerSessionId, sequence: 1, state: "SETTLED", occurredAt: rig.clock.now().toISOString(), evidence: { simulated: true } });
    rig.machine.markPresentationDone(sale.saleId);
    // Deterministic certification-fixture replenishment between independent sessions; no production adapter or external effect exists.
    rig.store.run(`UPDATE door SET state='AVAILABLE',product_id='sports-25',owning_sale_id=NULL WHERE door_id='X-01'`);
  }
  assert.equal(rig.store.one(`SELECT COUNT(*) AS count FROM sale`).count, 1000);
  assert.equal(rig.store.one(`SELECT COUNT(*) AS count FROM command_intent WHERE authority='PAID_SALE'`).count, 1000);
  assert.equal(rig.store.one(`SELECT COUNT(*) AS count FROM sale WHERE state='COMPLETED' AND mode='CERTIFICATION'`).count, 1000);
  assert.equal(rig.controller.receipts.length, 1000); assert.equal(rig.controller.maxObservedConcurrency(), 1);
  assert.equal(rig.store.one(`SELECT COUNT(DISTINCT payment_intent_key) AS count FROM sale`).count, 1000); rig.store.close();
});

test("model sequence rejects every third customer command across varied first/second outcomes", async () => {
  const faults = ["ACK", "NAK", "TIMEOUT", "DISCONNECT"];
  for (let index = 0; index < faults.length; index += 1) {
    const rig = await createRig(); makeDoorAvailable(rig, ["X-01"]); rig.controller.script({ fault: faults[index] }, { fault: faults[(index + 1) % faults.length] });
    rig.machine.selectCartDoor("X-01", "sports-25", true); const sale = (await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: "CERTIFICATION", configVersion: 1, doorIds: ["X-01"] })).sale;
    await rig.machine.startPayment(sale.saleId, crypto.randomUUID()); await rig.machine.openPaidDoorsAgain(sale.saleId, crypto.randomUUID());
    await assert.rejects(() => rig.machine.openPaidDoorsAgain(sale.saleId, crypto.randomUUID()), /already consumed/i);
    assert.deepEqual(rig.store.all(`SELECT attempt FROM command_intent WHERE sale_id=? ORDER BY attempt`, sale.saleId).map((row) => row.attempt), [1, 2]); rig.store.close();
  }
});
