import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualArtifactStore } from '../../atlas-manual-service/src/artifacts.mjs';
import { createAnalysisExecutor, storeAnalysisRequest, readAnalysisRequest, analysisActionHash } from '../src/executor.mjs';
import { createAstraDefectProvider } from '../src/provider.mjs';
import { buildAstraDefectRequest } from '../src/index.mjs';
import { canonical, digest } from '../src/contract.mjs';
import { preparedFixture, responseFixture, inputFixture, id } from './fixtures.mjs';

// This fixture verifies orchestration/artifact behavior. SQL and actual staff
// handles are exercised separately by scripts/fixture-checks.mjs on owned PG.
function setup(fetchImpl, options = {}) {
  const objects = new Map(), rows = new Map(), staff = {}, activity = { calls: 0, prepares: 0, valid: true, stale: false, failClaim: false, failResult: false };
  const store = createManualArtifactStore({ transport: {
    async putIfAbsent({ key, bytes, lineageSha256, contentType }) { if (!objects.has(key)) objects.set(key, { bytes: Buffer.from(bytes), lineageSha256, contentType }); },
    async read({ key }) { return objects.get(key); },
  } });
  const artifacts = { read: (...args) => store.read(...args), write: (value, source) => {
    if (activity.failResult && source.kind === 'DEFECT_RESULT') throw new Error('synthetic storage error'); return store.write(value, source);
  } };
  const auth = () => { if (!activity.valid) throw new Error('SIGN_IN_REQUIRED'); };
  const repository = {
    async find(_staff, { cardId, analysisId, actionId }) { auth(); return structuredClone([...rows.values()].find(x => x.cardId === cardId
      && (analysisId ? x.analysisId === analysisId : x.actionId === actionId)) ?? null); },
    async prepare(_staff, input) { auth(); activity.prepares++; const existing = rows.get(input.analysisId); if (existing) return structuredClone(existing);
      const value = { ...structuredClone(input), actorId: id(5), state: 'PREPARED', evidenceHash: digest(canonical(input.requestEvidence)), receipts: [] };
      rows.set(input.analysisId, value); return structuredClone(value); },
    async claim(_staff, { analysisId }) { auth(); if (activity.stale) throw new Error('DEFECT_ANALYSIS_STALE');
      if (activity.failClaim) throw new Error('synthetic preclaim interruption');
      const run = rows.get(analysisId), claimed = run.state === 'PREPARED'; if (claimed) run.state = 'DISPATCHED'; return { claimed, run: structuredClone(run) }; },
    async recordReply({ analysisId, kind, evidence }) {
      const run = rows.get(analysisId); assert.equal(run.state, 'DISPATCHED');
      const prior = run.receipts.find(x => x.kind === kind);
      if (prior) assert.deepEqual(prior.evidence, evidence); else run.receipts.push({ kind, evidence: structuredClone(evidence), recordedAt: new Date().toISOString() });
    },
    async status(_staff, { analysisId }) { auth(); const run = structuredClone(rows.get(analysisId)); if (!run) return null;
      run.state = (run.receipts.find(x => x.kind === 'RESPONSE') ?? run.receipts.find(x => x.kind === 'OUTCOME'))?.evidence.state ?? run.state; return run; },
  };
  const provider = createAstraDefectProvider({ apiKey: 'sk-fixture_no_live_secret_123456789', timeoutMs: 100,
    fetchImpl: async (...args) => { activity.calls++; return fetchImpl(...args); }, ...options });
  return { executor: createAnalysisExecutor({ repository, provider, artifacts }), repository, artifacts, rows, objects, activity, staff, provider };
}
const call = (context, prepared) => context.executor.prepareAndRun(context.staff, { cardId: prepared.evidence.cardId,
  actionId: prepared.evidence.analysisId, prepared, expiresAt: new Date(Date.now() + 120000).toISOString() });

