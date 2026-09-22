import assert from 'node:assert/strict';
import test from 'node:test';
import { canonical, inventoryHash } from '@tenkings/database';
import { exactFixture, sha, invocation, actorId } from './staffResearchExactInputQualificationFixture';
import { EXACT_INPUT_LIMITS, exactInputQualificationPlan, exactInputQualificationTransport, recoverExactInputQualification, runExactInputQualification } from '../lib/server/staffResearchExactInputQualification';

test('actual pure V6 engine uses verified originals and bounded exact-byte receipts; sequential replay/recovery never redispatch', async () => {
  const f = await exactFixture();
  assert.equal(f.plan.plan!.diagnostic_version, 'exact-input-v2');
  assert.equal(f.plan.plan!.expected_engine_version, 'staff-inventory-research-v6');
  const outcome = await runExactInputQualification(actorId, f.plan.plan_sha256!, invocation, f.env, f.deps);
  assert.equal(outcome.status, 'completed'); assert.equal(f.storage.size, 2);
  assert.deepEqual(outcome.summary!.counts, { search: 1, detail: 2, model: 1, image: 2 });
  assert.equal((outcome.summary!.result as any).engine_version, 'staff-inventory-research-v6');
  assert.equal((outcome.summary!.result as any).photo_identity.status, 'unresolved');
  assert.equal((outcome.summary!.result as any).sale_details.base_engine_version, 'staff-inventory-research-v3');
  assert.equal((outcome.summary!.result as any).estimate.status, 'unknown');
  const raw = [...f.storage.entries()].find(([key]) => key.endsWith('/terminal.json'))![1], terminal = JSON.parse(raw.toString());
  assert.equal(terminal.payload_sha256, inventoryHash(terminal.payload)); assert.equal(outcome.receipt_sha256, sha(raw));
  const model = terminal.payload.tape.calls.find((call: any) => call.kind === 'model');
  assert.equal(model.returned_model, 'gpt-6-astra'); assert.equal(model.usage.total_tokens, 168); assert.equal(model.request_id, 'synthetic-openai-request');
  const reconstructed = JSON.parse(model.request_template);
  for (const part of reconstructed.input[0].content) if (part.type === 'input_image') {
    const id = part.image_url.split(':')[1], proof = model.request_images.find((image: any) => image.sha256 === id);
    const original = f.bytes.find(bytes => sha(bytes) === id), blob = terminal.payload.tape.blobs.find((blob: any) => blob.sha256 === id);
    part.image_url = `data:${proof.mime_type};base64,${original?.toString('base64') ?? blob.data}`;
  }
  assert.equal(sha(JSON.stringify(reconstructed)), model.request_sha256);
  for (const blob of terminal.payload.tape.blobs) assert.equal(sha(Buffer.from(blob.data, 'base64')), blob.sha256);
  assert.equal(raw.includes(Buffer.from(f.env.OPENAI_API_KEY)), false); assert.equal(raw.includes(Buffer.from(f.env.SOLDCOMPS_API_KEY)), false);
  assert.equal((outcome.summary!.cost as any).status, 'unavailable'); assert.equal((outcome.summary!.cost as any).actual_billed_cost, null);
  const calls = f.requests.length;
  await recoverExactInputQualification(actorId, f.plan.plan_sha256!, invocation, f.deps);
  await runExactInputQualification(actorId, f.plan.plan_sha256!, invocation, f.env, f.deps);
  assert.equal(f.requests.length, calls); assert.equal(f.storage.size, 2);
  assert.equal((await recoverExactInputQualification('another-admin', f.plan.plan_sha256!, invocation, f.deps)).status, 'not_found');
});

test('a fresh qualification cannot pass by returning a legacy V5 result under the V6 plan', async () => {
  const f = await exactFixture(), original = f.deps.research;
  f.deps.research = async (...args) => {
    const result = await original(...args);
    const { photo_identity: _photoIdentity, ...legacy } = result;
    return { ...legacy, engine_version: 'staff-inventory-research-v5' };
  };
  const receipt = await runExactInputQualification(actorId, f.plan.plan_sha256!, invocation, f.env, f.deps);
  assert.equal(receipt.status, 'failed'); assert.equal(receipt.summary!.error_code, 'result_binding');
});

