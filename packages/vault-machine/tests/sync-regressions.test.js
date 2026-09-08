const test = require('node:test');
const assert = require('node:assert/strict');
const { createRig, closeAndRemove, tempDatabase, crypto, vault } = require('./helpers');

test('event and outbox inserts are atomic even when caller has no explicit transaction', async () => {
  const rig = await createRig({ configure: false });
  try {
    rig.store.db.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END");
    assert.throws(() => rig.machine.events.append({ type: 'TEST_EVENT' }));
    assert.equal(rig.store.one('SELECT COUNT(*) AS n FROM machine_event').n, 0);
  } finally { closeAndRemove(rig); }
});

test('outbox does not send newer events past a backed-off prefix and coalesces overlapping flush calls', async () => {
  const rig = await createRig({ configure: false });
  let release, sent = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const sink = { async send(batch) { sent += 1; await gate; return { acknowledgedEventIds: batch.map((event) => event.eventId), rejected: [] }; } };
  try {
    const first = rig.machine.events.append({ type: 'FIRST' });
    rig.store.run('UPDATE outbox SET next_attempt_at=? WHERE event_id=?', new Date(rig.clock.now().getTime() + 5000).toISOString(), first.eventId);
    rig.machine.events.append({ type: 'SECOND' });
    const sync = new vault.OutboxSynchronizer(rig.store, rig.clock, sink);
    assert.deepEqual(sync.pending(), []);
    rig.clock.advance(5001);
    const one = sync.flush(), two = sync.flush();
    assert.equal(sent, 1);
    release();
    const results = await Promise.all([one, two]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(results[0].acknowledged, 2);
  } finally { release(); closeAndRemove(rig); }
});

test('malformed cloud acknowledgments never discard facts or persist transport secrets', async () => {
  const rig = await createRig({ configure: false });
  try {
    rig.machine.events.append({ type: 'FIRST' });
    const sync = new vault.OutboxSynchronizer(rig.store, rig.clock, { send: async () => { throw Error('Authorization VaultMachine private-secret'); } });
    assert.equal((await sync.flush()).acknowledged, 0);
    assert.equal(rig.store.one('SELECT last_response FROM outbox').last_response, 'CLOUD_DELIVERY_FAILED');
    rig.clock.advance(10000);
    const invalid = new vault.OutboxSynchronizer(rig.store, rig.clock, { send: async () => ({ acknowledgedEventIds: ['unsent'], rejected: [] }) });
    assert.equal((await invalid.flush()).acknowledged, 0);
    assert.equal(rig.store.one('SELECT acknowledged_at FROM outbox').acknowledged_at, null);
  } finally { closeAndRemove(rig); }
});

test('durable simulated provider restores the same authorized request across process-equivalent reopen', async () => {
  const temporary = tempDatabase(), machineId = crypto.randomUUID();
  let provider;
  try {
    provider = new vault.DurableNayaxMock(temporary.path, machineId);
    const request = { idempotencyKey: crypto.randomUUID(), saleId: crypto.randomUUID(), mode: 'CERTIFICATION', currency: 'USD', totalCents: 2706, items: [{ lineId: crypto.randomUUID(), name: 'Sports', priceCents: 2500 }] };
    const original = await provider.startSession(request);
    provider.close();
    provider = new vault.DurableNayaxMock(temporary.path, machineId);
    assert.deepEqual(await provider.reconcileRequest(request.idempotencyKey), original);
    assert.deepEqual(await provider.startSession(request), original);
    assert.equal(await provider.reconcileRequest(crypto.randomUUID()), null);
    await assert.rejects(provider.startSession({ ...request, totalCents: 1 }), { code: 'PAYMENT_IDEMPOTENCY_CONFLICT' });
  } finally { provider?.close(); require('node:fs').rmSync(temporary.directory, { recursive: true, force: true }); }
});

test('outbox batches are byte bounded without skipping large Unicode facts', async () => {
  const rig = await createRig({ configure: false });
  const delivered = [];
  try {
    const payload = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`field${index}`, '界'.repeat(1000)]));
    const expected = Array.from({ length: 15 }, () => rig.machine.events.append({ type: 'BOUNDED', payload }).eventId);
    const sync = new vault.OutboxSynchronizer(rig.store, rig.clock, { send: async (batch) => {
      assert.ok(Buffer.byteLength(JSON.stringify({ contractVersion: 1, events: batch.map((event) => event.payload) })) <= 8 * 1024 * 1024);
      delivered.push(...batch.map((event) => event.eventId));
      return { acknowledgedEventIds: batch.map((event) => event.eventId), rejected: [] };
    } });
    assert.ok(sync.pressure().bytes > 9_000_000);
    const first = await sync.flush();
    assert.ok(first.sent > 0 && first.sent < 15);
    assert.deepEqual(delivered, expected.slice(0, first.sent));
    assert.equal((await sync.flush()).sent, 15 - first.sent);
    assert.deepEqual(delivered, expected);
    const count = rig.store.one('SELECT COUNT(*) AS n FROM machine_event').n;
    const oversized = Object.fromEntries(Array.from({ length: 400 }, (_, index) => [`field${index}`, '界'.repeat(1000)]));
    assert.throws(() => rig.machine.events.append({ type: 'OVERSIZED', payload: oversized }), { code: 'EVENT_PAYLOAD_INVALID' });
    assert.equal(rig.store.one('SELECT COUNT(*) AS n FROM machine_event').n, count);
  } finally { closeAndRemove(rig); }
});