test('exact stored request manifest reassembles all bytes; corrupt chunk cannot resume', async () => {
  const prepared = preparedFixture(), context = setup(async () => { throw new Error('provider unused'); });
  const ref = await storeAnalysisRequest(prepared, context.artifacts), source = { cardId: prepared.evidence.cardId, sourceHash: prepared.evidence.sourceBindingSha256 };
  const { bytes, manifest } = await readAnalysisRequest(ref, source, context.artifacts);
  assert.equal(bytes.toString(), prepared.requestText); assert.equal(manifest.requestHash, prepared.requestHash);
  const chunk = context.objects.get(manifest.parts[0].ref.key); chunk.bytes[20] ^= 1;
  await assert.rejects(readAnalysisRequest(ref, source, context.artifacts), { code: 'MANUAL_ARTIFACT_UNVERIFIED' }); assert.equal(context.activity.calls, 0);
});

test('large multi-part request keeps exact bytes and detects same-length corruption after async verification', async () => {
  const input = inputFixture(), image = input.images[0].whole;
  // A valid PNG ancillary text chunk enlarges the request without changing
  // fixture pixels or requiring an optical/image-quality assertion here.
  const text = Buffer.from(`Comment\0${'A'.repeat(5 * 1024 * 1024)}`), chunk = Buffer.alloc(text.length + 12);
  chunk.writeUInt32BE(text.length); chunk.write('tEXt', 4); text.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  image.bytes = Buffer.concat([image.bytes.subarray(0, -12), chunk, image.bytes.subarray(-12)]);
  image.sha256 = digest(image.bytes);
  const prepared = buildAstraDefectRequest(input), context = setup(async () => { throw Error('provider unused'); });
  const source = { cardId: input.cardId, sourceHash: prepared.evidence.sourceBindingSha256 };
  const ref = await storeAnalysisRequest(prepared, context.artifacts);
  const restored = await readAnalysisRequest(ref, source, context.artifacts);
  assert.equal(restored.manifest.parts.length, 2);
  assert.equal(restored.bytes.toString(), prepared.requestText);
  assert.equal(digest(restored.bytes), prepared.requestHash);
  context.objects.get(restored.manifest.parts[0].ref.key).bytes[1000] ^= 1;
  await assert.rejects(readAnalysisRequest(ref, source, context.artifacts), { code: 'MANUAL_ARTIFACT_UNVERIFIED' });
  assert.equal(context.activity.calls, 0);
});

test('two racing human request handlers claim one provider dispatch, retain result, and never mutate manual findings', async () => {
  const prepared = preparedFixture(), context = setup(async () => new Response(JSON.stringify(responseFixture(prepared.evidence)), { headers: { 'content-type': 'application/json' } }));
  await Promise.all([call(context, prepared), call(context, prepared)]); assert.equal(context.activity.calls, 1);
  const result = await context.executor.readResult(context.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId });
  assert.equal(result.run.state, 'READY'); assert.equal(result.result.proposals.length, 1); assert.equal(result.result.proposals[0].reviewStatus, 'UNREVIEWED');
  await context.executor.resume(context.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId }); assert.equal(context.activity.calls, 1);
});

test('a PREPARED crash resumes exact saved bytes without resolving newer images or knowledge', async () => {
  const prepared = preparedFixture(); let sent;
  const context = setup(async (_url, options) => { sent = options.body; return new Response(JSON.stringify(responseFixture(prepared.evidence)), { headers: { 'content-type': 'application/json' } }); });
  context.activity.failClaim = true; await assert.rejects(call(context, prepared), /preclaim interruption/); assert.equal(context.activity.calls, 0);
  context.activity.failClaim = false;
  const resumed = await context.executor.resume(context.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId });
  assert.equal(resumed.state, 'READY'); assert.equal(sent, prepared.requestText); assert.equal(context.activity.prepares, 1);
});

