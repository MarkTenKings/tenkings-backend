import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createStaffCardGalleryQueue, readStaffCardGalleryItem, readStaffCardGalleryMetadata, readStaffCardGalleryPreview,
  staffCardGalleryKey, staffCardGalleryPreviewPath, staffCardGalleryScope } from '../lib/staff-card-gallery-client.mjs';
import { galleryFixture, staffId, uuid, deferred, flush } from './staff-card-gallery-fixture.mjs';
const clone = structuredClone;
const response = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status,
  headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store', ...headers } });
const rejects = error => error.code === 'GALLERY_REPLY_INVALID';

function queueFixture() {
  const requests = [], urls = [], revoked = [], views = new Map(); let accessLost = 0;
  const queue = createStaffCardGalleryQueue({ staffId, readCard: (card, options) => { const request = { card, options, ...deferred() }; requests.push(request); return request.promise; },
    createObjectURL: () => { const url = `blob:gallery-${urls.length + 1}`; urls.push(url); return url; }, revokeObjectURL: url => revoked.push(url), onAccessLost: () => accessLost++ });
  return { queue, requests, urls, revoked, views, lost: () => accessLost,
    add(f) { const stop = queue.subscribe(f.card, value => views.set(f.card.cardId, value)); return stop; }, view(f) { return views.get(f.card.cardId); } };
}

test('scope/source keys are bound to staff identity, revision and verified Front upload', () => {
  const f = galleryFixture(), staff = { id: uuid(30), role: 'REVIEWER', mode: 'PRODUCTION' };
  assert.equal(staffCardGalleryScope(staff), `${staff.id}:REVIEWER:PRODUCTION`);
  assert.equal(staffCardGalleryScope({ ...staff, id: 'anonymous' }), null);
  assert.equal(staffCardGalleryScope({ ...staff, role: 'reviewer' }), null);
  assert.notEqual(staffCardGalleryKey(f.card), staffCardGalleryKey({ ...f.card, revision: 5 }));
  const changed = clone(f.card); changed.sides.FRONT.upload.verification.sha256 = 'f'.repeat(64);
  assert.notEqual(staffCardGalleryKey(f.card), staffCardGalleryKey(changed));
  assert.throws(() => staffCardGalleryKey({ ...f.card, sourceHash: undefined }), rejects);
});

test('metadata preserves actual saved status and refuses foreign, stale or invented approval bindings', () => {
  const f = galleryFixture(); assert.deepEqual(readStaffCardGalleryMetadata(f.metadata, f.card, staffId), f.metadata);
  for (const change of [m => { m.cardId = uuid(8); }, m => { m.front.binding.uploadId = uuid(8); }, m => { m.review.approval.sourceHash = 'f'.repeat(64); },
    m => { m.manual.sourceCurrent = false; }, m => { m.review.grade = 10; }, m => { m.title.state = 'MADE_UP'; }, m => { m.front.binding.manualRevision++; }]) {
    const m = clone(f.metadata); change(m); assert.throws(() => readStaffCardGalleryMetadata(m, f.card, staffId), rejects);
  }
  assert.throws(() => readStaffCardGalleryMetadata({ ...f.metadata, intakeRevision: 5 }, f.card, staffId), e => e.status === 409);
  for (const state of ['UNKNOWN', 'SAVED_DRAFT', 'CHANGED_SINCE_APPROVAL', 'PHOTOS_CHANGED']) {
    const m = clone(f.metadata); m.review.state = state; m.review.approval.current = false;
    if (state === 'CHANGED_SINCE_APPROVAL') m.review.approval.sourceHash = 'f'.repeat(64);
    if (state === 'PHOTOS_CHANGED') { m.manual.sourceCurrent = false; m.title = { state: 'UNKNOWN', text: null, source: null }; }
    if (state === 'SAVED_DRAFT' || state === 'UNKNOWN') m.review.approval = null;
    assert.equal(readStaffCardGalleryMetadata(m, f.card, staffId).review.state, state);
  }
});

