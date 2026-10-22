import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { approvedMediaSource, approvedMediaIdentity, createApprovedMediaLoader, createApprovedMediaResource } from '../lib/approved-card-media.mjs';
import { loadVerifiedImage } from '../../../packages/atlas-manual-workspace/src/verified-image.mjs';
import { INSPECTION_STORAGE_ORIGIN } from '../../../packages/atlas-service-bridge/src/inspection-access.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const fixture = () => {
  const publicToken = `ar_${'J'.repeat(24)}`, report = { state: 'PUBLISHED', version: 3, publicToken, publicHash: 'c'.repeat(64) };
  // A minimal transport-only WebP signature. Actual image decoding and layout
  // belong to the browser fixture; these bytes test exact verification only.
  const bytes = Buffer.from('5249464610000000574542505650382073796e746865746963', 'hex');
  const card = { cardId: '11111111-1111-4111-8111-111111111111', approvalActionId: '22222222-2222-4222-8222-222222222222', report,
    media: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { url: `/api/reports/${publicToken}/images/${side}?v=3`, provenance: 'APPROVED_GRADING_PHOTOGRAPH' }])) };
  const grant = side => ({ version: 'atlas-approved-image-access-v1', publicToken, approvalVersion: 3, publicHash: report.publicHash, side,
    image: { url: `${INSPECTION_STORAGE_ORIGIN}/${side}?synthetic=1`, sha256: hash(bytes), byteCount: bytes.length, width: 1350, height: 1858, mime: 'image/webp' } });
  const response = side => new Response(JSON.stringify(grant(side)), { headers: { 'content-type': 'application/json' } });
  const labelId = '33333333-3333-4333-8333-333333333333';
  card.media.LABEL = { itemId: labelId, url: `/admin/api/staff/manual-connected/labels/${labelId}/artwork?mode=preview`, provenance: 'REPORT_BOUND_LABEL_ARTWORK' };
  return { card, bytes, grant, response, front: approvedMediaSource(card, 'FRONT'), back: approvedMediaSource(card, 'BACK') };
};

function loader(fetchImpl, options = {}) {
  const created = [], revoked = [];
  const urlImpl = { createObjectURL(blob) { const url = `blob:approved-${created.length}`; created.push({ url, blob }); return url; }, revokeObjectURL(url) { revoked.push(url); } };
  return { created, revoked, load: createApprovedMediaLoader({ fetchImpl, retryDelays: [0, 0], origin: () => 'https://atlasgrading.com', urlImpl,
    verify: (descriptor, args) => loadVerifiedImage(descriptor, { ...args, cryptoImpl: webcrypto }), ...options }) };
}

test('exact published media routes refuse another side, version, publication, label item or unbound report', () => {
  const f = fixture();
  assert.ok(f.front); assert.ok(f.back); assert.ok(approvedMediaSource(f.card, 'LABEL'));
  for (const mutate of [c => { c.report.state = 'PENDING'; }, c => { delete c.report.publicHash; }, c => { c.report.version++; },
    c => { c.report.publicToken = `ar_${'B'.repeat(24)}`; }, c => { c.media.FRONT.url = c.media.BACK.url; },
    c => { c.media.FRONT.url += '&extra=1'; }, c => { c.media.FRONT.url = 'https://other.invalid/photo'; },
    c => { c.media.FRONT.provenance = 'PRESENTATION'; }]) {
    const card = structuredClone(f.card); mutate(card); assert.equal(approvedMediaSource(card, 'FRONT'), null);
  }
  const badLabel = structuredClone(f.card); badLabel.media.LABEL.itemId = f.card.cardId;
  assert.equal(approvedMediaSource(badLabel, 'LABEL'), null);
  const changed = structuredClone(f.card); changed.report.publicHash = 'd'.repeat(64);
  assert.notEqual(approvedMediaIdentity(changed), approvedMediaIdentity(f.card));
});

