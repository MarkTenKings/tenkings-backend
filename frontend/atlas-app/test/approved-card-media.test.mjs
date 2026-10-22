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
  const previewBytes = Buffer.from('ffd8ff73796e746865746963', 'hex');
  const previewGrant = side => {
    const value = grant(side);
    value.image.preview = { url: `${INSPECTION_STORAGE_ORIGIN}/${side}-preview?synthetic=1`, sha256: hash(previewBytes), byteCount: previewBytes.length,
      width: 558, height: 768, mime: 'image/jpeg', sourceSha256: value.image.sha256, policyVersion: 'atlas-inspection-preview-v1' };
    return value;
  };
  const response = side => new Response(JSON.stringify(grant(side)), { headers: { 'content-type': 'application/json' } });
  const labelId = '33333333-3333-4333-8333-333333333333';
  card.media.LABEL = { itemId: labelId, url: `/admin/api/staff/manual-connected/labels/${labelId}/artwork?mode=preview`, provenance: 'REPORT_BOUND_LABEL_ARTWORK' };
  return { card, bytes, grant, previewBytes, previewGrant, response, front: approvedMediaSource(card, 'FRONT'), back: approvedMediaSource(card, 'BACK') };
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

test('preview delivery verifies only the saved small rendition and exposes its distinct source lineage', async () => {
  for (const side of ['FRONT', 'BACK']) {
    const f = fixture(), grant = f.previewGrant(side), source = approvedMediaSource(f.card, side, { delivery: 'preview' }), calls = [];
    const l = loader(async (url, init) => {
      calls.push(url); assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'omit');
      if (url.includes('delivery=direct')) return new Response(JSON.stringify(grant));
      assert.equal(url, grant.image.preview.url); return new Response(f.previewBytes);
    });
    const asset = await l.load(source);
    assert.equal(calls.length, 2); assert.equal(asset.representation, 'preview');
    assert.equal(asset.sha256, hash(f.previewBytes)); assert.equal(asset.sourceSha256, hash(f.bytes));
    assert.equal(asset.width, 558); assert.equal(asset.height, 768); assert.equal(asset.byteCount, f.previewBytes.length);
    assert.equal(l.created[0].blob.type, 'image/jpeg'); asset.dispose(); assert.deepEqual(l.revoked, [asset.url]);
    assert.equal(approvedMediaSource(f.card, side).delivery, 'full');
    assert.equal(approvedMediaSource(f.card, side, { delivery: 'thumbnail' }), null);
  }
});

test('explicit full delivery never substitutes a preview, and a missing preview uses the exact full source', async () => {
  for (const delivery of ['full', 'preview']) {
    const f = fixture(), grant = delivery === 'full' ? f.previewGrant('FRONT') : f.grant('FRONT'), calls = [];
    const l = loader(async url => {
      calls.push(url);
      if (url.includes('delivery=direct')) return new Response(JSON.stringify(grant));
      assert.equal(url, grant.image.url); return new Response(f.bytes);
    });
    const asset = await l.load(approvedMediaSource(f.card, 'FRONT', { delivery }));
    assert.equal(calls.length, 2); assert.equal(asset.representation, 'full');
    assert.equal(asset.sha256, hash(f.bytes)); assert.equal(asset.sourceSha256, hash(f.bytes));
    assert.equal(asset.width, 1350); assert.equal(asset.height, 1858); asset.dispose();
  }
});

test('unavailable preview falls back once to the independently verified full photograph from the same grant', async () => {
  for (const mode of ['missing', 'network']) {
    const f = fixture(), grant = f.previewGrant('FRONT'), calls = [];
    const l = loader(async url => {
      calls.push(url);
      if (url.includes('delivery=direct')) return new Response(JSON.stringify(grant));
      if (url === grant.image.preview.url) {
        if (mode === 'network') throw new TypeError('fetch failed');
        return new Response(null, { status: 404 });
      }
      assert.equal(url, grant.image.url); return new Response(f.bytes);
    });
    const asset = await l.load(approvedMediaSource(f.card, 'FRONT', { delivery: 'preview' }));
    assert.equal(calls.filter(url => url.includes('delivery=direct')).length, 1);
    assert.equal(calls.filter(url => url === grant.image.url).length, 1);
    assert.equal(calls.filter(url => url === grant.image.preview.url).length, mode === 'network' ? 3 : 1);
    assert.equal(asset.representation, 'full'); assert.equal(asset.sha256, hash(f.bytes)); asset.dispose();
  }
});

