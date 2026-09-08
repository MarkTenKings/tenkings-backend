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

test("seeded state model explores over 16000 operations across 1000 varied payment and controller sequences", { timeout: 120000 }, async () => {
  const rig = await createRig(); let seed = 0x5641554c; let operations = 0; let paidCases = 0; let terminalCases = 0;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const faults = ['ACK', 'NAK', 'TIMEOUT', 'DISCONNECT'];
  try {
    for (let scenario = 0; scenario < 1000; scenario += 1) {
      // This is a generated state-machine model, not physical restocking or
      // human certification: fixture inventory is reset between scenarios.
      makeDoorAvailable(rig, ['X-01']); rig.machine.markCloudContact();
      const outcome = ['AUTHORIZE', 'DECLINE', 'CANCEL', 'UNKNOWN'][(next() >>> 16) % 4];
      rig.payment.scriptStart({ outcome });
      const controller = rig.controller; controller.script({ fault: faults[(next() >>> 16) % 4] }, { fault: faults[(next() >>> 16) % 4] });
      rig.machine.selectCartDoor('X-01', 'sports-25', true); operations++;
      rig.machine.selectCartDoor('X-01', 'sports-25', false); operations++;
      rig.machine.selectCartDoor('X-01', 'sports-25', true); operations++;
      const request = { idempotencyKey: crypto.randomUUID(), mode: 'CERTIFICATION', configVersion: 1, doorIds: ['X-01'] };
      const sale = (await rig.machine.checkout(request)).sale; operations++;
      assert.equal((await rig.machine.checkout(request)).sale.saleId, sale.saleId); operations++;
      assert.throws(() => rig.machine.selectCartDoor('X-01', 'sports-25', false), /existing transaction/); operations++;
      const key = crypto.randomUUID(); await rig.machine.startPayment(sale.saleId, key); operations++;
      await rig.machine.startPayment(sale.saleId, key); operations++;
      if (outcome === 'UNKNOWN') { rig.payment.scriptReconcile({ outcome: 'AUTHORIZE' }); await rig.machine.advancePayments(); operations++; }
      const row = rig.store.one('SELECT * FROM sale WHERE sale_id=?', sale.saleId);
      const stale = { callbackId: crypto.randomUUID(), saleId: sale.saleId, providerSessionId: row.provider_session_id, sequence: 0, state: 'UNKNOWN', occurredAt: rig.clock.now().toISOString(), evidence: { generated: true } };
      assert.notEqual((await rig.machine.handleProviderCallback(stale)).disposition, 'APPLIED'); operations++;
      assert.equal((await rig.machine.handleProviderCallback(stale)).disposition, 'DUPLICATE'); operations++;
      rig.store.run('UPDATE machine_meta SET last_cloud_success_at=NULL WHERE singleton=1');
      assert.equal((await rig.machine.readiness()).ready, false); operations++;
      const paid = rig.machine.publicSale(sale.saleId).authorizationDurable;
      if (paid) {
        paidCases++;
        const retryKey = crypto.randomUUID(); await rig.machine.openPaidDoorsAgain(sale.saleId, retryKey); operations++;
        await rig.machine.openPaidDoorsAgain(sale.saleId, retryKey); operations++;
        await assert.rejects(() => rig.machine.openPaidDoorsAgain(sale.saleId, crypto.randomUUID()), /already consumed/); operations++;
        await rig.machine.advancePayments(); operations++;
        assert.equal(rig.machine.publicSale(sale.saleId).paymentState, 'SETTLED');
        assert.equal(rig.store.one("SELECT state FROM door WHERE door_id='X-01'").state, 'COMMITTED_SOLD');
      } else {
        terminalCases++;
        for (let attempt = 0; attempt < 4; attempt++) { await assert.rejects(() => rig.machine.openPaidDoorsAgain(sale.saleId, crypto.randomUUID()), /terminal outcomes/); operations++; }
        assert.equal(rig.store.one("SELECT state FROM door WHERE door_id='X-01'").state, 'AVAILABLE');
      }
      rig.machine.markPresentationDone(sale.saleId); operations++;
      rig.machine.markPresentationDone(sale.saleId); operations++;
      const commands = rig.store.all('SELECT door_id,attempt FROM command_intent WHERE sale_id=? ORDER BY attempt', sale.saleId);
      assert.deepEqual(commands, paid ? [{ door_id: 'X-01', attempt: 1 }, { door_id: 'X-01', attempt: 2 }] : []);
      assert.equal(rig.store.one('SELECT COUNT(*) AS count FROM sale WHERE checkout_idempotency_key=?', request.idempotencyKey).count, 1);
    }
    assert.ok(operations > 16000, `Model executed ${operations} operations`);
    assert.ok(paidCases > 400 && terminalCases > 400, `Both branches covered: paid=${paidCases}, unpaid=${terminalCases}`);
    assert.equal(rig.controller.maxObservedConcurrency(), 1);
  } finally { rig.store.close(); }
});