test('cancelling asynchronous PREPARED restoration leaves the saved request claimable exactly once', async () => {
  const prepared = preparedFixture(), admission = new AbortController(), reason = Error('admission stopped');
  const context = setup(async (_url, options) => {
    assert.equal(options.body, prepared.requestText);
    return new Response(JSON.stringify(responseFixture(prepared.evidence)), { headers: { 'content-type': 'application/json' } });
  });
  context.activity.failClaim = true; await assert.rejects(call(context, prepared), /preclaim interruption/);
  context.activity.failClaim = false;
  let claims = 0;
  const read = context.artifacts.read, claim = context.repository.claim;
  context.repository.claim = (...args) => { claims++; return claim(...args); };
  context.artifacts.read = async (...args) => {
    const value = await read(...args);
    if (args[1].kind === 'DEFECT_REQUEST_PART') setImmediate(() => admission.abort(reason));
    return value;
  };
  await assert.rejects(context.executor.resume(context.staff, { cardId: prepared.evidence.cardId,
    analysisId: prepared.evidence.analysisId, dispatchSignal: admission.signal }), error => error === reason);
  assert.equal(claims, 0); assert.equal(context.activity.calls, 0);
  assert.equal(context.rows.get(prepared.evidence.analysisId).state, 'PREPARED');
  context.artifacts.read = read;
  await context.executor.resume(context.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId });
  await context.executor.resume(context.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId });
  assert.equal(claims, 1); assert.equal(context.activity.calls, 1); assert.equal(context.activity.prepares, 1);
});

test('shutdown after a committed analysis claim fences provider dispatch and retains the claim without replay', async () => {
  const prepared = preparedFixture(), context = setup(async () => { throw Error('must not dispatch'); }), admission = new AbortController();
  let entered, release;
  const claimed = new Promise(resolve => { entered = resolve; }), pending = new Promise(resolve => { release = resolve; });
  const claim = context.repository.claim;
  context.repository.claim = async (...args) => { const result = await claim(...args); entered(); await pending; return result; };
  const running = context.executor.prepareAndRun(context.staff, { cardId: prepared.evidence.cardId,
    actionId: prepared.evidence.analysisId, prepared, expiresAt: new Date(Date.now() + 120000).toISOString(), dispatchSignal: admission.signal });
  await claimed; admission.abort(Object.assign(Error('BATCH_STOPPED'), { code: 'BATCH_STOPPED' })); release();
  const result = await running;
  assert.equal(result.state, 'UNKNOWN'); assert.equal(context.activity.calls, 0);
  assert.equal(result.receipts[0].kind, 'OUTCOME');
  await context.executor.resume(context.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId });
  assert.equal(context.activity.calls, 0);
});

test('UNKNOWN request reconciliation never creates a new model request or a zero-findings result', async () => {
  const prepared = preparedFixture(), context = setup(async () => { throw new Error('possible network dispatch'); });
  const result = await call(context, prepared); assert.equal(result.state, 'UNKNOWN'); assert.equal(context.activity.calls, 1);
  await context.executor.resume(context.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId });
  const read = await context.executor.readResult(context.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId });
  assert.equal(read.result, null); assert.equal(context.activity.calls, 1);
});

test('raw malformed output and actual usage are saved before strict output refusal', async () => {
  const prepared = preparedFixture(), raw = responseFixture(prepared.evidence); raw.output[1].content[0].text = '{not JSON';
  const context = setup(async () => new Response(JSON.stringify(raw), { headers: { 'content-type': 'application/json' } }));
  const run = await call(context, prepared), receipt = run.receipts[0].evidence;
  assert.equal(run.state, 'REFUSED'); assert.equal(receipt.usage.total_tokens, 300); assert(receipt.responseRef); assert.equal(receipt.resultRef, null);
  const stored = await context.artifacts.read(receipt.responseRef, { cardId: run.cardId, kind: 'DEFECT_RESPONSE', sourceHash: prepared.evidence.sourceBindingSha256 });
  assert.equal(Buffer.from(stored.base64, 'base64').toString(), JSON.stringify(raw));
});

test('receipt-only persistence survives expired initiating staff access; read/adoption still requires sign-in', async () => {
  const prepared = preparedFixture(); let context;
  context = setup(async () => { context.activity.valid = false; return new Response(JSON.stringify(responseFixture(prepared.evidence)), { headers: { 'content-type': 'application/json' } }); });
  await assert.rejects(call(context, prepared), /SIGN_IN_REQUIRED/);
  const row = context.rows.get(prepared.evidence.analysisId); assert.equal(row.receipts[0].kind, 'RESPONSE'); assert.equal(row.receipts[0].evidence.state, 'READY');
  await assert.rejects(context.executor.readResult(context.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId }), /SIGN_IN_REQUIRED/);
});

