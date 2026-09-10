const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createFinancialInventoryReadHandlerV2, createPhysicalInventoryWriteHandlerV2 } = require('../dist/database/src/cardInventoryV2Http');
const { exportCardInventoryPageV2 } = require('../dist/database/src/cardInventoryV2Read');
const { canonical, inventoryHash, cardInventorySourceEventIdV2, CARD_INVENTORY_MAX_BYTES } = require('../dist/database/src/cardInventoryV2');

const token = 'disposable-only-inventory-read-token-0123456789';
const tokenHash = createHash('sha256').update(token).digest('hex');
const request = (overrides = {}) => ({ method: 'GET', headers: { authorization: 'Bearer ' + token }, query: { after_sequence: '0', limit: '5' }, ...overrides });
function response() { return { headers: {}, statusCode: 0, body: null,
  setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } }; }

test('read auth and configuration fail before any database access; all responses disable caching', async () => {
  let reads = 0;
  const handler = createFinancialInventoryReadHandlerV2({ tokenHash: () => tokenHash, async readPage() { reads++; } });
  for (const authorization of [undefined, '', 'Bearer wrong-token-value-01234567890', 'Bearer ' + token + ' suffix', ['Bearer ' + token]]) {
    const res = response(); await handler(request({ headers: { authorization } }), res);
    assert.equal(res.statusCode, 401); assert.match(res.headers['Cache-Control'], /no-store/);
  }
  const res = response(); await createFinancialInventoryReadHandlerV2({ tokenHash: () => 'malformed', async readPage() { reads++; } })(request(), res);
  assert.equal(res.statusCode, 503); assert.equal(reads, 0);
});

test('read boundary rejects non-GET, unknown/duplicate/unsafe cursors, and invalid page sizes', async () => {
  let reads = 0;
  const handler = createFinancialInventoryReadHandlerV2({ tokenHash: () => tokenHash, async readPage() { reads++; } });
  const wrongMethod = response(); await handler(request({ method: 'POST' }), wrongMethod);
  assert.equal(wrongMethod.statusCode, 405); assert.equal(wrongMethod.headers.Allow, 'GET');
  for (const query of [{}, { after_sequence: ['0', '1'] }, { after_sequence: '01' }, { after_sequence: '-1' },
    { after_sequence: '9007199254740992' }, { after_sequence: '0', limit: '1001' }, { after_sequence: '0', limit: '0' },
    { after_sequence: '0', token }, { after_sequence: '0', snapshot_through_sequence: '1e3' }]) {
    const res = response(); await handler(request({ query }), res); assert.equal(res.statusCode, 400);
  }
  assert.equal(reads, 0);
});

test('read response preserves the fixed high-water contract and strips database error detail', async () => {
  const expected = { page: { schema_version: 1, source_system: 'ten-kings-card-platform-v2', snapshot_id: 'v2-inventory:7', after_sequence: 7, through_sequence: 7, events: [] }, snapshot_through_sequence: 7 };
  const handler = createFinancialInventoryReadHandlerV2({ tokenHash: () => tokenHash, async readPage(input) {
    assert.deepEqual(input, { after_sequence: 7, limit: 5, snapshot_through_sequence: 7 }); return expected;
  } });
  const res = response(); await handler(request({ query: { after_sequence: '7', limit: '5', snapshot_through_sequence: '7' } }), res);
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body, expected);
  const failure = response(); await createFinancialInventoryReadHandlerV2({ tokenHash: () => tokenHash, async readPage() {
    throw new Error('postgresql://private-host:5432/secret SQL ' + token);
  } })(request(), failure);
  assert.equal(failure.statusCode, 503); assert.doesNotMatch(JSON.stringify(failure.body), /postgresql|private-host|secret SQL|0123456789/);
});

test('financial read token cannot reach admin auth/write and admin identity is taken from session', async () => {
  let auth = 0, writes = 0;
  const handler = createPhysicalInventoryWriteHandlerV2({ readTokenHash: () => tokenHash,
    async requireAdmin() { auth++; return { authority: 'auth-service', user: { id: 'human-admin' } }; },
    async record(input, admin) { assert.equal(admin, 'human-admin'); assert.deepEqual(input, { sourced: true }); writes++; return { outcome: 'RECORDED' }; } });
  const refused = response(); await handler(request({ method: 'POST' }), refused);
  assert.equal(refused.statusCode, 403); assert.equal(auth, 0); assert.equal(writes, 0);
  const allowed = response(); await handler(request({ method: 'POST', headers: { authorization: 'Bearer human-session' }, query: {}, body: { sourced: true } }), allowed);
  assert.equal(allowed.statusCode, 200); assert.equal(auth, 1); assert.equal(writes, 1);
});

