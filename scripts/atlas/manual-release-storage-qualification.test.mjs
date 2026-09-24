import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createPhotoStorage } from '../../packages/atlas-photo-storage/src/index.mjs';
import { createS3ManualArtifactTransport } from '../../packages/atlas-manual-service/src/artifacts.mjs';
import { runCanary, buildSealedInputs, createHttpTransport, validateManifest, QUALIFICATION_ROOT, QUALIFICATION_SOURCES } from './manual-release-storage-qualification.mjs';

const hash = body => createHash('sha256').update(body).digest('hex');
const identity = { id: '4e5f04b3-df88-4e48-a929-f473ec723c89', createdAt: '2026-09-17T00:00:00.000Z' };
const inputs = buildSealedInputs({ ...identity, profile: 'photo', payload: Buffer.alloc(65, 'p'), collision: Buffer.alloc(65, 'c') });
const artifactInputs = buildSealedInputs({ ...identity, profile: 'artifact', payload: Buffer.from(JSON.stringify({ canary: 'p'.repeat(52) })), collision: Buffer.from(JSON.stringify({ canary: 'c'.repeat(52) })) });
const plan = inputs.plan, PLAN_SHA = hash(inputs.planBytes);
function fakeProvider({ before, after, preexisting = false, sealedInputs = inputs } = {}) {
  const inputs = sealedInputs, plan = inputs.plan;
  const calls = []; let object = preexisting ? Buffer.from(inputs.payload) : null;
  const response = (status, extra = {}) => ({ status, headers: {}, ...extra });
  const metadata = () => ({ 'content-length': '65', 'content-type': plan.requiredHeaders['Content-Type'], etag: `"${hash(object)}"`,
    ...Object.fromEntries(Object.entries(plan.requiredHeaders).filter(([name]) => name.startsWith('x-amz-meta-'))),
    'x-amz-checksum-sha256': Buffer.from(hash(object), 'hex').toString('base64') });
  const provider = { calls, setObject: bytes => { object = bytes && Buffer.from(bytes); }, getObject: () => object,
    async send(req) {
      assert.deepEqual(req.target, plan.target); assert(req.signal instanceof AbortSignal);
      calls.push({ ...req, body: req.body && Buffer.from(req.body) });
      const intercepted = await before?.(req, provider); if (intercepted) return intercepted;
      let result;
      if (req.operation === 'headBucket') result = response(200);
      else if (req.operation === 'versioning') result = response(200, { versioning: null });
      else if (req.operation === 'options') result = response(200, { headers: {
        'access-control-allow-origin': plan.target.staffOrigin, 'access-control-allow-methods': req.method,
        'access-control-allow-headers': req.corsHeaders.join(',') } });
      else if (req.operation === 'put') {
        assert.equal(req.requiredHeaders['If-None-Match'], '*');
        if (req.checksum !== Buffer.from(hash(req.body), 'hex').toString('base64')) result = response(400, { errorCode: 'BadDigest' });
        else if (object) result = response(412);
        else { object = Buffer.from(req.body); result = response(200); }
      } else if (req.operation === 'delete') { object = null; result = response(204); }
      else if (req.anonymous) result = response(403);
      else if (!object) result = response(404);
      else if (req.ifMatch && req.ifMatch !== metadata().etag) result = response(412);
      else result = response(200, { headers: { ...metadata(), ...(req.browser ? { 'access-control-allow-origin': plan.target.staffOrigin } : {}) },
        ...(req.operation === 'get' ? { bytes: Buffer.from(object) } : {}) });
      return await after?.(req, result, provider) ?? result;
    } };
  return provider;
}
const run = (transport, options = {}) => runCanary({ execute: true, approvedPlanSha: PLAN_SHA, inputs, transport, ...options });
const deleted = transport => transport.calls.filter(x => x.operation === 'delete');

