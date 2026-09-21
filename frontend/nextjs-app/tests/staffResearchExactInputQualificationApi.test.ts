import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { HttpError, type AdminSession } from '../lib/server/adminSessionAuthority';
import handler, { createExactInputQualificationHandler, exactInputQualificationHost } from '../pages/api/v2/admin/inventory/research-qualification';
import { EXACT_INPUT_ACK } from '../lib/server/staffResearchExactInputQualification';
import { exactFixture, invocation, actorId } from './staffResearchExactInputQualificationFixture';
const actor: AdminSession = { authority: 'auth-service', sessionId: 'fixture-session', tokenHash: 'fixture-hash', expiresAt: new Date('2099-01-01'), user: { id: actorId, phone: null, displayName: null } };
function response() {
  const result = { code: 0, body: undefined as any, headers: {} as Record<string, string> };
  const res = { setHeader(key: string, value: string) { result.headers[key] = value; }, status(code: number) { result.code = code; return this; }, json(value: unknown) { result.body = value; return this; } } as unknown as NextApiResponse;
  return { result, res };
}
const request = (patch: Partial<NextApiRequest> = {}) => ({ method: 'GET', query: {}, headers: { host: 'qualified-main.vercel.app', origin: 'https://qualified-main.vercel.app', 'content-type': 'application/json' }, ...patch } as NextApiRequest);
test('installed API rejects anonymous/operator requests before inspecting pins/providers/DB', async () => {
  for (const [headers, status] of [[{}, 401], [{ 'x-operator-key': 'fixture' }, 403]] as const) {
    const out = response(); await handler(request({ headers }), out.res); assert.equal(out.result.code, status);
  }
});
test('only current normal human admin and exact qualified Preview may read diagnostic plans', async () => {
  const f = await exactFixture(); let plans = 0;
  const deps = { requireAdmin: async () => actor, env: () => f.env, plan: async () => { plans++; return f.plan; }, run: async () => assert.fail('run'), recover: async () => assert.fail('recover') };
  for (const modified of [{ ...actor, authority: 'operator-key' as const }, { ...actor, expiresAt: new Date(0) }, { ...actor, expiresAt: new Date('invalid') }]) {
    const out = response(); await createExactInputQualificationHandler({ ...deps, requireAdmin: async () => modified })(request(), out.res); assert.equal(out.result.code, 401);
  }
  for (const host of ['tenkings.co', 'collect.tenkings.co', 'foreign.vercel.app', 'qualified-main.vercel.app.evil.test', 'localhost:3000']) {
    const out = response(); await createExactInputQualificationHandler(deps)(request({ headers: { host } }), out.res); assert.equal(out.result.code, 404);
  }
  assert.equal(plans, 0);
  assert.equal(exactInputQualificationHost('localhost:3000', { NODE_ENV: 'development' }), false);
  assert.equal(exactInputQualificationHost('localhost:3000', { NODE_ENV: 'test' }), true);
  const allowed = response(); await createExactInputQualificationHandler(deps)(request(), allowed.res);
  assert.equal(allowed.result.code, 200); assert.equal(allowed.result.headers['Cache-Control'], 'private, no-store'); assert.equal(plans, 1);
});
test('default off, stale/malformed acknowledgements, origin/content-type/query substitution never invoke execution', async () => {
  const f = await exactFixture(), body = { invocation_id: invocation, plan_sha256: f.plan.plan_sha256, acknowledge: EXACT_INPUT_ACK };
  const deps = { requireAdmin: async () => actor, env: () => f.env, plan: async () => f.plan, run: async () => assert.fail('invalid run'), recover: async () => assert.fail('recover') };
  const disabled = response(); await createExactInputQualificationHandler({ ...deps, env: () => ({ ...f.env, STAFF_RESEARCH_EXACT_INPUT_QUALIFICATION_ENABLED: 'false' }) })(request({ method: 'POST', body }), disabled.res); assert.equal(disabled.result.code, 503);
  for (const [patch, status] of [
    [{ body: { ...body, unit_id: 'other-unit' } }, 400], [{ body: { ...body, plan_sha256: 'bad' } }, 400], [{ body: { ...body, acknowledge: '' } }, 400],
    [{ query: { path: '/arbitrary' }, body }, 400], [{ headers: { ...request().headers, origin: 'https://tenkings.co' }, body }, 403],
    [{ headers: { ...request().headers, 'content-type': 'text/plain' }, body }, 403],
  ] as const) { const out = response(); await createExactInputQualificationHandler(deps)(request({ method: 'POST', ...patch }), out.res); assert.equal(out.result.code, status); }
});
test('recovery remains a bounded read with execution disabled, and oversized metadata never goes to client', async () => {
  const f = await exactFixture(); let reads = 0;
  const route = createExactInputQualificationHandler({ requireAdmin: async () => actor, env: () => ({ ...f.env, STAFF_RESEARCH_EXACT_INPUT_QUALIFICATION_ENABLED: 'false' }),
    plan: async () => f.plan, run: async () => assert.fail('disabled execution'), recover: async (id, hash, uuid) => { assert.equal(id, actorId); assert.equal(hash, f.plan.plan_sha256); assert.equal(uuid, invocation); reads++;
      return { status: 'uncertain', invocation_id: invocation, receipt_sha256: null, download_url: null, summary: null, message: 'Read only' }; } });
  const out = response(); await route(request({ query: { invocation_id: invocation, plan_sha256: f.plan.plan_sha256! } }), out.res); assert.equal(out.result.code, 200); assert.equal(reads, 1);
  const oversize = createExactInputQualificationHandler({ requireAdmin: async () => actor, env: () => f.env, plan: async () => ({ ...f.plan, reason: 'x'.repeat(900 * 1024) }), run: async () => assert.fail(), recover: async () => assert.fail() });
  const large = response(); await oversize(request(), large.res); assert.equal(large.result.code, 503); assert.ok(JSON.stringify(large.result.body).length < 500);
  const leak = response(); await createExactInputQualificationHandler({ requireAdmin: async () => { throw new HttpError(401, 'fixture-secret'); }, env: () => f.env, plan: async () => f.plan, run: async () => assert.fail(), recover: async () => assert.fail() })(request(), leak.res);
  assert.equal(JSON.stringify(leak.result.body).includes('fixture-secret'), false);
});