test('preview requires exact original/manual binding, bounded JPEG/hash and uncropped white display declaration', async () => {
  const f = galleryFixture(), valid = await readStaffCardGalleryPreview(f.preview, f.metadata, f.card, staffId);
  assert.equal(valid.blob.type, 'image/jpeg'); assert.equal(valid.blob.size, f.preview.image.byteCount);
  const path = staffCardGalleryPreviewPath(f.metadata);
  assert.ok(path.startsWith(`/admin/api/staff/manual-connected/cards/${f.card.cardId}/gallery-preview?`));
  assert.deepEqual([...new URL(path, 'https://local.test').searchParams.keys()], ['intakeRevision', 'sourceHash', 'uploadId', 'version', 'originalSha256', 'manualRevision', 'manualContentHash']);
  const noManual = clone(f.metadata); noManual.front.binding.manualRevision = null; noManual.front.binding.manualContentHash = null; noManual.front.binding.sourceHash = null;
  assert.match(staffCardGalleryPreviewPath(noManual), /sourceHash=none.*manualRevision=none&manualContentHash=none$/);
  for (const change of [p => { p.binding.originalSha256 = 'f'.repeat(64); }, p => { p.image.sha256 = 'f'.repeat(64); }, p => { p.image.mime = 'image/svg+xml'; },
    p => { p.image.byteCount++; }, p => { p.image.width = 769; }, p => { p.image.base64 += '\n'; }, p => { p.display.crop = true; },
    p => { p.display.source = 'GENERATED'; }, p => { p.display.background = '#000000'; }, p => { p.binding.manualContentHash = 'f'.repeat(64); },
    p => { p.image.byteCount = 768 * 1024 + 1; }]) {
    const p = clone(f.preview); change(p); await assert.rejects(readStaffCardGalleryPreview(p, f.metadata, f.card, staffId), rejects);
  }
  const p = clone(f.preview), bytes = Buffer.from('not a JPEG'); p.image.base64 = bytes.toString('base64'); p.image.byteCount = bytes.length;
  p.image.sha256 = createHash('sha256').update(bytes).digest('hex'); await assert.rejects(readStaffCardGalleryPreview(p, f.metadata, f.card, staffId), rejects);
});

test('genuine adapter performs only private same-origin GET metadata then exact preview; retry may reuse validated metadata', async () => {
  const f = galleryFixture(), calls = [], published = [];
  const fetchImpl = async (path, options) => { calls.push({ path, options }); return response(calls.length === 1 ? f.metadata : f.preview); };
  assert.deepEqual(await readStaffCardGalleryItem(f.card, { staffId, fetchImpl, onMetadata: value => published.push(value) }), { metadata: f.metadata, preview: f.preview });
  assert.equal(published.length, 1); assert.equal(calls[0].path, `/admin/api/staff/manual-connected/cards/${f.card.cardId}/gallery`);
  assert.equal(calls[1].path, staffCardGalleryPreviewPath(f.metadata));
  for (const { options } of calls) { assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error'); assert.equal(options.body, undefined); }
  calls.length = 0; await readStaffCardGalleryItem(f.card, { staffId, metadata: f.metadata, fetchImpl: async (path, options) => { calls.push({ path, options }); return response(f.preview); } });
  assert.equal(calls.length, 1); assert.equal(calls[0].path, staffCardGalleryPreviewPath(f.metadata));
});

test('adapter refuses cacheable, oversized, malformed and unauthorized replies, preserving abort', async () => {
  const f = galleryFixture();
  for (const result of [() => response(f.metadata, 200, { 'cache-control': 'public, max-age=60' }),
    () => response(f.metadata, 200, { 'content-length': '2097153' }), () => response(f.metadata, 200, { 'content-type': 'text/html' }),
    () => new Response('x'.repeat(2097153), { headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } }),
    () => response({ ...f.metadata, unexpected: true })]) await assert.rejects(readStaffCardGalleryItem(f.card, { staffId, fetchImpl: async () => result() }), rejects);
  for (const status of [401, 403]) await assert.rejects(readStaffCardGalleryItem(f.card, { staffId, fetchImpl: async () => new Response('', { status }) }), e => e.status === status && e.code === 'GALLERY_ACCESS_ENDED');
  const controller = new AbortController(); let inner;
  const pending = readStaffCardGalleryItem(f.card, { staffId, signal: controller.signal, fetchImpl: (_path, { signal }) => { inner = signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } });
  controller.abort(); await assert.rejects(pending); assert.equal(inner.aborted, true);
});

test('queue is lazy, runs at most two visible jobs and publishes metadata before preview', async () => {
  const q = queueFixture(), fs = [1, 2, 3, 4].map(galleryFixture); fs.forEach(f => q.add(f)); assert.equal(q.requests.length, 0);
  fs.forEach(f => q.queue.visible(f.card, true)); assert.equal(q.requests.length, 2);
  q.requests[0].options.onMetadata(fs[0].metadata); assert.equal(q.view(fs[0]).metadata.review.state, 'APPROVED_CURRENT'); assert.equal(q.view(fs[0]).url, null);
  q.queue.visible(fs[2].card, false); q.requests[0].resolve(fs[0]); await flush(); assert.equal(q.requests.length, 3);
  assert.equal(q.requests[2].card.cardId, fs[3].card.cardId); assert.equal(q.view(fs[2]).state, 'IDLE');
  q.requests[1].resolve(fs[1]); q.requests[2].resolve(fs[3]); await flush();
  q.queue.visible(fs[2].card, true); assert.equal(q.requests.length, 4); q.requests[3].resolve(fs[2]); await flush();
  assert.equal(q.urls.length, 4); q.queue.dispose(); assert.deepEqual(q.revoked.sort(), q.urls.sort());
});

