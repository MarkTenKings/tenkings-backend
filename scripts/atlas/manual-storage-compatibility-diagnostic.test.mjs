import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { prepareManifest, validateManifest, runDiagnostic, diagnosticTransport, BOUNDS } from './manual-storage-compatibility-diagnostic.mjs';
import { createPhotoStorage } from '../../packages/atlas-photo-storage/src/index.mjs';
import { createS3ManualArtifactTransport } from '../../packages/atlas-manual-service/src/artifacts.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const sum = b => createHash('sha256').update(b).digest('base64');
const { manifest, bytes, sha256 } = prepareManifest({ id: '341e734b-a2a4-43ec-97f5-c72a50ecb7d5', createdAt: '2026-09-21T00:00:00.000Z' });
function fixture({ checksum = true, conditional = true, cors = true, readMatch = true, privacy = true, hook } = {}) {
  const objects = new Map(), calls = [];
  function responseObject(req, current) {
    return { status: 200, headers: { 'content-length': '65', 'content-type': req.requiredHeaders['Content-Type'],
      ...Object.fromEntries(Object.entries(req.requiredHeaders).filter(([k]) => k.startsWith('x-amz-meta-'))),
      etag: `"${sha(current)}"`, ...(req.browser ? { 'access-control-allow-origin': req.target.staffOrigin } : {}) }, bytes: Buffer.from(current) };
  }
  return { calls, objects, async send(req) {
    calls.push(req);
    const override = await hook?.(req, objects, calls); if (override) return override;
    const key = req.target.key, current = objects.get(key), absent = { status: 404, headers: {} };
    if (req.operation === 'headBucket') return { status: 200, headers: {} };
    if (req.operation === 'versioning') return { status: 200, headers: {}, versioning: null };
    if (req.operation === 'options') return { status: cors ? 200 : 403, headers: { 'access-control-allow-origin': req.target.staffOrigin,
      'access-control-allow-methods': req.method, 'access-control-allow-headers': req.corsHeaders.join(',') } };
    if (req.anonymous && privacy) return { status: 403, headers: {} };
    if (req.operation === 'put') {
      if (checksum && req.checksum !== sum(req.body)) return { status: 400, headers: {}, errorCode: 'BadDigest' };
      if (conditional && current) return { status: 412, headers: {}, errorCode: 'PreconditionFailed' };
      objects.set(key, Buffer.from(req.body)); return { status: 200, headers: {} };
    }
    if (req.operation === 'delete') { objects.delete(key); return { status: 204, headers: {} }; }
    if (!current) return absent;
    if (req.ifMatch && req.ifMatch !== `"${sha(current)}"` && readMatch) return { status: 412, headers: {} };
    const result = responseObject(req, current); if (req.operation === 'head' || req.anonymous) delete result.bytes;
    return result;
  } };
}

