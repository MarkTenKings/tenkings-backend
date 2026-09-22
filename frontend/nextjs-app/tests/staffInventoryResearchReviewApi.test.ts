import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { CardInventoryErrorV2 } from '@tenkings/database';
import { createInventoryAdminSessionRequirement } from '../lib/server/inventoryAdmin';
import { HttpError, type AdminSession } from '../lib/server/adminSessionAuthority';
import handler, { config, createStaffInventoryResearchReviewHandler } from '../pages/api/v2/admin/inventory/research-review';
import { StaffInventoryResearchReviewResponseSchema, type StaffInventoryResearchReviewCommand, type StaffInventoryResearchReviewResponse } from '../lib/staffInventoryMarketValue';
import { marketJob, marketReview, MARKET_TIME } from './fixtures/staffInventoryMarketValue';

const ADMIN: AdminSession = { sessionId: 'fixture-session', tokenHash: 'fixture-session-hash', authority: 'auth-service', user: { id: 'fixture-admin', phone: '+15555550100', displayName: 'Fixture admin' } };
const snapshot = marketReview(marketJob());
const command: StaffInventoryResearchReviewCommand = {
  requestId: '22222222-2222-4222-8222-222222222222', jobId: snapshot.job_id, unitId: snapshot.unit_id,
  descriptionEventId: snapshot.description_event_id, inputHash: snapshot.input_hash, resultHash: snapshot.result_hash,
  expectedRevision: 0, candidateId: 'ebay:111111111110', decision: 'excluded',
};
const receipt = (): StaffInventoryResearchReviewResponse => ({ version: 1, outcome: 'RECORDED', request_id: command.requestId, recorded_revision: 1,
  review: { ...snapshot, revision: 1, updated_at: MARKET_TIME, decisions: [{ candidate_id: command.candidateId, decision: command.decision,
    actor_id: ADMIN.user.id, reviewed_at: MARKET_TIME, revision: 1, request_id: command.requestId }] } });
const request = (method = 'POST', body: unknown = command, query: Record<string, string> = {}, headers: Record<string, string | undefined> = { authorization: 'Bearer fixture-admin' }) => ({ method, body, query, headers } as NextApiRequest);
function response() {
  const value = { status: 0, body: undefined as any, headers: {} as Record<string, string> };
  const res = { setHeader(name: string, content: string) { value.headers[name] = content; }, status(status: number) { value.status = status; return this; }, json(body: unknown) { value.body = body; return this; } } as unknown as NextApiResponse;
  return { value, res };
}
const dependencies = (): Parameters<typeof createStaffInventoryResearchReviewHandler>[0] => ({ requireAdmin: async () => ADMIN, record: async () => receipt() });

test('review accepts one exact decision and derives its actor exclusively from the human session', async () => {
  const writes: unknown[][] = [];
  const route = createStaffInventoryResearchReviewHandler({ ...dependencies(), record: async (...args) => { writes.push(args); return receipt(); } });
  const out = response(); await route(request(), out.res);
  assert.equal(out.value.status, 200); assert.deepEqual(writes, [[command, ADMIN.user.id]]);
  assert.deepEqual(StaffInventoryResearchReviewResponseSchema.parse(out.value.body), receipt());
  assert.equal(out.value.headers['Cache-Control'], 'private, no-store'); assert.equal(out.value.headers['X-Robots-Tag'], 'noindex, nofollow');
  assert.equal(config.api.bodyParser.sizeLimit, '8kb');
  for (const field of ['value_cents', 'expected_price_cents', 'cost_cents', 'candidates', 'image_previews', 'lease']) assert.equal(JSON.stringify(out.value.body).includes(field), false);
});

test('replay acknowledges the original decision revision while returning a later saved review', async () => {
  const saved = receipt(); saved.outcome = 'REPLAY'; saved.review.revision = 2;
  saved.review.decisions[0] = { ...saved.review.decisions[0], decision: 'confirmed', revision: 2, request_id: '33333333-3333-4333-8333-333333333333' };
  const out = response(); await createStaffInventoryResearchReviewHandler({ ...dependencies(), record: async () => saved })(request(), out.res);
  assert.equal(out.value.status, 200); assert.equal(out.value.body.recorded_revision, 1);
  assert.equal(out.value.body.review.decisions[0].decision, 'confirmed'); assert.equal(out.value.body.request_id, command.requestId);
});

