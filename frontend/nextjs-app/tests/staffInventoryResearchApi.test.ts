import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { CardInventoryErrorV2, readStaffInventoryResearchV2, type StaffInventoryResearchStatusV2 } from '@tenkings/database';
import { canonical, inventoryHash } from '../../../packages/database/src/cardInventoryV2';
import { createInventoryAdminSessionRequirement } from '../lib/server/inventoryAdmin';
import { HttpError, type AdminSession } from '../lib/server/adminSessionAuthority';
import handler, { createStaffInventoryResearchHandler } from '../pages/api/v2/admin/inventory/research';
import { StaffInventoryMarketValueResponseSchema } from '../lib/staffInventoryMarketValue';
import { marketJob, marketResult, marketReview, MARKET_TIME } from './fixtures/staffInventoryMarketValue';
import { recoveryJob, recoverySnapshot } from './fixtures/staffInventoryResearchRecovery';

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
const deps = (): Parameters<typeof createStaffInventoryResearchHandler>[0] => ({ requireAdmin: async () => ADMIN, read: async () => [job], readReviews: async () => [], retry: async () => ({ outcome: 'QUEUED', request_id: UUID, job }), start: async () => ({ outcome: 'QUEUED', request_id: UUID, job }) });
function reviewedRead(read: Parameters<typeof createStaffInventoryResearchHandler>[0]['read']) {
  let saved: StaffInventoryResearchStatusV2[] = [];
  return { read: async (ids: string[]) => { saved = await read(ids); return saved; },
    readReviews: async (ids: string[]) => saved.filter(entry => ids.includes(entry.job_id) && entry.status === 'complete' && entry.result !== null).map(marketReview) };
}

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
  assert.equal(valid.result.code, 200); assert.deepEqual(calls, [['fixture-unit', 'fixture-second']]); assert.deepEqual(valid.result.body, { version: 1, jobs: [{ ...job, result_hash: null, review: null, recovery: null }], image_previews: {}, recovery_enabled: false });
  assert.equal(JSON.stringify(valid.result.body).includes('lease'), false);
  for (const query of [{}, { unit_id: '' }, { unit_id: ['fixture-unit', 'fixture-unit'] }, { unit_id: ' fixture' }, { unit_id: 'fixture\n' }, { unit_id: ['x'.repeat(201)] }, { unit_id: Array.from({ length: 51 }, (_, i) => `fixture-${i}`) }, { unit_id: 'fixture-unit', unrelated: '1' }]) {
    const out = response(); await get(request('GET', undefined, query), out.res); assert.equal(out.result.code, 400);
  }
  assert.equal(calls.length, 1);
  const tooBig = response(); await createStaffInventoryResearchHandler({ ...deps(), read: async () => [{ ...job, oversized: 'x'.repeat(8 * 1024 * 1024) } as StaffInventoryResearchStatusV2] })(request(), tooBig.res); assert.equal(tooBig.result.code, 503);
});

