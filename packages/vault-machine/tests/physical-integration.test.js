const test = require('node:test');
const assert = require('node:assert/strict');
const { createRig, makeDoorAvailable, crypto, vault, contracts } = require('./helpers');
const { makeSyntheticConfig } = require('../../vault-contracts/tests/profile-fixtures');

async function rigWithPhysicalBoundary() {
  const rig = await createRig({ configure: false });
  const generated = makeSyntheticConfig(rig.machineId, 1, rig.keyPair.privateKey, 2);
  // Injected test profile only; these hashes are not physical evidence.
  generated.payload.machineProfile.provenance = 'QUALIFIED';
  generated.payload.machineProfile.evidence = Object.fromEntries(['geometryDigest','wiringDigest','capabilityDigest','hardwareDigest'].map(k => [k, 'a'.repeat(64)]));
  const simulator = new vault.DeterministicControllerSimulator(generated.payload.doorMapping);
  let ready = true, outputState = 'OFF_VERIFIED', behavior = async cmd => ({ ...await simulator.sendOpenCommand(cmd), outputState: 'OFF_VERIFIED', observedDoorId: undefined });
  const controller = { identity: async () => ({ ...await simulator.identity(), mode: 'OFFICIAL_TEST', ready, outputState }), validateMapping: m => simulator.validateMapping(m), sendOpenCommand: cmd => behavior(cmd) };
  let boundDigest;
  const payment = {
    capabilities: async () => ({ ...await rig.payment.capabilities(), mode: 'OFFICIAL_TEST', bindingDigest: 'a'.repeat(64) }),
    startSession: async request => {
      const { fulfillment, ...legacy } = request;
      assert.ok(fulfillment, 'non-mock payment binds the immutable physical mapping');
      const result = await rig.payment.startSession(legacy);
      boundDigest = crypto.createHash('sha256').update(contracts.canonicalJson(request)).digest('hex');
      return { ...result, originalRequestDigest: boundDigest, providerTransactionId: "fixture-transaction" };
    },
    reconcile: async id => ({ ...await rig.payment.reconcile(id), originalRequestDigest: boundDigest, providerTransactionId: "fixture-transaction" }),
    cancelSession: async () => { throw new Error('not used in this injected test'); },
  };
  const machine = new vault.VaultMachine(rig.store, payment, controller, { pinnedConfigKeys: { 'test-config-key': rig.keyPair.publicKey.export({ type: 'spki', format: 'pem' }) }, appVersion: '0.1.0', clock: rig.clock });
  const payload = generated.payload;
  machine.stageConfig({ payload, digest: contracts.configDigest(payload), keyId: 'test-config-key', algorithm: 'Ed25519', signature: crypto.sign(null, Buffer.from(contracts.canonicalJson(payload)), rig.keyPair.privateKey).toString('base64') });
  machine.activatePendingConfig(); machine.markCloudContact();
  return { ...rig, machine, simulator, ids: payload.doorMapping.map(d => d.doorId), setReady: v => { ready = v; }, setOutput: v => { outputState = v; }, setBehavior: v => { behavior = v; } };
}
async function reserve(rig) {
  makeDoorAvailable(rig, rig.ids);
  rig.ids.forEach(id => rig.machine.selectCartDoor(id, 'sports-25', true));
  return (await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: 'CERTIFICATION', configVersion: 1, doorIds: rig.ids })).sale;
}
test('physical controller becoming unready after reservation leaves every intent undispatched', async () => {
  const rig = await rigWithPhysicalBoundary();
  try {
    const sale = await reserve(rig); rig.setReady(false);
    await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
    assert.equal(rig.simulator.receipts.length, 0);
    assert.equal(rig.store.one("SELECT COUNT(*) AS n FROM command_intent WHERE state='COMMAND_INTENT_RECORDED'").n, 2);
    assert.equal(rig.store.one('SELECT automation_halted FROM machine_meta').automation_halted, 1);
  } finally { rig.store.close(); }
});
for (const fault of ['throw', 'uncertain', 'missing-off-proof']) test(`physical ${fault} blocks the next coil and persists recovery across restart`, async () => {
  const rig = await rigWithPhysicalBoundary(); let calls = 0;
  try {
    rig.setBehavior(async cmd => { calls++; if (fault === 'throw') throw new Error('transport lost'); return { commandId: cmd.commandId, controllerSequence: 1, outcome: fault === 'uncertain' ? 'SENT_UNKNOWN' : 'ACCEPTED', ...(fault === 'uncertain' ? { outputState: 'UNCERTAIN' } : {}) }; });
    const sale = await reserve(rig); await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
    assert.equal(calls, 1);
    assert.equal(rig.store.one("SELECT state FROM command_intent WHERE completed_at IS NOT NULL").state, "SENT_UNKNOWN");
    assert.equal(rig.store.one("SELECT COUNT(*) AS n FROM command_intent WHERE state='COMMAND_INTENT_RECORDED'").n, 1);
    assert.deepEqual(rig.store.one('SELECT automation_halted,recovery_required FROM machine_meta'), { automation_halted: 1, recovery_required: 1 });
    await rig.machine.initialize(); await rig.machine.drainCommands(); assert.equal(calls, 1);
  } finally { rig.store.close(); }
});
test('physical queue holds until the first adapter completes its full OFF observation', async () => {
  const rig = await rigWithPhysicalBoundary(); let release; let calls = 0;
  const first = new Promise(resolve => { release = resolve; });
  try {
    rig.setBehavior(async cmd => { calls++; if (calls === 1) await first; return { commandId: cmd.commandId, controllerSequence: calls, outcome: 'ACCEPTED', outputState: 'OFF_VERIFIED' }; });
    const sale = await reserve(rig); const start = rig.machine.startPayment(sale.saleId, crypto.randomUUID());
    while (!calls) await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1); release(); await start; assert.equal(calls, 2);
  } finally { rig.store.close(); }
});
