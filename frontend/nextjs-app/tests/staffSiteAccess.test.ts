import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createStaffInventoryAccessHandler } from '../pages/api/v2/admin/inventory/access';
import { createInventoryAdminSessionRequirement } from '../lib/server/inventoryAdmin';
import { HttpError, type AdminSession } from '../lib/server/adminSessionAuthority';
const admin: AdminSession = { sessionId: 'human', tokenHash: 'hash', authority: 'auth-service', user: { id: 'admin', phone: '+15555550000', displayName: 'Team member' } };
const request = (method = 'GET', headers: Record<string, string> = { authorization: 'Bearer human-session' }, query = {}) => ({ method, headers, query } as NextApiRequest);
function response() {
  const result = { status: 0, headers: {} as Record<string, string>, body: undefined as unknown };
  const res = { setHeader(key: string, value: string) { result.headers[key] = value; }, status(code: number) { result.status = code; return this; }, json(body: unknown) { result.body = body; return this; } } as unknown as NextApiResponse;
  return { result, res };
}
test('access returns only server-checked safe display identity with no-store', async () => {
  let calls = 0;
  const handler = createStaffInventoryAccessHandler(async req => { calls++; assert.equal(req.headers.authorization, 'Bearer human-session'); return admin; });
  const { result, res } = response(); await handler(request(), res);
  assert.equal(calls, 1); assert.equal(result.status, 200);
  assert.deepEqual(result.body, { user: { id: 'admin', displayName: 'Team member' } });
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.equal(result.headers['X-Robots-Tag'], 'noindex, nofollow');
});
test('unauthorized, expired, customer, static-operator and financial capabilities cannot enter staff', async () => {
  const readToken = 'fixture-financial-read'.repeat(3), readHash = createHash('sha256').update(readToken).digest('hex');
  const guard = createInventoryAdminSessionRequirement({ readTokenHash: () => readHash, requireAdmin: async req => {
    if (req.headers.authorization === 'Bearer expired') throw new HttpError(401, 'Expired');
    if (req.headers.authorization === 'Bearer customer') throw new HttpError(403, 'Customer');
    return admin;
  } });
  const handler = createStaffInventoryAccessHandler(guard);
  for (const [headers, status] of [[{}, 401], [{ authorization: 'Bearer expired' }, 401], [{ authorization: 'Bearer customer' }, 403], [{ authorization: 'Bearer human', 'x-operator-key': 'operator' }, 403], [{ authorization: `Bearer ${readToken}` }, 403]] as [Record<string, string>, number][]) {
    const { result, res } = response(); await handler(request('GET', headers), res); assert.equal(result.status, status); assert.equal(JSON.stringify(result.body).includes('Team member'), false);
  }
});
test('access cannot write, accepts no caller identity, and hides unexpected service details', async () => {
  const handler = createStaffInventoryAccessHandler(async () => admin);
  for (const [req, status] of [[request('POST'), 405], [request('GET', undefined, { userId: 'other' }), 400]] as const) { const { result, res } = response(); await handler(req, res); assert.equal(result.status, status); }
  const { result, res } = response(); await createStaffInventoryAccessHandler(async () => { throw new Error('secret connection string'); })(request(), res);
  assert.equal(result.status, 503); assert.equal(JSON.stringify(result.body).includes('secret'), false);
});