test('approved back label is bound to the saved approved-B front item and exact back route', () => {
  const { card } = fixture();
  assert.equal(approvedMediaSource(card, 'LABEL_BACK'), null);
  card.media.LABEL.layoutVersion = 'atlas-approved-b-v1';
  card.media.LABEL_BACK = { ...card.media.LABEL, url: card.media.LABEL.url.replace('mode=preview', 'mode=preview-back') };
  assert.deepEqual(approvedMediaSource(card, 'LABEL_BACK'), { kind: 'LABEL_BACK', url: card.media.LABEL_BACK.url, layoutVersion: 'atlas-approved-b-v1' });
  for (const mutate of [c => { delete c.media.LABEL.layoutVersion; }, c => { delete c.media.LABEL; },
    c => { c.media.LABEL_BACK.url = c.media.LABEL.url; }, c => { c.media.LABEL_BACK.url += '&extra=1'; },
    c => { c.media.LABEL_BACK.provenance = 'APPROVED_GRADING_PHOTOGRAPH'; },
    c => { c.media.LABEL_BACK.itemId = c.cardId; c.media.LABEL_BACK.url = `/admin/api/staff/manual-connected/labels/${c.cardId}/artwork?mode=preview-back`; }]) {
    const changed = structuredClone(card); mutate(changed); assert.equal(approvedMediaSource(changed, 'LABEL_BACK'), null);
  }
});

test('503 and rate limit recover within three attempts and exact bytes are verified without credentials to storage', async () => {
  const f = fixture(), calls = []; let grants = 0, photos = 0;
  const l = loader(async (url, init) => {
    calls.push({ url, init }); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    if (url.includes('delivery=direct')) {
      assert.equal(url, `${f.front.url}&delivery=direct`); assert.equal(init.credentials, 'omit');
      if (++grants === 1) return new Response(null, { status: 503 });
      if (grants === 2) return new Response(null, { status: 429, headers: { 'retry-after': '0' } });
      return f.response('FRONT');
    }
    assert.equal(url, f.grant('FRONT').image.url); assert.equal(init.credentials, 'omit');
    if (++photos === 1) return new Response(null, { status: 503 });
    return new Response(f.bytes, { headers: { 'content-length': String(f.bytes.length) } });
  });
  const result = await l.load(f.front);
  assert.equal(grants, 3); assert.equal(photos, 2); assert.equal(result.sha256, hash(f.bytes));
  assert.deepEqual(Buffer.from(await l.created[0].blob.arrayBuffer()), f.bytes);
  result.dispose(); result.dispose(); assert.deepEqual(l.revoked, [result.url]);
});

test('permanent failure is not automatically retried; temporary failure ends at its bounded attempt count', async () => {
  for (const status of [404, 401, 403, 503, 429]) {
    let calls = 0; const f = fixture(), l = loader(async () => { calls++; return new Response(null, { status }); });
    await assert.rejects(l.load(f.front), /APPROVED_MEDIA_UNAVAILABLE/);
    assert.equal(calls, [503, 429].includes(status) ? 3 : 1); assert.equal(l.created.length, 0);
  }
});

test('wrong grant side, report version, public hash, storage origin and changed photo bytes cannot render', async () => {
  for (const mutate of [v => { v.side = 'BACK'; }, v => { v.approvalVersion++; }, v => { v.publicHash = 'd'.repeat(64); },
    v => { v.image.url = 'https://other.invalid/photo'; }, v => { v.image.byteCount++; }, v => { v.image.sha256 = 'e'.repeat(64); }]) {
    const f = fixture(), grant = f.grant('FRONT'); mutate(grant); let calls = 0;
    const l = loader(async url => { calls++; return url.includes('delivery=direct') ? new Response(JSON.stringify(grant)) : new Response(f.bytes); });
    await assert.rejects(l.load(f.front)); assert.equal(l.created.length, 0); assert.ok(calls <= 2);
  }
});