test('legacy V5 terminal receipts recover byte-for-byte without current config, execution or relabeling', async () => {
  const f = await exactFixture();
  const legacyPlan = { diagnostic_version: 'exact-input-v1', config: f.config };
  const planHash = inventoryHash(legacyPlan), legacyResult = { engine_version: 'staff-inventory-research-v5', estimate: { status: 'unknown' } };
  const payload = { stage: 'terminal', status: 'completed', actor_sha256: sha(actorId), plan_sha256: planHash, invocation_id: invocation,
    plan: legacyPlan, summary: { status: 'completed', result: legacyResult } };
  const bytes = Buffer.from(canonical({ schema_version: 1, payload_sha256: inventoryHash(payload), payload }));
  const key = `inventory-research-qualification/${sha(actorId)}/${planHash}/${invocation}/terminal.json`;
  f.storage.set(key, bytes);
  const receipt = await recoverExactInputQualification(actorId, planHash, invocation, { ...f.deps,
    readInput: async () => assert.fail('Legacy recovery must not read current input'),
    writeReceipt: async () => assert.fail('Legacy recovery must not rewrite evidence'),
    fetchImpl: async () => assert.fail('Legacy recovery must not invoke providers'),
  });
  assert.equal(receipt.status, 'completed'); assert.deepEqual(receipt.summary!.result, legacyResult);
  assert.equal(receipt.receipt_sha256, sha(bytes)); assert.deepEqual(f.storage.get(key), bytes);
  assert.equal(f.requests.length, 0);
});

test('configuration/default-off/stale pins and corrupt actual original bytes fail before provider dispatch', async () => {
  const f = await exactFixture();
  assert.equal((await exactInputQualificationPlan({ ...f.env, STAFF_RESEARCH_EXACT_INPUT_QUALIFICATION_CONFIG: undefined }, { ...f.deps, readInput: async () => assert.fail('unconfigured DB read') })).enabled, false);
  assert.equal((await exactInputQualificationPlan({ ...f.env, VERCEL_GIT_COMMIT_SHA: 'f'.repeat(40) }, f.deps)).plan, null);
  await assert.rejects(runExactInputQualification(actorId, f.plan.plan_sha256!, invocation, { ...f.env, STAFF_RESEARCH_EXACT_INPUT_QUALIFICATION_ENABLED: 'false' }, f.deps));
  await assert.rejects(runExactInputQualification(actorId, 'a'.repeat(64), invocation, f.env, f.deps));
  await assert.rejects(runExactInputQualification(actorId, f.plan.plan_sha256!, invocation, f.env, { ...f.deps, readPhoto: async key => ({ key, sha256: f.config.photos.front.sha256, bytes: Buffer.from('not-original') }) }));
  f.row.status = 'superseded'; await assert.rejects(runExactInputQualification(actorId, f.plan.plan_sha256!, invocation, f.env, f.deps));
  assert.equal(f.requests.length, 0); assert.equal(f.storage.size, 0);
});

test('initial receipt failure and unverified receipt prevent all providers; terminal write loss is recovered as uncertainty only', async () => {
  const f = await exactFixture();
  await assert.rejects(runExactInputQualification(actorId, f.plan.plan_sha256!, invocation, f.env, { ...f.deps, writeReceipt: async () => { throw Error('storage failure'); } }));
  assert.equal(f.requests.length, 0);
  await assert.rejects(runExactInputQualification(actorId, f.plan.plan_sha256!, invocation, f.env, { ...f.deps, writeReceipt: async (key, bytes, signal) => {
    if (key.endsWith('/terminal.json')) throw Error('storage uncertain'); await f.deps.writeReceipt(key, bytes, signal);
  } }));
  const before = f.requests.length, receipt = await recoverExactInputQualification(actorId, f.plan.plan_sha256!, invocation, f.deps);
  assert.equal(receipt.status, 'uncertain'); assert.ok(before > 0);
  assert.equal((await runExactInputQualification(actorId, f.plan.plan_sha256!, invocation, f.env, f.deps)).status, 'uncertain'); assert.equal(f.requests.length, before);
});

test('source revision changes during work are marked stale without changing any business record', async () => {
  const f = await exactFixture(), original = f.deps.fetchImpl;
  f.deps.fetchImpl = (async (url, init) => { const response = await original(url, init); if (String(url).includes('openai.com')) f.row.status = 'superseded'; return response; }) as typeof fetch;
  const receipt = await runExactInputQualification(actorId, f.plan.plan_sha256!, invocation, f.env, f.deps);
  assert.equal(receipt.status, 'stale_input'); assert.equal(receipt.summary!.stale_input, true); assert.equal(f.storage.size, 2);
});

