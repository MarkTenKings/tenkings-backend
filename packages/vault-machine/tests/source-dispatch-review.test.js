const test = require('node:test');
const assert = require('node:assert/strict');
const { createRig, grant, makeDoorAvailable, crypto } = require('./helpers');
const { createInjectedQualifiedCertificationRig } = require('./waveshare-test-fixture');

// Policy injection only: the fixture still uses in-process simulators. No serial
// transport, official SDK, physical qualification or actual payment is involved.
function physicalPolicy(rig) {
  const identity = rig.controller.identity.bind(rig.controller);
  rig.controller.identity = async () => ({ ...await identity(), mode: 'OFFICIAL_TEST' });
}
function source(rig, value) {
  // Models the current build identity that VaultStore records at service startup.
  rig.store.run('UPDATE machine_meta SET source_commit=? WHERE singleton=1', value);
}
function assertNotDispatched(rig, commandId) {
  assert.deepEqual(rig.store.one('SELECT state,dispatched_at,completed_at FROM command_intent WHERE command_id=?', commandId), {
    state: 'COMMAND_INTENT_RECORDED', dispatched_at: null, completed_at: null,
  });
  assert.deepEqual(rig.store.one('SELECT automation_halted,recovery_required FROM machine_meta WHERE singleton=1'), {
    automation_halted: 1, recovery_required: 1,
  });
}

for (const candidate of ['UNVERIFIED', 'UNCOMMITTED_CANDIDATE', `CANDIDATE_SHA256:${'b'.repeat(64)}`]) {
  test(`ordinary physical restock cannot dispatch from ${candidate.split(':')[0]}`, async () => {
    const rig = await createInjectedQualifiedCertificationRig();
    try {
      physicalPolicy(rig); source(rig, candidate);
      assert.ok((await rig.machine.readiness()).reasons.includes('CONTROLLER_BUILD_IDENTITY_UNVERIFIED'));
      const actor = grant(rig, 'RESTOCKER');
      await rig.operations.startOrResumeRestock(actor.sessionId, ['door-0001']);
      const intent = rig.store.one('SELECT command_id,authority FROM command_intent');
      assert.equal(intent.authority, 'RESTOCK');
      assert.equal(rig.controller.receipts.length, 0);
      assertNotDispatched(rig, intent.command_id);
      await rig.machine.initialize();
      assertNotDispatched(rig, intent.command_id);
      assert.equal(rig.controller.receipts.length, 0);
    } finally { rig.store.close(); }
  });
}

test('existing certification cannot schedule another physical diagnostic under a candidate build', async () => {
  const rig = await createInjectedQualifiedCertificationRig();
  try {
    physicalPolicy(rig);
    const actor = grant(rig, 'TECHNICIAN');
    const first = await rig.operations.startCertification(actor.sessionId);
    assert.equal(rig.controller.receipts.length, 1);
    rig.operations.recordCertificationEvidence(actor.sessionId, {
      evidenceId: crypto.randomUUID(), sessionId: first.sessionId, doorId: first.scheduledDoorId,
      evidenceClass: 'AUTOMATED', outcome: 'PASS', expectedDoorIds: [first.scheduledDoorId], observedDoorIds: [first.scheduledDoorId],
      notes: 'Injected policy regression only; no physical observation', artifactDigest: 'c'.repeat(64), observedAt: rig.clock.now().toISOString(),
    });
    source(rig, 'UNCOMMITTED_CANDIDATE');
    const next = await rig.operations.startCertification(actor.sessionId);
    assert.equal(next.sessionId, first.sessionId);
    assert.notEqual(next.commandId, first.commandId);
    assert.equal(rig.controller.receipts.length, 1);
    assertNotDispatched(rig, next.commandId);
    assert.equal(rig.store.one('SELECT source_commit FROM certification_session WHERE session_id=?', first.sessionId).source_commit, 'a'.repeat(40));
  } finally { rig.store.close(); }
});

test('a previously committed paid intent stays unsent when a candidate build reaches physical dispatch', async () => {
  const rig = await createInjectedQualifiedCertificationRig();
  try {
    // Build the durable authorization and exact selected-door intent through the
    // ordinary mock payment path, deferring only dispatch at this crash boundary.
    makeDoorAvailable(rig, ['door-0001']);
    rig.machine.selectCartDoor('door-0001', 'sports-25', true);
    const checkout = await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: 'PRODUCTION', configVersion: 1, doorIds: ['door-0001'] });
    const drain = rig.machine.drainCommands.bind(rig.machine);
    rig.machine.drainCommands = async () => {};
    await rig.machine.startPayment(checkout.sale.saleId, crypto.randomUUID());
    rig.machine.drainCommands = drain;
    const intent = rig.store.one('SELECT command_id,authority FROM command_intent WHERE sale_id=?', checkout.sale.saleId);
    assert.equal(intent.authority, 'PAID_SALE');
    const committed = rig.store.one('SELECT allocation_state FROM sale_item WHERE sale_id=?', checkout.sale.saleId);
    assert.equal(committed.allocation_state, 'COMMITTED_SOLD');
    assert.equal(rig.controller.receipts.length, 0);

    // Inject both non-MOCK policy identities so the existing mixed-adapter gate
    // cannot accidentally make this source-provenance regression pass.
    physicalPolicy(rig);
    const capabilities = rig.payment.capabilities.bind(rig.payment);
    rig.payment.capabilities = async () => ({ ...await capabilities(), mode: 'OFFICIAL_TEST' });
    source(rig, `CANDIDATE_SHA256:${'d'.repeat(64)}`);
    await rig.machine.drainCommands();
    assert.equal(rig.controller.receipts.length, 0);
    assertNotDispatched(rig, intent.command_id);
    assert.deepEqual(rig.store.one('SELECT allocation_state FROM sale_item WHERE sale_id=?', checkout.sale.saleId), committed);
  } finally { rig.store.close(); }
});

test('the existing 40-hex source contract still permits a qualified physical restock dispatch', async () => {
  const rig = await createInjectedQualifiedCertificationRig();
  try {
    physicalPolicy(rig);
    assert.ok(!(await rig.machine.readiness()).reasons.includes('CONTROLLER_BUILD_IDENTITY_UNVERIFIED'));
    const actor = grant(rig, 'RESTOCKER');
    await rig.operations.startOrResumeRestock(actor.sessionId, ['door-0001']);
    assert.equal(rig.controller.receipts.length, 1);
    assert.equal(rig.store.one('SELECT state FROM command_intent').state, 'ACCEPTED');
  } finally { rig.store.close(); }
});

test('candidate source identity preserves ordinary MOCK restock', async () => {
  const rig = await createRig({ sourceCommit: 'UNCOMMITTED_CANDIDATE' });
  try {
    assert.ok(!(await rig.machine.readiness()).reasons.includes('CONTROLLER_BUILD_IDENTITY_UNVERIFIED'));
    const actor = grant(rig, 'RESTOCKER');
    await rig.operations.startOrResumeRestock(actor.sessionId, ['X-01']);
    assert.equal(rig.controller.receipts.length, 1);
    assert.equal(rig.store.one('SELECT state FROM command_intent').state, 'ACCEPTED');
  } finally { rig.store.close(); }
});