test('two shared admission slots bound all cards; an aborted queued side makes no request', async () => {
  const f = fixture(), gates = [], calls = []; let active = 0, peak = 0;
  const l = loader(async (url, init) => {
    calls.push(url); active++; peak = Math.max(peak, active);
    const gate = deferred(); gates.push({ ...gate, signal: init.signal }); await gate.promise; active--;
    return f.response(url.includes('BACK') ? 'BACK' : 'FRONT');
  }, { verify: async descriptor => ({ url: `blob:${descriptor.url.includes('BACK') ? 'back' : 'front'}`, dispose() {} }) });
  const controller = new AbortController(), a = l.load(f.front), b = l.load(f.back), c = l.load(f.front, { signal: controller.signal });
  const cancelled = assert.rejects(c); await pause(0); assert.equal(calls.length, 2); assert.equal(peak, 2);
  controller.abort(); await cancelled; gates.forEach(gate => gate.resolve()); await Promise.all([a, b]);
  assert.equal(calls.length, 2);
});

test('one deadline includes queue, stalled JSON, server Retry-After and byte verification', async () => {
  const f = fixture();
  for (const mode of ['json', 'retry-after', 'verify']) {
    let calls = 0, signal;
    const l = loader(async (_url, options) => {
      calls++; signal = options.signal;
      if (mode === 'json') return { ok: true, json: () => new Promise(() => {}) };
      if (mode === 'retry-after') return new Response(null, { status: 429, headers: { 'retry-after': '60' } });
      return f.response('FRONT');
    }, { timeoutMs: 20, ...(mode === 'verify' ? { verify: async (_d, options) => { signal = options.signal; return new Promise(() => {}); } } : {}) });
    await assert.rejects(l.load(f.front), /APPROVED_MEDIA_TIMEOUT/); assert.equal(calls, 1);
    if (mode !== 'retry-after') assert.equal(signal.aborted, true);
  }
});

test('label preview uses the exact authenticated route, stays bounded and revokes on release', async () => {
  const f = fixture(), source = approvedMediaSource(f.card, 'LABEL'); let calls = 0;
  const l = loader(async (url, init) => {
    calls++; assert.equal(url, source.url); assert.equal(init.credentials, 'same-origin');
    return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { 'content-type': 'image/svg+xml; charset=utf-8' } });
  });
  const result = await l.load(source); assert.equal(calls, 1); assert.equal(l.created[0].blob.type, 'image/svg+xml');
  result.dispose(); assert.deepEqual(l.revoked, [result.url]);
  const huge = loader(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/svg+xml' } }));
  await assert.rejects(huge.load(source), /APPROVED_MEDIA_TOO_LARGE/); assert.equal(huge.created.length, 0);
});

test('back-label loading uses its authenticated saved route and independent disposal', async () => {
  const { card } = fixture(); card.media.LABEL.layoutVersion = 'atlas-approved-b-v1';
  card.media.LABEL_BACK = { ...card.media.LABEL, url: card.media.LABEL.url.replace('mode=preview', 'mode=preview-back') };
  const source = approvedMediaSource(card, 'LABEL_BACK');
  const l = loader(async (url, init) => {
    assert.equal(url, source.url); assert.equal(init.credentials, 'same-origin');
    return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { 'content-type': 'image/svg+xml' } });
  });
  const loaded = await l.load(source); assert.equal(l.created.length, 1); loaded.dispose(); assert.deepEqual(l.revoked, [loaded.url]);
});

test('private 401/403 ends access once and never retries or exposes an image', async () => {
  for (const status of [401, 403]) {
    const f = fixture(); let calls = 0, revoked = 0;
    const l = loader(async () => { calls++; return new Response(null, { status }); }, { endAccess: () => { revoked++; } });
    await assert.rejects(l.load(approvedMediaSource(f.card, 'LABEL')), /APPROVED_MEDIA_UNAVAILABLE/);
    assert.equal(calls, 1); assert.equal(revoked, 1); assert.equal(l.created.length, 0);
  }
});

