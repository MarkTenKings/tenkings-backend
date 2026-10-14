import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LABEL_JIG_V1 } from '../../../packages/atlas-finishing/src/label-sheet-geometry.mjs';
import { LABEL_EXPORT_PROFILE_V1 } from '../../../packages/atlas-finishing/src/label-sheet.mjs';
import { createLabelSheetsClient, labelArtworkHref, LABEL_SHEETS_PATH, LABEL_EXPORT_PROFILE } from '../lib/label-sheets-client.mjs';
const sheetId = randomUUID(), itemId = randomUUID(), exportId = randomUUID(), staffId = randomUUID();
const hash = 'a'.repeat(64), sheet = { sheetId, revision: 8, jigHash: LABEL_JIG_V1.jigHash, items: [{ itemId, slot: 1 }] }, output = { exportId, sheetId, state: 'READY', sha256: hash, manifestHash: 'b'.repeat(64) };
const item = { itemId, state: 'READY', labelHash: hash };
function fixture(request, shared = new Map()) {
  const calls = [], storage = { getItem: key => shared.get(key) ?? null, setItem: (key, value) => shared.set(key, value), removeItem: key => shared.delete(key) };
  const options = { staffId, csrf: 'actual-csrf', storage, cryptoImpl: { randomUUID }, request: async (path, options) => { calls.push({ path, ...options }); return request(path, options); } };
  return { calls, shared, options, client: createLabelSheetsClient(options) };
}
test('partial export binds current sheet revision and preserves the same request after a lost reply and reload', async () => {
  const f = fixture(async () => { throw Object.assign(Error('lost'), { status: 503 }); });
  await assert.rejects(f.client.exportSheet(sheet));
  const original = f.client.pending(); assert.equal(original.kind, 'export'); assert.equal(original.body.expectedSheetRevision, 8);
  assert.equal(LABEL_EXPORT_PROFILE, LABEL_EXPORT_PROFILE_V1.id);
  assert.equal(original.body.exportProfileId, LABEL_EXPORT_PROFILE_V1.id);
  assert.equal(f.calls[0].csrf, 'actual-csrf');
  await assert.rejects(f.client.recordPrint(sheet, output, [1]), { code: 'LABEL_REQUEST_PENDING' });
  const next = createLabelSheetsClient({ ...f.options, request: async (path, options) => { assert.equal(path, f.calls[0].path); assert.deepEqual(options.body, original.body); return output; } });
  await next.resume(); assert.equal(next.pending(), null);
});
test('a sheet download issues only the exact saved-export request and never records physical printing', async () => {
  const f = fixture(async () => ({ url: 'https://objects.example/export.png?signed=1', expiresAt: new Date(Date.now() + 60000).toISOString() }));
  await f.client.downloadSheet(sheet, output);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path, `${LABEL_SHEETS_PATH}/${sheetId}/exports/${exportId}/download`);
  assert.deepEqual(Object.keys(f.calls[0].body).sort(), ['expectedExportSha256', 'requestId']);
  assert.equal(f.calls[0].body.expectedExportSha256, hash); assert.equal(f.client.pending(), null);
});
test('physical print confirmation is explicit, exact and supports a subset of occupied positions', async () => {
  const f = fixture(async () => ({ eventId: randomUUID(), exportId }));
  await f.client.recordPrint({ ...sheet, items: [...sheet.items, { itemId: randomUUID(), slot: 9 }] }, output, [9]);
  const body = f.calls[0].body; assert.deepEqual(body.successfulSlots, [9]); assert.deepEqual(body.failedSlots, []);
  assert.equal(body.exportId, exportId); assert.equal(body.exportSha256, hash); assert.equal(body.manifestHash, output.manifestHash);
  assert.throws(() => f.client.recordPrint(sheet, output, [2]), { code: 'LABEL_REPLY_INVALID' });
  assert.throws(() => f.client.recordPrint(sheet, output, [1, 1]), { code: 'LABEL_REPLY_INVALID' });
});
test('single-label export stays distinct from full-sheet export and reuses exact artwork', async () => {
  const f = fixture(async () => ({ ...output, itemId, sheetId: null }));
  const result = await f.client.exportLabel(item);
  assert.equal(result.itemId, itemId); assert.match(f.calls[0].path, /labels\/[^/]+\/exports$/);
  assert.equal(f.calls[0].body.expectedLabelHash, hash); assert.equal(f.calls[0].body.exportProfileId, 'atlas-v4-individual-2400ppi-v1');
});
test('exact known CAS refusals release a stale intent; ambiguous failures retain it', async () => {
  for (const code of ['LABEL_REVISION_CHANGED', 'LABEL_REQUEST_CONFLICT', 'LABEL_SOURCE_SUPERSEDED', 'LABEL_SOURCE_CHANGED', 'LABEL_PUBLISHED_PRODUCTION_REQUIRED', 'LABEL_EXPORT_RETRY_LIMIT', 'LABEL_EXPORT_CHANGED', 'LABEL_REPRINT_SOURCE_INVALID', 'LABEL_NOT_READY']) {
    const f = fixture(async () => { throw { status: 409, code }; });
    await assert.rejects(f.client.exportSheet(sheet)); assert.equal(f.client.pending(), null);
  }
  const f = fixture(async () => { throw { status: 503, code: 'LABEL_REVISION_CHANGED' }; });
  await assert.rejects(f.client.exportSheet(sheet)); assert.ok(f.client.pending());
});
test('verified access and deletion refusals release unavailable intents; ambiguous statuses do not', async () => {
  for (const [status, code] of [[404, 'LABEL_EXPORT_NOT_FOUND'], [404, 'LABEL_ITEM_NOT_FOUND'], [404, 'LABEL_SHEET_NOT_FOUND'], [404, 'MANUAL_CARD_NOT_FOUND'], [410, 'INTAKE_CARD_DELETED'], [403, 'LABEL_ACCESS_DENIED']]) {
    const f = fixture(async () => { throw { status, code }; });
    await assert.rejects(f.client.exportSheet(sheet)); assert.equal(f.client.pending(), null);
    const unknown = fixture(async () => { throw { status: 503, code }; });
    await assert.rejects(unknown.client.exportSheet(sheet)); assert.ok(unknown.client.pending());
  }
});
test('a definite failed export permits an explicit new retry intent instead of replaying the completed attempt', async () => {
  const f = fixture(async () => ({ ...output, state: 'FAILED', sha256: null }));
  await f.client.exportSheet(sheet); assert.equal(f.client.pending(), null);
  await f.client.exportSheet(sheet); assert.notEqual(f.calls[0].body.requestId, f.calls[1].body.requestId);
  assert.equal(f.calls[0].body.expectedSheetRevision, f.calls[1].body.expectedSheetRevision);
});
test('storage failure prevents a mutation from being dispatched', async () => {
  const f = fixture(async () => output), client = createLabelSheetsClient({ ...f.options, storage: { getItem: () => null, setItem() { throw Error('disabled'); } } });
  await assert.rejects(client.exportSheet(sheet), { code: 'LABEL_STORAGE_UNAVAILABLE' }); assert.equal(f.calls.length, 0);
});
test('late success cannot erase a newer request saved by another tab', async () => {
  let complete;
  const f = fixture(() => new Promise(resolve => { complete = resolve; }));
  const operation = f.client.exportSheet(sheet); await Promise.resolve();
  const saved = f.client.pending(), newer = { ...saved, body: { ...saved.body, requestId: randomUUID() } };
  f.shared.set(`atlas-label-sheets:${staffId}:pending`, JSON.stringify(newer));
  complete(output); await operation; assert.deepEqual(f.client.pending(), newer);
});
test('parallel gestures cannot dispatch a second request and account journals are separate', async () => {
  let complete;
  const f = fixture(() => new Promise(resolve => { complete = resolve; }));
  const operation = f.client.exportSheet(sheet); await Promise.resolve();
  await assert.rejects(f.client.exportSheet(sheet), { code: 'LABEL_REQUEST_PENDING' }); assert.equal(f.calls.length, 1);
  const other = createLabelSheetsClient({ ...f.options, staffId: randomUUID() }); assert.equal(other.pending(), null);
  complete(output); await operation;
});
test('invalid replies and unsafe or expired URLs retain their exact download intent', async () => {
  for (const url of ['javascript:alert(1)', 'https://user:password@objects.example/file', 'https://objects.example/file']) {
    const f = fixture(async () => ({ url, expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await assert.rejects(f.client.downloadSheet(sheet, output), { code: 'LABEL_DOWNLOAD_INVALID' }); assert.ok(f.client.pending());
  }
});
test('read-only sheet listing does not allocate or mutate, and duplicate positions are rejected', async () => {
  const f = fixture(async () => ({ version: 'atlas-label-sheets-v1', sheets: [{ sheetId, revision: 8, capacity: 50, jigHash: LABEL_JIG_V1.jigHash }], pending: [] }));
  await f.client.list(); assert.equal(f.calls[0].method, undefined); assert.equal(f.client.pending(), null);
  const bad = fixture(async () => ({ ...sheet, capacity: 50, items: [{ slot: 1 }, { slot: 1 }] }));
  await assert.rejects(bad.client.sheet(sheetId), { code: 'LABEL_REPLY_INVALID' });
});
test('artwork URL is an authenticated exact item path with explicit preview versus true ink', () => {
  assert.equal(labelArtworkHref(item, '/admin'), `/admin/api/staff/manual-connected/labels/${itemId}/artwork?mode=preview`);
  assert.match(labelArtworkHref(item, '/admin', 'print'), /mode=print$/);
  assert.equal(labelArtworkHref({ ...item, state: 'NEEDS_LAYOUT' }), null);
  assert.equal(labelArtworkHref({ ...item, itemId: '../unauthorized' }), null);
});


test('a different saved jig cannot be displayed as the current physical layout', async () => {
  const f = fixture(async () => ({ ...sheet, jigHash: 'f'.repeat(64), capacity: 50 }));
  await assert.rejects(f.client.sheet(sheetId), { code: 'LABEL_JIG_CHANGED' });
});