test('hard transcript/credential/redirect violations stop subsequent admission and fail evidence', async () => {
  for (const failure of ['transcript', 'escaped-secret', 'header-secret', 'redirect'] as const) {
    const f = await exactFixture(); let dispatched = 0;
    const control = new AbortController(), query = 'https://api.sold-comps.com/v1/scrape?keyword=example&ebaySite=ebay.com&count=240&page=1&sold=true&includeCompleteListing=true&exactMatch=true&hydrateBoa=true';
    const transport = exactInputQualificationTransport(f.plan.plan!, [], f.env, { now: f.deps.now, fetchImpl: (async () => {
      dispatched++; if (failure === 'redirect') return new Response('', { status: 302 });
      if (failure === 'header-secret') return Response.json({}, { headers: { 'content-type': `application/json; note=${f.env.SOLDCOMPS_API_KEY}` } });
      if (failure === 'escaped-secret') return new Response(JSON.stringify({ value: f.env.OPENAI_API_KEY }).replace('fixture', '\\u0066ixture'), { headers: { 'content-type': 'application/json' } });
      return Response.json({ value: 'x'.repeat(4.5 * 1024 * 1024) });
    }) as typeof fetch }, control.signal);
    const init = { method: 'GET', headers: { Authorization: `Bearer ${f.env.SOLDCOMPS_API_KEY}` }, redirect: 'error' as const, cache: 'no-store' as const, signal: control.signal };
    if (failure === 'transcript') await transport.fetchImpl(query, init);
    await assert.rejects(transport.fetchImpl(query, init));
    const before = dispatched; await assert.rejects(transport.fetchImpl(query, init)); assert.equal(dispatched, before);
    const tape = transport.finish(); assert.ok(tape.violations.length); assert.equal(tape.calls.at(-1)!.outcome, 'failed');
    assert.equal(JSON.stringify(tape).includes(f.env.SOLDCOMPS_API_KEY), false);
  }
});

test('dispatch cap and configured cost reservation count failed/uncertain requests; no fabricated bill', async () => {
  const f = await exactFixture(), signal = new AbortController().signal;
  const query = 'https://api.sold-comps.com/v1/scrape?keyword=example&ebaySite=ebay.com&count=240&page=1&sold=true&includeCompleteListing=true&exactMatch=true&hydrateBoa=true';
  const init = { method: 'GET', headers: { Authorization: `Bearer ${f.env.SOLDCOMPS_API_KEY}` }, redirect: 'error' as const, cache: 'no-store' as const, signal };
  let dispatches = 0;
  const transport = exactInputQualificationTransport(f.plan.plan!, [], f.env, { now: f.deps.now, fetchImpl: (async () => { dispatches++; throw Error('network uncertain'); }) as typeof fetch }, signal);
  for (let i = 0; i < 4; i++) await assert.rejects(transport.fetchImpl(query, init));
  assert.equal(dispatches, 3); assert.equal(transport.finish().counts.search, 3);
  const configured = structuredClone(f.plan.plan!); configured.config.billing = { currency: 'USD', maximum_total_microusd: 10, maximum_per_dispatch_microusd: { search: 10, detail: 10, model: 10, image: 0 }, basis: 'Synthetic verified account bound', basis_sha256: 'c'.repeat(64) }; configured.cost_status = 'configured_upper_bounds';
  const budget = exactInputQualificationTransport(configured, [], f.env, { now: f.deps.now, fetchImpl: (async () => { throw Error('unknown bill'); }) as typeof fetch }, signal);
  await assert.rejects(budget.fetchImpl(query, init)); await assert.rejects(budget.fetchImpl(query, init));
  const tape = budget.finish(); assert.equal(tape.counts.search, 1); assert.equal(tape.cost.reserved_microusd, '10'); assert.equal(tape.cost.actual_billed_cost, null); assert.ok(tape.violations.includes('configured_cost_cap'));
});

test('near-limit private evidence recovers a bounded summary and private URL; signing failure preserves receipt truth', async () => {
  const f = await exactFixture(); await runExactInputQualification(actorId, f.plan.plan_sha256!, invocation, f.env, f.deps);
  const [key, raw] = [...f.storage.entries()].find(([key]) => key.endsWith('/terminal.json'))!, payload = JSON.parse(raw.toString()).payload;
  payload.large_retained_evidence = 'x'.repeat(EXACT_INPUT_LIMITS.bundle_bytes - raw.length - 4096);
  const big = Buffer.from(canonical({ schema_version: 1, payload_sha256: inventoryHash(payload), payload })); f.storage.set(key, big);
  assert.ok(big.length > 47 * 1024 * 1024 && big.length <= EXACT_INPUT_LIMITS.bundle_bytes);
  const receipt = await recoverExactInputQualification(actorId, f.plan.plan_sha256!, invocation, f.deps);
  assert.ok(JSON.stringify(receipt).length < 768 * 1024); assert.match(receipt.download_url!, /expires=60/);
  const unsigned = await recoverExactInputQualification(actorId, f.plan.plan_sha256!, invocation, { ...f.deps, signReceipt: async () => { throw Error('temporary unavailable'); } });
  assert.equal(unsigned.status, 'completed'); assert.equal(unsigned.download_url, null); assert.match(unsigned.message, /exists/);
  payload.actor_sha256 = '0'.repeat(64); f.storage.set(key, Buffer.from(canonical({ schema_version: 1, payload_sha256: inventoryHash(payload), payload })));
  await assert.rejects(recoverExactInputQualification(actorId, f.plan.plan_sha256!, invocation, f.deps));
});