test('Front remains ready while Back fails then manually retries the same exact source', async () => {
  const f = fixture(), values = { FRONT: [], BACK: [] }, calls = []; let failBack = true, disposed = 0;
  const resource = createApprovedMediaResource({ load: async source => {
    calls.push(source); if (source.kind === 'BACK' && failBack) throw new Error('temporary');
    return { url: `blob:${source.kind}`, dispose() { disposed++; } };
  } });
  await Promise.all([resource.read(f.front, value => values.FRONT.push(value)), resource.read(f.back, value => values.BACK.push(value))]);
  assert.equal(values.FRONT.at(-1).url, 'blob:FRONT'); assert.ok(values.BACK.at(-1).error); assert.equal(values.BACK.at(-1).loading, false);
  failBack = false; await resource.read(f.back, value => values.BACK.push(value));
  assert.equal(values.FRONT.length, 2); assert.equal(values.BACK.at(-1).url, 'blob:BACK');
  assert.deepEqual(calls, [f.front, f.back, f.back]); assert.equal(disposed, 0);
  resource.dispose(); assert.equal(disposed, 2);
});

test('replaced source, unmount and access loss abort both sides and dispose late out-of-order results', async () => {
  for (const end of ['replace', 'dispose']) {
    const f = fixture(), gates = [], views = [], destroyed = [];
    const resource = createApprovedMediaResource({ load: (source, options) => {
      const gate = deferred(); gates.push({ ...gate, source, signal: options.signal }); return gate.promise;
    } });
    const a = resource.read(f.front, value => views.push(value)), b = resource.read(f.back, value => views.push(value));
    await pause(0); let c;
    if (end === 'replace') c = resource.read({ ...f.front, binding: { ...f.front.binding, publicHash: 'e'.repeat(64) } }, value => views.push(value));
    else resource.dispose();
    await pause(0); assert.equal(gates[0].signal.aborted, true);
    if (end === 'dispose') assert.equal(gates[1].signal.aborted, true);
    const before = views.length;
    gates[0].resolve({ url: 'blob:old-front', dispose() { destroyed.push('old-front'); } });
    if (end === 'dispose') gates[1].resolve({ url: 'blob:old-back', dispose() { destroyed.push('old-back'); } });
    await a; assert.equal(views.length, before); assert.ok(destroyed.includes('old-front'));
    if (end === 'replace') {
      gates[2].resolve({ url: 'blob:new-front', dispose() { destroyed.push('new-front'); } }); await c;
      assert.equal(views.at(-1).url, 'blob:new-front');
      gates[1].resolve({ url: 'blob:back', dispose() { destroyed.push('back'); } }); await b; resource.dispose();
    } else await b;
    assert.ok(destroyed.includes(end === 'replace' ? 'new-front' : 'old-back'));
  }
});

test('decode failure releases only its own asset and remains manually recoverable', async () => {
  const f = fixture(), destroyed = [], views = []; let attempts = 0;
  const resource = createApprovedMediaResource({ load: async source => ({ url: `blob:${source.kind}:${++attempts}`, dispose() { destroyed.push(source.kind); } }) });
  await resource.read(f.front, value => views.push(value)); await resource.read(f.back, () => {});
  resource.fail('FRONT'); assert.deepEqual(destroyed, ['FRONT']); assert.equal(views.at(-1).error.code, 'APPROVED_MEDIA_DECODE');
  await resource.read(f.front, value => views.push(value)); assert.equal(views.at(-1).url, 'blob:FRONT:3');
  resource.fail('FRONT', 'blob:FRONT:1'); assert.equal(views.at(-1).url, 'blob:FRONT:3'); assert.deepEqual(destroyed, ['FRONT']);
  resource.dispose(); assert.deepEqual(destroyed, ['FRONT', 'BACK', 'FRONT']);
});

test('a late verified asset arriving after timeout is revoked instead of published', async () => {
  const f = fixture(), gate = deferred(); let disposed = 0;
  const l = loader(async () => f.response('FRONT'), { timeoutMs: 15, verify: () => gate.promise });
  await assert.rejects(l.load(f.front), /APPROVED_MEDIA_TIMEOUT/);
  gate.resolve({ url: 'blob:late', dispose() { disposed++; } }); await pause(0); assert.equal(disposed, 1);
});