test('invalid preview lineage and corrupt preview bytes fail closed without fetching another image', async () => {
  const cases = [
    ['lineage', g => { g.image.preview.sourceSha256 = 'e'.repeat(64); }, undefined, 1],
    ['side', g => { g.side = 'BACK'; }, undefined, 1],
    ['version', g => { g.approvalVersion++; }, undefined, 1],
    ['hash', g => { g.image.preview.sha256 = 'd'.repeat(64); }, undefined, 2],
    ['length', g => { g.image.preview.byteCount++; }, undefined, 2],
    ['format', g => { g.image.preview.sha256 = hash(Buffer.alloc(11)); }, Buffer.alloc(11), 2],
  ];
  for (const [name, mutate, bytes, expectedCalls] of cases) {
    const f = fixture(), grant = f.previewGrant('FRONT'); mutate(grant); const calls = [];
    const l = loader(async url => {
      calls.push(url);
      if (url.includes('delivery=direct')) return new Response(JSON.stringify(grant));
      assert.equal(url, grant.image.preview.url, name); return new Response(bytes ?? f.previewBytes);
    });
    await assert.rejects(l.load(approvedMediaSource(f.card, 'FRONT', { delivery: 'preview' })), undefined, name);
    assert.equal(calls.length, expectedCalls, name); assert.equal(l.created.length, 0, name);
  }
});

test('preview cancellation and the original deadline cannot trigger a full fallback or publish late bytes', async () => {
  for (const mode of ['abort', 'timeout']) {
    const f = fixture(), gate = deferred(), controller = new AbortController(), calls = []; let released = 0;
    const l = loader(async url => { calls.push(url); return new Response(JSON.stringify(f.previewGrant('FRONT'))); },
      { timeoutMs: mode === 'timeout' ? 15 : 1000, verify: () => gate.promise });
    const pending = l.load(approvedMediaSource(f.card, 'FRONT', { delivery: 'preview' }), { signal: controller.signal });
    const rejected = assert.rejects(pending); await pause(0);
    if (mode === 'abort') controller.abort();
    await rejected; gate.resolve({ url: 'blob:late-preview', dispose() { released++; } }); await pause(0);
    assert.equal(calls.length, 1); assert.equal(released, 1);
  }
});

test('small photographs and saved labels share prompt FIFO admission ahead of optional full media', async () => {
  const f = fixture(), calls = [], gate = deferred();
  const l = loader(async url => {
    calls.push(url);
    if (url.includes('/labels/')) return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
    return new Response(JSON.stringify(f.previewGrant(url.includes('BACK') ? 'BACK' : 'FRONT')));
  }, { verify: async descriptor => { await gate.promise; return { url: `blob:${descriptor.url}`, dispose() {} }; } });
  const full = l.load(f.front), label = l.load(approvedMediaSource(f.card, 'LABEL'));
  const preview = l.load(approvedMediaSource(f.card, 'BACK', { delivery: 'preview' }));
  await pause(0);
  assert.equal(calls[0], approvedMediaSource(f.card, 'LABEL').url);
  assert.equal(calls[1], `${f.back.url}&delivery=direct`);
  gate.resolve(); (await Promise.all([full, label, preview])).forEach(asset => asset.dispose());
});

test('independent preview and full slots preserve stills on full failure, retry and decode failure', async () => {
  const f = fixture(), preview = approvedMediaSource(f.card, 'FRONT', { delivery: 'preview' });
  const calls = [], views = { preview: [], full: [] }, released = []; let failFull = true;
  const resource = createApprovedMediaResource({ load: async source => {
    calls.push(source.delivery);
    if (source.delivery === 'full' && failFull) throw new Error('full unavailable');
    return { url: `blob:${source.delivery}`, representation: source.delivery, width: source.delivery === 'full' ? 1350 : 558,
      dispose() { released.push(source.delivery); } };
  } });
  await resource.read(preview, value => views.preview.push(value));
  await resource.read(f.front, value => views.full.push(value));
  assert.equal(views.preview.at(-1).url, 'blob:preview'); assert.ok(views.full.at(-1).error);
  failFull = false; await resource.read(f.front, value => views.full.push(value));
  assert.equal(views.preview.length, 2); assert.equal(views.full.at(-1).representation, 'full');
  resource.fail('FRONT', 'blob:full'); assert.deepEqual(released, ['full']); assert.equal(views.preview.length, 2);
  resource.fail('FRONT', 'blob:stale'); assert.equal(views.preview.length, 2);
  resource.dispose(); assert.deepEqual(released, ['full', 'preview']); assert.deepEqual(calls, ['preview', 'full', 'full']);
});

