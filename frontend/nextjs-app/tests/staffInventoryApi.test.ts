import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import sharp from 'sharp';
import { CardInventoryErrorV2, staffInventoryWorkspaceV2, type StaffInventoryWorkspace } from '@tenkings/database';
import { createInventoryAdminSessionRequirement } from '../lib/server/inventoryAdmin';
import { HttpError, type AdminSession } from '../lib/server/adminSessionAuthority';
import { verifyInventoryPhoto, MAX_INVENTORY_PHOTO_BYTES } from '../lib/server/inventoryPhoto';
import { uploadPrivateChecksumBuffer, type StorageObjectHead } from '../lib/server/storage';
import { createStaffInventoryWorkspaceHandler } from '../pages/api/v2/admin/inventory/workspace';
import { createStaffInventoryPhotoHandler, prepareInventoryPhoto } from '../pages/api/v2/admin/inventory/photo';
import { createFinancialInventoryWorkspaceHandler } from '../pages/api/integrations/financial/inventory-workspace';
import workflowHandler, { createInventoryWorkflowRoute } from '../pages/api/v2/admin/inventory/workflow';
import eventsHandler from '../pages/api/v2/admin/inventory/events';

const READ_TOKEN = 'fixture-financial-read-capability-'.repeat(2);
const READ_HASH = createHash('sha256').update(READ_TOKEN).digest('hex');
const ADMIN: AdminSession = { sessionId: 'fixture-session', tokenHash: 'fixture-session-hash', authority: 'auth-service', user: { id: 'fixture-admin', phone: '+15555550100', displayName: 'Fixture admin' } };
const UUID = '11111111-1111-4111-8111-111111111111';
const request = (method = 'GET', body?: unknown, headers: Record<string, string | string[] | undefined> = { authorization: 'Bearer fixture-mobile-admin' }, query = {}) => ({ method, body, headers, query } as NextApiRequest);
function response() {
  const result = { code: 0, body: undefined as any, headers: {} as Record<string, string> };
  const res = { setHeader(name: string, value: string) { result.headers[name] = value; }, status(code: number) { result.code = code; return this; }, json(body: unknown) { result.body = body; return this; } } as unknown as NextApiResponse;
  return { result, res };
}
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const photoKey = (data: Buffer) => `inventory-photos/${UUID}/${sha(data)}.jpg`;
const add = () => ({ action: 'add', request_id: UUID, effective_at: '2026-01-01T00:00:00.000Z', note: '', origin: 'existing', description: { name: 'Fixture cards', category: 'pokemon', notes: '', photo_key: null }, quantity: 2, total_cost_cents: null, cost_method: 'unassigned', expected_price_cents: null, destination: { location_id: UUID, kind: 'hq', machine_id: null, product_id: null, door_id: null }, stage: 'unprocessed' });
const workspace = () => staffInventoryWorkspaceV2([], []);
const workspaceDeps = (): Parameters<typeof createStaffInventoryWorkspaceHandler>[0] => ({ requireAdmin: async () => ADMIN, readWorkspace: async () => workspace(), signPhoto: async (key: string) => `https://fixture.invalid/${key}`, verifyPhoto: async () => true, record: async () => ({ request_id: UUID, outcome: 'RECORDED' as const }) });

test('inventory uses the existing human admin authority and blocks static credentials before session lookup', async () => {
  let lookups = 0;
  const requireAdmin = createInventoryAdminSessionRequirement({ readTokenHash: () => READ_HASH, requireAdmin: async () => { lookups++; return ADMIN; } });
  assert.equal(await requireAdmin(request()), ADMIN);
  for (const authorization of [`Bearer ${READ_TOKEN}`, `bearer ${READ_TOKEN}`, `  BEARER\t${READ_TOKEN}  `]) {
    await assert.rejects(requireAdmin(request('POST', {}, { authorization })), (e: unknown) => e instanceof HttpError && e.statusCode === 403);
  }
  for (const operator of ['', 'fixture-operator-key']) await assert.rejects(requireAdmin(request('POST', {}, { authorization: 'Bearer fixture-mobile-admin', 'x-operator-key': operator })), (e: unknown) => e instanceof HttpError && e.statusCode === 403);
  for (const authorization of ['', 'Basic fixture', 'Bearer token extra']) {
    await assert.rejects(requireAdmin(request('POST', {}, { authorization })), (e: unknown) => e instanceof HttpError && e.statusCode === 401);
  }
  assert.equal(lookups, 1);
  for (const session of [{ ...ADMIN, authority: 'operator-key' as const }, { ...ADMIN, authority: undefined }, { ...ADMIN, sessionId: 'operator-key:fixture' }, { ...ADMIN, tokenHash: 'operator-key' }]) {
    const denied = createInventoryAdminSessionRequirement({ readTokenHash: () => undefined, requireAdmin: async () => session });
    await assert.rejects(denied(request()), (e: unknown) => e instanceof HttpError && e.statusCode === 403);
  }
});

