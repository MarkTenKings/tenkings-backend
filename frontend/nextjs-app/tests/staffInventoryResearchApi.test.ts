import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { CardInventoryErrorV2, type StaffInventoryResearchStatusV2 } from '@tenkings/database';
import { createInventoryAdminSessionRequirement } from '../lib/server/inventoryAdmin';
import { HttpError, type AdminSession } from '../lib/server/adminSessionAuthority';
import handler, { createStaffInventoryResearchHandler } from '../pages/api/v2/admin/inventory/research';

const UUID = '11111111-1111-4111-8111-111111111111';
const ADMIN: AdminSession = { sessionId: 'fixture-session', tokenHash: 'fixture-session-hash', authority: 'auth-service', user: { id: 'fixture-admin', phone: '+15555550100', displayName: 'Fixture admin' } };
const READ_TOKEN = 'fixture-financial-read-capability-'.repeat(2);
const READ_HASH = createHash('sha256').update(READ_TOKEN).digest('hex');
const retry = { requestId: UUID, jobId: UUID, unitId: 'fixture-unit', descriptionEventId: 'workflow:fixture', inputHash: 'a'.repeat(64), expectedAttemptCount: 3 };
const job = { job_id: UUID, unit_id: 'fixture-unit', description_event_id: 'workflow:fixture', description_hash: 'b'.repeat(64), input_hash: 'a'.repeat(64), status: 'failed', attempt_count: 3, max_attempts: 3, can_retry: true, queued_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', started_at: null, completed_at: null, next_attempt_at: null, error: { code: 'PROVIDER_UNAVAILABLE', message: 'Research provider is unavailable.' }, result: null } as StaffInventoryResearchStatusV2;
const request = (method = 'GET', body?: unknown, query: Record<string, string | string[] | undefined> = { unit_id: 'fixture-unit' }, headers = { authorization: 'Bearer fixture-admin' }) => ({ method, body, query, headers } as NextApiRequest);
function response() {
  const result = { code: 0, body: undefined as any, headers: {} as Record<string, string> };
  const res = { setHeader(name: string, value: string) { result.headers[name] = value; }, status(code: number) { result.code = code; return this; }, json(body: unknown) { result.body = body; return this; } } as unknown as NextApiResponse;
  return { result, res };
}
const deps = (): Parameters<typeof createStaffInventoryResearchHandler>[0] => ({ requireAdmin: async () => ADMIN, read: async () => [job], retry: async () => ({ outcome: 'QUEUED', request_id: UUID, job }), start: async () => ({ outcome: 'QUEUED', request_id: UUID, job }) });

test('research requires human inventory authority before reads, retries or method validation', async () => {
  for (const code of [401, 403]) {
    const denied = createStaffInventoryResearchHandler({ ...deps(), requireAdmin: async () => { throw new HttpError(code, 'Access denied'); }, read: async () => assert.fail('unauthorized read'), retry: async () => assert.fail('unauthorized write') });
    for (const method of ['GET', 'POST', 'DELETE']) {
      const output = response(); await denied(request(method, retry), output.res);
      assert.equal(output.result.code, code); assert.equal(output.result.headers['Cache-Control'], 'private, no-store'); assert.equal(output.result.headers['X-Robots-Tag'], 'noindex, nofollow');
    }
  }
  const protect = createInventoryAdminSessionRequirement({ readTokenHash: () => READ_HASH, requireAdmin: async () => ADMIN });
  for (const headers of [{ authorization: `Bearer ${READ_TOKEN}` }, { authorization: 'Bearer fixture-admin', 'x-operator-key': 'fixture-operator' }]) {
    const output = response();
    await createStaffInventoryResearchHandler({ ...deps(), requireAdmin: protect, read: async () => assert.fail('financial or operator read'), retry: async () => assert.fail('financial or operator write') })(request('POST', retry, {}, headers), output.res);
    assert.equal(output.result.code, 403);
  }
});

test('the installed research handler rejects the financial bearer before database access', async t => {
  const previous = process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256; process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256 = READ_HASH;
  t.after(() => { if (previous === undefined) delete process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256; else process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256 = previous; });
  for (const method of ['GET', 'POST']) {
    const output = response(); await handler(request(method, retry, {}, { authorization: `Bearer ${READ_TOKEN}` }), output.res); assert.equal(output.result.code, 403);
  }
});

test('research reads select bounded distinct units and never return worker tokens', async () => {
  const calls: string[][] = [];
  const get = createStaffInventoryResearchHandler({ ...deps(), read: async ids => { calls.push(ids); return [job]; } });
  const valid = response(); await get(request('GET', undefined, { unit_id: ['fixture-unit', 'fixture-second'] }), valid.res);
  assert.equal(valid.result.code, 200); assert.deepEqual(calls, [['fixture-unit', 'fixture-second']]); assert.deepEqual(valid.result.body, { version: 1, jobs: [job], image_previews: {} });
  assert.equal(JSON.stringify(valid.result.body).includes('lease'), false);
  for (const query of [{}, { unit_id: '' }, { unit_id: ['fixture-unit', 'fixture-unit'] }, { unit_id: ' fixture' }, { unit_id: 'fixture\n' }, { unit_id: ['x'.repeat(201)] }, { unit_id: Array.from({ length: 51 }, (_, i) => `fixture-${i}`) }, { unit_id: 'fixture-unit', unrelated: '1' }]) {
    const out = response(); await get(request('GET', undefined, query), out.res); assert.equal(out.result.code, 400);
  }
  assert.equal(calls.length, 1);
  const tooBig = response(); await createStaffInventoryResearchHandler({ ...deps(), read: async () => [{ ...job, oversized: 'x'.repeat(8 * 1024 * 1024) } as StaffInventoryResearchStatusV2] })(request(), tooBig.res); assert.equal(tooBig.result.code, 503);
});

test('research signs only capped, deduplicated hash-bound private evidence and tolerates missing previews', async () => {
  const signed: string[] = [];
  const keys = Array.from({ length: 14 }, (_, i) => `research-evidence/${String(i).padStart(64, '0')}.jpg`);
  const candidates = [...keys, keys[0], 'inventory-photos/private.jpg', 'research-evidence/../private.jpg'].map(storage_key => ({ image: { storage_key, sha256: storage_key.split('/')[1].split('.')[0] } }));
  const withImages = { ...job, result: { candidates } } as unknown as StaffInventoryResearchStatusV2;
  const before = JSON.stringify(withImages);
  const route = createStaffInventoryResearchHandler({ ...deps(), read: async () => [withImages], signImage: async key => { signed.push(key); if (key === keys[1]) throw Error('private storage internal error'); return `https://fixture.invalid/${key}`; } });
  const out = response(); await route(request(), out.res);
  assert.equal(out.result.code, 200); assert.deepEqual(signed, keys.slice(0, 12)); assert.equal(Object.keys(out.result.body.image_previews).length, 11);
  assert.equal(out.result.body.image_previews[keys[0]], `https://fixture.invalid/${keys[0]}`); assert.equal(out.result.body.image_previews[keys[1]], undefined); assert.equal(JSON.stringify(withImages), before);
  assert.equal(JSON.stringify(out.result.body).includes('storage internal error'), false);
});

test('research retries pass exact inventory revision and session actor; all other fields or actions are rejected', async () => {
  const calls: unknown[][] = [];
  const post = createStaffInventoryResearchHandler({ ...deps(), retry: async (...args) => { calls.push(args); return { outcome: 'QUEUED', request_id: UUID, job }; } });
  const valid = response(); await post(request('POST', retry, {}), valid.res); assert.equal(valid.result.code, 200); assert.deepEqual(calls, [[retry, ADMIN.user.id]]);
  for (const body of [{ ...retry, recorded_by: 'forged' }, { ...retry, result: { estimate: 99999 } }, { ...retry, expectedAttemptCount: 0 }, { ...retry, inputHash: 'wrong' }, { unitId: retry.unitId }, null]) {
    const out = response(); await post(request('POST', body, {}), out.res); assert.equal(out.result.code, 400);
  }
  const query = response(); await post(request('POST', retry), query.res); assert.equal(query.result.code, 400);
  const method = response(); await post(request('PUT', retry, {}), method.res); assert.equal(method.result.code, 405); assert.equal(method.result.headers.Allow, 'GET, POST'); assert.equal(calls.length, 1);
});

test('research conflicts remain actionable and provider/database failures disclose no internals', async () => {
  for (const [error, code] of [[new CardInventoryErrorV2('CONFLICT', 'Staff corrected this card.'), 409], [new Error('secret database/provider detail'), 503]] as const) {
    const depsFail = { ...deps(), read: async () => { throw error; }, retry: async () => { throw error; } };
    for (const method of ['GET', 'POST']) {
      const out = response(); await createStaffInventoryResearchHandler(depsFail)(request(method, retry, method === 'GET' ? { unit_id: retry.unitId } : {}), out.res); assert.equal(out.result.code, code); assert.equal(JSON.stringify(out.result.body).includes('secret'), false);
    }
  }
});

test('manual research start is one exact human-authorized card, separate from retries and inventory mutation', async () => {
  const command = { action: 'start', requestId: UUID, unitId: 'fixture-unit', descriptionEventId: 'workflow:fixture' };
  const calls: unknown[][] = [];
  const route = createStaffInventoryResearchHandler({ ...deps(), start: async (...args) => { calls.push(args); return { outcome: 'QUEUED', request_id: UUID, job }; }, retry: async () => assert.fail('start is not a retry') });
  const out = response(); await route(request('POST', command, {}), out.res); assert.equal(out.result.code, 200); assert.deepEqual(calls, [[command, ADMIN.user.id]]);
  for (const changed of [{ ...command, unitIds: ['fixture-unit'] }, { ...command, recorded_by: 'forged' }, { ...command, descriptionEventId: undefined }, { ...command, requestId: 'invalid' }, { ...command, expected_price_cents: 1 }]) {
    const rejected = response(); await route(request('POST', changed, {}), rejected.res); assert.equal(rejected.result.code, 400);
  }
  for (const code of [401, 403]) {
    const denied = response(); await createStaffInventoryResearchHandler({ ...deps(), requireAdmin: async () => { throw new HttpError(code, 'Denied'); }, start: async () => assert.fail('unauthorized start') })(request('POST', command, {}), denied.res); assert.equal(denied.result.code, code);
  }
  assert.equal(calls.length, 1);
});