test('approved bytes cannot widen target, request caps, headers or source bindings', async () => {
  for (const change of [
    value => { value.bounds.maxHttpRequests = 300; },
    value => { value.bounds.maxPutBodyBytes = 999999; },
    value => { value.bounds.totalDeadlineMs = 300001; },
    value => { value.target.key = 'preexisting/real-card'; },
    value => { value.target.endpoint = 'https://other.invalid'; },
    value => { value.requiredHeaders['If-None-Match'] = undefined; },
    value => { value.uploadPlan.binding.cardId = 'another-card'; },
    value => { value.payload.checksumBase64 = value.collisionPayload.checksumBase64; },
    value => { value.unexpected = true; },
  ]) {
    const changed = structuredClone(plan); change(changed);
    const planBytes = Buffer.from(JSON.stringify(changed)), provider = fakeProvider();
    await assert.rejects(run(provider, { approvedPlanSha: hash(planBytes), inputs: { ...inputs, planBytes } }), /SEALED_PLAN_CONTRACT_CHANGED/);
    assert.equal(provider.calls.length, 0);
  }
});
test('source manifest is closed, binds both different profile keys, and reads only injected offline fixtures', () => {
  const allInputs = { photo: inputs, artifact: artifactInputs };
  const manifest = { schemaVersion: 1, status: 'PREPARED_NOT_AUTHORIZED_NOT_EXECUTED', root: QUALIFICATION_ROOT,
    profiles: ['photo', 'artifact'], keys: { photo: plan.target.key, artifact: artifactInputs.plan.target.key },
    plans: { photo: hash(inputs.planBytes), artifact: hash(artifactInputs.planBytes) },
    sources: Object.fromEntries(QUALIFICATION_SOURCES.map(path => [path, hash(path)])) };
  const validate = (value, overrides = {}) => {
    const bytes = Buffer.from(JSON.stringify(value));
    return validateManifest(hash(bytes), bytes, { readSource: path => Buffer.from(path), readInputs: profile => allInputs[profile], ...overrides });
  };
  assert.deepEqual(validate(manifest), manifest);
  for (const change of [
    value => { value.sources = {}; },
    value => { delete value.sources['packages/atlas-manual-service/src/artifacts.mjs']; },
    value => { value.sources['../unexpected'] = hash('unexpected'); },
    value => { value.profiles = ['photo']; },
    value => { value.keys.artifact = value.keys.photo; },
    value => { value.plans.artifact = value.plans.photo; },
  ]) { const value = structuredClone(manifest); change(value); assert.throws(() => validate(value)); }
  assert.throws(() => validate(manifest, { readSource: () => Buffer.from('changed') }), /QUALIFIED_SOURCE_CHANGED/);
});

