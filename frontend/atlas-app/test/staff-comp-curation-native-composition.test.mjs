import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, requireThat } from '@atlas/manual-service/contract';
import { createStaffCompCurationNativeComposition } from '../lib/server/staff-comp-curation-native-composition.mjs';
import { curationFixture, deferred } from './staff-comp-curation-fixture.mjs';

async function fixture() {
  const f = await curationFixture();
  let actor = f.staff, authCalls = 0;
  const options = { enabled: true, environment: {}, ...Object.fromEntries(['boundary', 'approved', 'artifacts', 'validateAccess'].map(key => [key, f.options[key]])),
    origin: 'http://127.0.0.1:4318',
    auth: { async authenticate(cookie, csrf) {
      authCalls++; await f.hooks.auth?.(authCalls);
      requireThat(cookie === 'synthetic=session' && actor, 401, 'SIGN_IN_REQUIRED');
      if (csrf !== undefined) requireThat(csrf === 'synthetic-csrf', 403, 'CSRF_REQUIRED');
      return actor;
    } },
    assertRequest(req) { assert.equal(this, options); requireThat(req.syntheticAdmitted === true, 403, 'DIRECT_ACCESS_FORBIDDEN'); },
  };
  const composition = createStaffCompCurationNativeComposition(options);
  async function request(input = null, extra = {}) {
    const method = input ? 'POST' : 'GET';
    const req = { method, syntheticAdmitted: true,
      url: `/api/staff/comp-curation/cards/${f.cardId}` + (input ? '/decision' : `?approvalActionId=${f.actionId}&previewId=${f.previewId}`),
      headers: { cookie: 'synthetic=session', ...(input ? { origin: options.origin, 'content-type': 'application/json', 'x-atlas-csrf': 'synthetic-csrf' } : {}) },
      body: input ?? '', ...extra };
    let status, body; const headers = {};
    await composition.handler(req, { setHeader(k, v) { headers[k] = v; }, status(v) { status = v; return this; }, json(v) { body = v; } });
    return { status, body, headers };
  }
  const decision = outcome => f.input({ outcome, selectedIds: [], reviewedIds: [], expectedPolicyHash: null });
  return { ...f, options, composition, request, decision, setActor(value) { actor = value; }, get authCalls() { return authCalls; } };
}

test('disabled native composition is null and touches no capabilities or environment', () => {
  const disabled = new Proxy({}, { get(_target, key) { assert.equal(key, 'enabled'); return undefined; } });
  assert.equal(createStaffCompCurationNativeComposition(), null);
  assert.equal(createStaffCompCurationNativeComposition(disabled), null);
  for (const enabled of [false, 'true', 1, null]) assert.equal(createStaffCompCurationNativeComposition({ enabled }), null);
});

test('enabled composition refuses serverless hosts, policy/provider injection and incomplete trusted capabilities', async () => {
  const f = await fixture();
  for (const extra of [{ environment: { VERCEL: '1' } }, { environment: { AWS_LAMBDA_FUNCTION_NAME: 'synthetic' } },
    { policy: f.options.policy }, { provider: () => assert.fail('provider') }, { auth: {} }, { boundary: {} },
    { approved: {} }, { artifacts: {} }, { validateAccess: null }, { assertRequest: null }, { origin: 'https://example.invalid/path' }]) {
    assert.throws(() => createStaffCompCurationNativeComposition({ ...f.options, ...extra }), { code: 'COMP_NOT_CONFIGURED' });
  }
  assert.equal(f.authCalls, 0); assert.equal(f.calls.insert, 0);
  assert(Object.isFrozen(f.composition)); assert.deepEqual(Object.keys(f.composition).sort(), ['close', 'handler', 'policy', 'status', 'visibility']);
});