test('operator boundary rejects static capability, unauthenticated calls, GET writes, and leaks no auth error', async () => {
  let writes = 0;
  const handler = authority => createPhysicalInventoryWriteHandlerV2({ readTokenHash: () => tokenHash,
    async requireAdmin() { if (!authority) throw { statusCode: 401, message: 'private session detail' }; return { authority, user: { id: 'admin' } }; },
    async record() { writes++; } });
  for (const [authority, method, expected] of [[null, 'POST', 401], ['operator-key', 'POST', 403], ['auth-service', 'GET', 405]]) {
    const res = response(); await handler(authority)(request({ method, headers: {}, query: {} }), res);
    assert.equal(res.statusCode, expected); assert.doesNotMatch(JSON.stringify(res.body), /private session/);
  }
  assert.equal(writes, 0);
});

test('large legal inventory pages reduce event count under 10 MiB and retain contiguous resume', async () => {
  const time = new Date(Date.now() - 60000).toISOString();
  const text = '界'.repeat(2000), idText = 'i'.repeat(180), location = '11111111-1111-4111-8111-111111111111';
  const rows = Array.from({ length: 1000 }, (_, i) => {
    const cardId = 'fixture-card-' + i;
    const body = { event_kind: 'receipt', effective_at: time, correction_reason: text, external_product_id: idText,
      stock_id: null, unit_or_pack_id: cardId, lot_id: idText, acquisition_cycle_id: idText,
      quantity: 1, from_custody_id: null, to_custody_id: 'warehouse:' + idText, external_sale_id: null,
      reverses_source_event_id: null, currency: 'USD', evidence_ref: text, sale_gross_cents: null,
      components: [{ unit_id: cardId, lot_id: idText, acquisition_cycle_id: idText, acquisition_event_id: idText,
        quantity: 1, cost_cents: null, basis: 'unknown', purchase_ledger_line_id: null, evidence_ref: text, unknown_reason: text }], inputs: [] };
    const command = { request_id: 'fixture-request-' + i, card_id: cardId, product_identity_ref: text,
      custody_bindings: [{ custody_id: body.to_custody_id, location_id: location, evidence_ref: text }],
      ownership_evidence_ref: text, fulfilment: null, event: body };
    const id = cardInventorySourceEventIdV2(command.request_id);
    const event = { ...body, stock_id: id, source_event_id: id, source_sequence: i + 1, recorded_by: idText, recorded_at: time };
    const before = { currentOwnerType: 'HOUSE', currentOwnerId: null, lifecycleState: 'GRADED', locationId: null, saleMode: 'PACK' };
    const content = { command, event, card_before: before, card_after: { ...before, locationId: location, lifecycleState: 'IN_INVENTORY' } };
    return { id, cardId, sequence: BigInt(i + 1), recordedAt: new Date(time), content: canonical(content),
      contentHash: inventoryHash(content), requestHash: inventoryHash({ command, actor: idText }) };
  });
  const db = { async $queryRaw(sql) {
    if (sql.text.includes('MAX(')) return [{ maximum: 1000n }];
    if (sql.text.includes('COUNT(')) return [{ count: BigInt(sql.values[0]) }];
    const [after, bound, limit] = sql.values;
    return rows.filter(r => r.sequence > after && r.sequence <= bound).slice(0, limit);
  } };
  const first = await exportCardInventoryPageV2(db, { after_sequence: 0, limit: 1000 });
  assert.ok(first.page.events.length > 0 && first.page.events.length < 1000);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= CARD_INVENTORY_MAX_BYTES);
  let after = first.page.through_sequence;
  while (after < 1000) {
    const next = await exportCardInventoryPageV2(db, { after_sequence: after, limit: 1000, snapshot_through_sequence: first.snapshot_through_sequence });
    assert.equal(next.page.events[0].source_sequence, after + 1);
    assert.ok(Buffer.byteLength(JSON.stringify(next)) <= CARD_INVENTORY_MAX_BYTES);
    after = next.page.through_sequence;
  }
  assert.equal(after, 1000);
});