test('review rejects invented selection, money, actor, malformed bindings and non-POST traffic before writes', async () => {
  const route = createStaffInventoryResearchReviewHandler({ ...dependencies(), record: async () => assert.fail('Invalid request must not write') });
  for (const body of [null, { ...command, actor: 'forged' }, { ...command, selected_candidate_ids: [command.candidateId] },
    { ...command, value_cents: 9999 }, { ...command, expected_price_cents: 9999 }, { ...command, decision: 'included' },
    { ...command, expectedRevision: -1 }, { ...command, expectedRevision: 0.5 }, { ...command, resultHash: 'wrong' },
    { ...command, inputHash: 'wrong' }, { ...command, candidateId: 'not-a-listing' }, { ...command, requestId: 'new' },
    { ...command, unitId: 'changed\nunit' }]) {
    const out = response(); await route(request('POST', body), out.res); assert.equal(out.value.status, 400);
  }
  const query = response(); await route(request('POST', command, { unit_id: command.unitId }), query.res); assert.equal(query.value.status, 400);
  for (const method of ['GET', 'PUT', 'DELETE']) { const out = response(); await route(request(method), out.res); assert.equal(out.value.status, 405); assert.equal(out.value.headers.Allow, 'POST'); }
});

test('review rejects financial, operator and absent human authority before body validation or writes', async t => {
  for (const status of [401, 403]) {
    const route = createStaffInventoryResearchReviewHandler({ ...dependencies(), requireAdmin: async () => { throw new HttpError(status, 'Sign in'); }, record: async () => assert.fail('Unauthorized write') });
    const out = response(); await route(request('GET', null), out.res); assert.equal(out.value.status, status);
  }
  const token = 'fixture-financial-review-denied-'.repeat(2), hash = createHash('sha256').update(token).digest('hex');
  const requireAdmin = createInventoryAdminSessionRequirement({ readTokenHash: () => hash, requireAdmin: async () => ADMIN });
  for (const headers of [{ authorization: `Bearer ${token}` }, { authorization: 'Bearer fixture-admin', 'x-operator-key': 'operator' }]) {
    const out = response(); await createStaffInventoryResearchReviewHandler({ ...dependencies(), requireAdmin, record: async () => assert.fail('Capability write') })(request('POST', command, {}, headers), out.res);
    assert.equal(out.value.status, 403);
  }
  const previous = process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256; process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256 = hash;
  t.after(() => { if (previous === undefined) delete process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256; else process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256 = previous; });
  const installed = response(); await handler(request('POST', command, {}, { authorization: `Bearer ${token}` }), installed.res); assert.equal(installed.value.status, 403);
});

test('stale revisions return 409 and uncertain server failures expose no private details or automatic retries', async () => {
  for (const [error, status] of [[new CardInventoryErrorV2('CONFLICT', 'The saved review changed. Reload before reviewing.'), 409],
    [new CardInventoryErrorV2('INVALID_INPUT', 'This listing is not reviewable.'), 400], [new Error('private database connection secret'), 503]] as const) {
    let writes = 0; const out = response();
    await createStaffInventoryResearchReviewHandler({ ...dependencies(), record: async () => { writes++; throw error; } })(request(), out.res);
    assert.equal(out.value.status, status); assert.equal(writes, 1); assert.equal(JSON.stringify(out.value.body).includes('private database'), false);
  }
});

test('mismatched successful write receipts fail closed without acknowledging another request or research revision', async () => {
  const mutations = [
    (saved: StaffInventoryResearchReviewResponse) => { saved.request_id = '33333333-3333-4333-8333-333333333333'; },
    (saved: StaffInventoryResearchReviewResponse) => { saved.recorded_revision = 2; saved.review.revision = 2; },
    (saved: StaffInventoryResearchReviewResponse) => { saved.review.unit_id = 'another-unit'; },
    (saved: StaffInventoryResearchReviewResponse) => { saved.review.description_event_id = 'another-description'; },
    (saved: StaffInventoryResearchReviewResponse) => { saved.review.input_hash = 'd'.repeat(64); },
    (saved: StaffInventoryResearchReviewResponse) => { saved.review.result_hash = 'd'.repeat(64); },
    (saved: StaffInventoryResearchReviewResponse) => { saved.review.decisions[0].candidate_id = 'ebay:111111111111'; },
    (saved: StaffInventoryResearchReviewResponse) => { saved.review.decisions[0].decision = 'confirmed'; },
    (saved: StaffInventoryResearchReviewResponse) => { saved.review.decisions[0].actor_id = 'another-admin'; },
  ];
  for (const mutate of mutations) {
    const saved = receipt(); mutate(saved); const out = response();
    await createStaffInventoryResearchReviewHandler({ ...dependencies(), record: async () => saved })(request(), out.res);
    assert.equal(out.value.status, 503); assert.equal(out.value.body.review, undefined);
  }
});