test('anonymous, non-admin, financial bearer and operator calls cannot load or save staff stock', async () => {
  for (const status of [401, 403]) {
    const deps = workspaceDeps();
    deps.requireAdmin = async () => { throw new HttpError(status, 'Access denied'); };
    deps.readWorkspace = async () => { assert.fail('unauthorized read'); };
    deps.record = async () => { assert.fail('unauthorized write'); };
    for (const method of ['GET', 'POST']) {
      const { result, res } = response();
      await createStaffInventoryWorkspaceHandler(deps)(request(method, add()), res);
      assert.equal(result.code, status);
      assert.equal(result.headers['Cache-Control'], 'private, no-store');
    }
  }
  let writes = 0;
  const deps = workspaceDeps();
  deps.requireAdmin = createInventoryAdminSessionRequirement({ readTokenHash: () => READ_HASH, requireAdmin: async () => ADMIN });
  deps.record = async () => { writes++; return { request_id: UUID, outcome: 'RECORDED', events: [] }; };
  for (const headers of [{ authorization: `Bearer ${READ_TOKEN}` }, { authorization: 'Bearer mobile', 'x-operator-key': 'fixture' }]) {
    const { result, res } = response();
    await createStaffInventoryWorkspaceHandler(deps)(request('POST', add(), headers), res);
    assert.equal(result.code, 403);
  }
  assert.equal(writes, 0);
});

test('the retained advanced inventory routes use the same human-only boundary', async t => {
  const previous = process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256;
  process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256 = READ_HASH;
  t.after(() => { if (previous === undefined) delete process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256; else process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256 = previous; });
  for (const handler of [workflowHandler, eventsHandler]) {
    for (const headers of [{ authorization: `bearer ${READ_TOKEN}` }, { authorization: `Bearer ${READ_TOKEN}`, 'x-operator-key': 'fixture' }, { 'x-operator-key': 'fixture' }]) {
      const output = response(); await handler(request('POST', {}, headers), output.res);
      assert.equal(output.result.code, 403); assert.equal(output.result.headers['Cache-Control'], 'private, no-store');
    }
  }
});

test('advanced descriptive events cannot bypass stored-photo verification', async () => {
  let writes = 0, verified = 0, valid = false;
  const command = { request_id: 'fixture-description-request', effective_at: '2026-01-01T00:00:00.000Z', evidence_ref: 'fixture:description-evidence', event_kind: 'item_described', data: { unit_ids: ['fixture-unit'], description: { ...add().description, photo_key: photoKey(Buffer.from('fixture')) } } };
  const handler = createInventoryWorkflowRoute({
    requireAdmin: async () => ADMIN,
    tokenHash: () => undefined,
    read: async () => { assert.fail('not a workspace read'); },
    verifyPhoto: async key => { verified++; assert.equal(key, command.data.description.photo_key); return valid; },
    record: async () => { writes++; return { outcome: 'RECORDED' } as any; },
  });
  for (const mode of ['preview', 'record']) {
    const output = response(); await handler(request('POST', { mode, command }), output.res);
    assert.equal(output.result.code, 400); assert.equal(writes, 0);
  }
  valid = true;
  const accepted = response(); await handler(request('POST', { mode: 'record', command }), accepted.res);
  assert.equal(accepted.result.code, 200); assert.equal(verified, 3); assert.equal(writes, 1);
});

