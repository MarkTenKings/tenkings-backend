import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualArtifactStore } from '../../atlas-manual-service/src/artifacts.mjs';
import { createAnalysisExecutor, analysisActionHash } from '../src/executor.mjs';
import { createAstraDefectProvider, RESPONSE_ENDPOINT } from '../src/provider.mjs';
import { buildAstraDefectRequest, buildAstraBackgroundDefectRequest, restorePreparedRequest, parseAstraResponse,
  VERSION, BACKGROUND_VERSION, BACKGROUND_POLICY, MODEL } from '../src/index.mjs';
import { digest, canonical } from '../src/contract.mjs';
import { inputFixture, responseFixture, id, hash } from './fixtures.mjs';

const apiKey = 'sk-background_fixture_no_live_secret_123456';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { 'content-type': 'application/json', 'x-request-id': 'req_background_fixture' } });
const ack = (status = 'queued') => ({ id: 'resp_fixture_123', model: MODEL, status, background: true, store: false });

// Only storage and the actual provider transport/parser are exercised here.
// Real locking, acceptance constraints and ACLs have separate PostgreSQL tests.
function context(fetchImpl, providerOptions = {}) {
  const rows = new Map(), accepted = new Map(), objects = new Map(), staff = {};
  const activity = { valid: true, calls: [], writes: [], failResult: false, failAcceptance: false };
  const auth = () => { if (!activity.valid) throw new Error('SIGN_IN_REQUIRED'); };
  const store = createManualArtifactStore({ transport: {
    async putIfAbsent({ key, bytes, lineageSha256, contentType }) {
      if (!objects.has(key)) objects.set(key, { bytes: Buffer.from(bytes), lineageSha256, contentType });
    },
    async read({ key }) { return objects.get(key); },
  } });
  const artifacts = { read: (...args) => store.read(...args), write(value, source) {
    activity.writes.push(source.kind);
    if (activity.failResult && source.kind === 'DEFECT_RESULT') throw new Error('storage unavailable');
    return store.write(value, source);
  } };
  const findAccepted = ({ analysisId, providerBindingHash }) => {
    const run = rows.get(analysisId), acceptance = accepted.get(analysisId);
    if (!acceptance || run.requestEvidence.providerBindingHash !== providerBindingHash
      || run.receipts.some(x => x.kind === 'RESPONSE')) return null;
    return structuredClone({ run, acceptance });
  };
  const repository = {
    async find(_staff, { analysisId, actionId, cardId }) { auth();
      return structuredClone([...rows.values()].find(x => x.cardId === cardId
        && (analysisId ? x.analysisId === analysisId : x.actionId === actionId)) ?? null); },
    async prepare(_staff, input) { auth(); const old = rows.get(input.analysisId); if (old) return structuredClone(old);
      const row = { ...structuredClone(input), state: 'PREPARED', actorId: id(5), evidenceHash: digest(canonical(input.requestEvidence)),
        replacesAnalysisId: input.replacement?.analysisId ?? null, replacesOutcomeHash: input.replacement?.outcomeHash ?? null, receipts: [] };
      rows.set(row.analysisId, row); return structuredClone(row); },
    async claim(_staff, { analysisId }) { auth(); const run = rows.get(analysisId), claimed = run.state === 'PREPARED';
      if (claimed) run.state = 'DISPATCHED'; return { claimed, run: structuredClone(run) }; },
    async status(_staff, { analysisId }) { auth(); const row = rows.get(analysisId); if (!row) return null;
      const terminal = row.receipts.find(x => x.kind === 'RESPONSE');
      return structuredClone({ ...row, state: terminal?.evidence.state ?? (accepted.has(analysisId) ? 'RUNNING'
        : row.receipts.find(x => x.kind === 'OUTCOME')?.evidence.state ?? row.state), acceptance: accepted.get(analysisId) ?? null }); },
    async recordReply({ analysisId, requestHash, kind, evidence }) {
      const run = rows.get(analysisId); assert.equal(run.state, 'DISPATCHED'); assert.equal(run.requestHash, requestHash);
      const old = run.receipts.find(x => x.kind === kind);
      if (old) assert.deepEqual(old.evidence, evidence); else run.receipts.push({ kind, evidence: structuredClone(evidence) });
    },
    async appendAcceptance({ analysisId, requestHash, providerBindingHash, evidence }) {
      if (activity.failAcceptance) throw new Error('acceptance unavailable');
      const run = rows.get(analysisId); assert.equal(run.state, 'DISPATCHED'); assert.equal(run.requestHash, requestHash);
      assert.equal(run.requestEvidence.providerBindingHash, providerBindingHash);
      assert.equal(run.requestEvidence.version, BACKGROUND_VERSION);
      assert.equal(activity.writes.filter(x => !x.startsWith('DEFECT_REQUEST')).length, 0);
      accepted.set(analysisId, structuredClone(evidence));
    },
    async findAccepted(input) { return findAccepted(input); },
    async listAcceptedPending({ providerBindingHash, limit, cursor }) {
      const items = [...rows.keys()].map(analysisId => findAccepted({ analysisId, providerBindingHash })).filter(Boolean)
        .filter(x => !cursor || x.run.analysisId > cursor.analysisId)
        .filter(x => Date.parse(x.acceptance.pollUntil) > Date.now() || !x.run.receipts.some(r => r.kind === 'OUTCOME'));
      return { items: items.slice(0, limit), nextCursor: items.length > limit ? { analysisId: items[limit - 1].run.analysisId,
        recordedAt: new Date().toISOString() } : null };
    },
  };
  const makeProvider = (options = {}) => createAstraDefectProvider({ apiKey, timeoutMs: 100, getTimeoutMs: 100,
    fetchImpl: async (url, options) => { activity.calls.push({ url, method: options.method, body: options.body }); return fetchImpl(url, options); },
    ...providerOptions, ...options });
  const provider = makeProvider();
  const makeExecutor = (p = provider) => createAnalysisExecutor({ repository, artifacts, provider: p });
  return { executor: makeExecutor(), makeExecutor, makeProvider, repository, artifacts, rows, accepted, objects, activity, staff };
}
const prepare = () => buildAstraBackgroundDefectRequest(inputFixture());
const run = (c, prepared, options = {}) => c.executor.prepareAndRun(c.staff, { cardId: prepared.evidence.cardId,
  actionId: prepared.evidence.analysisId, prepared, expiresAt: new Date(Date.now() + 180000).toISOString(), ...options });