test('actual service/HTTP composition reads saved evidence and records only private null-policy decisions', async () => {
  const f = await fixture(), before = canonical({ publication: f.row, market: f.market, packet: f.packet });
  const first = await f.request(); assert.equal(first.status, 200); assert.match(first.headers['Cache-Control'], /private, no-store/);
  assert.equal(first.body.result.availability, 'POLICY_REQUIRED'); assert.equal(first.body.result.policy, null); assert.equal(first.body.result.preview, null);
  for (const outcome of ['SKIP', 'NO_SUITABLE_COMPS']) {
    const input = f.decision(outcome), reply = await f.request(input);
    assert.equal(reply.status, 200); assert.equal(reply.body.result.outcome, outcome);
    for (const key of ['policy', 'policyHash', 'guidance']) assert.equal(reply.body.result[key], null);
    assert.equal(reply.body.result.reportSnapshotUnaffected, true); assert.deepEqual(reply.body.result.selected, []);
    const replay = await f.request(input); assert.deepEqual(replay.body, reply.body);
  }
  assert.equal(f.calls.insert, 2); assert.equal(canonical({ publication: f.row, market: f.market, packet: f.packet }), before);
  assert.equal((await f.request(f.input())).status, 409); assert.equal(f.calls.insert, 2);
});

test('missing saved pool still supports truthful Skip without artifact acquisition', async () => {
  const f = await fixture(), input = { ...f.decision('SKIP'), previewId: null, expectedPreviewHash: null };
  const result = await f.request(input); assert.equal(result.status, 200); assert.equal(result.body.result.sourceStatus, 'NO_SAVED_POOL');
  assert.equal(result.body.result.guidance, null); assert.equal(f.calls.artifact, 0);
});

test('current capability changes during observed authentication refuse before returning private state', async () => {
  for (const change of [f => { f.options.auth.authenticate = async () => f.staff; }, f => { f.options.boundary.transaction = async () => ({}); },
    f => { f.options.approved.loadPacket = async () => ({}); }, f => { f.options.artifacts.read = async () => ({}); },
    f => { f.options.validateAccess = async () => {}; }, f => { f.options.environment.VERCEL = '1'; }, f => { f.options.enabled = false; }]) {
    const f = await fixture(), entered = deferred(), resume = deferred();
    f.hooks.auth = async () => { entered.resolve(); await resume.promise; };
    const reading = f.request(); await entered.promise; assert.equal(f.authCalls, 1); change(f); resume.resolve();
    const result = await reading; assert.equal(result.status, 503); assert.deepEqual(result.body, { error: 'COMP_NOT_CONFIGURED' });
    assert.equal(f.calls.insert, 0); assert.equal(f.calls.access, 0);
  }
});

test('close while saved evidence is awaited ends the request and never closes caller-owned clients', async () => {
  const f = await fixture(), entered = deferred(), resume = deferred();
  f.hooks.artifact = async () => { entered.resolve(); await resume.promise; };
  const reading = f.request(); await entered.promise; f.composition.close(); resume.resolve();
  const result = await reading; assert.equal(result.status, 503); assert.deepEqual(result.body, { error: 'COMP_NOT_CONFIGURED' });
  assert.equal(f.calls.insert, 0); assert.equal((await f.request()).status, 503);
});

test('close after a committed decision reports uncertainty without pretending rollback', async () => {
  const f = await fixture();
  f.hooks.auth = n => { if (n === 2) f.composition.close(); };
  const result = await f.request(f.decision('SKIP')); assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: 'COMP_NOT_CONFIGURED' }); assert.equal(f.calls.insert, 1);
});

test('ingress and current approval/access refusals remain independent from private configuration', async () => {
  const f = await fixture();
  assert.equal((await f.request(null, { syntheticAdmitted: false })).status, 403); assert.equal(f.authCalls, 0);
  f.row.state = 'PENDING'; assert.equal((await f.request()).status, 409); assert.equal((await f.request(f.decision('SKIP'))).status, 409);
  f.row.state = 'PUBLISHED'; f.setActor(null); assert.equal((await f.request()).status, 401); assert.equal(f.calls.insert, 0);
});
