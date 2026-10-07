const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRig, grant, makeDoorAvailable } = require('./helpers');
const { VaultMaintenance } = require('../dist/maintenance');

test('maintenance idle entry drains once, locks durable service and expires staff', async () => {
  const rig = await createRig(); let drains = 0;
  try {
    grant(rig, 'ADMIN');
    const maintenance = new VaultMaintenance(rig.machine, { quiesce: async () => { drains++; }, resume: async () => assert.fail('unexpected resume'), now: () => rig.clock.now() });
    assert.equal((await maintenance.status()).restartAllowed, false);
    const [a, b] = await Promise.all([maintenance.enter(), maintenance.enter()]);
    assert.equal(a.restartAllowed, true); assert.deepEqual(a, b); assert.equal(drains, 1);
    assert.equal(rig.store.one('SELECT service_locked FROM machine_meta').service_locked, 1);
    assert.equal(rig.store.maybeOne('SELECT 1 FROM staff_session WHERE ended_at IS NULL'), undefined);
    await rig.machine.initialize();
    assert.equal(rig.store.one('SELECT service_locked FROM machine_meta').service_locked, 1);
  } finally { rig.store.close(); }
});

test('maintenance rejects unresolved sale without quiescing or changing its bytes', async () => {
  const rig = await createRig();
  try {
    makeDoorAvailable(rig);
    rig.machine.selectCartDoor('X-01', 'sports-25', true);
    await rig.machine.checkout({ idempotencyKey: '00000000-0000-4000-8000-000000000001', mode: 'PRODUCTION', configVersion: 1, doorIds: ['X-01'] });
    const before = rig.store.all('SELECT * FROM sale');
    const maintenance = new VaultMaintenance(rig.machine, { quiesce: async () => assert.fail('unsafe drain'), resume: async () => assert.fail('unsafe resume') });
    const status = await maintenance.enter();
    assert.equal(status.restartAllowed, false); assert.ok(status.blockers.includes('NONTERMINAL_SALE'));
    assert.deepEqual(rig.store.all('SELECT * FROM sale'), before);
  } finally { rig.store.close(); }
});

test('maintenance detects a raced mutation while draining and resumes without service lock', async () => {
  const rig = await createRig(); let resumed = false;
  try {
    const maintenance = new VaultMaintenance(rig.machine, { quiesce: async () => rig.store.run('UPDATE machine_meta SET recovery_required=1'), resume: async () => { resumed = true; } });
    const status = await maintenance.enter();
    assert.equal(status.restartAllowed, false); assert.ok(status.blockers.includes('RECOVERY_REQUIRED')); assert.equal(resumed, true);
    assert.equal(rig.store.one('SELECT service_locked FROM machine_meta').service_locked, 0);
  } finally { rig.store.close(); }
});

test('physical maintenance requires affirmative OFF observation; missing or unknown remains blocked', async () => {
  const rig = await createRig();
  try {
    const maintenance = new VaultMaintenance(rig.machine, { quiesce: async () => {}, resume: async () => {} });
    for (const outputState of [undefined, 'UNKNOWN', 'ACTIVE']) {
      rig.controller.identity = async () => ({ mode: 'OFFICIAL_TEST', ready: true, outputState });
      assert.ok((await maintenance.status()).blockers.includes('CONTROLLER_IDLE_UNVERIFIED'));
    }
    rig.controller.identity = async () => ({ mode: 'OFFICIAL_TEST', ready: true, outputState: 'OFF_VERIFIED' });
    assert.equal((await maintenance.enter()).restartAllowed, true);
  } finally { rig.store.close(); }
});

test('completed presentation does not make settlement or reconciliation uncertainty restartable', async () => {
  const rig = await createRig();
  try {
    makeDoorAvailable(rig); rig.machine.selectCartDoor('X-01', 'sports-25', true);
    await rig.machine.checkout({ idempotencyKey: '00000000-0000-4000-8000-000000000002', mode: 'PRODUCTION', configVersion: 1, doorIds: ['X-01'] });
    rig.store.run("UPDATE sale SET state='COMPLETED'");
    const maintenance = new VaultMaintenance(rig.machine, { quiesce: async () => assert.fail('unsafe drain'), resume: async () => {} });
    for (const state of ['RECONCILIATION_REQUIRED', 'SETTLEMENT_PENDING', 'AUTHORIZED', 'VEND_RESULT_PENDING', 'UNKNOWN']) {
      rig.store.run('UPDATE sale SET payment_state=?', state);
      assert.ok((await maintenance.enter()).blockers.includes('UNRESOLVED_PAYMENT'));
    }
  } finally { rig.store.close(); }
});

test('actual HTTP maintenance waits a partly received mutation and resumes after its cart change', async () => {
  const net = require('node:net'); const httpClient = require('node:http');
  const { vault } = require('./helpers');
  const rig = await createRig(); makeDoorAvailable(rig);
  const portProbe = net.createServer(); await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
  const origin = `http://127.0.0.1:${port}`; let http;
  let enteredQuiesce; const quiescing = new Promise(resolve => { enteredQuiesce = resolve; });
  const maintenance = new VaultMaintenance(rig.machine, { quiesce: async () => { enteredQuiesce(); await http.pauseMutations(); }, resume: async () => http.resumeMutations() });
  http = new vault.VaultHttpService(rig.machine, rig.operations, { origin, port, clock: rig.clock, adapterCallbackToken: 'callback-test-only', maintenance, maintenanceToken: 'maintenance-test-only' });
  await http.listen(); let request;
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Vault-Contract-Version': '1' };
  try {
    const bootstrap = await fetch(origin + '/api/v1/session/bootstrap', { method: 'POST', headers, body: '{}' });
    const cookie = bootstrap.headers.get('set-cookie').split(';')[0]; await bootstrap.arrayBuffer();
    const stateVersion = rig.store.one('SELECT public_state_version FROM machine_meta').public_state_version;
    const body = JSON.stringify({ selected: true, productId: 'sports-25', doorId: 'X-01' });
    const accepted = new Promise(resolve => http.server.once('request', resolve));
    const completed = new Promise((resolve, reject) => {
      request = httpClient.request(origin + '/api/v1/cart/select', { method: 'POST', headers: { ...headers, Cookie: cookie, 'If-Match': String(stateVersion), 'Content-Length': Buffer.byteLength(body) } }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); });
      request.on('error', reject); request.write(body.slice(0, 1));
    });
    await accepted;
    const entering = maintenance.enter(); await quiescing;
    const blocked = await fetch(origin + '/api/v1/session/bootstrap', { method: 'POST', headers, body: '{}' });
    assert.equal(blocked.status, 503); await blocked.arrayBuffer();
    request.end(body.slice(1)); assert.equal(await completed, 200);
    const result = await entering;
    assert.equal(result.restartAllowed, false); assert.ok(result.blockers.includes('CART_ACTIVE'));
    assert.equal(rig.store.one('SELECT service_locked FROM machine_meta').service_locked, 0);
    const resumed = await fetch(origin + '/api/v1/session/bootstrap', { method: 'POST', headers, body: '{}' });
    assert.equal(resumed.status, 200); await resumed.arrayBuffer();
  } finally { request?.destroy(); await http.close(); rig.store.close(); }
});