test('research signs only capped, deduplicated hash-bound private evidence and tolerates missing previews', async () => {
  const signed: string[] = [];
  const keys = Array.from({ length: 26 }, (_, i) => `research-evidence/${String(i).padStart(64, '0')}.jpg`);
  const candidates = [...keys, keys[0], 'inventory-photos/private.jpg', 'research-evidence/../private.jpg'].map(storage_key => ({ image: { storage_key, sha256: storage_key.split('/')[1].split('.')[0] } }));
  const withImages = { ...job, result: { candidates } } as unknown as StaffInventoryResearchStatusV2;
  const before = JSON.stringify(withImages);
  const route = createStaffInventoryResearchHandler({ ...deps(), read: async () => [withImages], signImage: async key => { signed.push(key); if (key === keys[1]) throw Error('private storage internal error'); return `https://fixture.invalid/${key}`; } });
  const out = response(); await route(request(), out.res);
  assert.equal(out.result.code, 200); assert.deepEqual(signed, keys.slice(0, 24)); assert.equal(Object.keys(out.result.body.image_previews).length, 23);
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

test('summary is an explicit compact read with no signing, writes or full candidate evidence', async () => {
  const completed = marketJob(marketResult(5)), queued = { ...job, job_id: '22222222-2222-4222-8222-222222222222', unit_id: 'queued-unit', status: 'queued' as const };
  const calls: string[][] = [];
  const route = createStaffInventoryResearchHandler({ ...deps(), ...reviewedRead(async ids => { calls.push(ids); return [completed, queued]; }),
    signImage: async () => assert.fail('Summary must not sign any image'), retry: async () => assert.fail('Summary must not retry'), start: async () => assert.fail('Summary must not start research') });
  const out = response(); await route(request('GET', undefined, { view: 'summary', unit_id: ['fixture-unit', 'queued-unit', 'no-current-job'] }), out.res);
  assert.equal(out.result.code, 200);
  const parsed = StaffInventoryMarketValueResponseSchema.parse(out.result.body);
  assert.deepEqual(calls, [['fixture-unit', 'queued-unit', 'no-current-job']]);
  assert.deepEqual(parsed.summaries.map(summary => [summary.unit_id, summary.status, summary.value_cents, summary.comp_count]), [['fixture-unit', 'estimated', 1002, 2], ['queued-unit', 'queued', null, 0]]);
  assert.equal(parsed.summaries.some(summary => summary.unit_id === 'no-current-job'), false, 'An omitted unit explicitly has no current research job.');
  const encoded = JSON.stringify(out.result.body);
  assert.ok(encoded.length < 1500);
  for (const privateField of ['candidates', 'image_previews', 'input_hash', 'description_hash', 'job_id', 'inventory-photos', 'research-evidence', 'ebay.com']) assert.equal(encoded.includes(privateField), false);
  assert.equal(out.result.headers['Cache-Control'], 'private, no-store'); assert.equal(out.result.headers['X-Robots-Tag'], 'noindex, nofollow');
});

test('summary bounds, explicit view syntax and human session guard apply before the reader', async () => {
  let reads = 0;
  const route = createStaffInventoryResearchHandler({ ...deps(), read: async () => { reads++; return []; } });
  const max = response(); await route(request('GET', undefined, { view: 'summary', unit_id: Array.from({ length: 50 }, (_, i) => `fixture-${i}`) }), max.res);
  assert.equal(max.result.code, 200); assert.deepEqual(max.result.body, { version: 1, summaries: [] });
  for (const query of [{ view: 'full', unit_id: 'fixture-unit' }, { view: '', unit_id: 'fixture-unit' }, { view: ['summary'], unit_id: 'fixture-unit' },
    { view: 'summary', unit_id: ['fixture-unit', 'fixture-unit'] }, { view: 'summary', unit_id: Array.from({ length: 51 }, (_, i) => `fixture-${i}`) }, { view: 'summary', unit_id: 'fixture-unit', include: 'photos' }]) {
    const out = response(); await route(request('GET', undefined, query), out.res); assert.equal(out.result.code, 400);
  }
  assert.equal(reads, 1);
  for (const code of [401, 403]) {
    const out = response();
    await createStaffInventoryResearchHandler({ ...deps(), requireAdmin: async () => { throw new HttpError(code, 'Access denied'); }, read: async () => assert.fail('Unauthenticated summary read') })(request('GET', undefined, { view: 'summary', unit_id: 'fixture-unit' }), out.res);
    assert.equal(out.result.code, code);
  }
});

test('summary rejects duplicate or unrequested jobs and never promotes malformed or stale evidence', async () => {
  const completed = marketJob();
  for (const jobs of [[completed, completed], [{ ...completed, unit_id: 'unrequested-unit' }], [{ ...completed, status: 'invented' }]]) {
    const out = response();
    await createStaffInventoryResearchHandler({ ...deps(), read: async () => jobs as StaffInventoryResearchStatusV2[] })(request('GET', undefined, { view: 'summary', unit_id: 'fixture-unit' }), out.res);
    assert.equal(out.result.code, 503); assert.equal(out.result.body.summaries, undefined);
  }
  for (const result of [{ ...completed.result!, description_event_id: 'old-description' }, { ...completed.result!, estimate: { ...completed.result!.estimate, value_cents: 9999 } }]) {
    const out = response();
    await createStaffInventoryResearchHandler({ ...deps(), ...reviewedRead(async () => [{ ...completed, result }]) })(request('GET', undefined, { view: 'summary', unit_id: 'fixture-unit' }), out.res);
    assert.equal(out.result.code, 200); assert.equal(out.result.body.summaries[0].status, 'unknown'); assert.equal(out.result.body.summaries[0].value_cents, null);
  }
});

test('summary uses the real hash-verified reader and fails closed on tampered persisted hashes or revision bindings', async () => {
  const result = marketResult(), input = { schema_version: 1, unit_id: result.unit_id, description_event_id: result.description_event_id, description_hash: result.description_hash,
    description: { name: 'Fixture Runner', category: null, manufacturer: null, card_number: null, year: null, set_name: null, variant: null, card_type: null }, front_photo_key: result.photos.front!.key, back_photo_key: result.photos.back!.key };
  const row = { id: UUID, unitId: input.unit_id, descriptionEventId: input.description_event_id, descriptionHash: input.description_hash,
    inputHash: inventoryHash(input), input: canonical(input), result: canonical(result), resultHash: inventoryHash(result), status: 'complete', attemptCount: 1, maxAttempts: 3,
    leaseToken: null, leaseExpiresAt: null, nextAttemptAt: new Date(MARKET_TIME), createdAt: new Date(MARKET_TIME), updatedAt: new Date(MARKET_TIME), startedAt: new Date(MARKET_TIME), completedAt: new Date(MARKET_TIME),
    errorCode: null, errorMessage: null, retries: [] };
  for (const changed of [{}, { inputHash: '0'.repeat(64) }, { resultHash: '0'.repeat(64) }, { descriptionEventId: 'old-description' }, { descriptionHash: '0'.repeat(64) },
    { result: canonical({ ...result, estimate: { ...result.estimate, value_cents: 1001 } }), resultHash: inventoryHash({ ...result, estimate: { ...result.estimate, value_cents: 1001 } }) }]) {
    const reader = { $queryRaw: async () => [{ ...row, ...changed }] } as unknown as Parameters<typeof readStaffInventoryResearchV2>[0];
    const out = response();
    await createStaffInventoryResearchHandler({ ...deps(), ...reviewedRead(ids => readStaffInventoryResearchV2(reader, { unitIds: ids })), signImage: async () => assert.fail('No summary image signing') })(request('GET', undefined, { view: 'summary', unit_id: 'fixture-unit' }), out.res);
    assert.equal(out.result.code, Object.keys(changed).length ? 503 : 200);
    if (!Object.keys(changed).length) assert.equal(out.result.body.summaries[0].value_cents, 1002);
    else assert.deepEqual(out.result.body, { message: 'Card research is unavailable. Your inventory is saved.' });
  }
});

test('research GET binds current review snapshots and summary applies staff decisions without changing original evidence', async () => {
  const saved = marketJob(marketResult(5)), review = marketReview(saved), original = JSON.stringify(saved);
  review.revision = 1; review.updated_at = MARKET_TIME;
  review.decisions = [{ candidate_id: saved.result!.selected_candidate_ids[0], decision: 'excluded', actor_id: ADMIN.user.id,
    reviewed_at: MARKET_TIME, revision: 1, request_id: '22222222-2222-4222-8222-222222222222' }];
  const reads: string[][] = [];
  const route = createStaffInventoryResearchHandler({ ...deps(), read: async () => [saved], readReviews: async ids => { reads.push(ids); return [review]; } });
  const full = response(); await route(request(), full.res); assert.equal(full.result.code, 200);
  assert.equal(full.result.body.version, 2, 'Legacy version-1 panels must fail closed after a staff decision.');
  assert.equal(full.result.body.jobs[0].result_hash, inventoryHash(saved.result)); assert.deepEqual(full.result.body.jobs[0].review, review);
  assert.deepEqual(full.result.body.jobs[0].result, saved.result);
  const summary = response(); await route(request('GET', undefined, { unit_id: saved.unit_id, view: 'summary' }), summary.res);
  assert.equal(summary.result.body.version, 1, 'Compact summaries retain their independent projection protocol.');
  assert.equal(summary.result.code, 200); assert.equal(summary.result.body.summaries[0].status, 'unknown');
  assert.equal(summary.result.body.summaries[0].value_cents, null); assert.equal(summary.result.body.summaries[0].comp_count, 0);
  assert.deepEqual(reads, [[saved.job_id], [saved.job_id]]); assert.equal(JSON.stringify(saved), original);
});

test('unreviewed full reads preserve version one and a mixed reviewed batch fences legacy clients', async () => {
  const first = marketJob(), second = marketJob({ ...marketResult(), unit_id: 'second-unit', description_event_id: 'workflow:second' });
  second.job_id = '22222222-2222-4222-8222-222222222222';
  const reviews = [marketReview(first), marketReview(second)];
  const route = createStaffInventoryResearchHandler({ ...deps(), read: async () => [first, second], readReviews: async () => reviews });
  const before = response(); await route(request('GET', undefined, { unit_id: [first.unit_id, second.unit_id] }), before.res);
  assert.equal(before.result.code, 200); assert.equal(before.result.body.version, 1);
  reviews[1].revision = 1; reviews[1].updated_at = MARKET_TIME;
  reviews[1].decisions = [{ candidate_id: second.result!.selected_candidate_ids[0], decision: 'confirmed', actor_id: ADMIN.user.id,
    reviewed_at: MARKET_TIME, revision: 1, request_id: '33333333-3333-4333-8333-333333333333' }];
  const after = response(); await route(request('GET', undefined, { unit_id: [first.unit_id, second.unit_id] }), after.res);
  assert.equal(after.result.code, 200); assert.equal(after.result.body.version, 2);
  assert.deepEqual(after.result.body.jobs[0].result, first.result); assert.deepEqual(after.result.body.jobs[1].result, second.result);
});

test('missing, duplicate, unrelated and raced review reads never fall back to a stale AI value', async () => {
  const saved = marketJob(), review = marketReview(saved);
  for (const reviews of [[], [review, review], [{ ...review, job_id: '22222222-2222-4222-8222-222222222222' }],
    [{ ...review, unit_id: 'wrong-unit' }], [{ ...review, description_event_id: 'old-description' }],
    [{ ...review, input_hash: '0'.repeat(64) }], [{ ...review, result_hash: '0'.repeat(64) }]]) {
    for (const view of [undefined, 'summary']) {
      const route = createStaffInventoryResearchHandler({ ...deps(), read: async () => [saved], readReviews: async () => reviews });
      const out = response(); await route(request('GET', undefined, { unit_id: saved.unit_id, ...(view ? { view } : {}) }), out.res);
      assert.equal(out.result.code, 503); assert.equal(out.result.body.jobs, undefined); assert.equal(out.result.body.summaries, undefined);
    }
  }
});

test('full research signs original selected candidates first, including a staff-excluded candidate', async () => {
  const saved = marketJob(marketResult(5));
  for (const candidate of saved.result!.candidates) candidate.image!.storage_key = `research-evidence/${candidate.image!.sha256}.jpg`;
  saved.result!.candidates.reverse();
  const review = marketReview(saved); review.revision = 1; review.updated_at = MARKET_TIME;
  review.decisions = [{ candidate_id: saved.result!.selected_candidate_ids[0], decision: 'excluded', actor_id: ADMIN.user.id,
    reviewed_at: MARKET_TIME, revision: 1, request_id: '22222222-2222-4222-8222-222222222222' }];
  const signed: string[] = [], candidates = saved.result!.candidates;
  const out = response(); await createStaffInventoryResearchHandler({ ...deps(), read: async () => [saved], readReviews: async () => [review],
    signImage: async key => { signed.push(key); return `https://fixture.invalid/${key}`; } })(request(), out.res);
  assert.equal(out.result.code, 200);
  assert.deepEqual(new Set(signed.slice(0, 2)), new Set(candidates.filter(candidate => saved.result!.selected_candidate_ids.includes(candidate.id)).map(candidate => candidate.image!.storage_key)));
  assert.equal(signed[2], candidates.find(candidate => !saved.result!.selected_candidate_ids.includes(candidate.id))!.image!.storage_key);
});

test('recovery GET exposes only a bound saved snapshot and exact execution state without starting work', async () => {
  const saved = recoveryJob(), snapshot = recoverySnapshot(), calls: string[][] = [], before = JSON.stringify(saved);
  for (const enabled of [false, true]) {
    const out = response();
    await createStaffInventoryResearchHandler({ ...deps(), ...reviewedRead(async () => [saved]), recoveryEnabled: () => enabled,
      readRecovery: async ids => { calls.push(ids); return [snapshot]; },
      retry: async () => assert.fail('GET must not retry'), start: async () => assert.fail('GET must not start research'),
    })(request(), out.res);
    assert.equal(out.result.code, 200); assert.equal(out.result.body.recovery_enabled, enabled);
    assert.deepEqual(out.result.body.jobs[0].recovery, snapshot); assert.deepEqual(out.result.body.jobs[0].result, saved.result);
    assert.equal(out.result.headers['Cache-Control'], 'private, no-store');
  }
  assert.deepEqual(calls, [[saved.job_id], [saved.job_id]]); assert.equal(JSON.stringify(saved), before);
});

test('recovery reads reject stale, duplicate, foreign and malformed snapshots before signing images', async () => {
  const saved = recoveryJob(), valid = recoverySnapshot();
  const cases = [[{ ...valid, unit_id: 'other' }], [{ ...valid, description_event_id: 'other' }], [{ ...valid, input_hash: 'f'.repeat(64) }],
    [{ ...valid, job_id: '22222222-2222-4222-8222-222222222222' }], [valid, valid], [{ ...valid, status: 'automatically_approved' }], [{ ...valid, missing_fields: ['price'] }]];
  for (const snapshots of cases) {
    const out = response();
    await createStaffInventoryResearchHandler({ ...deps(), ...reviewedRead(async () => [saved]), readRecovery: async () => snapshots as any,
      signImage: async () => assert.fail('Do not sign on invalid recovery evidence'),
    })(request(), out.res);
    assert.equal(out.result.code, 503); assert.deepEqual(out.result.body, { message: 'Card research is unavailable. Your inventory is saved.' });
  }
});

test('summary preserves its compact wire format and unknown cents while showing saved recovery status', async () => {
  const saved = recoveryJob(), snapshot = recoverySnapshot({ status: 'checking_details' });
  for (const enabled of [false, true]) {
    const out = response();
    await createStaffInventoryResearchHandler({ ...deps(), ...reviewedRead(async () => [saved]), readRecovery: async () => [snapshot], recoveryEnabled: () => enabled,
      signImage: async () => assert.fail('Compact summary must not sign images'),
    })(request('GET', undefined, { unit_id: saved.unit_id, view: 'summary' }), out.res);
    assert.equal(out.result.code, 200); const value = StaffInventoryMarketValueResponseSchema.parse(out.result.body);
    assert.equal(value.summaries[0].status, 'unknown'); assert.equal(value.summaries[0].value_cents, null);
    assert.match(value.summaries[0].reason, enabled ? /Checking missing details/ : /Automatic checks paused/);
    assert.equal('recovery' in value.summaries[0], false); assert.equal('proposal' in value.summaries[0], false);
  }
});

test('no persisted recovery row creates no running claim; authority and unit limits still precede recovery reads', async () => {
  const saved = recoveryJob(); let calls = 0;
  const base = { ...deps(), ...reviewedRead(async () => [saved]), recoveryEnabled: () => true, readRecovery: async () => { calls++; return []; } };
  const out = response(); await createStaffInventoryResearchHandler(base)(request(), out.res);
  assert.equal(out.result.code, 200); assert.equal(out.result.body.jobs[0].recovery, null); assert.equal(calls, 1);
  for (const query of [{ unit_id: Array.from({ length: 51 }, (_, i) => `unit-${i}`) }, { unit_id: 'fixture-unit', recovery: 'start' }]) {
    const invalid = response(); await createStaffInventoryResearchHandler(base)(request('GET', undefined, query), invalid.res); assert.equal(invalid.result.code, 400);
  }
  const denied = response(); await createStaffInventoryResearchHandler({ ...base, requireAdmin: async () => { throw new HttpError(401, 'No session'); } })(request(), denied.res);
  assert.equal(denied.result.code, 401); assert.equal(calls, 1);
});