test('the workspace passes only validated facts and the session actor to the sole writer', async () => {
  const deps = workspaceDeps(), calls: unknown[][] = [];
  deps.record = async (...args: any[]) => { calls.push(args); return { request_id: UUID, outcome: 'RECORDED', events: [] }; };
  const handler = createStaffInventoryWorkspaceHandler(deps);
  const saved = response();
  await handler(request('POST', add()), saved.res);
  assert.equal(saved.result.code, 200);
  assert.deepEqual(calls, [[add(), ADMIN.user.id]]);
  const forged = response();
  await handler(request('POST', { ...add(), recorded_by: 'another-user' }), forged.res);
  assert.equal(forged.result.code, 400);
  assert.equal(calls.length, 1);
  const invalidPhoto = response();
  deps.verifyPhoto = async () => false;
  await handler(request('POST', { ...add(), description: { ...add().description, photo_key: photoKey(Buffer.from('fixture')) } }), invalidPhoto.res);
  assert.equal(invalidPhoto.result.code, 400);
  assert.equal(calls.length, 1);
  for (const [error, expected] of [[new CardInventoryErrorV2('CONFLICT', 'Stale selection'), 409], [new Error('secret provider detail'), 503]] as const) {
    deps.record = async () => { throw error; };
    const failed = response(); await handler(request('POST', add()), failed.res);
    assert.equal(failed.result.code, expected);
    assert.equal(JSON.stringify(failed.result.body).includes('secret'), false);
    assert.equal(failed.result.headers['Cache-Control'], 'private, no-store');
  }
});

test('staff and advanced descriptions verify both photos before recording reviewed card details', async () => {
  const description = { ...add().description, photo_key: photoKey(Buffer.from('front fixture')), back_photo_key: photoKey(Buffer.from('back fixture')), card_details: { manufacturer: null, card_number: '007/100', year: '2026', set_name: 'Fixture set', variant: null, card_type: 'Trading card' } };
  for (const mode of ['staff', 'preview', 'record']) {
    const verified: string[] = [], calls: unknown[] = []; let backValid = false;
    const verifyPhoto = async (key: string) => { verified.push(key); return key === description.photo_key || backValid; };
    const handler = mode === 'staff' ? createStaffInventoryWorkspaceHandler({ ...workspaceDeps(), verifyPhoto, record: async command => { calls.push(command); return { request_id: UUID, outcome: 'RECORDED' }; } }) : createInventoryWorkflowRoute({ requireAdmin: async () => ADMIN, tokenHash: () => undefined, verifyPhoto, read: async () => { assert.fail('not a read'); }, record: async input => { calls.push(input); return { outcome: 'RECORDED' } as any; } });
    const command = mode === 'staff' ? { ...add(), description } : { request_id: 'fixture-description-request', effective_at: '2026-01-01T00:00:00.000Z', evidence_ref: 'fixture:description-evidence', event_kind: 'item_described', data: { unit_ids: ['fixture-unit'], description } };
    const body = mode === 'staff' ? command : { mode, command };
    const failed = response(); await handler(request('POST', body), failed.res);
    assert.equal(failed.result.code, 400); assert.deepEqual(calls, []);
    assert.deepEqual(verified, [description.photo_key, description.back_photo_key]);
    backValid = true; verified.length = 0;
    const accepted = response(); await handler(request('POST', body), accepted.res);
    assert.equal(accepted.result.code, 200); assert.deepEqual(calls, [command]);
    assert.deepEqual(verified, [description.photo_key, description.back_photo_key]);
  }
});

test('staff refreshes sign both unique sides without re-reading photo objects or hiding inventory', async () => {
  const front = photoKey(Buffer.from('front read fixture')), back = photoKey(Buffer.from('back read fixture'));
  const deps = workspaceDeps(), signed: string[] = []; let verified = 0;
  deps.readWorkspace = async () => ({ ...workspace(), items: [{ photo_key: front, back_photo_key: back }, { photo_key: back, back_photo_key: front }, { photo_key: null, back_photo_key: back }] } as StaffInventoryWorkspace);
  deps.signPhoto = async key => { signed.push(key); return `https://fixture.invalid/${key}`; };
  const handler = createStaffInventoryWorkspaceHandler(deps);
  for (const storageFailure of ['missing', 'unavailable']) {
    deps.verifyPhoto = async () => { verified++; if (storageFailure === 'unavailable') throw new Error('Photo storage unavailable'); return false; };
    signed.length = 0; const accepted = response();
    await handler(request(), accepted.res);
    assert.equal(accepted.result.code, 200); assert.deepEqual(signed.sort(), [front, back].sort());
    assert.equal(accepted.result.body.items.length, 3);
    assert.equal(accepted.result.body.items[0].back_photo_url, accepted.result.body.items[1].photo_url);
    assert.equal(accepted.result.body.items[2].photo_url, null);
    assert.equal(verified, 0, 'workspace refresh does not HEAD or stream photo bytes');
  }
});