test('photo failure preserves valid metadata for retry, while a 409 clears stale approval and cannot retry old binding', async () => {
  const q = queueFixture(), f = galleryFixture(); q.add(f); q.queue.visible(f.card, true);
  q.requests[0].options.onMetadata(f.metadata); q.requests[0].reject(Object.assign(Error(), { code: 'GALLERY_PREVIEW_UNAVAILABLE', status: 404 })); await flush();
  assert.equal(q.view(f).state, 'FAILED'); assert.equal(q.view(f).metadata.title.text, f.metadata.title.text);
  q.queue.retry(f.card); assert.deepEqual(q.requests[1].options.metadata, f.metadata);
  q.requests[1].resolve(f); await flush(); assert.equal(q.view(f).state, 'READY'); q.queue.imageFailed(f.card); assert.equal(q.view(f).state, 'FAILED'); assert.equal(q.revoked.length, 1);
  q.queue.retry(f.card); q.requests[2].reject(Object.assign(Error(), { code: 'GALLERY_SOURCE_CHANGED', status: 409 })); await flush();
  assert.equal(q.view(f).state, 'STALE'); assert.equal(q.view(f).metadata, null); assert.equal(q.view(f).url, null);
  q.queue.retry(f.card); assert.equal(q.requests.length, 3); q.queue.dispose();
});

test('missing differs from denied; injected malformed replies cannot publish an image', async () => {
  const q = queueFixture(), f = galleryFixture(); q.add(f); q.queue.visible(f.card, true);
  const metadata = { ...f.metadata, front: { state: 'UNAVAILABLE', binding: null } }; q.requests[0].resolve({ metadata, preview: null }); await flush();
  assert.equal(q.view(f).state, 'MISSING'); q.queue.retry(f.card); assert.equal(q.requests[1].options.metadata, null);
  q.requests[1].resolve({ ...f, preview: { ...f.preview, binding: { ...f.preview.binding, uploadId: uuid(99) } } }); await flush();
  assert.equal(q.view(f).state, 'FAILED'); assert.equal(q.urls.length, 0);
  q.queue.retry(f.card); q.requests[2].reject(Object.assign(Error(), { status: 410, code: 'INTAKE_CARD_DISCARDED' })); await flush();
  assert.equal(q.view(f).state, 'UNAVAILABLE'); assert.equal(q.view(f).metadata, null); q.queue.dispose();
});

test('access loss closes every tile, aborts pending jobs, revokes URLs and refuses late injected replies', async () => {
  const q = queueFixture(), fs = [1, 2, 3].map(galleryFixture); fs.forEach(f => { q.add(f); q.queue.visible(f.card, true); });
  q.requests[0].resolve(fs[0]); await flush(); assert.equal(q.urls.length, 1); assert.equal(q.requests.length, 3);
  q.requests[1].reject(Object.assign(Error(), { status: 401 })); await flush();
  assert.equal(q.lost(), 1); assert.equal(q.requests[2].options.signal.aborted, true); assert.deepEqual(q.revoked, q.urls);
  assert.ok(fs.every(f => q.view(f).metadata === null && q.view(f).url === null));
  q.requests[2].options.onMetadata(fs[2].metadata); q.requests[2].resolve(fs[2]); await flush(); assert.equal(q.urls.length, 1);
  q.queue.retry(fs[0].card); assert.equal(q.requests.length, 3);
});

test('unsubscribe/replacement and disposal abort reads and never retain old source photos', async () => {
  const q = queueFixture(), f = galleryFixture(), stop = q.add(f); q.queue.visible(f.card, true); stop();
  assert.equal(q.requests[0].options.signal.aborted, true); q.add(f); q.queue.visible(f.card, true);
  q.requests[0].resolve(f); await flush(); assert.equal(q.urls.length, 0);
  q.requests[1].resolve(f); await flush(); assert.equal(q.urls.length, 1); q.queue.dispose(); assert.equal(q.revoked.length, 1);
});


test('changed cookie account in either metadata or preview closes the entire prior scope', async () => {
  for (const phase of ['metadata', 'preview']) {
    const q = queueFixture(), f = galleryFixture(); q.add(f); q.queue.visible(f.card, true);
    const result = clone(f); result[phase].staffId = uuid(901);
    if (phase === 'preview') q.requests[0].options.onMetadata(f.metadata);
    q.requests[0].resolve(result); await flush();
    assert.equal(q.lost(), 1); assert.equal(q.view(f).metadata, null); assert.equal(q.view(f).url, null); assert.equal(q.urls.length, 0);
    assert.equal(q.requests[0].options.staffId, staffId);
  }
});
