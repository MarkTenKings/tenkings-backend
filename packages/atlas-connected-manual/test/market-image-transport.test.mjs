import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import sharp from 'sharp';
import { digest, requireThat } from '@atlas/manual-service/contract';
import { createFrontendManualRuntime } from '../../../frontend/atlas-app/lib/server/manual-frontend-runtime.mjs';
import { createPrivateManualServer } from '../scripts/private-server.mjs';
import { createPresentationMarketService } from '../src/presentation-market-service.mjs';
import { marketPreviewHash } from '../src/presentation-market.mjs';
import { createManualServiceProxy, MANUAL_TRANSPORT_LIMITS } from '../src/transport.mjs';

const cardId = '11111111-1111-4111-8111-111111111111';
const previewId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const origin = 'https://atlasgrading.com', privateOrigin = 'https://native.atlasgrading.com';
const key = Buffer.alloc(32, 81), staff = Object.freeze({ id: otherId });
const marketPath = `/api/staff/manual-connected/cards/${cardId}/presentation/market`;
const imagePath = sha => `${marketPath}?preview=${previewId}&image=${sha}`;
const request = (url, cookie = 'fixture-staff') => ({ method: 'GET', url, headers: { cookie } });
function response() {
  return { headers: {}, statusCode: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    send(value) { this.bytes = Buffer.from(value); return this; },
    json(value) { this.value = value; this.bytes = Buffer.from(JSON.stringify(value)); return this; } };
}
function assertError(res, status, error) {
  assert.equal(res.statusCode, status);
  assert.deepEqual(JSON.parse(res.bytes), { error });
  assert.equal(res.headers['cache-control'], 'private, no-store');
}
async function fixture(t, { format = 'png' } = {}) {
  const bytes = await sharp({ create: { width: 3, height: 5, channels: 3,
    background: { r: 25, g: 100, b: 210 } } }).toFormat(format).toBuffer();
  const sha = digest(bytes), imageUrl = 'https://i.ebayimg.com/images/g/fixture/s-l1600.jpg';
  const preview = { version: 'atlas-market-preview-v2', candidates: [{ slabReading: { sha256: sha, imageUrl } }] };
  const counters = { ingress: 0, frontendAuth: 0, nativeAuth: 0, dispatches: 0, savedReads: 0, photoReads: 0 };
  const state = { allowed: true, corruptPhoto: false, corruptPreview: false, revokeOnPhoto: false,
    nativeCookie: 'fixture-staff', tamperQuery: false };
  const market = createPresentationMarketService({
    repository: {
      async latestMarket(actor, card) {
        assert.equal(actor, staff); requireThat(card === cardId && state.allowed, 404, 'MARKET_PREVIEW_NOT_FOUND');
        return previewId;
      },
      async market(actor, card, id) {
        counters.savedReads++; assert.equal(actor, staff);
        requireThat(state.allowed && card === cardId && id === previewId, 404, 'MARKET_PREVIEW_NOT_FOUND');
        return { state: 'READY', input: { approvalActionId: otherId }, saved: {
          state: 'READY', ref: { kind: 'MARKET_PREVIEW' }, artifactHash: digest(JSON.stringify(preview)),
          sourceHash: marketPreviewHash(preview) } };
      },
    },
    artifacts: { async read(_ref, binding) {
      assert.equal(binding.cardId, cardId); assert.equal(binding.kind, 'MARKET_PREVIEW');
      return state.corruptPreview ? { ...preview, candidates: [] } : preview;
    } },
    async readPhoto(url, hash) {
      counters.photoReads++; assert.equal(url, imageUrl); assert.equal(hash, sha);
      if (state.revokeOnPhoto) state.allowed = false;
      return { bytes: state.corruptPhoto ? Buffer.from('different bytes') : bytes, mimeType: `image/${format}` };
    },
    provider: { search() { assert.fail('Photo reads must not search or call a provider'); } },
  });
  const server = createPrivateManualServer({ origin, key, connected: { workflow: {}, intake: {}, market },
    boundary: { async authenticate(cookie) {
      counters.nativeAuth++; requireThat(cookie === state.nativeCookie, 401, 'SIGN_IN_REQUIRED'); return staff;
    } },
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const local = `http://127.0.0.1:${server.address().port}`;
  const frontend = createFrontendManualRuntime({
    env: { ATLAS_MANUAL_ENABLED: 'true', ATLAS_MANUAL_SERVICE_ORIGIN: privateOrigin,
      ATLAS_MANUAL_UPLOAD_ORIGIN: 'https://uploads.example.test', ATLAS_MANUAL_SERVICE_KEY: key.toString('base64') },
    staffConfig: { origin, sessionKey: Buffer.alloc(32, 1), phoneKey: Buffer.alloc(32, 2), routerKey: Buffer.alloc(32, 3) },
    async assertRequest(req) { counters.ingress++; assert.ok(req.url.startsWith('/admin/')); },
    auth: { async authenticate(cookie) {
      counters.frontendAuth++; requireThat(cookie === 'fixture-staff', 401, 'SIGN_IN_REQUIRED'); return staff;
    } },
    fetchImpl(url, init) {
      counters.dispatches++; assert.equal(init.redirect, 'manual');
      const target = new URL(url); assert.equal(target.origin, privateOrigin);
      if (state.tamperQuery) target.searchParams.set('image', 'b'.repeat(64));
      return fetch(local + target.pathname + target.search, init);
    },
  });
  async function read(path = imagePath(sha), cookie) {
    const res = response(); assert.equal(await frontend.handler(request(`/admin${path}`, cookie), res), true); return res;
  }
  return { bytes, sha, preview, counters, state, read, local };
}

for (const format of ['jpeg', 'png', 'webp']) test(`retained ${format} crosses frontend, signed private host and saved-photo service with exact decodable bytes`, async t => {
  const f = await fixture(t, { format });
  // Thumbnail and enlargement use the same retained photograph, including when
  // the equivalent query is presented in the opposite parameter order.
  for (const path of [imagePath(f.sha), `${marketPath}?image=${f.sha}&preview=${previewId}`]) {
    const res = await f.read(path);
    assert.equal(res.statusCode, 200); assert.deepEqual(res.bytes, f.bytes);
    assert.equal(digest(res.bytes), f.sha); assert.equal(res.headers['content-type'], `image/${format}`);
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['content-security-policy'], "default-src 'none'; sandbox");
    const metadata = await sharp(res.bytes).metadata();
    assert.equal(metadata.format, format); assert.equal(metadata.width, 3); assert.equal(metadata.height, 5);
  }
  assert.deepEqual(f.counters, { ingress: 2, frontendAuth: 2, nativeAuth: 2, dispatches: 2, savedReads: 6, photoReads: 2 });
});

test('retained-photo transport preserves status JSON, independent authentication and signed query binding', async t => {
  const f = await fixture(t);
  const status = await f.read(marketPath);
  assert.equal(status.statusCode, 200); assert.match(status.headers['content-type'], /^application\/json/);
  assert.equal(JSON.parse(status.bytes).state, 'READY'); assert.equal(f.counters.photoReads, 0);
  await assert.rejects(f.read(imagePath(f.sha), 'forged'), { code: 'SIGN_IN_REQUIRED' });
  assert.equal(f.counters.dispatches, 1);
  f.state.nativeCookie = 'revoked';
  assertError(await f.read(), 401, 'SIGN_IN_REQUIRED'); assert.equal(f.counters.photoReads, 0);
  f.state.nativeCookie = 'fixture-staff'; f.state.tamperQuery = true;
  const authBefore = f.counters.nativeAuth;
  assertError(await f.read(), 401, 'MANUAL_PRIVATE_SIGNATURE_INVALID');
  assert.equal(f.counters.nativeAuth, authBefore);
  const unsigned = await fetch(f.local + imagePath(f.sha), { headers: { cookie: 'fixture-staff' } });
  assert.equal(unsigned.status, 401); assert.deepEqual(await unsigned.json(), { error: 'MANUAL_PRIVATE_SIGNATURE_REQUIRED' });
  assert.equal(f.counters.photoReads, 0);
});

test('saved preview ownership, retained candidate membership, artifact and photograph hashes remain authoritative', async t => {
  const f = await fixture(t);
  assertError(await f.read(imagePath(f.sha).replace(cardId, otherId)), 404, 'MARKET_PREVIEW_NOT_FOUND');
  assertError(await f.read(imagePath(f.sha).replace(previewId, otherId)), 404, 'MARKET_PREVIEW_NOT_FOUND');
  assertError(await f.read(imagePath('b'.repeat(64))), 404, 'MARKET_IMAGE_NOT_FOUND');
  assert.equal(f.counters.photoReads, 0);
  f.state.corruptPreview = true;
  assertError(await f.read(), 503, 'MARKET_PREVIEW_CORRUPT'); assert.equal(f.counters.photoReads, 0);
  f.state.corruptPreview = false; f.state.corruptPhoto = true;
  assertError(await f.read(), 503, 'MARKET_IMAGE_CORRUPT');
  f.state.corruptPhoto = false; f.state.revokeOnPhoto = true;
  assertError(await f.read(), 404, 'MARKET_PREVIEW_NOT_FOUND');
  assert.equal(f.counters.photoReads, 2);
});

test('only the exact market photograph path and UUID/digest query can receive raster bytes from the proxy', async () => {
  const hash = 'a'.repeat(64), path = imagePath(hash);
  const malformed = [marketPath, `${marketPath}?preview=${previewId}`, `${marketPath}?image=${hash}`,
    `${path}&extra=1`, `${path}&preview=${previewId}`, `${path}&image=${hash}`, `${path}&`,
    path.replace(previewId, 'invalid'), path.replace(previewId, previewId.replace('-4', '-5')),
    path.replace(hash, 'a'.repeat(63)), path.replace(hash, 'A'.repeat(64)), path.replace(cardId, 'not-a-card'),
    path.replace('/market?', '/market/search?'), path.replace('/market?', '/market/select?'),
    path.replace('/market?', '/market/other?'), path.replace('/manual-connected/', '/manual/'),
    path.replace('/presentation/market', '/presentation'), path.replace('preview=', 'preview=%2F'),
  ];
  const proxy = createManualServiceProxy({ origin: privateOrigin, key,
    fetchImpl: async () => new Response(Buffer.from('raster must not escape this route'), { headers: { 'content-type': 'image/jpeg' } }) });
  for (const bad of malformed) {
    const res = response(); assert.equal(await proxy(request(bad), res), true, bad);
    assertError(res, 502, 'MANUAL_SERVICE_RESPONSE_INVALID');
  }
  for (const bad of [path.replace('/market?', '/market/../market?'), `${path}#fragment`, path.replace('/market?', '/market%2f?')]) {
    const res = response(); assert.equal(await proxy(request(bad), res), false, bad); assert.equal(res.bytes, undefined);
  }
});

test('native market handler refuses malformed query combinations without reading photographs', async t => {
  const f = await fixture(t), path = imagePath(f.sha);
  for (const bad of [`${path}&extra=1`, `${path}&image=${f.sha}`, `${path}&preview=${previewId}`,
    `${marketPath}?image=${f.sha}`, `${marketPath}?preview=${previewId}`, path.replace(f.sha, 'invalid'),
    path.replace('/market?', '/market/search?')]) {
    assertError(await f.read(bad), 405, 'METHOD_NOT_ALLOWED');
  }
  assertError(await f.read(path.replace(previewId, 'invalid')), 400, 'MANUAL_REQUEST_INVALID');
  assert.equal(f.counters.photoReads, 0);
});

test('market raster responses retain MIME restrictions and both declared and streamed byte limits', async () => {
  const run = async upstream => {
    const res = response();
    const proxy = createManualServiceProxy({ origin: privateOrigin, key, fetchImpl: async () => upstream });
    await proxy(request(imagePath('a'.repeat(64))), res); return res;
  };
  for (const mime of ['image/svg+xml', 'image/gif', 'image/avif', 'image/jpeg; charset=utf-8', 'text/html', 'application/octet-stream']) {
    assertError(await run(new Response('unsupported', { headers: { 'content-type': mime } })), 502, 'MANUAL_SERVICE_RESPONSE_INVALID');
  }
  const limit = MANUAL_TRANSPORT_LIMITS.imageResponseBytes;
  const allowed = Buffer.alloc(limit), valid = await run(new Response(allowed, { headers: { 'content-type': 'image/png' } }));
  assert.equal(valid.statusCode, 200); assert.deepEqual(valid.bytes, allowed);
  assertError(await run(new Response('small', { headers: { 'content-type': 'image/png', 'content-length': String(limit + 1) } })),
    413, 'MANUAL_IMAGE_DIRECT_REQUIRED');
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(limit)); controller.enqueue(new Uint8Array(1));
  }, cancel() { cancelled = true; } });
  assertError(await run(new Response(stream, { headers: { 'content-type': 'image/png' } })), 413, 'MANUAL_IMAGE_DIRECT_REQUIRED');
  assert.equal(cancelled, true);
  assertError(await run(Response.json({ error: 'MARKET_IMAGE_NOT_FOUND' }, { status: 404 })), 404, 'MARKET_IMAGE_NOT_FOUND');
});