test('workspace reads cap response size and bound/deduplicate photo signing', async () => {
  const deps = workspaceDeps();
  let active = 0, maxActive = 0, calls = 0;
  deps.signPhoto = async (key: string) => { active++; calls++; maxActive = Math.max(active, maxActive); await Promise.resolve(); active--; return `https://fixture.invalid/${key}`; };
  deps.readWorkspace = async () => ({ ...workspace(), items: Array.from({ length: 40 }, (_, i) => ({ photo_key: `fixture-key-${i % 20}` })) } as StaffInventoryWorkspace);
  const handler = createStaffInventoryWorkspaceHandler(deps), read = response();
  await handler(request(), read.res);
  assert.equal(read.result.code, 200); assert.equal(calls, 20); assert.ok(maxActive <= 12);
  assert.equal(read.result.body.items[0].photo_url, read.result.body.items[20].photo_url);
  deps.readWorkspace = async () => ({ ...workspace(), items: [{ notes: 'x'.repeat(10 * 1024 * 1024) }] } as StaffInventoryWorkspace);
  const oversized = response(); await handler(request(), oversized.res); assert.equal(oversized.result.code, 503); assert.equal(calls, 20);
  const query = response(); await handler(request('GET', undefined, undefined, { page: '1' }), query.res); assert.equal(query.result.code, 400);
  const method = response(); await handler(request('DELETE'), method.res); assert.equal(method.result.code, 405);
});

test('photo preparation validates decoded format, caps pixels and strips source metadata', async () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const bytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#112233' } }).withMetadata({ orientation: 6 }).toFormat(format).toBuffer();
    const prepared = await prepareInventoryPhoto(`data:image/${format};base64,${bytes.toString('base64')}`);
    const metadata = await sharp(prepared.photo).metadata();
    assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined);
    assert.equal(prepared.checksum, sha(prepared.photo));
    if (format === 'png') await assert.rejects(prepareInventoryPhoto(`data:image/jpeg;base64,${bytes.toString('base64')}`));
  }
  for (const invalid of [null, '', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,Zg===', 'data:image/png;base64,ZmFrZQ==', `data:image/png;base64,${Buffer.alloc(MAX_INVENTORY_PHOTO_BYTES + 1).toString('base64')}`]) await assert.rejects(prepareInventoryPhoto(invalid));
  const tooManyPixels = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: '#111111' } }).png().toBuffer();
  await assert.rejects(prepareInventoryPhoto(`data:image/png;base64,${tooManyPixels.toString('base64')}`));
});

test('photo references require exact bounded stored metadata and native or streamed SHA-256', async () => {
  const bytes = Buffer.from('fixture-photo-body'), key = photoKey(bytes);
  const head: StorageObjectHead = { storageKey: key, byteSize: bytes.length, contentType: 'image/jpeg', metadata: { sha256: sha(bytes) }, checksumSha256: sha(bytes), nativeChecksumPresent: true, checksumSource: 'provider_native' };
  let reads = 0;
  const deps = { headObject: async () => head, openRead: async () => { reads++; return { storageKey: key, byteSize: bytes.length, body: Readable.from([bytes]) }; } };
  assert.equal(await verifyInventoryPhoto(key, deps), true); assert.equal(reads, 0);
  head.nativeChecksumPresent = false;
  assert.equal(await verifyInventoryPhoto(key, deps), true); assert.equal(reads, 1);
  deps.openRead = async () => ({ storageKey: key, byteSize: bytes.length, body: Readable.from([Buffer.alloc(bytes.length)]) });
  assert.equal(await verifyInventoryPhoto(key, deps), false, 'caller metadata cannot validate tampered bytes');
  for (const changed of [{ contentType: 'text/html' }, { storageKey: `${key}.other` }, { byteSize: 0 }, { byteSize: 1.5 }, { byteSize: MAX_INVENTORY_PHOTO_BYTES + 1 }]) {
    assert.equal(await verifyInventoryPhoto(key, { headObject: async () => ({ ...head, ...changed }), openRead: async () => { assert.fail('invalid metadata must not be read'); } }), false);
  }
  assert.equal(await verifyInventoryPhoto('../other.jpg', deps), false);
  assert.equal(await verifyInventoryPhoto(key.replace(UUID, '-'.repeat(36)), deps), false);
  assert.equal(await verifyInventoryPhoto(key, { headObject: async () => { throw { name: 'NotFound' }; } }), false);
  await assert.rejects(verifyInventoryPhoto(key, { headObject: async () => ({ ...head, nativeChecksumPresent: true, checksumSha256: null }) }));
});