test('V2 changes only background mode and evidence version; V1 and V2 restore exact bytes and result provenance', () => {
  const old = buildAstraDefectRequest(inputFixture()), current = prepare();
  assert.equal(old.evidence.version, VERSION); assert.equal(current.evidence.version, BACKGROUND_VERSION);
  const { background, ...withoutBackground } = current.request;
  assert.equal(background, true); assert.equal(JSON.stringify(withoutBackground), old.requestText);
  assert.deepEqual({ ...current.evidence, version: VERSION }, old.evidence);
  for (const prepared of [old, current]) {
    assert.equal(restorePreparedRequest(prepared).requestText, prepared.requestText);
    const parsed = parseAstraResponse(Buffer.from(JSON.stringify(responseFixture(prepared.evidence))), prepared.evidence);
    assert.equal(parsed.result.version, prepared.evidence.version);
    assert.equal(parsed.result.proposals[0].provenance.version, prepared.evidence.version);
  }
  const wrong = { ...current, requestText: old.requestText, requestHash: old.requestHash };
  assert.throws(() => restorePreparedRequest(wrong), { code: 'DEFECT_ANALYSIS_REQUEST_ARTIFACT_INVALID' });
});

test('acceptance returns without ACK object writes; restart collects after 180 seconds and expired staff session with exactly one POST', async t => {
  const prepared = prepare(); let sent = false;
  const c = context(async (url, options) => {
    if (options.method === 'POST') { assert.equal(sent, false); sent = true; assert.equal(options.body, prepared.requestText); return json(ack()); }
    assert.equal(url, `${RESPONSE_ENDPOINT}/resp_fixture_123`); assert.equal(options.body, undefined);
    return json(responseFixture(prepared.evidence));
  });
  assert.equal((await run(c, prepared)).state, 'RUNNING');
  assert(c.activity.writes.every(x => x.startsWith('DEFECT_REQUEST')));
  const accepted = c.accepted.get(prepared.evidence.analysisId);
  assert.equal(accepted.responseHash, digest(JSON.stringify(ack())));
  assert.equal(Date.parse(accepted.pollUntil) - Date.parse(accepted.receivedAt), BACKGROUND_POLICY.pollWindowMs);
  const later = Date.now() + 181000; t.mock.method(Date, 'now', () => later);
  c.activity.valid = false;
  const restarted = c.makeExecutor(c.makeProvider());
  assert.equal((await restarted.pending()).items.length, 1);
  assert.equal((await restarted.reconcile({ analysisId: prepared.evidence.analysisId })).state, 'SETTLED');
  assert.equal(c.activity.calls.filter(x => x.method === 'POST').length, 1);
  assert.equal(c.rows.get(prepared.evidence.analysisId).receipts[0].evidence.state, 'READY');
  await assert.rejects(restarted.readResult(c.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId }), /SIGN_IN_REQUIRED/);
  c.activity.valid = true;
  const read = await restarted.readResult(c.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId });
  assert.equal(read.result.proposals[0].reviewStatus, 'UNREVIEWED');
  assert.equal((await restarted.pending()).items.length, 0);
  assert.equal((await restarted.reconcile({ analysisId: prepared.evidence.analysisId })).state, 'SKIPPED');
});