test('sealed manifest verifies current closure and rejects hash/source/key/cap drift', () => {
  assert.deepEqual(validateManifest(sha256, bytes), manifest);
  assert.throws(() => validateManifest('0'.repeat(64), bytes), /MANIFEST_HASH_CHANGED/);
  assert.throws(() => validateManifest(sha256, bytes, { readSource: () => Buffer.from('changed') }), /MANIFEST_CONTRACT_OR_SOURCE_CHANGED/);
  for (const change of [m => m.bounds.requests++, m => m.profiles[0].target.key += '-other', m => m.profiles[0].payloadSha256 = '0'.repeat(64)]) {
    const changed = structuredClone(manifest); change(changed); const b = Buffer.from(JSON.stringify(changed));
    assert.throws(() => validateManifest(sha(b), b), /MANIFEST_CONTRACT_OR_SOURCE_CHANGED/);
  }
});
for (const checksum of [false, true]) for (const conditional of [false, true]) {
  test(`independent checksum=${checksum} conditional=${conditional}, exact cleanup/caps`, async () => {
    const transport = fixture({ checksum, conditional }); const result = await runDiagnostic({ manifest, transport });
    assert.equal(result.status, 'DIAGNOSTIC_COMPLETE'); assert.equal(result.releaseQualified, false);
    assert.equal(result.results.length, 2); assert.equal(transport.objects.size, 0);
    assert.equal(result.counts.putAttempts, 6); assert.equal(result.counts.putBytes, 390);
    assert.equal(result.counts.deleteAttempts, checksum ? 2 : 4);
    assert.equal(result.counts.requests, checksum ? 44 : 50);
    for (const r of result.results) {
      assert.equal(r.observations.checksum, checksum ? 'CHECKSUM_REJECTED' : 'CHECKSUM_UNENFORCED');
      assert.equal(r.observations.conditionalCreate, conditional ? 'CONDITIONAL_REJECTED' : 'CONDITIONAL_UNENFORCED');
      assert.equal(r.cleanup, 'VERIFIED_ABSENT'); assert.ok(r.counts.requests <= 30);
    }
    for (const req of transport.calls) assert.ok(manifest.profiles.some(p => p.target.key === req.target.key));
  });
}
test('CORS/public/read-precondition capability failures remain diagnostic observations, never qualification', async () => {
  const transport = fixture({ checksum: false, conditional: false, cors: false, readMatch: false, privacy: false });
  const result = await runDiagnostic({ manifest, transport });
  assert.equal(result.status, 'DIAGNOSTIC_COMPLETE'); assert.equal(result.releaseQualified, false); assert.equal(transport.objects.size, 0);
  assert.deepEqual(result.results[0].observations.cors, { PUT: 'NOT_ALLOWED', GET: 'NOT_ALLOWED', HEAD: 'NOT_ALLOWED' });
  for (const r of result.results) { assert.equal(r.observations.anonymousget, 'NOT_DENIED'); assert.equal(r.observations.readPrecondition, 'UNENFORCED'); }
});
test('unknown PUT stops immediately, preserves object and requires reconciliation', async () => {
  const transport = fixture({ hook: (r, objects) => { if (r.operation === 'put') { objects.set(r.target.key, Buffer.from(r.body)); throw new Error('lost reply'); } } });
  const result = await runDiagnostic({ manifest, transport });
  assert.equal(result.status, 'DIAGNOSTIC_STOPPED'); assert.equal(result.results[0].cleanup, 'REQUIRES_OPERATOR_RECONCILIATION');
  assert.deepEqual(result.notRun, ['artifact']); assert.equal(result.counts.putAttempts, 1); assert.equal(result.counts.deleteAttempts, 0);
  assert.equal(transport.calls.at(-1).operation, 'put'); assert.equal(transport.objects.size, 1);
});
test('unknown delete stops without retry or a second profile', async () => {
  const transport = fixture({ checksum: false, hook: r => { if (r.operation === 'delete') throw new Error('lost delete reply'); } });
  const result = await runDiagnostic({ manifest, transport });
  assert.equal(result.status, 'DIAGNOSTIC_STOPPED'); assert.equal(result.counts.deleteAttempts, 1); assert.equal(result.counts.putAttempts, 1);
  assert.equal(result.results[0].cleanup, 'REQUIRES_OPERATOR_RECONCILIATION'); assert.equal(transport.calls.at(-1).operation, 'delete');
});
for (const [name, mutation] of [
  ['hash', r => r.bytes = Buffer.alloc(65)],
  ['metadata', r => r.headers['x-amz-meta-atlas-kind'] = 'alien'],
  ['version', r => r.headers['x-amz-version-id'] = 'unexpected-version'],
  ['oversized', r => r.bytes = Buffer.alloc(4097)],
]) test(`unexpected ${name} stops before any delete`, async () => {
  const base = fixture({ checksum: false }); const transport = { async send(req) {
    const result = await base.send(req);
    if (req.label === 'checksum-accepted-cleanup-ownership-get') mutation(result);
    return result;
  } };
  const result = await runDiagnostic({ manifest, transport });
  assert.equal(result.status, 'DIAGNOSTIC_STOPPED'); assert.equal(result.counts.deleteAttempts, 0);
  assert.equal(result.counts.putAttempts, 1); assert.equal(result.results[0].cleanup, 'REQUIRES_OPERATOR_RECONCILIATION');
});
test('bad-digest status without expected code never advances', async () => {
  const transport = fixture({ hook: req => req.operation === 'put' ? { status: 400, headers: {}, errorCode: 'AccessDenied' } : null });
  const result = await runDiagnostic({ manifest, transport });
  assert.equal(result.stopCode, 'CHECKSUM_RESPONSE_UNEXPECTED'); assert.equal(result.counts.putAttempts, 1); assert.equal(result.counts.deleteAttempts, 0);
});
test('initial non-absence, versioning, cancellation and deadline refuse before writes', async () => {
  for (const transport of [fixture({ hook: r => r.label === 'initial-absence' ? { status: 200, headers: {} } : null }),
    fixture({ hook: r => r.operation === 'versioning' ? { status: 200, headers: {}, versioning: 'Enabled' } : null })]) {
    const result = await runDiagnostic({ manifest, transport }); assert.equal(result.counts.putAttempts, 0); assert.equal(result.status, 'DIAGNOSTIC_STOPPED');
  }
  const c = new AbortController(); c.abort();
  assert.equal((await runDiagnostic({ manifest, transport: fixture(), signal: c.signal })).counts.requests, 0);
  let time = 0; const result = await runDiagnostic({ manifest, transport: fixture(), now: () => (time += BOUNDS.totalMs) });
  assert.equal(result.counts.requests, 0); assert.equal(result.stopCode, 'DEADLINE');
});
test('noncooperative transport timeout does not cause subsequent writes or cleanup', async () => {
  const transport = fixture({ hook: r => r.operation === 'put' ? new Promise(() => {}) : null });
  const result = await runDiagnostic({ manifest, transport, timers: { set: fn => setTimeout(fn, 10), clear: clearTimeout } });
  assert.equal(result.status, 'DIAGNOSTIC_STOPPED'); assert.equal(result.counts.putAttempts, 1); assert.equal(result.counts.deleteAttempts, 0);
  assert.equal(result.results[0].cleanup, 'REQUIRES_OPERATOR_RECONCILIATION');
});
test('actual SDK photo and artifact wires carry signed explicit algorithm and fixed bodies', async () => {
  const require = createRequire(new URL('../../packages/atlas-photo-storage/package.json', import.meta.url));
  const sdk = require('@aws-sdk/client-s3'), { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const wires = [];
  const transport = diagnosticTransport({ sdk, getSignedUrl, createPhotoStorage, createS3ManualArtifactTransport,
    credentials: { accessKeyId: 'SYNTHETIC_ACCESS_KEY', secretAccessKey: 'SYNTHETIC_SECRET_NOT_REAL' },
    fetchImpl: async (url, options) => {
      const parsed = new URL(url); wires.push({ parsed, options });
      assert.equal(options.headers['x-amz-sdk-checksum-algorithm'], 'SHA256');
      assert.equal(parsed.searchParams.has('x-amz-sdk-checksum-algorithm'), false);
      assert.equal(options.body.length, 65); assert.equal(options.headers['if-none-match'] ?? options.headers['If-None-Match'], '*');
      return new Response('<Error><Code>BadDigest</Code></Error>', { status: 400 });
    } });
  for (const p of manifest.profiles) for (const label of ['checksum-refusal', 'create-once', 'collision-refusal']) {
    const body = Buffer.from(label === 'collision-refusal' ? p.collisionBase64 : p.payloadBase64, 'base64');
    const result = await transport.send({ ...p, body, label, operation: 'put', checksum: label === 'checksum-refusal' ? sum(Buffer.from(p.collisionBase64, 'base64')) : sum(body),
      signal: new AbortController().signal, maximumBodyBytes: 4096 });
    assert.equal(result.status, 400); assert.equal(result.errorCode, 'BadDigest');
  }
  assert.equal(wires.length, 6);
  for (const { parsed, options } of wires.slice(0, 3)) {
    assert.ok(parsed.searchParams.get('X-Amz-SignedHeaders').split(';').includes('x-amz-sdk-checksum-algorithm'));
    assert.equal(parsed.searchParams.get('X-Amz-Content-Sha256'), 'UNSIGNED-PAYLOAD');
    assert.equal(options.headers['x-amz-checksum-sha256'].length, 44);
  }
  for (const { options } of wires.slice(3)) assert.match(options.headers.authorization, /SignedHeaders=[^,]*x-amz-sdk-checksum-algorithm/);
});

test('exclusive evidence reservation refuses a repeat and preserves first intent/journal', async () => {
  const { reserveEvidence, ROOT } = await import('./manual-storage-compatibility-diagnostic.mjs');
  const { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'atlas-diagnostic-exclusive-'));
  const local = path => { assert.ok(path.startsWith(`${ROOT}/`)); return join(dir, path.slice(ROOT.length + 1)); };
  const effects = { write: (p, bytes, options) => writeFileSync(local(p), bytes, options), mkdir: (p, options) => mkdirSync(local(p), options) };
  try {
    reserveEvidence({ manifestSha256: sha256, manifest, ...effects });
    writeFileSync(join(dir, 'evidence/requests.ndjson'), 'preserved-test-receipt\n');
    const intent = readFileSync(join(dir, 'execution.intent.json'));
    assert.throws(() => reserveEvidence({ manifestSha256: sha256, manifest, ...effects }), { code: 'EEXIST' });
    assert.deepEqual(readFileSync(join(dir, 'execution.intent.json')), intent);
    assert.equal(readFileSync(join(dir, 'evidence/requests.ndjson'), 'utf8'), 'preserved-test-receipt\n');
  } finally { rmSync(dir, { recursive: true }); }
});

