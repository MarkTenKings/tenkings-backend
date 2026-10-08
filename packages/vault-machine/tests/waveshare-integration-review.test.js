const test = require('node:test');
const assert = require('node:assert/strict');
const { createRig, grant } = require('./helpers');
const { createInjectedQualifiedCertificationRig } = require('./waveshare-test-fixture');

for (const outcome of ['SENT_UNKNOWN', 'TIMEOUT', 'ACCEPTED']) test(`physical ${outcome} cannot bypass uncertainty halt with misleading or missing OFF proof`, async () => {
  const rig = await createInjectedQualifiedCertificationRig();
  try {
    const original = await rig.controller.identity();
    rig.controller.identity = async () => ({ ...original, mode: 'OFFICIAL_TEST' });
    rig.controller.sendOpenCommand = async command => ({ commandId: command.commandId, controllerSequence: 1, outcome,
      ...(outcome === 'ACCEPTED' ? {} : { outputState: 'OFF_VERIFIED' }) });
    const actor = grant(rig, 'TECHNICIAN');
    await rig.operations.startCertification(actor.sessionId);
    assert.deepEqual(rig.store.one('SELECT automation_halted,recovery_required FROM machine_meta'), { automation_halted: 1, recovery_required: 1 });
    const persisted = rig.store.one('SELECT state,completed_at FROM command_intent');
    assert.equal(persisted.state, outcome === 'ACCEPTED' ? 'SENT_UNKNOWN' : outcome);
    assert.ok(persisted.completed_at);
    await rig.machine.initialize();
    assert.equal(rig.store.one('SELECT automation_halted FROM machine_meta').automation_halted, 1);
  } finally { rig.store.close(); }
});

test('physical diagnostic with historical schema1 config is preserved but never dispatched', async () => {
  const rig = await createRig();
  try {
    const original = await rig.controller.identity();
    rig.controller.identity = async () => ({ ...original, mode: 'OFFICIAL_TEST', outputState: 'OFF_VERIFIED' });
    const actor = grant(rig, 'TECHNICIAN'); await rig.operations.startCertification(actor.sessionId);
    assert.equal(rig.controller.receipts.length, 0);
    assert.equal(rig.store.one('SELECT state FROM command_intent').state, 'COMMAND_INTENT_RECORDED');
    assert.equal(rig.store.one('SELECT automation_halted FROM machine_meta').automation_halted, 1);
  } finally { rig.store.close(); }
});

test('mixed mock-payment diagnostic is allowed only as AUTOMATED evidence and does not enable customer payment', async () => {
  const rig = await createInjectedQualifiedCertificationRig();
  try {
    const original = await rig.controller.identity(); rig.controller.identity = async () => ({ ...original, mode: 'OFFICIAL_TEST' });
    const actor = grant(rig, 'TECHNICIAN'); await rig.operations.startCertification(actor.sessionId);
    assert.equal(rig.controller.receipts.length, 1);
    assert.equal((await rig.machine.publicState()).activeCertification.observationEvidenceClass, 'AUTOMATED');
    assert.ok((await rig.machine.readiness()).reasons.includes('PHYSICAL_CONTROLLER_REQUIRES_OFFICIAL_PAYMENT'));
  } finally { rig.store.close(); }
});