test('sealed approval, plan and payload gates reject before any provider operation', async () => {
  const provider = fakeProvider();
  for (const override of [{ execute: false }, { approvedPlanSha: '0'.repeat(64) },
    { inputs: { ...inputs, planBytes: Buffer.from('{}') } }, { inputs: { ...inputs, payload: Buffer.alloc(65) } }])
    await assert.rejects(run(provider, override));
  assert.equal(provider.calls.length, 0);
});
test('successful exact canary stays within every sealed operation and byte bound and deletes its only object', async () => {
  const provider = fakeProvider(), result = await run(provider);
  assert.equal(result.status, 'PASS_CLEANED'); assert.equal(provider.getObject(), null);
  assert.deepEqual(result.counts, { requests: 23, putAttempts: 3, deleteAttempts: 1, putBytes: 195 });
  assert(provider.calls.every(x => x.target.key === plan.target.key));
  const browser = provider.calls.find(x => x.label === 'browser-signed-get'); assert.equal(browser.ifMatch, undefined);
  assert(provider.calls.find(x => x.label === 'created-object-get').ifMatch);
});
test('initially existing or forbidden object never grants upload or deletion authority', async () => {
  for (const provider of [fakeProvider({ preexisting: true }), fakeProvider({ before: req => req.label === 'initial-absence' ? { status: 403, headers: {} } : null })]) {
    const result = await run(provider); assert.equal(result.status, 'FAILED_SAFE');
    assert.equal(result.counts.putAttempts, 0); assert.equal(deleted(provider).length, 0);
  }
});
test('versioning and CORS refusal stop before PUT', async () => {
  for (const label of ['bucket-versioning', 'cors-PUT']) {
    const provider = fakeProvider({ before: req => req.label === label ? { status: label === 'cors-PUT' ? 403 : 200, headers: {}, versioning: 'Enabled' } : null });
    const result = await run(provider); assert.equal(result.counts.putAttempts, 0); assert.equal(deleted(provider).length, 0);
  }
});
test('ignored checksum failure cleans only the attempted harmless payload', async () => {
  const provider = fakeProvider({ before: (req, own) => {
    if (req.label === 'checksum-refusal') { own.setObject(req.body); return { status: 200, headers: {} }; }
  } });
  const result = await run(provider); assert.equal(result.failureCode, 'CHECKSUM_REFUSAL_NOT_PROVEN');
  assert.equal(result.cleanup, 'VERIFIED_ABSENT'); assert.equal(result.counts.putAttempts, 1);
});
test('InvalidDigest syntax refusal does not prove the sealed BadDigest checksum requirement', async () => {
  const provider = fakeProvider({ before: req => req.label === 'checksum-refusal' ? { status: 400, headers: {}, errorCode: 'InvalidDigest' } : null });
  const result = await run(provider); assert.equal(result.failureCode, 'CHECKSUM_REFUSAL_NOT_PROVEN');
  assert.equal(result.status, 'FAILED_CLEANUP_REQUIRED'); assert.equal(result.counts.putAttempts, 1); assert.equal(deleted(provider).length, 0);
});
test('unknown created upload reconciles its exact dispatched bytes and cleans without another PUT', async () => {
  const provider = fakeProvider({ after: req => { if (req.label === 'create-once') throw new Error('secret-provider-error'); } });
  const result = await run(provider); assert.equal(result.status, 'FAILED_SAFE'); assert.equal(result.cleanup, 'VERIFIED_ABSENT');
  assert.equal(result.counts.putAttempts, 2); assert.equal(provider.getObject(), null);
  assert(!JSON.stringify(result).includes('secret-provider-error'));
});
test('unknown upload followed by 404 remains unresolved because a late write is possible', async () => {
  const provider = fakeProvider({ before: req => { if (req.label === 'create-once') throw new Error('connection lost'); } });
  const result = await run(provider); assert.equal(result.status, 'FAILED_CLEANUP_REQUIRED');
  assert.equal(deleted(provider).length, 0); assert.equal(result.counts.putAttempts, 2);
});
test('unknown collision cannot delete the original and enable a delayed conditional upload', async () => {
  const provider = fakeProvider({ before: req => { if (req.label === 'collision-refusal') throw new Error('connection lost'); } });
  const result = await run(provider); assert.equal(result.status, 'FAILED_CLEANUP_REQUIRED');
  assert.equal(deleted(provider).length, 0); assert.deepEqual(provider.getObject(), inputs.payload);
});
test('unknown collision whose attempted bytes are observed can be cleaned', async () => {
  const provider = fakeProvider({ before: (req, own) => { if (req.label === 'collision-refusal') { own.setObject(req.body); throw new Error('connection lost'); } } });
  const result = await run(provider); assert.equal(result.cleanup, 'VERIFIED_ABSENT'); assert.equal(provider.getObject(), null);
});
test('returned 5xx or unproven 4xx PUT statuses retain uncertainty until those dispatched bytes are observed', async () => {
  for (const status of [403, 500, 503]) for (const label of ['checksum-refusal', 'create-once', 'collision-refusal']) {
    const provider = fakeProvider({ before: req => req.label === label ? { status, headers: {} } : null });
    const result = await run(provider); assert.equal(result.status, 'FAILED_CLEANUP_REQUIRED');
    assert.equal(deleted(provider).length, 0);
  }
  const committed = fakeProvider({ after: (req, result) => req.label === 'create-once' ? { ...result, status: 503 } : result });
  const result = await run(committed); assert.equal(result.status, 'FAILED_SAFE'); assert.equal(result.cleanup, 'VERIFIED_ABSENT');
  assert.equal(result.counts.putAttempts, 2);
});
test('a sealed but never-dispatched collision payload is not cleanup authority', async () => {
  const provider = fakeProvider({ before: (req, own) => { if (req.label === 'create-once') { own.setObject(inputs.collision); return { status: 200, headers: {} }; } } });
  const result = await run(provider); assert.equal(result.status, 'FAILED_CLEANUP_REQUIRED'); assert.equal(deleted(provider).length, 0);
});
test('failed cleanup is bounded to two attempts, preserved as unresolved, and not called a pass', async () => {
  const provider = fakeProvider({ before: req => req.operation === 'delete' ? { status: 403, headers: {} } : null });
  const result = await run(provider); assert.equal(result.status, 'FAILED_CLEANUP_REQUIRED'); assert.equal(deleted(provider).length, 2);
  assert(result.counts.requests <= 30); assert(result.counts.putBytes <= 195); assert(provider.getObject());
});
test('lost delete response reconciles absence without repeating deletion', async () => {
  const provider = fakeProvider({ after: req => { if (req.operation === 'delete') throw new Error('connection lost'); } });
  const result = await run(provider); assert.equal(result.status, 'PASS_CLEANED'); assert.equal(deleted(provider).length, 1);
});
test('403 readback after DELETE does not prove absence', async () => {
  const provider = fakeProvider({ before: req => req.label.startsWith('cleanup-confirm-') ? { status: 403, headers: {} } : null });
  const result = await run(provider); assert.equal(result.status, 'FAILED_CLEANUP_REQUIRED');
});
test('qualification deadline reserves cleanup time; total deadline forbids further requests', async () => {
  for (const elapsed of [211000, 300001]) {
    let time = 0;
    const provider = fakeProvider({ after: req => { if (req.label === 'create-once') time = elapsed; } });
    const result = await run(provider, { now: () => time });
    assert.equal(result.failureCode, 'QUALIFICATION_DEADLINE');
    if (elapsed < 300000) { assert.equal(result.cleanup, 'VERIFIED_ABSENT'); assert.equal(deleted(provider).length, 1); }
    else { assert.equal(result.status, 'FAILED_CLEANUP_REQUIRED'); assert.equal(deleted(provider).length, 0); }
  }
});
test('noncooperative request is bounded, aborted and never treated as a completed upload', async () => {
  let abortObserved = false;
  const provider = fakeProvider({ before: req => {
    if (req.label === 'create-once') { req.signal.addEventListener('abort', () => { abortObserved = true; }); return new Promise(() => {}); }
  } });
  const result = await run(provider, { timers: { set: fn => setTimeout(fn, 10), clear: clearTimeout } });
  assert(abortObserved); assert.equal(result.status, 'FAILED_CLEANUP_REQUIRED'); assert.equal(result.counts.putAttempts, 2);
});
test('oversized provider result fails closed and cleanup still verifies the actual canary', async () => {
  const provider = fakeProvider({ after: (req, result) => req.label === 'created-object-get' ? { ...result, bytes: Buffer.alloc(4097) } : result });
  const result = await run(provider); assert.equal(result.failureCode, 'RESPONSE_BODY_LIMIT'); assert.equal(result.cleanup, 'VERIFIED_ABSENT');
});
test('first malformed version is refused before recording it or constructing cleanup authority', async () => {
  const provider = fakeProvider({ after: (req, result) => req.label === 'create-once' ? { ...result, headers: { 'x-amz-version-id': 'v'.repeat(1025) } } : result });
  const result = await run(provider); assert.equal(result.failureCode, 'VERSION_INVALID');
  assert(!JSON.stringify(result).includes('v'.repeat(1025)));
  assert.equal(deleted(provider).length, 0); assert.equal(result.cleanup, 'REQUIRES_OPERATOR_RECONCILIATION');
});
test('a second unexpected version refuses deletion rather than claiming whole-key absence', async () => {
  const provider = fakeProvider({ after: (req, result) => req.label === 'create-once'
    ? { ...result, headers: { 'x-amz-version-id': 'first-version' } }
    : req.label === 'cleanup-1-head' ? { ...result, headers: { ...result.headers, 'x-amz-version-id': 'second-version' } } : result });
  const result = await run(provider); assert.equal(result.status, 'FAILED_CLEANUP_REQUIRED'); assert.equal(deleted(provider).length, 0);
});
test('failure to journal a PUT intent never dispatches that PUT or grants deletion authority', async () => {
  const provider = fakeProvider();
  const result = await run(provider, { onEvent: event => { if (event.label === 'checksum-refusal') throw new Error('offline journal unavailable'); } });
  assert.equal(result.status, 'FAILED_SAFE'); assert(!provider.calls.some(req => req.operation === 'put'));
  assert.equal(deleted(provider).length, 0);
});
test('cancellation at the journal boundary cannot dispatch an upload afterward', async () => {
  const provider = fakeProvider(), controller = new AbortController();
  const result = await run(provider, { signal: controller.signal, onEvent: event => {
    if (event.label === 'checksum-refusal') controller.abort();
  } });
  assert.equal(result.status, 'FAILED_SAFE'); assert.equal(deleted(provider).length, 0);
  assert(!provider.calls.some(req => req.operation === 'put'));
});

