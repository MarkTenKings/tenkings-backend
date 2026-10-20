import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createPublicImageAccessLoader } from '../components/public-image-access.mjs';
import { createManualPublicHandler } from '../../../packages/atlas-connected-manual/src/publication-reader.mjs';
import { manualPublicClient, MANUAL_PUBLIC_ORIGIN } from '../../../packages/atlas-service-bridge/src/manual-public.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const options = (signal = new AbortController().signal, priority = 0) => ({ signal, priority, parse: value => value });
const ok = value => ({ ok: true, status: 200, json: async () => value });

test('actual native two-reader gate rejects four parallel grants, while the shared loader admits them without a refusal', async t => {
  const key = Buffer.alloc(32, 17); let active = 0, peak = 0, refused = 0;
  const handler = createManualPublicHandler({ key, reader: { async read(claims) {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 20)); active--;
    return { contentType: 'application/json', bytes: Buffer.from(JSON.stringify({ token: claims.request.token })) };
  } } });
  const server = createServer((req, res) => { void handler(req, res); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const client = manualPublicClient({ manualOrigin: MANUAL_PUBLIC_ORIGIN, manualKey: key, deploymentId: 'fixture.vercel.app',
    releaseSha: 'a'.repeat(40), configHash: 'b'.repeat(64) }, (_url, init) => new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: server.address().port, path: '/api/internal/atlas/manual-public', method: 'POST',
        signal: init.signal, headers: { ...init.headers, host: 'private.atlasgrading.com' } }, res => {
        const parts = []; res.on('data', part => parts.push(part)); res.on('error', reject);
        res.on('end', () => { if (res.statusCode === 503) refused++;
          resolve(new Response(Buffer.concat(parts), { status: res.statusCode, headers: res.headers })); });
      }); req.on('error', reject); req.end(init.body);
    }));
  const fetchGrant = async token => {
    try { const value = await client.read({ kind: 'IMAGE_ACCESS', token, version: 1, side: 'FRONT', findingId: null }); return ok(value); }
    catch { return { ok: false, status: 503 }; }
  };
  const tokens = ['A', 'B', 'C', 'D'].map(value => 'ar_' + value.repeat(24));
  const old = await Promise.all(tokens.map(fetchGrant));
  assert.equal(old.filter(value => value.status === 503).length, 2); assert.equal(peak, 2);
  refused = 0;
  const load = createPublicImageAccessLoader({ fetchImpl: fetchGrant, retryDelays: [] });
  const current = await Promise.all(tokens.map(token => load(token, options())));
  assert.deepEqual(current.map(value => value.token), tokens); assert.equal(refused, 0); assert.equal(peak, 2);
});

test('mounted callers share two slots and pending canonical requests precede optional requests', async () => {
  const requests = [], waits = new Map(); let active = 0, peak = 0;
  const load = createPublicImageAccessLoader({ fetchImpl: url => {
    requests.push(url); active++; peak = Math.max(peak, active);
    const wait = deferred(); waits.set(url, wait);
    return wait.promise.then(() => { active--; return ok(url); });
  } });
  const work = [load('optional-A', options(undefined, 1)), load('canonical-A', options()),
    load('optional-B', options(undefined, 1)), load('canonical-B', options()), load('canonical-C', options())];
  await flush(); assert.deepEqual(requests, ['canonical-A', 'canonical-B']);
  waits.get('canonical-A').resolve(); await flush(); assert.deepEqual(requests, ['canonical-A', 'canonical-B', 'canonical-C']);
  waits.get('canonical-B').resolve(); waits.get('canonical-C').resolve(); await flush();
  assert.deepEqual(requests.slice(3), ['optional-A', 'optional-B']);
  waits.get('optional-A').resolve(); waits.get('optional-B').resolve(); await Promise.all(work); assert.equal(peak, 2);
});

test('503 retries are finite and fresh, and terminal statuses, network failures and malformed grants never retry', async () => {
  let calls = 0, cancelled = 0;
  const load = createPublicImageAccessLoader({ retryDelays: [0, 0], fetchImpl: async (_url, init) => {
    assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    calls++; return calls === 1 ? { status: 503, body: { cancel() { cancelled++; } } } : ok({ grant: calls });
  } });
  assert.deepEqual(await load('/grant?v=2', options()), { grant: 2 });
  assert.deepEqual(await load('/grant?v=2', options()), { grant: 3 }); assert.equal(cancelled, 1);
  assert.deepEqual(await load('/grant?v=2', { parse: value => value }), { grant: 4 });
  for (const status of [401, 403, 404, 409, 429, 500, 502]) {
    let count = 0;
    const terminal = createPublicImageAccessLoader({ retryDelays: [0, 0], fetchImpl: async () => { count++; return { status, ok: false }; } });
    await assert.rejects(terminal('/grant', options()), /IMAGE_ACCESS_UNAVAILABLE/); assert.equal(count, 1);
  }
  for (const malformed of [false, true]) {
    let count = 0;
    const terminal = createPublicImageAccessLoader({ fetchImpl: async () => { count++; if (!malformed) throw new TypeError('network'); return ok({}); } });
    await assert.rejects(terminal('/grant', { ...options(), parse() { throw new Error('INSPECTION_ACCESS_INVALID'); } })); assert.equal(count, 1);
  }
  let busyCalls = 0;
  const busy = createPublicImageAccessLoader({ retryDelays: [0, 0], fetchImpl: async () => { busyCalls++; return { status: 503, ok: false }; } });
  await assert.rejects(busy('/grant', options()), /IMAGE_ACCESS_UNAVAILABLE/); assert.equal(busyCalls, 3);
});

test('one deadline covers queue and backoff; abort removes queued work and late JSON cannot publish', async () => {
  let calls = 0;
  const timeout = createPublicImageAccessLoader({ timeoutMs: 15, retryDelays: [100, 100], fetchImpl: async () => { calls++; return { status: 503 }; } });
  await assert.rejects(timeout('/busy', options()), /IMAGE_ACCESS_TIMEOUT/); assert.equal(calls, 1);
  const waits = [], starts = [];
  const load = createPublicImageAccessLoader({ fetchImpl: async url => { starts.push(url); const wait = deferred(); waits.push(wait); return { ...ok(), json: () => wait.promise }; } });
  const first = load('/first', options()), second = load('/second', options()); await flush();
  const controller = new AbortController(), queued = load('/cancelled', options(controller.signal));
  controller.abort(); await assert.rejects(queued); await flush(); assert.deepEqual(starts, ['/first', '/second']);
  waits[0].resolve('first'); waits[1].resolve('second'); await Promise.all([first, second]);
  const late = deferred(), pending = createPublicImageAccessLoader({ timeoutMs: 10, fetchImpl: async () => ({ ...ok(), json: () => late.promise }) });
  const result = pending('/late', options());
  await new Promise(resolve => setTimeout(resolve, 20)); late.resolve('must not publish');
  await assert.rejects(result, /IMAGE_ACCESS_TIMEOUT/);
  const backoff = new AbortController(); let retries = 0;
  const retry = createPublicImageAccessLoader({ retryDelays: [100, 100], fetchImpl: async () => { retries++; return { status: 503 }; } });
  const cancelled = retry('/busy', options(backoff.signal)); await flush(); backoff.abort(); await assert.rejects(cancelled); assert.equal(retries, 1);
});