test('re-reading an owned slot publishes pending and ready state to the current callback without another transfer', async () => {
  const f = fixture(), gate = deferred(), original = [], latest = [], ready = []; let calls = 0;
  const resource = createApprovedMediaResource({ load: async () => { calls++; return gate.promise; } });
  const first = resource.read(f.front, value => original.push(value)); await pause(0);
  const second = resource.read(f.front, value => latest.push(value));
  assert.equal(first, second); assert.equal(latest.at(-1).loading, true);
  gate.resolve({ url: 'blob:full', representation: 'full', sourceSha256: hash(f.bytes), dispose() {} }); await first;
  assert.equal(original.length, 1); assert.equal(latest.at(-1).url, 'blob:full');
  await resource.read(f.front, value => ready.push(value));
  assert.equal(calls, 1); assert.deepEqual(ready, [latest.at(-1)]); resource.dispose();
});

test('failed full delivery never fetches an available preview as replacement evidence', async () => {
  const f = fixture(), grant = f.previewGrant('FRONT'), calls = [];
  const l = loader(async url => {
    calls.push(url);
    if (url.includes('delivery=direct')) return new Response(JSON.stringify(grant));
    assert.equal(url, grant.image.url); return new Response(null, { status: 404 });
  });
  await assert.rejects(l.load(f.front), /VERIFIED_IMAGE_UNAVAILABLE/);
  assert.deepEqual(calls, [`${f.front.url}&delivery=direct`, grant.image.url]); assert.equal(l.created.length, 0);
});

test('leaving 3D cancels only pending full reads, preserves completed media and discards late full results', async () => {
  const f = fixture(), preview = approvedMediaSource(f.card, 'FRONT', { delivery: 'preview' });
  const gates = [], views = [], released = [], calls = [];
  const resource = createApprovedMediaResource({ load: async (source, { signal }) => {
    calls.push(`${source.kind}:${source.delivery}`);
    if (source.kind === 'FRONT' && source.delivery === 'full') {
      const gate = deferred(); gates.push({ ...gate, signal }); return gate.promise;
    }
    return { url: `blob:${source.kind}:${source.delivery}`, dispose() { released.push(`${source.kind}:${source.delivery}`); } };
  } });
  await resource.read(preview, () => {}); await resource.read(f.back, () => {});
  const pending = resource.read(f.front, value => views.push(value)); await pause(0);
  resource.cancel('FRONT'); resource.cancel('BACK');
  assert.equal(gates[0].signal.aborted, true); assert.deepEqual(released, []);
  assert.deepEqual(views.at(-1), { loading: false, url: null, error: null, cancelled: true });
  const count = views.length;
  gates[0].resolve({ url: 'blob:late-full', dispose() { released.push('late-full'); } }); await pending;
  assert.equal(views.length, count); assert.deepEqual(released, ['late-full']);
  const resumed = resource.read(f.front, value => views.push(value)); await pause(0);
  assert.equal(gates[1].signal.aborted, false); assert.equal(views.at(-1).loading, true);
  gates[1].resolve({ url: 'blob:resumed-full', dispose() { released.push('resumed-full'); } }); await resumed;
  resource.cancel('FRONT'); assert.equal(views.at(-1).url, 'blob:resumed-full');
  resource.dispose();
  assert.deepEqual(calls, ['FRONT:preview', 'BACK:full', 'FRONT:full', 'FRONT:full']);
  assert.deepEqual(released, ['late-full', 'FRONT:preview', 'BACK:full', 'resumed-full']);
});
