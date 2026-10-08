const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { createRig, vault } = require('./helpers');
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port; }
test('maintenance authenticates separately, drains HTTP admission and retains a service lock', async () => {
  const rig = await createRig(); const port = await freePort(), origin = `http://127.0.0.1:${port}`; let http;
  const maintenance = new vault.VaultMaintenance(rig.machine, { quiesce: async () => { await http.pauseMutations(); }, resume: async () => { http.resumeMutations(); }, now: () => rig.clock.now() });
  http = new vault.VaultHttpService(rig.machine, rig.operations, { origin, port, clock: rig.clock, adapterCallbackToken: 'callback-test-only', maintenance, maintenanceToken: 'maintenance-test-only' });
  await http.listen();
  const post = (path, body, token) => fetch(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Vault-Contract-Version': '1', ...(token ? { 'X-Vault-Maintenance-Token': token } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/api/v1/internal/maintenance', { action: 'enter' }, 'callback-test-only')).status, 401);
    let response = await post('/api/v1/internal/maintenance', { action: 'status' }, 'maintenance-test-only');
    assert.equal((await response.json()).data.restartAllowed, false);
    response = await post('/api/v1/internal/maintenance', { action: 'enter' }, 'maintenance-test-only');
    assert.equal(response.status, 200); const state = (await response.json()).data;
    assert.equal(state.maintenanceActive, true); assert.equal(state.restartAllowed, true);
    assert.equal(rig.store.one('SELECT service_locked FROM machine_meta').service_locked, 1);
    assert.equal((await post('/api/v1/session/bootstrap', {})).status, 503);
    response = await post('/api/v1/internal/maintenance', { action: 'status' }, 'maintenance-test-only');
    assert.equal((await response.json()).data.restartAllowed, true);
  } finally { await http.close(); rig.store.close(); }
});