test('failure after a raw response save retains its reference and usage as UNKNOWN without redispatch', async () => {
  const prepared = preparedFixture(), context = setup(async () => new Response(JSON.stringify(responseFixture(prepared.evidence)), { headers: { 'content-type': 'application/json' } }));
  context.activity.failResult = true; const run = await call(context, prepared), evidence = run.receipts[0].evidence;
  assert.equal(run.state, 'UNKNOWN'); assert(evidence.responseRef); assert.equal(evidence.usage.total_tokens, 300); assert.equal(evidence.resultRef, null);
  context.activity.failResult = false; await context.executor.resume(context.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId });
  assert.equal(context.activity.calls, 1);
});

test('stale source before claim prevents dispatch; changed provider binding prevents PREPARED replay', async () => {
  const prepared = preparedFixture(), context = setup(async () => { throw new Error('provider should be unused'); });
  context.activity.stale = true; await assert.rejects(call(context, prepared), /DEFECT_ANALYSIS_STALE/); assert.equal(context.activity.calls, 0);
  context.activity.stale = false;
  const changed = createAnalysisExecutor({ repository: context.repository, artifacts: context.artifacts,
    provider: createAstraDefectProvider({ apiKey: 'sk-a_different_fixture_key_12345678', fetchImpl: async () => { throw new Error('provider should be unused'); } }) });
  await assert.rejects(changed.resume(context.staff, { cardId: prepared.evidence.cardId, analysisId: prepared.evidence.analysisId }), { code: 'DEFECT_ANALYSIS_PROVIDER_BINDING_CHANGED' });
});

test('durable pre-dispatch refusal settles exact replay without new artifacts or provider work', async () => {
  const prepared = preparedFixture(), context = setup(async () => { throw new Error('must not dispatch'); });
  const retired = { analysisId: prepared.evidence.analysisId, actionId: prepared.evidence.analysisId, cardId: prepared.evidence.cardId,
    state: 'REFUSED', retired: true, dispatched: false, baseHash: analysisActionHash(prepared.evidence), receipts: [] };
  context.rows.set(retired.analysisId, retired);
  assert.equal((await call(context, prepared)).retired, true);
  assert.equal((await context.executor.resume(context.staff, { cardId: retired.cardId, analysisId: retired.analysisId })).retired, true);
  assert.equal((await context.executor.readResult(context.staff, { cardId: retired.cardId, analysisId: retired.analysisId })).result, null);
  assert.equal(context.activity.calls, 0); assert.equal(context.activity.prepares, 0); assert.equal(context.objects.size, 0);
  await assert.rejects(context.executor.prepareAndRun(context.staff, { cardId: retired.cardId, actionId: retired.actionId,
    prepared, baseHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 120000).toISOString() }), { code: 'DEFECT_ANALYSIS_ACTION_CONFLICT' });
});

test('optional low priority admission preserves exact PREPARED evidence and never claims or POSTs while busy',async()=>{
 const prepared=preparedFixture(),context=setup(async()=>new Response(JSON.stringify(responseFixture(prepared)),{status:200,headers:{'content-type':'application/json'}}));
 const input={cardId:prepared.evidence.cardId,actionId:prepared.evidence.analysisId,prepared,expiresAt:new Date(Date.now()+120000).toISOString(),admitDispatch:async()=>false};
 const result=await context.executor.prepareAndRun(context.staff,input);assert.equal(result.state,'PREPARED');assert.equal(context.activity.calls,0);
 const before=structuredClone(context.rows.get(prepared.evidence.analysisId));
 for(let i=0;i<3;i++)await context.executor.resume(context.staff,{cardId:input.cardId,analysisId:input.actionId,admitDispatch:async()=>false});
 assert.deepEqual(context.rows.get(input.actionId),before);assert.equal(context.activity.calls,0);
 await context.executor.resume(context.staff,{cardId:input.cardId,analysisId:input.actionId,admitDispatch:async()=>true});assert.equal(context.activity.calls,1);
});