test('durable acceptance survives initiating session expiry before HTTP projection', async () => {
  const prepared = prepare(); let c;
  c = context(async (_url, options) => { if (options.method === 'POST') { c.activity.valid = false; return json(ack()); }
    return json(responseFixture(prepared.evidence)); });
  await assert.rejects(run(c, prepared), /SIGN_IN_REQUIRED/);
  assert.equal(c.accepted.size, 1);
  assert.equal((await c.executor.reconcile({ analysisId: prepared.evidence.analysisId })).state, 'SETTLED');
  assert.equal(c.activity.calls.filter(x => x.method === 'POST').length, 1);
});

test('racing background human handlers create one paid POST and one durable acceptance', async () => {
  const prepared = prepare(), c = context(async () => json(ack()));
  await Promise.all([run(c, prepared), run(c, prepared)]);
  assert.equal(c.activity.calls.length, 1); assert.equal(c.activity.calls[0].method, 'POST');
  assert.equal(c.accepted.size, 1); assert.equal(c.rows.get(prepared.evidence.analysisId).receipts.length, 0);
  await c.executor.resume(c.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId });
  assert.equal(c.activity.calls.length, 1);
});

test('ambiguous POST without response ID stays UNKNOWN and cannot produce GET work or automatic POST replay', async () => {
  const prepared = prepare(), c = context(async () => { throw new Error('connection lost after possible dispatch'); });
  assert.equal((await run(c, prepared)).state, 'UNKNOWN');
  assert.equal((await c.executor.pending()).items.length, 0);
  assert.equal((await c.executor.reconcile({ analysisId: prepared.evidence.analysisId })).state, 'SKIPPED');
  await c.executor.resume(c.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId });
  assert.equal(c.activity.calls.length, 1);
  assert.equal(c.rows.get(prepared.evidence.analysisId).receipts[0].evidence.responseId, null);
});

test('transient GET, different response ID, and in-progress response stay pending; only exact terminal ID settles', async () => {
  const prepared = prepare(); let count = 0;
  const c = context(async (_url, options) => {
    if (options.method === 'POST') return json(ack());
    count++;
    if (count === 1) return json({ error: { code: 'rate_limit_exceeded' } }, 429);
    if (count === 2) return json({ ...responseFixture(prepared.evidence), id: 'resp_unrelated' });
    if (count === 3) return json(ack('in_progress'));
    return json(responseFixture(prepared.evidence));
  });
  await run(c, prepared);
  for (let i = 0; i < 3; i++) {
    assert.equal((await c.executor.reconcile({ analysisId: prepared.evidence.analysisId })).state, 'PENDING');
    assert.equal(c.rows.get(prepared.evidence.analysisId).receipts.length, 0);
    assert(c.activity.writes.every(x => x.startsWith('DEFECT_REQUEST')));
  }
  assert.equal((await c.executor.reconcile({ analysisId: prepared.evidence.analysisId })).state, 'SETTLED');
  assert.equal(c.activity.calls.filter(x => x.method === 'POST').length, 1); assert.equal(count, 4);
});

test('terminal artifact failure remains collectable; corrupted original request and changed provider binding cannot adopt', async () => {
  const prepared = prepare(), c = context(async (_url, options) => json(options.method === 'POST' ? ack() : responseFixture(prepared.evidence)));
  await run(c, prepared);
  const changed = c.makeExecutor(c.makeProvider({ apiKey: 'sk-different_background_fixture_123456789' }));
  assert.equal((await changed.reconcile({ analysisId: prepared.evidence.analysisId })).state, 'SKIPPED');
  assert.equal(c.activity.calls.length, 1);
  const object = [...c.objects.values()][0], original = Buffer.from(object.bytes); object.bytes[20] ^= 1;
  assert.equal((await c.executor.reconcile({ analysisId: prepared.evidence.analysisId })).state, 'PENDING');
  assert.equal(c.rows.get(prepared.evidence.analysisId).receipts.length, 0); object.bytes = original;
  c.activity.failResult = true;
  assert.equal((await c.executor.reconcile({ analysisId: prepared.evidence.analysisId })).state, 'PENDING');
  assert.equal(c.rows.get(prepared.evidence.analysisId).receipts.length, 0);
  c.activity.failResult = false;
  assert.equal((await c.executor.reconcile({ analysisId: prepared.evidence.analysisId })).state, 'SETTLED');
  assert.equal(c.activity.calls.filter(x => x.method === 'POST').length, 1);
});

