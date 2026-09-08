const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { crypto, FakeClock, makeConfig, vault, contracts } = require('./helpers');

async function mockCloud(machineId, config, grants, clock) {
  const state = { available: true, rejectAuth: false, calls: [], events: [], nextSequence: 1, grants, config };
  const credential = 'vault_' + 'q'.repeat(43);
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    state.calls.push({ method: req.method, url: req.url, body });
    res.setHeader('content-type', 'application/json');
    if (!state.available) { res.statusCode = 503; res.end('{}'); return; }
    if (state.rejectAuth || req.headers.authorization !== `VaultMachine ${credential}` || req.headers['x-vault-contract-version'] !== '1') { res.statusCode = 403; res.end('{}'); return; }
    const prefix = `/api/vault/v1/machines/${machineId}/`;
    if (!req.url.startsWith(prefix)) { res.statusCode = 404; res.end('{}'); return; }
    const path = req.url.slice(prefix.length);
    if (path === 'config' && req.method === 'GET') {
      if (req.headers['if-none-match'] === `"${state.config.digest}"`) { res.statusCode = 304; res.end(); return; }
      res.end(JSON.stringify({ config: state.config })); return;
    }
    if (path.startsWith('staff-grants:pull?') && req.method === 'GET') {
      const after = Number(new URL(req.url, 'http://127.0.0.1').searchParams.get('afterGrantVersion'));
      const selected = state.grants.filter((grant) => grant.grantVersion > after);
      res.end(JSON.stringify({ grants: selected, latestGrantVersion: selected.at(-1)?.grantVersion ?? after, hasMore: false })); return;
    }
    if (path === 'heartbeat' && req.method === 'POST') {
      contracts.VaultHeartbeatSchema.parse(body);
      res.end(JSON.stringify({ accepted: true, machine: { id: machineId }, serverObservedAt: clock.now().toISOString() })); return;
    }
    if (path === 'events:batch' && req.method === 'POST') {
      contracts.VaultEventBatchSchema.parse(body);
      for (const event of body.events) {
        const previous = state.events.find((stored) => stored.eventId === event.eventId);
        if (previous) assert.deepEqual(event, previous);
        else { assert.equal(event.sequence, state.nextSequence++); state.events.push(event); }
      }
      res.end(JSON.stringify({ acknowledgedEventIds: body.events.map((event) => event.eventId), rejected: [] })); return;
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { state, credential, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

test('fresh runtime obtains configuration and staff, restocks and purchases through loopback HTTP, survives cloud loss, and syncs contiguous facts', async () => {
  const machineId = crypto.randomUUID(), clock = new FakeClock(), keys = crypto.generateKeyPairSync('ed25519');
  const signed = makeConfig(machineId, 1, keys.privateKey);
  const staff = { grantId: crypto.randomUUID(), userId: 'runtime-technician', machineId, role: 'TECHNICIAN', verifierVersion: 1, grantVersion: 1, verifier: vault.createScryptPinVerifier('123456'), hashAlgorithm: 'scrypt', hashParameters: { N: 16384, r: 8, p: 1 }, validFrom: '2026-08-16T00:00:00.000Z', expiresAt: '2027-08-16T00:00:00.000Z', revokedAt: null };
  const cloud = await mockCloud(machineId, signed, [staff], clock);
  const store = new vault.VaultStore(':memory:', { machineId, appVersion: '0.1.0', sourceCommit: 'a'.repeat(40), acquireProcessLock: false });
  let runtime;
  const machine = new vault.VaultMachine(store, new vault.DeterministicNayaxMock(), new vault.DeterministicControllerSimulator([...contracts.SIMULATOR_DOOR_MAPPING]), { clock, appVersion: '0.1.0', pinnedConfigKeys: { 'test-config-key': keys.publicKey.export({ type: 'spki', format: 'pem' }) }, beforeCheckout: () => runtime.proveCheckoutReachability() });
  const service = new vault.VaultHttpService(machine, new vault.VaultOperationsService(machine, clock), { origin: 'http://127.0.0.1:47831', port: 0, host: '127.0.0.1', adapterCallbackToken: 'local-test-adapter-secret', clock });
  await machine.initialize();
  const address = await service.listen();
  runtime = new vault.VaultRuntime(machine, new vault.VaultCloudClient({ origin: cloud.origin, machineId, credential: () => cloud.credential, allowInsecureLoopback: true }), { clock, broadcast: () => service.broadcastState() });
  let cookie = '';
  const call = async (path, body) => {
    const expected = cookie && body !== undefined && path !== '/api/v1/session/bootstrap' ? (await call('/api/v1/state')).stateVersion : null;
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Vault-Contract-Version': '1', Origin: 'http://127.0.0.1:47831', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(expected === null ? {} : { 'If-Match': String(expected) }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result)); return result.data;
  };
  try {
    assert.equal(machine.config.active(), null);
    await runtime.synchronize();
    assert.equal(machine.config.active().payload.version, 1);
    await call('/api/v1/session/bootstrap', {});
    const actor = await call('/api/v1/staff/authenticate', { userId: staff.userId, pin: '123456' });
    const restock = await call('/api/v1/restocks', { staffSessionId: actor.sessionId, doorIds: ['X-01', 'K-01'] });
    for (let index = 0; index < 2; index += 1) {
      const restockState = await call('/api/v1/state');
      const current = restockState.activeRestock.items.find((item) => item.outcome === 'UNREVIEWED' && item.command?.terminal);
      assert.ok(current, 'The restock API must expose one terminal command ready for human observation');
      const doorId = current.doorId;
      await call(`/api/v1/restocks/${restock.sessionId}/items/${doorId}`, { staffSessionId: actor.sessionId, outcome: 'FILLED' });
      if (index === 0) await call('/api/v1/restocks', { staffSessionId: actor.sessionId });
    }
    await call(`/api/v1/restocks/${restock.sessionId}/finalize`, { staffSessionId: actor.sessionId, servicedDoorsClosed: true });
    await call('/api/v1/staff/safe-exit', { staffSessionId: actor.sessionId, servicedDoorsClosed: true });
    await call('/api/v1/cart/select', { doorId: 'X-01', productId: 'sports-25', selected: true });
    const before = await call('/api/v1/state');
    const checkout = await call('/api/v1/checkout', { idempotencyKey: crypto.randomUUID(), configVersion: 1, mode: before.mode, doorIds: ['X-01'] });
    const saleId = checkout.activeSale.saleId;
    // Cloud outage after durable checkout must not prevent local fulfillment/retry.
    cloud.state.available = false;
    await assert.rejects(runtime.synchronize());
    await call(`/api/v1/sales/${saleId}/payment`, { idempotencyKey: crypto.randomUUID() });
    await runtime.tickLocal();
    const paid = await call('/api/v1/state');
    assert.deepEqual(paid.activeSale.paidDoorIds, ['X-01']);
    await call(`/api/v1/sales/${saleId}/open-doors`, { idempotencyKey: crypto.randomUUID() });
    assert.equal(store.one("SELECT COUNT(*) AS n FROM command_intent WHERE sale_id=?", saleId).n, 2);
    await call(`/api/v1/sales/${saleId}/done`, {});
    await call('/api/v1/cart/select', { doorId: 'K-01', productId: 'sports-25', selected: true });
    await assert.rejects(machine.checkout({ idempotencyKey: crypto.randomUUID(), configVersion: 1, mode: paid.mode, doorIds: ['K-01'] }));
    cloud.state.available = true;
    clock.advance(300_000);
    await runtime.synchronize();
    assert.equal(cloud.state.events.some((event) => event.type === 'FULFILLMENT_COMMITTED'), true);
    assert.equal(cloud.state.events.some((event) => event.actor === staff.userId), true);
    assert.equal(cloud.state.calls.some((request) => request.method === 'GET' && request.url.includes('staff-grants:pull?')), true);
    assert.equal(cloud.state.calls.some((request) => request.method === 'POST' && request.url.endsWith('events:batch')), true);
    cloud.state.rejectAuth = true;
    await assert.rejects(runtime.synchronize(), { code: 'CLOUD_AUTH_REJECTED' });
    assert.equal((await machine.readiness()).ready, false);
  } finally { await runtime.stop(); await service.close(); store.close(); await cloud.close(); }
});

test('cloud transport rejects insecure non-loopback origins, redirects, credential leakage and malformed acknowledgments', async () => {
  const machineId = crypto.randomUUID();
  for (const origin of ['http://example.test', 'https://user:password@example.test', 'https://example.test/path', 'file:///tmp']) assert.throws(() => new vault.VaultCloudClient({ origin, machineId, credential: () => 'secret', allowInsecureLoopback: true }));
  const client = new vault.VaultCloudClient({ origin: 'https://cloud.example.test', machineId, credential: () => 'secret-credential', fetch: async (_url, options) => { assert.equal(options.redirect, 'error'); throw Error('leak secret-credential https://user:password@example.test'); } });
  await assert.rejects(client.config(), (error) => error.code === 'CLOUD_RESPONSE_INVALID' && !String(error).includes('secret-credential'));
});

test('CLI failed listener startup releases both SQLite writer locks without printing credentials', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'vault-cli-validation-'));
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const database = path.join(directory, 'machine.sqlite');
  try {
    const keys = crypto.generateKeyPairSync('ed25519');
    const publicKey = path.join(directory, 'public.pem');
    fs.writeFileSync(publicKey, keys.publicKey.export({ type: 'spki', format: 'pem' }));
    const result = require('node:child_process').spawnSync(process.execPath, [path.resolve(__dirname, '../dist/cli.js')], {
      timeout: 15000, encoding: 'utf8', env: {
        PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        VAULT_MACHINE_ID: crypto.randomUUID(), VAULT_DATABASE_PATH: database,
        VAULT_KIOSK_ORIGIN: `http://127.0.0.1:${server.address().port}`, VAULT_PORT: String(server.address().port),
        VAULT_ADAPTER_CALLBACK_TOKEN: 'fixture-callback-secret', VAULT_CONFIG_PUBLIC_KEY_PATH: publicKey,
        VAULT_CONFIG_KEY_ID: 'fixture', VAULT_APP_VERSION: '0.1.0', VAULT_SOURCE_COMMIT: 'a'.repeat(40),
        VAULT_KIOSK_STATIC_ROOT: directory, VAULT_CLOUD_ORIGIN: 'https://127.0.0.1:1',
        VAULT_MACHINE_CREDENTIAL: 'fixture-machine-secret',
      },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /fixture-(callback|machine)-secret/);
    assert.equal(fs.existsSync(`${database}.writer.lock`), false);
    assert.equal(fs.existsSync(`${database}.mock-provider.sqlite.writer.lock`), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