function offlineHttpProvider(sealed) {
  let object = null; const requests = [], p = sealed.plan;
  const metadata = () => ({ 'content-length': '65', 'content-type': p.requiredHeaders['Content-Type'], etag: `"${hash(object)}"`,
    ...Object.fromEntries(Object.entries(p.requiredHeaders).filter(([name]) => name.startsWith('x-amz-meta-'))),
    'x-amz-checksum-sha256': createHash('sha256').update(object).digest('base64') });
  const reply = (status, bytes = null, headers = {}) => new Response(bytes, { status, headers });
  const refuse = (status, code) => reply(status, `<Error><Code>${code}</Code></Error>`, { 'content-type': 'application/xml' });
  return { requests, getObject: () => object, async fetch(urlText, req) {
    const url = new URL(urlText), headers = new Headers(req.headers);
    requests.push({ url, method: req.method, headers, body: req.body && Buffer.from(req.body) });
    assert.equal(url.origin, p.target.uploadOrigin); assert.equal(req.redirect, 'error');
    assert(req.signal instanceof AbortSignal);
    if (req.method === 'OPTIONS') return reply(200, null, { 'access-control-allow-origin': p.target.staffOrigin,
      'access-control-allow-methods': headers.get('access-control-request-method'), 'access-control-allow-headers': headers.get('access-control-request-headers') });
    if (url.pathname === '/') return reply(200, req.method === 'GET' ? '<VersioningConfiguration/>' : null);
    assert.equal(url.pathname, `/${p.target.key}`);
    if (!headers.has('authorization') && !url.searchParams.has('X-Amz-Signature')) return refuse(403, 'AccessDenied');
    if (req.method === 'PUT') {
      assert.equal(headers.get('if-none-match'), '*');
      if (headers.get('x-amz-checksum-sha256') !== createHash('sha256').update(req.body).digest('base64')) return refuse(400, 'BadDigest');
      if (object) return refuse(412, 'PreconditionFailed');
      object = Buffer.from(req.body); return reply(200);
    }
    if (req.method === 'DELETE') { object = null; return reply(204); }
    if (!object) return req.method === 'HEAD' ? reply(404) : refuse(404, 'NoSuchKey');
    if (headers.has('if-match') && headers.get('if-match') !== metadata().etag) return refuse(412, 'PreconditionFailed');
    return reply(200, req.method === 'HEAD' ? null : object, { ...metadata(),
      ...(headers.has('origin') ? { 'access-control-allow-origin': p.target.staffOrigin } : {}) });
  } };
}