test('local poll-window exhaustion is UNKNOWN with retained response ID, no new GET and no cancellation claim', async t => {
  const prepared = prepare(), c = context(async () => json(ack())); await run(c, prepared);
  const end = Date.parse(c.accepted.get(prepared.evidence.analysisId).pollUntil); t.mock.method(Date, 'now', () => end + 1);
  assert.equal((await c.executor.reconcile({ analysisId: prepared.evidence.analysisId })).state, 'UNKNOWN');
  const receipt = c.rows.get(prepared.evidence.analysisId).receipts[0].evidence;
  assert.equal(receipt.code, 'DEFECT_ANALYSIS_POLL_WINDOW_EXHAUSTED'); assert.equal(receipt.responseId, 'resp_fixture_123');
  assert.equal(receipt.usage, null); assert.equal(receipt.resultRef, null); assert.equal(c.activity.calls.length, 1);
  assert.equal((await c.executor.pending()).items.length, 0);
});

test('acceptance DB failure preserves observed response ID without claiming durable acceptance or redispatching', async () => {
  const prepared = prepare(), c = context(async () => json(ack())); c.activity.failAcceptance = true;
  assert.equal((await run(c, prepared)).state, 'UNKNOWN');
  assert.equal(c.accepted.size, 0);
  assert.equal(c.rows.get(prepared.evidence.analysisId).receipts[0].evidence.responseId, 'resp_fixture_123');
  await c.executor.resume(c.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId });
  assert.equal(c.activity.calls.length, 1);
});

test('replacement parent and outcome enter the action hash and survive exact PREPARED resume', async () => {
  const prepared = prepare(), replacement = { analysisId: id(20), outcomeHash: hash('old-unknown') };
  assert.notEqual(analysisActionHash(prepared.evidence), analysisActionHash(prepared.evidence, prepared.evidence.analysisId, replacement));
  const c = context(async () => json(ack())); const claim = c.repository.claim; let held = true;
  c.repository.claim = (...args) => { if (held) throw new Error('crash before claim'); return claim(...args); };
  await assert.rejects(run(c, prepared, { replacement,
    baseHash: analysisActionHash(prepared.evidence, prepared.evidence.analysisId, replacement) }), /crash before claim/);
  held = false;
  assert.equal((await c.executor.resume(c.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId })).state, 'RUNNING');
  assert.equal(c.activity.calls.length, 1);
  await assert.rejects(run(c, prepared), { code: 'DEFECT_ANALYSIS_ACTION_CONFLICT' });
});

test('GET transport is fixed, bounded even for noncooperative fetch, and rejects path injection before network', async () => {
  let calls = 0;
  const provider = createAstraDefectProvider({ apiKey, getTimeoutMs: 10, fetchImpl: (url, options) => {
    calls++; assert.equal(url, `${RESPONSE_ENDPOINT}/resp_fixture_123`); assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error'); assert.equal(options.body, undefined); return new Promise(() => {});
  } });
  const input = { analysisId: id(10), requestHash: hash('request'), responseId: 'resp_fixture_123' };
  assert.equal((await provider.retrieve(input)).state, 'UNKNOWN'); assert.equal(calls, 1);
  await assert.rejects(provider.retrieve({ ...input, responseId: 'resp_abc/../other' }), { code: 'DEFECT_ANALYSIS_RESPONSE_INVALID' });
  assert.equal(calls, 1);
});

test('aborting a background GET preserves accepted work for a later worker', async () => {
  const prepared = prepare(); let getStarted;
  const start = new Promise(resolve => { getStarted = resolve; });
  const c = context(async (_url, options) => {
    if (options.method === 'POST') return json(ack());
    getStarted(); return new Promise(() => {});
  });
  await run(c, prepared);
  const controller = new AbortController(), work = c.executor.reconcile({ analysisId: prepared.evidence.analysisId, signal: controller.signal });
  await start; controller.abort(); assert.equal((await work).state, 'PENDING');
  assert.equal(c.accepted.size, 1); assert.equal(c.rows.get(prepared.evidence.analysisId).receipts.length, 0);
  assert.equal((await c.executor.pending()).items.length, 1);
  assert.equal(c.activity.calls.filter(x => x.method === 'POST').length, 1);
});
