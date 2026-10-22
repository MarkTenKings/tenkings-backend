import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical } from '@atlas/manual-service/contract';
import { createNativeCompCurationRuntime } from '../src/comp-curation-runtime.mjs';
import { nativeCompRuntimeFixture as fixture, deferred, response } from './fixtures/comp-curation-runtime-fixture.mjs';

test('absent flag is inert; enabled runtime rejects fallback, broad capabilities and invalid role/database/key inputs', async t => {
  assert.equal(createNativeCompCurationRuntime(), null);
  assert.equal(createNativeCompCurationRuntime(new Proxy({}, { get(_target, key) { assert.equal(key, 'enabled'); return false; } })), null);
  const f = await fixture(); t.after(() => f.runtime.close());
  for (const change of [o => { o.auth = {}; }, o => { o.environment.VERCEL = '1'; }, o => { o.policy = {}; },
    o => { o.settings.role = 'public'; }, o => { o.settings.role = o.settings.schemaOwner; },
    o => { o.settings.databaseUrl = o.staffConfig.databaseUrl; }, o => { o.settings.databaseUrl = o.settings.databaseUrl.replace('/synthetic?', '/other?'); },
    o => { o.settings.schemaSha256 = null; }, o => { o.settings.transportKey = o.staffConfig.sessionKey; },
    o => { o.artifactReader.write = () => {}; }, o => { o.nonceStore = null; }]) {
    const options = { ...f.options, environment: {}, settings: { ...f.options.settings }, artifactReader: { ...f.options.artifactReader } };
    change(options); assert.throws(() => createNativeCompCurationRuntime(options), { code: 'COMP_NOT_CONFIGURED' });
  }
  assert.equal(f.counts.create, 0); assert.equal(f.counts.auth, 0); assert.equal(f.runtime.configuredForDisplay, true);
});

test('actual auth, restricted wrapper, approval/intake and signed service read/Skip/No suitable retain exact saved sources', async t => {
  const f = await fixture(); t.after(() => f.runtime.close());
  const before = canonical({ row: f.row, packet: f.packet, market: f.market, preview: f.preview });
  const read = await f.request(); assert.equal(read.statusCode, 200); assert.equal(read.body.result.policy, null);
  for (const outcome of ['SKIP', 'NO_SUITABLE_COMPS']) {
    const input = f.decision(outcome), result = await f.request(input); assert.equal(result.statusCode, 200);
    assert.equal(result.body.result.outcome, outcome); assert.equal(result.body.result.guidance, null);
    assert.deepEqual((await f.request(input)).body, result.body);
  }
  assert.equal(f.rows.length, 2); assert.equal(f.counts.create, 1);
  assert.equal(canonical({ row: f.row, packet: f.packet, market: f.market, preview: f.preview }), before);
  assert(f.trace.filter(sql => sql.includes('comp-db:role')).length >= f.counts.transaction * 2);
  assert.equal((await f.request(f.input())).statusCode, 409); assert.equal(f.rows.length, 2);
});

test('signature, nonce and current staff refusal precede any restricted client creation', async t => {
  const f = await fixture(); t.after(() => f.runtime.close());
  // Corrupt every actual signature header without guessing its protocol name.
  f.hooks.beforeNative = req => { for (const key of Object.keys(req.headers)) if (/signature|proof/.test(key)) req.headers[key] = 'bad'; };
  assert.notEqual((await f.request()).statusCode, 200); assert.equal(f.counts.create, 0);
  delete f.hooks.beforeNative; f.state.expired = true;
  assert.equal((await f.request()).statusCode, 401); assert.equal(f.counts.create, 0);
  f.state.expired = false; const original = f.rawRequests.at(-1), replay = response();
  await f.runtime.handler(original, replay); assert.notEqual(replay.statusCode, 200); assert.equal(f.counts.create, 0);
});

test('role/schema, current publication, intake tombstone and exact artifact checks never fall back or write', async () => {
  for (const change of [f => { f.data.role[0].unsafe = true; }, f => { f.data.schema[0].columns.push({ name: 'drift' }); },
    f => { f.row.state = 'PENDING'; }, f => { f.state.discarded = true; }, f => { f.packet.reportHash = 'f'.repeat(64); }]) {
    const f = await fixture(); change(f); assert.notEqual((await f.request(f.decision())).statusCode, 200);
    assert.equal(f.rows.length, 0); assert.equal(f.counts.create, 1); await f.runtime.close(); assert.equal(f.counts.disconnect, 1);
  }
});

test('observed artifact wait fences configuration/capability/authority drift before decision', async () => {
  for (const change of [f => { f.options.enabled = false; }, f => { f.config.routerKey[0] ^= 1; },
    f => { f.options.artifactReader.read = async () => f.packet; }, f => { f.auth.database = {}; },
    f => { f.owned.$transaction = async () => {}; }, f => { f.state.expired = true; }, f => { f.card.approvers = []; f.card.owner_id = randomUUID(); }]) {
    const f = await fixture(), entered = deferred(), resume = deferred();
    f.hooks.artifact = async () => { entered.resolve(); await resume.promise; };
    const work = f.request(f.decision()); await entered.promise; change(f); resume.resolve();
    assert.notEqual((await work).statusCode, 200); assert.equal(f.rows.length, 0); await f.runtime.close();
  }
});