test('full photo and artifact qualification use actual candidate adapters and real SDK wire behavior with no network', async () => {
  const require = createRequire(new URL('../../packages/atlas-photo-storage/package.json', import.meta.url));
  const sdk = require('@aws-sdk/client-s3'), { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  for (const sealed of [inputs, artifactInputs]) {
    const provider = offlineHttpProvider(sealed); let photoGrants = 0, artifactPuts = 0, artifactReads = 0;
    const transport = createHttpTransport({ sdk, getSignedUrl,
      createPhotoStorage: args => { const actual = createPhotoStorage(args); return { ...actual, createOriginalUpload: options => { photoGrants++; return actual.createOriginalUpload(options); } }; },
      createS3ManualArtifactTransport: args => { const actual = createS3ManualArtifactTransport(args); return {
        putIfAbsent: options => { artifactPuts++; return actual.putIfAbsent(options); },
        read: options => { artifactReads++; return actual.read(options); },
      }; },
      credentials: { accessKeyId: 'OFFLINE_ONLY', secretAccessKey: 'OFFLINE_SECRET_ONLY' }, fetchImpl: provider.fetch });
    const result = await runCanary({ execute: true, approvedPlanSha: hash(sealed.planBytes), inputs: sealed, transport });
    assert.equal(result.status, 'PASS_CLEANED', JSON.stringify(result)); assert.equal(provider.getObject(), null);
    assert.equal(result.counts.requests, provider.requests.length);
    assert.equal(provider.requests.length, sealed.plan.profile === 'photo' ? 23 : 19);
    assert.equal(photoGrants, sealed.plan.profile === 'photo' ? 1 : 0);
    assert.equal(artifactPuts, sealed.plan.profile === 'artifact' ? 2 : 0);
    assert.equal(artifactReads, sealed.plan.profile === 'artifact' ? 2 : 0);
    for (const request of provider.requests.filter(request => request.method === 'PUT')) {
      assert.equal(request.body.length, 65);
      if (sealed.plan.profile === 'artifact') {
        assert(request.headers.has('authorization'));
        assert.equal(request.headers.get('x-amz-sdk-checksum-algorithm'), 'SHA256');
      }
    }
  }
});

test('real SDK presigning matches candidate PUT settings, pinned server reads and unpinned browser reads without network', async () => {
  const require = createRequire(new URL('../../packages/atlas-photo-storage/package.json', import.meta.url));
  const sdk = require('@aws-sdk/client-s3'), { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const captures = [], signedInputs = [], credentials = { accessKeyId: 'OFFLINE_CANARY_ONLY', secretAccessKey: 'OFFLINE_SECRET_NOT_A_REAL_CREDENTIAL' };
  const transport = createHttpTransport({ createPhotoStorage, sdk, getSignedUrl: (client, command, options) => {
    signedInputs.push(structuredClone(command.input)); return getSignedUrl(client, command, options);
  }, credentials, fetchImpl: async (url, request) => {
    captures.push({ url: new URL(url), request }); return new Response(null, { status: 200 });
  } });
  const base = { target: plan.target, requiredHeaders: plan.requiredHeaders, maximumBodyBytes: 4096, signal: new AbortController().signal };
  await transport.send({ ...base, operation: 'put', body: inputs.payload, checksum: plan.payload.checksumBase64 });
  await transport.send({ ...base, operation: 'get', ifMatch: '"exact-etag"' });
  await transport.send({ ...base, operation: 'get', browser: true });
  const signed = captures[0].url.searchParams.get('X-Amz-SignedHeaders').split(';');
  assert.equal(captures[0].url.searchParams.get('x-amz-sdk-checksum-algorithm'), 'SHA256');
  for (const header of Object.keys(plan.requiredHeaders)) assert(signed.includes(header.toLowerCase()));
  for (const capture of captures) { assert.equal(capture.url.origin, plan.target.uploadOrigin); assert.equal(capture.url.pathname, `/${plan.target.key}`); assert.equal(capture.request.redirect, 'error'); }
  assert.equal(captures[1].request.headers['If-Match'], '"exact-etag"');
  assert.equal(captures[2].request.headers['If-Match'], undefined);
  assert.equal(captures[2].request.headers.Origin, plan.target.staffOrigin);
  assert.equal(signedInputs[1].ChecksumMode, 'ENABLED');
  assert.equal(signedInputs[2].ChecksumMode, undefined); assert.equal(signedInputs[2].IfMatch, undefined);
  // The pinned SDK supplies its own checksum query default to the plain browser GET.
  assert.equal(captures[2].url.searchParams.get('x-amz-checksum-mode'), 'ENABLED');
});
test('HTTP adapter stops oversized streaming bytes and cancels anonymous bodies without reading them', async () => {
  const require = createRequire(new URL('../../packages/atlas-photo-storage/package.json', import.meta.url));
  const sdk = require('@aws-sdk/client-s3'), { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  let cancelled = 0;
  const transport = createHttpTransport({ createPhotoStorage, sdk, getSignedUrl, credentials: { accessKeyId: 'OFFLINE_ONLY', secretAccessKey: 'OFFLINE_SECRET_ONLY' },
    fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4097)); }, cancel() { cancelled++; } }), { status: 200 }) });
  const base = { target: plan.target, requiredHeaders: plan.requiredHeaders, maximumBodyBytes: 4096, signal: new AbortController().signal, operation: 'get' };
  await assert.rejects(transport.send(base), /RESPONSE_BODY_LIMIT/); assert.equal(cancelled, 1);
  const anonymous = await transport.send({ ...base, anonymous: true }); assert.equal(anonymous.bytes, undefined); assert.equal(cancelled, 2);
});
test('versioning parser accepts only complete empty or recognized complete status documents', async () => {
  const require = createRequire(new URL('../../packages/atlas-photo-storage/package.json', import.meta.url));
  const sdk = require('@aws-sdk/client-s3'), { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  let xml;
  const transport = createHttpTransport({ createPhotoStorage, sdk, getSignedUrl, credentials: { accessKeyId: 'OFFLINE_ONLY', secretAccessKey: 'OFFLINE_SECRET_ONLY' },
    fetchImpl: async () => new Response(xml, { status: 200 }) });
  const req = { target: plan.target, requiredHeaders: plan.requiredHeaders, maximumBodyBytes: 4096,
    signal: new AbortController().signal, operation: 'versioning' };
  for (const valid of ['<VersioningConfiguration/>', '<VersioningConfiguration></VersioningConfiguration>',
    '<?xml version="1.0" encoding="UTF-8"?><VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></VersioningConfiguration>']) {
    xml = valid; assert.equal((await transport.send(req)).versioning, null);
  }
  for (const status of ['Enabled', 'Suspended']) {
    xml = `<VersioningConfiguration><Status>${status}</Status></VersioningConfiguration>`;
    assert.equal((await transport.send(req)).versioning, status);
  }
  for (const invalid of ['<VersioningConfiguration><Status', '<VersioningConfiguration>', '<VersioningConfiguration/><Status>Enabled</Status>',
    '<VersioningConfiguration><Status>Unknown</Status></VersioningConfiguration>', '<VersioningConfiguration><Status></Status></VersioningConfiguration>']) {
    xml = invalid; await assert.rejects(transport.send(req), /VERSIONING_RESPONSE_INVALID/);
  }
});