for (const enforced of [true, false]) test(`full actual-SDK diagnostic on synthetic HTTP, enforcement=${enforced}`, async () => {
  const require = createRequire(new URL('../../packages/atlas-photo-storage/package.json', import.meta.url));
  const sdk = require('@aws-sdk/client-s3'), { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const backend = fixture({ checksum: enforced, conditional: enforced }); let request;
  const actual = diagnosticTransport({ sdk, getSignedUrl, createPhotoStorage, createS3ManualArtifactTransport,
    credentials: { accessKeyId: 'SYNTHETIC_ACCESS_KEY', secretAccessKey: 'SYNTHETIC_SECRET_NOT_REAL' },
    fetchImpl: async (_url, options) => {
      const observed = await backend.send({ ...request, ...(options.body ? { body: Buffer.from(options.body) } : {}) });
      let body = observed.bytes;
      if (request.operation === 'versioning') body = Buffer.from('<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>');
      else if (observed.errorCode) body = Buffer.from(`<Error><Code>${observed.errorCode}</Code></Error>`);
      return new Response(options.method === 'HEAD' || observed.status === 204 ? null : body ?? '', { status: observed.status, headers: observed.headers });
    } });
  const transport = { async send(req) { request = req; return actual.send(req); } };
  const result = await runDiagnostic({ manifest, transport });
  assert.equal(result.status, 'DIAGNOSTIC_COMPLETE', JSON.stringify(result));
  assert.equal(result.releaseQualified, false); assert.equal(backend.objects.size, 0);
  assert.equal(result.counts.requests, enforced ? 44 : 50);
  assert.equal(backend.calls.length, result.counts.requests);
});