test('photo upload forces private/no-store storage and verifies the stored object before signing', async () => {
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#102030' } }).png().toBuffer();
  const sent: any[] = [], steps: string[] = [];
  const deps = {
    requireAdmin: async () => ADMIN,
    storageMode: () => 's3' as const,
    upload: async (...args: Parameters<typeof uploadPrivateChecksumBuffer>) => { steps.push('upload'); return uploadPrivateChecksumBuffer(args[0], args[1], args[2], args[3], { storageMode: 's3', sendS3: async command => { sent.push(command.input); } }); },
    verifyPhoto: async (key: string) => { steps.push('verify'); const stored = sent.at(-1); return verifyInventoryPhoto(key, { headObject: async () => ({ storageKey: stored.Key, contentType: stored.ContentType, byteSize: stored.Body.length, checksumSha256: null, metadata: {} }), openRead: async () => ({ storageKey: stored.Key, body: Readable.from([stored.Body]), byteSize: stored.Body.length }) }); },
    sign: async () => { steps.push('sign'); return 'https://fixture.invalid/private-photo'; },
  };
  const handler = createStaffInventoryPhotoHandler(deps), output = response();
  await handler(request('POST', { image: `data:image/png;base64,${bytes.toString('base64')}` }), output.res);
  assert.equal(output.result.code, 200); assert.deepEqual(steps, ['upload', 'verify', 'sign']);
  assert.equal(sent[0].ACL, 'private'); assert.equal(sent[0].CacheControl, 'private, no-store'); assert.equal(sent[0].ChecksumSHA256, createHash('sha256').update(sent[0].Body).digest('base64'));
  assert.equal(output.result.headers['Cache-Control'], 'private, no-store');
  deps.verifyPhoto = async () => false;
  steps.length = 0;
  const corrupt = response(); await handler(request('POST', { image: `data:image/png;base64,${bytes.toString('base64')}` }), corrupt.res);
  assert.equal(corrupt.result.code, 503); assert.equal(steps.includes('sign'), false); assert.equal('photo_key' in corrupt.result.body, false);
  const disabled = response();
  await createStaffInventoryPhotoHandler({ ...deps, storageMode: () => 'local', upload: async () => { assert.fail('private photos cannot use public local storage'); } })(request('POST', {}), disabled.res);
  assert.equal(disabled.result.code, 503);
  const denied = response(); await createStaffInventoryPhotoHandler({ ...deps, requireAdmin: async () => { throw new HttpError(403, 'Denied'); }, upload: async () => { assert.fail('unauthorized upload'); } })(request('POST', {}), denied.res);
  assert.equal(denied.result.code, 403);
});

test('financial snapshots accept only their read bearer, refuse writes and omit private photo/roster data', async () => {
  let reads = 0;
  const item = { name: 'Fixture item', quantity: 2, planned_sales_channel: 'Whatnot', photo_key: 'private-key', back_photo_key: 'private-back-key', photo_url: 'https://fixture.invalid/private-front', back_photo_url: 'https://fixture.invalid/private-back', card_details: { manufacturer: null, card_number: '007/100', year: '2026', set_name: 'Fixture set', variant: null, card_type: null }, unit_ids: ['fixture-unit'], units: [{ id: 'fixture-unit' }] };
  const handler = createFinancialInventoryWorkspaceHandler({ readTokenHash: () => READ_HASH, readWorkspace: async () => { reads++; return { ...workspace(), items: [item] } as unknown as StaffInventoryWorkspace; } });
  for (const [method, authorization, query, expected] of [['GET', '', {}, 401], ['GET', 'Bearer fixture-mobile-admin', {}, 401], ['POST', `Bearer ${READ_TOKEN}`, {}, 405], ['GET', `Bearer ${READ_TOKEN}`, { page: '1' }, 400]] as const) {
    const output = response(); await handler(request(method, {}, { authorization }, query), output.res);
    assert.equal(output.result.code, expected); assert.equal(output.result.headers['Cache-Control'], 'private, no-store');
  }
  assert.equal(reads, 0);
  const output = response(); await handler(request('GET', undefined, { authorization: `Bearer ${READ_TOKEN}` }), output.res);
  assert.equal(output.result.code, 200); assert.deepEqual(output.result.body.items, [{ name: item.name, quantity: 2 }]); assert.equal(reads, 1);
  const unavailable = response();
  await createFinancialInventoryWorkspaceHandler({ readTokenHash: () => undefined, readWorkspace: async () => { assert.fail('unconfigured capability'); } })(request('GET', undefined, { authorization: `Bearer ${READ_TOKEN}` }), unavailable.res);
  assert.equal(unavailable.result.code, 401);
});
