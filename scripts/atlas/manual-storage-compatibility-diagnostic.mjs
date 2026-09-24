// Bounded provider diagnostics only. Never modifies or repeats a prior canary.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { descriptorSha256 } from '../../packages/atlas-photo-core/src/index.mjs';
import { createHttpTransport, QUALIFICATION_SOURCES } from './manual-release-storage-qualification.mjs';

export const ROOT = '/Users/markthomas/.codex/atlas-handoffs/atlas-connected-manual-20260912/release-readiness/storage/compatibility-20260920';
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SOURCES = Object.freeze([...QUALIFICATION_SOURCES, 'scripts/atlas/manual-storage-compatibility-diagnostic.mjs']);
export const BOUNDS = Object.freeze({ keys: 2, requests: 60, putAttempts: 6, putBytes: 390, deleteAttempts: 4,
  perProfileRequests: 30, perProfilePutAttempts: 3, perProfileDeleteAttempts: 2, responseBytes: 4096,
  requestMs: 10000, profileMs: 300000, totalMs: 600000, sdkMaxAttempts: 1 });
const PURPOSE = 'BOUNDED_STORAGE_CAPABILITY_DIAGNOSTIC_NOT_RELEASE_QUALIFICATION';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const checksum = bytes => createHash('sha256').update(bytes).digest('base64');
const fail = code => { throw Object.assign(new Error(code), { diagnosticCode: code }); };
const need = (value, code) => { if (!value) fail(code); };
const code = error => /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.diagnosticCode ?? '') ? error.diagnosticCode : 'REQUEST_FAILED';
const good = value => value.status >= 200 && value.status < 300;
const canonical = value => Array.isArray(value) ? `[${value.map(canonical)}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
const equal = (a, b) => canonical(a) === canonical(b);

/** Pure: constructs exact synthetic inputs and source hashes; no file/network effects. */
export function prepareManifest({ id, createdAt, readSource = p => readFileSync(resolve(SOURCE_ROOT, p)) }) {
  need(typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id), 'ID_INVALID');
  need(typeof createdAt === 'string' && Number.isFinite(Date.parse(createdAt)) && new Date(createdAt).toISOString() === createdAt, 'TIME_INVALID');
  const profiles = ['photo', 'artifact'].map(profile => {
    const make = marker => Buffer.from(JSON.stringify({ p: profile === 'photo' ? 'P' : 'A', id, v: marker }).padEnd(65, ' '));
    const payload = make(1), collision = make(2);
    need(payload.length === 65 && collision.length === 65, 'PAYLOAD_INVALID');
    const keyPrefix = `atlas-connected-manual-v1/release-compatibility-20260920/${id}`;
    const target = { bucket: 'atlas-grading-private-20260910', region: 'nyc3', endpoint: 'https://nyc3.digitaloceanspaces.com',
      uploadOrigin: 'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com', staffOrigin: 'https://atlasgrading.com',
      key: `${keyPrefix}/${profile === 'photo' ? 'originals/probe.bin' : 'artifacts/probe.json'}` };
    const uploadPlan = { schemaVersion: 1, uploadId: `diagnostic-${id}`, binding: { cardId: `diagnostic-${id}`, pairId: `diagnostic-${id}`, side: 'FRONT', version: 1 },
      object: { key: target.key, versionId: null }, expected: { byteCount: 65, sha256: sha(payload) } };
    const lineage = sha(canonical({ purpose: PURPOSE, id, profile }));
    const requiredHeaders = { 'Content-Type': profile === 'photo' ? 'application/octet-stream' : 'application/json', 'If-None-Match': '*',
      'x-amz-checksum-sha256': checksum(payload), ...(profile === 'photo'
        ? { 'x-amz-meta-atlas-kind': 'original', 'x-amz-meta-atlas-binding-sha256': descriptorSha256(uploadPlan) }
        : { 'x-amz-meta-atlas-manual-lineage-sha256': lineage }), 'x-amz-sdk-checksum-algorithm': 'SHA256' };
    return { profile, keyPrefix, target, requiredHeaders, ...(profile === 'photo' ? { uploadPlan } : {}),
      payloadBase64: payload.toString('base64'), payloadSha256: sha(payload),
      collisionBase64: collision.toString('base64'), collisionSha256: sha(collision) };
  });
  const manifest = { schemaVersion: 1, purpose: PURPOSE, root: ROOT, id, createdAt, bounds: { ...BOUNDS }, profiles,
    sources: Object.fromEntries(SOURCES.map(p => [p, sha(readSource(p))])) };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  return { manifest, bytes, sha256: sha(bytes) };
}
export function validateManifest(expectedSha, bytes, options) {
  need(/^[a-f0-9]{64}$/.test(expectedSha) && sha(bytes) === expectedSha, 'MANIFEST_HASH_CHANGED');
  const manifest = JSON.parse(bytes);
  const expected = prepareManifest({ id: manifest.id, createdAt: manifest.createdAt, ...options });
  need(equal(manifest, expected.manifest), 'MANIFEST_CONTRACT_OR_SOURCE_CHANGED');
  return manifest;
}

/** Actual SDK transport with one explicit diagnostic change to photo presigning:
 * keep the SHA256 algorithm in an HTTP header, alongside its signed checksum.
 */
export function diagnosticTransport({ sdk, getSignedUrl, createPhotoStorage, createS3ManualArtifactTransport, credentials, fetchImpl = fetch }) {
  const photoFactory = options => {
    const actual = createPhotoStorage({ ...options, sign: (client, command, signing) => getSignedUrl(client, command,
      { ...signing, unhoistableHeaders: new Set([...signing.unhoistableHeaders, 'x-amz-sdk-checksum-algorithm']) }) });
    return { async createOriginalUpload(input) {
      const grant = await actual.createOriginalUpload(input);
      return { ...grant, headers: { ...grant.headers, 'x-amz-sdk-checksum-algorithm': 'SHA256' } };
    } };
  };
  return createHttpTransport({ sdk, getSignedUrl, createPhotoStorage: photoFactory, createS3ManualArtifactTransport, credentials,
    fetchImpl: (url, options) => {
      if (options.method === 'PUT') {
        const parsed = new URL(url);
        need(options.headers['x-amz-sdk-checksum-algorithm'] === 'SHA256', 'HTTP_ALGORITHM_MISSING');
        need(!parsed.searchParams.has('x-amz-sdk-checksum-algorithm'), 'ALGORITHM_QUERY_HOISTED');
        const signed = parsed.searchParams.get('X-Amz-SignedHeaders');
        if (signed !== null) need(['if-none-match', 'x-amz-checksum-sha256', 'x-amz-sdk-checksum-algorithm']
          .every(h => signed.split(';').includes(h)), 'PRESIGNED_REQUIRED_HEADER_MISSING');
      }
      return fetchImpl(url, options);
    } });
}

/** Only known, fully reconciled writes may advance. Unknown I/O stops globally. */
export async function runDiagnostic({ manifest, transport, onEvent = () => {}, now = () => performance.now(), signal,
  timers = { set: setTimeout, clear: clearTimeout } }) {
  const expected = prepareManifest({ id: manifest.id, createdAt: manifest.createdAt,
    readSource: p => Buffer.from(p) }).manifest;
  // Runtime inputs must still have the exact prepared shape; source validation is the CLI's prior gate.
  expected.sources = manifest.sources;
  need(equal(manifest, expected), 'RUNTIME_MANIFEST_CHANGED');
  const started = now(), totalDeadline = started + BOUNDS.totalMs;
  const total = { requests: 0, putAttempts: 0, putBytes: 0, deleteAttempts: 0 }, results = [];
  let stopCode = null;
  for (const profile of manifest.profiles) {
    const payload = Buffer.from(profile.payloadBase64, 'base64'), collision = Buffer.from(profile.collisionBase64, 'base64');
    const startedProfile = now(), deadline = Math.min(totalDeadline, startedProfile + BOUNDS.profileMs);
    const counts = { requests: 0, putAttempts: 0, putBytes: 0, deleteAttempts: 0 };
    const observations = {}, events = [];
    let possibleObject = false, cleanup = 'NOT_NEEDED', currentSha = null;
    const emit = value => { const record = { profile: profile.profile, ...value }; events.push(record); onEvent(record); };
    async function request(operation, label, options = {}) {
      need(!signal?.aborted, 'CANCELLED');
      need(now() < deadline, 'DEADLINE');
      need(total.requests < BOUNDS.requests && counts.requests < BOUNDS.perProfileRequests, 'REQUEST_CAP');
      if (operation === 'put') {
        need(counts.putAttempts < BOUNDS.perProfilePutAttempts && total.putAttempts < BOUNDS.putAttempts
          && Buffer.isBuffer(options.body) && options.body.length === 65
          && [profile.payloadSha256, profile.collisionSha256].includes(sha(options.body))
          && total.putBytes + options.body.length <= BOUNDS.putBytes, 'PUT_CAP_OR_PAYLOAD');
        counts.putAttempts++; total.putAttempts++; counts.putBytes += options.body.length; total.putBytes += options.body.length;
      }
      if (operation === 'delete') {
        need(currentSha !== null && counts.deleteAttempts < BOUNDS.perProfileDeleteAttempts && total.deleteAttempts < BOUNDS.deleteAttempts, 'DELETE_NOT_VERIFIED_OR_CAP');
        counts.deleteAttempts++; total.deleteAttempts++;
      }
      counts.requests++; total.requests++;
      const entry = { sequence: counts.requests, operation, label, bodyBytes: options.body?.length ?? 0 };
      emit({ ...entry, state: 'DISPATCHING' });
      const controller = new AbortController(), cancel = () => controller.abort();
      let timeout;
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const expired = new Promise((_, reject) => {
          timeout = timers.set(() => { controller.abort(); reject(Object.assign(new Error('REQUEST_TIMEOUT'), { diagnosticCode: 'REQUEST_TIMEOUT' })); }, Math.min(BOUNDS.requestMs, deadline - now()));
          controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('REQUEST_ABORTED'), { diagnosticCode: 'REQUEST_ABORTED' })), { once: true });
        });
        const result = await Promise.race([Promise.resolve().then(() => {
          need(!controller.signal.aborted && !signal?.aborted, 'CANCELLED');
          if (operation === 'put') { possibleObject = true; currentSha = null; cleanup = 'REQUIRED'; }
          return transport.send({ ...options, operation, label, target: structuredClone(profile.target), requiredHeaders: { ...profile.requiredHeaders },
            profile: profile.profile, keyPrefix: profile.keyPrefix, uploadPlan: structuredClone(profile.uploadPlan),
            signal: controller.signal, maximumBodyBytes: BOUNDS.responseBytes });
        }), expired]);
        need(Number.isInteger(result.status) && result.status >= 100 && result.status <= 599 && result.headers, 'RESPONSE_INVALID');
        need(!result.bytes || result.bytes.length <= BOUNDS.responseBytes, 'RESPONSE_TOO_LARGE');
        need(result.headers['x-amz-version-id'] === undefined, 'OBJECT_VERSION_UNEXPECTED');
        emit({ ...entry, state: 'OBSERVED', status: result.status,
          ...(typeof result.errorCode === 'string' && /^[A-Za-z0-9]{1,80}$/.test(result.errorCode) ? { errorCode: result.errorCode } : {}),
          ...(result.bytes ? { responseBytes: result.bytes.length, responseSha256: sha(result.bytes) } : {}) });
        return result;
      } catch (error) { emit({ ...entry, state: 'STOPPED', code: code(error) }); throw error; }
      finally { timers.clear(timeout); signal?.removeEventListener('abort', cancel); }
    }
    function metadata(result, expectedSha, ignoreNativeChecksum) {
      const h = result.headers;
      need(result.status === 200 && h['content-length'] === '65' && h['content-type'] === profile.requiredHeaders['Content-Type']
        && h['content-encoding'] === undefined && h['content-range'] === undefined && h['x-amz-delete-marker'] !== 'true'
        && Object.entries(profile.requiredHeaders).filter(([k]) => k.startsWith('x-amz-meta-')).every(([k, v]) => h[k] === v)
        && typeof h.etag === 'string' && h.etag.length > 0 && h.etag.length <= 512 && !/[\x00-\x1f\x7f]/.test(h.etag), 'OWNERSHIP_METADATA_CONFLICT');
      if (!ignoreNativeChecksum && h['x-amz-checksum-sha256'] !== undefined)
        need(h['x-amz-checksum-sha256'] === Buffer.from(expectedSha, 'hex').toString('base64'), 'NATIVE_CHECKSUM_CONFLICT');
    }
    async function read(label, expectedSha, ignoreNativeChecksum = false) {
      const head = await request('head', `${label}-head`); metadata(head, expectedSha, ignoreNativeChecksum);
      const get = await request('get', `${label}-get`, { ifMatch: head.headers.etag }); metadata(get, expectedSha, ignoreNativeChecksum);
      need(get.headers.etag === head.headers.etag && get.bytes?.length === 65 && sha(get.bytes) === expectedSha, 'OWNED_BYTES_CONFLICT');
      currentSha = expectedSha; return head;
    }
    async function absent(label) {
      const head = await request('head', `${label}-head`), get = await request('get', `${label}-get`);
      need(head.status === 404 && get.status === 404, 'ABSENCE_UNPROVEN');
      possibleObject = false; currentSha = null; cleanup = 'VERIFIED_ABSENT';
    }
    async function remove(label, expectedSha, ignoreNativeChecksum = false) {
      await read(`${label}-ownership`, expectedSha, ignoreNativeChecksum);
      need(good(await request('delete', `${label}-delete`)), 'DELETE_NOT_CONFIRMED');
      await absent(`${label}-absence`);
    }
    try {
      need((await request('head', 'initial-absence')).status === 404, 'INITIAL_ABSENCE_UNPROVEN');
      need(good(await request('headBucket', 'bucket-status')), 'BUCKET_UNAVAILABLE');
      const versioning = await request('versioning', 'bucket-versioning');
      need(good(versioning) && versioning.versioning === null, 'BUCKET_VERSIONING_UNQUALIFIED');
      if (profile.profile === 'photo') {
        observations.cors = {};
        for (const method of ['PUT', 'GET', 'HEAD']) {
          const headers = method === 'PUT' ? Object.keys(profile.requiredHeaders) : ['content-type'];
          const response = await request('options', `cors-${method}`, { method, corsHeaders: headers });
          const allowed = (response.headers['access-control-allow-headers'] ?? '').toLowerCase().split(',').map(v => v.trim());
          observations.cors[method] = good(response) && response.headers['access-control-allow-origin'] === profile.target.staffOrigin
            && (response.headers['access-control-allow-methods'] ?? '').split(',').map(v => v.trim()).includes(method)
            && headers.every(h => allowed.includes(h.toLowerCase()) || allowed.includes('*')) ? 'ALLOWED' : 'NOT_ALLOWED';
        }
      }
      const bad = await request('put', 'checksum-refusal', { body: payload, checksum: checksum(collision) });
      if (bad.status === 400 && bad.errorCode === 'BadDigest') {
        observations.checksum = 'CHECKSUM_REJECTED'; await absent('checksum-refused-absence');
      } else if (bad.status === 200) {
        observations.checksum = 'CHECKSUM_UNENFORCED';
        await remove('checksum-accepted-cleanup', profile.payloadSha256, true);
      } else fail('CHECKSUM_RESPONSE_UNEXPECTED');
      need(good(await request('put', 'create-once', { body: payload, checksum: checksum(payload) })), 'CREATE_NOT_CONFIRMED');
      const original = await read('created-object', profile.payloadSha256); observations.exactReadback = 'VERIFIED';
      if (profile.profile === 'photo') {
        const browser = await request('get', 'browser-signed-get', { browser: true }); metadata(browser, profile.payloadSha256, false);
        need(browser.bytes?.length === 65 && sha(browser.bytes) === profile.payloadSha256 && browser.headers.etag === original.headers.etag, 'BROWSER_BYTES_CONFLICT');
        observations.browserReadCors = browser.headers['access-control-allow-origin'] === profile.target.staffOrigin ? 'ALLOWED' : 'NOT_ALLOWED';
      }
      for (const operation of ['get', 'head']) {
        const anonymous = await request(operation, `anonymous-${operation}`, { anonymous: true });
        observations[`anonymous${operation}`] = [401, 403].includes(anonymous.status) ? 'DENIED' : 'NOT_DENIED';
      }
      const collisionResult = await request('put', 'collision-refusal', { body: collision, checksum: checksum(collision) });
      if (collisionResult.status === 412) {
        observations.conditionalCreate = 'CONDITIONAL_REJECTED';
        const retained = await read('after-collision', profile.payloadSha256);
        need(retained.headers.etag === original.headers.etag, 'COLLISION_METADATA_CHANGED');
      } else if (collisionResult.status === 200) {
        observations.conditionalCreate = 'CONDITIONAL_UNENFORCED'; await read('after-collision', profile.collisionSha256);
      } else fail('COLLISION_RESPONSE_UNEXPECTED');
      const wrongMatch = await request('get', 'if-match-refusal', { ifMatch: '"atlas-diagnostic-never-match"' });
      if (wrongMatch.status === 412) observations.readPrecondition = 'REJECTED';
      else if (wrongMatch.status === 200) {
        metadata(wrongMatch, currentSha, false);
        need(wrongMatch.bytes?.length === 65 && sha(wrongMatch.bytes) === currentSha, 'READ_PRECONDITION_BYTES_CONFLICT');
        observations.readPrecondition = 'UNENFORCED';
      } else fail('READ_PRECONDITION_UNEXPECTED');
      await remove('final-cleanup', currentSha);
    } catch (error) {
      stopCode = code(error);
      if (possibleObject) cleanup = 'REQUIRES_OPERATOR_RECONCILIATION';
    }
    const result = { profile: profile.profile, key: profile.target.key, observations, cleanup, counts, stopCode,
      elapsedMs: Math.max(0, now() - startedProfile), events };
    results.push(result); emit({ state: 'TERMINAL', cleanup, stopCode });
    if (stopCode) break;
  }
  return { status: stopCode ? 'DIAGNOSTIC_STOPPED' : 'DIAGNOSTIC_COMPLETE', releaseQualified: false,
    purpose: PURPOSE, stopCode, counts: total, elapsedMs: Math.max(0, now() - started), results,
    notRun: manifest.profiles.map(p => p.profile).filter(p => !results.some(r => r.profile === p)) };
}

/** Fixed destination and exclusive claim; test injection changes filesystem effects only. */
export function reserveEvidence({ manifestSha256, manifest, at = new Date().toISOString(),
  write = writeFileSync, mkdir = mkdirSync }) {
  write(`${ROOT}/execution.intent.json`, JSON.stringify({ manifestSha256, at, keys: manifest.profiles.map(p => p.target.key) })+'\n', { flag: 'wx', mode: 0o600 });
  mkdir(`${ROOT}/evidence`, { mode: 0o700 });
  const journal = `${ROOT}/evidence/requests.ndjson`;
  write(journal, '', { flag: 'wx', mode: 0o600 });
  return journal;
}

async function main() {
  const args = process.argv.slice(2);
  need(args.length === 2 && args[0] === '--execute' && /^--manifest-sha256=[a-f0-9]{64}$/.test(args[1]), 'EXACT_EXECUTION_REQUIRED');
  const manifestSha256 = args[1].slice('--manifest-sha256='.length);
  const manifest = validateManifest(manifestSha256, readFileSync(`${ROOT}/manifest.json`));
  need(realpathSync(ROOT) === ROOT, 'ROOT_CHANGED');
  const require = createRequire(new URL('../../packages/atlas-photo-storage/package.json', import.meta.url));
  need(require('@aws-sdk/client-s3/package.json').version === '3.914.0' && require('@aws-sdk/s3-request-presigner/package.json').version === '3.982.0', 'SDK_VERSION_CHANGED');
  for (const [name, relative] of [['@atlas/photo-core', 'packages/atlas-photo-core/src/index.mjs'], ['@atlas/photo-runtime', 'packages/atlas-photo-runtime/src/index.mjs']])
    need(realpathSync(require.resolve(name)) === realpathSync(resolve(SOURCE_ROOT, relative)), 'WORKSPACE_MODULE_CHANGED');
  const { createPhotoStorage } = await import('../../packages/atlas-photo-storage/src/index.mjs');
  const { createS3ManualArtifactTransport } = await import('../../packages/atlas-manual-service/src/artifacts.mjs');
  const transport = diagnosticTransport({ sdk: require('@aws-sdk/client-s3'), getSignedUrl: require('@aws-sdk/s3-request-presigner').getSignedUrl,
    createPhotoStorage, createS3ManualArtifactTransport, credentials: { accessKeyId: process.env.ATLAS_DIAGNOSTIC_ACCESS_KEY_ID, secretAccessKey: process.env.ATLAS_DIAGNOSTIC_SECRET_ACCESS_KEY } });
  const journal = reserveEvidence({ manifestSha256, manifest });
  const abort = new AbortController(), cancel = () => abort.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const result = await runDiagnostic({ manifest, transport, signal: abort.signal, onEvent: event => appendFileSync(journal, JSON.stringify(event)+'\n') });
    writeFileSync(`${ROOT}/evidence/result.json`, JSON.stringify({ manifestSha256, ...result }, null, 2)+'\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: result.status, releaseQualified: false, counts: result.counts, stopCode: result.stopCode,
      profiles: result.results.map(({ profile, observations, cleanup }) => ({ profile, observations, cleanup })) }));
    if (result.status !== 'DIAGNOSTIC_COMPLETE') process.exitCode = 1;
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  console.error(JSON.stringify({ status: 'DIAGNOSTIC_REFUSED_OR_INTERRUPTED', code: code(error), releaseQualified: false,
    action: 'Preserve all intents and evidence; never repeat this diagnostic or either prior canary.' })); process.exitCode = 1;
});