test('close rejects new work, drains accepted work, and disconnects owned client once without closing shared auth', async () => {
  const f = await fixture(), entered = deferred(), resume = deferred();
  f.hooks.artifact = async () => { entered.resolve(); await resume.promise; };
  const first = f.request(f.decision()); await entered.promise;
  let done = false; const close = f.runtime.close().then(() => { done = true; });
  assert.equal(f.runtime.configuredForDisplay, false); assert.equal((await f.request()).statusCode, 503);
  assert.equal(done, false); assert.equal(f.counts.disconnect, 0);
  resume.resolve(); assert.equal((await first).statusCode, 200); await close; await f.runtime.close();
  assert.equal(f.rows.length, 1); assert.equal(f.counts.disconnect, 1); assert(f.auth.database.client);
});

test('two-request bound shares one initialization; failed construction is retained and never retried automatically', async () => {
  const f = await fixture(), entered = deferred(), resume = deferred(); let enteredCount = 0;
  f.hooks.artifact = async () => { if (++enteredCount === 2) entered.resolve(); await resume.promise; };
  const first = f.request(), second = f.request(); await entered.promise;
  assert.equal((await f.request()).statusCode, 503); assert.equal(f.counts.create, 1);
  resume.resolve(); assert.equal((await first).statusCode, 200); assert.equal((await second).statusCode, 200); await f.runtime.close();
  const g = await fixture(); g.state.failCreate = true;
  assert.equal((await g.request()).statusCode, 503); assert.equal((await g.request()).statusCode, 503);
  assert.equal(g.counts.create, 1); await g.runtime.close(); assert.equal(g.counts.disconnect, 0);
});

test('failed owned candidate and asynchronous rejection are observed and disposed without touching shared auth', async () => {
  for (const kind of ['invalid', 'async-invalid', 'async-reject', 'staff-client']) {
    const f = await fixture(); await f.runtime.close();
    let created = 0, disposed = 0;
    const invalid = { async $disconnect() { disposed++; } };
    f.auth.database.client.$disconnect = () => assert.fail('Shared staff client must never be disconnected');
    f.options.createClient = () => {
      created++;
      if (kind === 'async-reject') return Promise.reject(Error('Synthetic initializer rejection'));
      if (kind === 'staff-client') return f.auth.database.client;
      return kind === 'async-invalid' ? Promise.resolve(invalid) : invalid;
    };
    const runtime = createNativeCompCurationRuntime(f.options);
    // Retain a freshly signed, previously unconsumed request from the real
    // proxy. The original closed fixture receives it only after interception.
    let req; f.hooks.beforeNative = value => { req = value; throw Error('Capture only'); };
    assert.equal((await f.request()).statusCode, 503);
    const out = response(); await runtime.handler(req, out); assert.equal(out.statusCode, 503);
    assert.equal(runtime.configuredForDisplay, false); assert.equal(created, 1);
    await runtime.close(); await runtime.close();
    assert.equal(disposed, ['invalid', 'async-invalid'].includes(kind) ? 1 : 0);
  }
});

test('close during observed lazy initialization waits for that exact owned client and admits no successor', async () => {
  const f = await fixture(); await f.runtime.close();
  const entered = deferred(), resume = deferred(); let created = 0;
  f.options.createClient = async () => { created++; entered.resolve(); await resume.promise; return f.owned; };
  const runtime = createNativeCompCurationRuntime(f.options);
  let req; f.hooks.beforeNative = value => { req = value; throw Error('Capture only'); };
  assert.equal((await f.request()).statusCode, 503);
  const out = response(), work = runtime.handler(req, out); await entered.promise;
  let done = false; const close = runtime.close().then(() => { done = true; });
  assert.equal(done, false); assert.equal(f.counts.disconnect, 0);
  const refusal = response(); await runtime.handler(req, refusal); assert.equal(refusal.statusCode, 503);
  resume.resolve(); await work; assert.equal(out.statusCode, 200); await close;
  assert.equal(created, 1); assert.equal(f.counts.disconnect, 1);
});

test('unrelated route and idle close create no client, authentication or artifact work', async () => {
  const f = await fixture();
  assert.equal(await f.runtime.handler({ url: '/api/staff/manual-connected/cards/' + f.cardId + '/presentation/market' }, response()), false);
  await f.runtime.close(); await f.runtime.close();
  assert.deepEqual(f.counts, { create: 0, disconnect: 0, auth: 0, artifact: 0, transaction: 0 });
});

test('host origin accessor checks captured environment before and after observed database/artifact waits', async () => {
  for (const wait of ['transaction', 'artifact']) {
    let unchanged = true;
    const f = await fixture({ runtimeFactory(options) {
      const origin = options.settings.origin;
      Object.defineProperty(options.settings, 'origin', { enumerable: true, get() {
        if (!unchanged) throw Object.assign(Error('Captured host configuration changed'), { code: 'COMP_NOT_CONFIGURED', status: 503 });
        return origin;
      } });
      Object.freeze(options.settings);
      return createNativeCompCurationRuntime(options);
    } });
    const entered = deferred(), resume = deferred();
    f.hooks[wait] = async () => { entered.resolve(); await resume.promise; };
    const work = f.request(f.decision()); await entered.promise;
    unchanged = false; resume.resolve();
    assert.notEqual((await work).statusCode, 200); assert.equal(f.rows.length, 0);
    assert.equal(f.runtime.configuredForDisplay, false); await f.runtime.close();
    assert.equal(f.counts.disconnect, 1);
  }
});