test('independent detail/model/image dispatch ceilings reject the first excess call before network', async () => {
  const f = await exactFixture(), originals = [0, 1].map(index => ({ key: f.key(index), sha256: sha(f.bytes[index]), bytes: f.bytes[index] }));
  for (const kind of ['detail', 'model', 'image'] as const) {
    let sent = 0; const signal = new AbortController().signal;
    const urls = Array.from({ length: 13 }, (_, i) => `https://i.ebayimg.com/images/g/cap${i}/s-l400.jpg`);
    const transport = exactInputQualificationTransport(f.plan.plan!, originals, f.env, { now: f.deps.now, fetchImpl: (async url => {
      if (String(url).includes('/scrape?')) return Response.json({ items: urls.map(thumbnailUrl => ({ thumbnailUrl })) });
      sent++; return kind === 'image' ? new Response(new Uint8Array(f.bytes[2]), { headers: { 'content-type': 'image/jpeg' } }) : Response.json({ model: 'gpt-6-astra', usage: { input_tokens: 1 } });
    }) as typeof fetch }, signal);
    if (kind === 'image') await transport.fetchImpl('https://api.sold-comps.com/v1/scrape?keyword=example&ebaySite=ebay.com&count=240&page=1&sold=true&includeCompleteListing=true&exactMatch=true&hydrateBoa=true', {
      method: 'GET', headers: { Authorization: `Bearer ${f.env.SOLDCOMPS_API_KEY}` }, redirect: 'error', cache: 'no-store', signal });
    const perform = (index: number) => transport.fetchImpl(kind === 'image' ? urls[index] : kind === 'detail' ? `https://api.sold-comps.com/v1/item/${900000000000 + index}?ebaySite=ebay.com` : 'https://api.openai.com/v1/responses', {
      method: kind === 'model' ? 'POST' : 'GET', headers: kind === 'image' ? {} : { Authorization: `Bearer ${kind === 'model' ? f.env.OPENAI_API_KEY : f.env.SOLDCOMPS_API_KEY}` }, redirect: 'error', cache: 'no-store', signal,
      ...(kind === 'model' ? { body: JSON.stringify({ model: 'gpt-6-astra', store: false, reasoning: { effort: 'medium' }, max_output_tokens: 6500,
        input: [{ role: 'user', content: originals.map(photo => ({ type: 'input_image', image_url: `data:image/jpeg;base64,${photo.bytes.toString('base64')}`, detail: 'high' })) }] }) } : {}),
    });
    for (let i = 0; i < EXACT_INPUT_LIMITS[kind]; i++) await perform(i);
    await assert.rejects(perform(EXACT_INPUT_LIMITS[kind])); assert.equal(sent, EXACT_INPUT_LIMITS[kind]);
    assert.ok(transport.finish().violations.includes('dispatch_cap'));
  }
});

test('client disconnect stops new paid dispatch while a private failure receipt remains recoverable', async () => {
  const f = await exactFixture(), disconnected = new AbortController(), original = f.deps.fetchImpl;
  f.deps.fetchImpl = (async (url, init) => { const response = await original(url, init); disconnected.abort(); return response; }) as typeof fetch;
  const receipt = await runExactInputQualification(actorId, f.plan.plan_sha256!, invocation, f.env, f.deps, disconnected.signal);
  assert.equal(receipt.status, 'failed'); assert.equal(f.requests.length, 1); assert.equal(f.storage.size, 2);
  const before = f.requests.length; await recoverExactInputQualification(actorId, f.plan.plan_sha256!, invocation, f.deps); assert.equal(f.requests.length, before);
});

test('parent deadline propagates into nested plan and receipt read signals, with no delayed dispatch', async () => {
  const f = await exactFixture();
  for (const stage of ['plan', 'receipt'] as const) {
    const parent = new AbortController(); let stopped = false;
    const hang = (signal: AbortSignal) => new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => { stopped = true; reject(Error('owned stream stopped')); }, { once: true }));
    const task = stage === 'plan'
      ? exactInputQualificationPlan(f.env, { ...f.deps, readReferences: (_description, signal) => hang(signal) }, parent.signal)
      : recoverExactInputQualification(actorId, f.plan.plan_sha256!, invocation, { ...f.deps, readReceipt: (_key, _max, signal) => hang(signal) }, parent.signal);
    const timer = setTimeout(() => parent.abort(), 5);
    try { await assert.rejects(task); assert.equal(stopped, true); assert.equal(f.requests.length, 0); } finally { clearTimeout(timer); }
  }
});
